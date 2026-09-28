import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { kitchenTicketsTable, tableSessionLinesTable, type ServiceType } from "../db/schema";
import { getUTCRangeFromLocalDate } from "./timezone";
import type { LineAddon, LineProduct, Tx } from "./tables";

/**
 * Kitchen Display — the part of it other routes write through. A ticket is
 * made in two places (a table's "Kirim ke Dapur" in routes/tables.ts, the
 * cashier's Dapur button in routes/kitchen.ts) and both must number and shape
 * it the same way, so both come here.
 */

/** One dish on a ticket, as the kitchen reads it. */
export type KitchenLine = {
  /** The cart / bill line it came from — how a later send knows what is new. */
  lineId: string;
  qty: number;
  name: string;
  variant: string | null;
  note: string | null;
  addons: { name: string; qty: number }[];
  /**
   * Set when the note was edited after this line reached the kitchen, so the
   * screen can point at it. Absent on a line whose note came with it.
   */
  noteChangedAt?: string;
};

/**
 * How long an unanswered Recall stays on the floor. Long enough to outlast any
 * service, short enough that one left hanging is gone by the next day.
 */
export const KITCHEN_CALL_TTL_MS = 12 * 60 * 60_000;

/** An open ticket older than this is from an earlier service and drops off the screen. */
export const TICKET_ACTIVE_WINDOW_MS = 24 * 60 * 60_000;

/** A cashier tab's id, as the till sends it for a counter ticket. */
export const TAB_KEY = /^[A-Za-z0-9_-]{1,64}$/;

export const TICKET_STATUSES = ["open", "in_progress", "done", "hold", "cancelled"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** A table bill line's unsent units, as a kitchen line. Null when nothing is new. */
export function tableKitchenLine(l: {
  id: string;
  product: unknown;
  quantity: number;
  sent_qty: number;
  addons: unknown;
  note: string | null;
}): KitchenLine | null {
  const qty = l.quantity - l.sent_qty;
  if (qty <= 0) return null;
  const product = l.product as LineProduct;
  const variant = typeof product.variant_name === "string" && product.variant_name ? product.variant_name : null;
  return {
    lineId: l.id,
    qty,
    name: product.product_name,
    variant,
    note: l.note,
    addons: ((l.addons as LineAddon[] | null) ?? []).map((a) => ({ name: a.name, qty: a.quantity })),
  };
}

/**
 * Serialise ticket writes per outlet, for the rest of the transaction. Taken
 * again inside insertKitchenTicket (advisory locks stack), so a caller that
 * must read what was already sent before deciding takes it first.
 */
export async function lockKitchen(tx: Tx, outletId: number) {
  await tx.execute(sql`select pg_advisory_xact_lock(75, ${outletId})`);
}

/**
 * Write one ticket, numbered "#N" for the outlet's local day. Runs inside the
 * caller's transaction so a ticket exists exactly when what it reports does —
 * for a table, when sent_qty moved.
 */
export async function insertKitchenTicket(
  tx: Tx,
  t: {
    outletId: number;
    timezone: string;
    source: "table" | "counter";
    sessionId?: string | null;
    sourceKey?: string | null;
    label: string | null;
    customer: string | null;
    note?: string | null;
    /** Counter tickets only — a table's ticket is always dine_in. */
    serviceType?: ServiceType | null;
    lines: KitchenLine[];
    createdBy: string;
  },
) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: t.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const { startUTC } = getUTCRangeFromLocalDate(today, t.timezone);
  // Two tills sending at once must not hand the kitchen two "#41"s.
  await lockKitchen(tx, t.outletId);
  const [{ last }] = await tx
    .select({ last: sql<number>`coalesce(max(${kitchenTicketsTable.ticket_no}), 0)::int` })
    .from(kitchenTicketsTable)
    .where(and(eq(kitchenTicketsTable.outlet_id, t.outletId), gte(kitchenTicketsTable.created_at, startUTC)));
  const [row] = await tx
    .insert(kitchenTicketsTable)
    .values({
      outlet_id: t.outletId,
      ticket_no: Number(last) + 1,
      source: t.source,
      session_id: t.sessionId ?? null,
      source_key: t.sourceKey ?? null,
      label: t.label ? t.label.slice(0, 40) : null,
      customer: t.customer ? t.customer.slice(0, 100) : null,
      note: t.note ? t.note.slice(0, 255) : null,
      service_type: t.source === "table" ? "dine_in" : (t.serviceType ?? null),
      lines: t.lines,
      created_by: t.createdBy,
    })
    .returning({ id: kitchenTicketsTable.id, ticketNo: kitchenTicketsTable.ticket_no });
  return row;
}

/**
 * Carry each line's current note onto the live tickets already holding it.
 * A ticket is only made for units the kitchen has not seen, so "jangan pedas"
 * typed after a dish was sent would otherwise never reach the screen — the
 * next send finds no new units and makes no ticket.
 *
 * Only tickets still being worked (Masuk / Dikerjakan / Ditahan) change: a
 * dish already Siap is out of the kitchen. Counter tickets are matched within
 * their till tab; table tickets by line alone, since a merge or move-lines
 * carries lines to another seating while their tickets keep the old one.
 * Returns how many tickets changed.
 */
export async function syncKitchenNotes(
  tx: Tx,
  t: {
    outletId: number;
    source: "table" | "counter";
    /** The till tab, for counter tickets. */
    sourceKey?: string;
    lines: { lineId: string; note: string | null }[];
  },
): Promise<number> {
  if (!t.lines.length) return 0;
  const want = new Map(t.lines.map((l) => [l.lineId, l.note || null]));
  const ids = [...want.keys()];
  await lockKitchen(tx, t.outletId);
  const now = new Date();
  const live = await tx
    .select({ id: kitchenTicketsTable.id, lines: kitchenTicketsTable.lines })
    .from(kitchenTicketsTable)
    .where(
      and(
        eq(kitchenTicketsTable.outlet_id, t.outletId),
        eq(kitchenTicketsTable.source, t.source),
        t.sourceKey ? eq(kitchenTicketsTable.source_key, t.sourceKey) : undefined,
        inArray(kitchenTicketsTable.status, ["open", "in_progress", "hold"]),
        gte(kitchenTicketsTable.created_at, new Date(now.getTime() - TICKET_ACTIVE_WINDOW_MS)),
        sql`exists (
          select 1
            from jsonb_array_elements(${kitchenTicketsTable.lines}) e
           where e ->> 'lineId' = any(ARRAY[${sql.join(
             ids.map((id) => sql`${id}`),
             sql`, `,
           )}]::text[])
        )`,
      ),
    );
  let touched = 0;
  for (const ticket of live) {
    let changed = false;
    const lines = (ticket.lines as KitchenLine[]).map((l) => {
      if (!want.has(l.lineId)) return l;
      const note = want.get(l.lineId) ?? null;
      if ((l.note ?? null) === note) return l;
      changed = true;
      return { ...l, note, noteChangedAt: now.toISOString() };
    });
    if (!changed) continue;
    await tx
      .update(kitchenTicketsTable)
      .set({ lines, updated_at: now })
      .where(eq(kitchenTicketsTable.id, ticket.id));
    touched++;
  }
  return touched;
}

/**
 * Tell a sale's kitchen tickets which order they became, so the kitchen screen
 * can show the receipt's order number beside "#N". Checkout does NOT take a
 * ticket off the screen — paying and cooking are separate; the kitchen still
 * finishes it with Siap — it only gains the number.
 *
 *   counter  every not-yet-linked ticket of the till tab that was paid.
 *   table    every not-yet-linked ticket holding a line of the bill that was
 *            paid. Matched by line, not seating: a merge or move-lines carries
 *            lines to another seating while their tickets keep the old one.
 *            Bounded to what the screen still shows.
 *
 * Called AFTER the sale commits, with any failure logged and dropped: this is
 * a label, and a sale must not roll back over one. Returns how many tickets
 * it touched.
 */
export async function linkKitchenTickets(t: {
  outletId: number;
  orderId: string;
  /** The till tab's id, when the cashier sent one. */
  tabKey: string | null;
  /** The sale settled a table bill (its lines now carry orderId). */
  tableBill: boolean;
}): Promise<number> {
  const now = new Date();
  let linked = 0;
  if (t.tabKey) {
    const rows = await db
      .update(kitchenTicketsTable)
      .set({ order_id: t.orderId, updated_at: now })
      .where(
        and(
          eq(kitchenTicketsTable.outlet_id, t.outletId),
          eq(kitchenTicketsTable.source, "counter"),
          eq(kitchenTicketsTable.source_key, t.tabKey),
          isNull(kitchenTicketsTable.order_id),
        ),
      )
      .returning({ id: kitchenTicketsTable.id });
    linked += rows.length;
  }
  if (t.tableBill) {
    const rows = await db
      .update(kitchenTicketsTable)
      .set({ order_id: t.orderId, updated_at: now })
      .where(
        and(
          eq(kitchenTicketsTable.outlet_id, t.outletId),
          eq(kitchenTicketsTable.source, "table"),
          isNull(kitchenTicketsTable.order_id),
          gte(kitchenTicketsTable.created_at, new Date(now.getTime() - TICKET_ACTIVE_WINDOW_MS)),
          sql`exists (
            select 1
              from jsonb_array_elements(${kitchenTicketsTable.lines}) e
              join ${tableSessionLinesTable} l on l.id = e ->> 'lineId'
             where l.order_id = ${t.orderId}
          )`,
        ),
      )
      .returning({ id: kitchenTicketsTable.id });
    linked += rows.length;
  }
  return linked;
}
