import { and, eq, gte, sql } from "drizzle-orm";
import { kitchenTicketsTable } from "../db/schema";
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
};

/**
 * How long an unanswered Recall stays on the floor. Long enough to outlast any
 * service, short enough that one left hanging is gone by the next day.
 */
export const KITCHEN_CALL_TTL_MS = 12 * 60 * 60_000;

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
      lines: t.lines,
      created_by: t.createdBy,
    })
    .returning({ id: kitchenTicketsTable.id, ticketNo: kitchenTicketsTable.ticket_no });
  return row;
}
