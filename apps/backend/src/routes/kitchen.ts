import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, asc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { kitchenTicketsTable } from "../db/schema";
import { hasFeature, requireOutletAccess, type SubscriptionGate } from "../lib/outlet-access";
import { HttpError } from "../lib/tables";
import {
  TICKET_STATUSES,
  insertKitchenTicket,
  lockKitchen,
  type KitchenLine,
  type TicketStatus,
} from "../lib/kitchen";
import { publishFloor } from "../lib/floor-events";
import { APP_TIMEZONE } from "../lib/timezone";

/**
 * Kitchen Display (KDS) — the kitchen's screen of tickets, and its Recall.
 *
 * Tickets are written by the places that tell the kitchen something: a
 * table's "Kirim ke Dapur" (routes/tables.ts, POST /sent) and the cashier's
 * Dapur button on a counter tab (POST /api/kitchen/tickets below). The kitchen
 * moves them through Masuk → Dikerjakan → Siap, and can call a waiter from any
 * ticket at any time ("Recall"): the call waits on the floor page until a
 * waiter acknowledges it.
 *
 * Every change publishes on the floor bus (lib/floor-events.ts) — reason
 * "ticket" for the kitchen's own screens, "call" for a Recall raised or
 * answered, which is what the floor page listens for.
 *
 * PERMISSIONS. The screen is `kitchen` (the owner passes every check).
 * Writing a counter ticket is the till's (`cashier`). Answering a Recall is
 * anyone on the floor, the till or the kitchen.
 *
 * PLAN GATING follows the table rule: what STARTS something is gated (a new
 * counter ticket needs the pager counter feature, the same flag that shows the
 * Dapur button); working through tickets that already exist never is.
 */

const KITCHEN = ["kitchen"] as const;
const TILL = ["cashier"] as const;
const ANSWER_CALL = ["tables", "cashier", "kitchen"] as const;

/** A finished or cancelled ticket stays on the screen this long. */
const FINISHED_VISIBLE_MS = 30 * 60_000;
/** An open ticket older than this is from an earlier service and drops off. */
const ACTIVE_WINDOW_MS = 24 * 60 * 60_000;

/** Pager / counter tickets need the counter kitchen feature; tables have their own. */
const entitled = (gate: SubscriptionGate) =>
  hasFeature(gate, "pager") || hasFeature(gate, "tableManagement");

async function handle(reply: FastifyReply, fn: () => Promise<unknown>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ success: false, error: err.message, code: err.code });
    }
    throw err;
  }
}

/** Trimmed text, or null when blank. Over-long input is cut, never refused. */
function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
}

function ticketParam(request: FastifyRequest): number {
  const id = Number((request.params as Record<string, string>).id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "Tiket tidak valid");
  return id;
}

/** The caller's zone for "today" (ticket numbering), validated. */
function timezoneOf(request: FastifyRequest): string {
  const tz = (request.query as Record<string, string>)?.timezone;
  if (typeof tz === "string" && tz) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    } catch {
      /* fall through */
    }
  }
  return APP_TIMEZONE;
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

/** One counter cart line as the kitchen needs it, or an error sentence. */
function parseCounterLine(raw: unknown): KitchenLine | string {
  const r = (raw ?? {}) as Record<string, unknown>;
  const lineId = typeof r.lineId === "string" ? r.lineId.trim() : "";
  if (!lineId || lineId.length > 64) return "Baris pesanan tidak valid";
  const name = text(r.name, 255);
  if (!name) return "Nama menu kosong";
  const qty = Number(r.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 9999) return `Jumlah ${name} tidak valid`;
  const addons = Array.isArray(r.addons) ? r.addons.slice(0, 30) : [];
  return {
    lineId,
    qty,
    name,
    variant: text(r.variant, 100),
    note: text(r.note, 200),
    addons: addons
      .map((a) => {
        const x = (a ?? {}) as Record<string, unknown>;
        const n = text(x.name, 255);
        const q = Number(x.qty);
        return n && Number.isInteger(q) && q >= 1 && q <= 999 ? { name: n, qty: q } : null;
      })
      .filter((a): a is { name: string; qty: number } => a !== null),
  };
}

function ticketView(t: typeof kitchenTicketsTable.$inferSelect) {
  return {
    id: t.id,
    ticketNo: t.ticket_no,
    source: t.source,
    sessionId: t.session_id,
    label: t.label,
    customer: t.customer,
    note: t.note,
    lines: t.lines as KitchenLine[],
    status: t.status,
    statusAt: iso(t.status_at),
    startedAt: iso(t.started_at),
    createdAt: iso(t.created_at),
    call: t.call_at
      ? { at: iso(t.call_at), note: t.call_note, count: t.call_count, ackAt: iso(t.call_ack_at) }
      : null,
  };
}

export async function kitchenRoutes(app: FastifyInstance) {
  /** The kitchen screen: every live ticket, plus the recently finished. */
  app.get("/api/kitchen/tickets", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, KITCHEN);
    if (!access) return;
    const now = Date.now();
    const rows = await db
      .select()
      .from(kitchenTicketsTable)
      .where(
        and(
          eq(kitchenTicketsTable.outlet_id, access.outlet.id),
          gte(kitchenTicketsTable.created_at, new Date(now - ACTIVE_WINDOW_MS)),
          or(
            inArray(kitchenTicketsTable.status, ["open", "in_progress", "hold"]),
            gte(kitchenTicketsTable.status_at, new Date(now - FINISHED_VISIBLE_MS)),
          ),
        ),
      )
      .orderBy(asc(kitchenTicketsTable.created_at), asc(kitchenTicketsTable.id))
      .limit(300);
    return {
      success: true,
      serverTime: new Date(now).toISOString(),
      entitled: entitled(access.gate),
      outlet: { name: access.outlet.name },
      tickets: rows.map(ticketView),
    };
  });

  /**
   * The cashier's Dapur button on a counter tab. The till sends the whole
   * cart every time (a reprint is the normal fix for a lost ticket); the
   * kitchen gets only what earlier tickets of the same tab did not already
   * hold, so a reprint adds nothing and an added drink adds just the drink.
   */
  app.post("/api/kitchen/tickets", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, TILL);
    if (!access) return;
    return handle(reply, async () => {
      if (!entitled(access.gate)) {
        throw new HttpError(
          403,
          "Layar Dapur tersedia mulai paket Max Lite — upgrade paket untuk membukanya.",
        );
      }
      const body = (request.body as any) ?? {};
      const tabKey = typeof body.tabKey === "string" ? body.tabKey.trim() : "";
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(tabKey)) throw new HttpError(400, "Tab kasir tidak valid");
      if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > 300) {
        throw new HttpError(400, "Daftar item tidak valid");
      }
      const parsed = body.lines.map(parseCounterLine);
      const bad = parsed.find((p: unknown) => typeof p === "string");
      if (bad) throw new HttpError(400, bad);
      const lines = parsed as KitchenLine[];

      const ticket = await db.transaction(async (tx) => {
        // Before reading what was sent: two presses racing must not both see
        // the same "nothing sent yet" and hand the kitchen the cart twice.
        await lockKitchen(tx, access.outlet.id);
        const earlier = await tx
          .select({ lines: kitchenTicketsTable.lines })
          .from(kitchenTicketsTable)
          .where(
            and(
              eq(kitchenTicketsTable.outlet_id, access.outlet.id),
              eq(kitchenTicketsTable.source_key, tabKey),
            ),
          );
        const sent = new Map<string, number>();
        for (const t of earlier) {
          for (const l of t.lines as KitchenLine[]) sent.set(l.lineId, (sent.get(l.lineId) ?? 0) + l.qty);
        }
        const fresh = lines
          .map((l) => ({ ...l, qty: l.qty - (sent.get(l.lineId) ?? 0) }))
          .filter((l) => l.qty > 0);
        if (!fresh.length) return null;
        return insertKitchenTicket(tx, {
          outletId: access.outlet.id,
          timezone: timezoneOf(request),
          source: "counter",
          sourceKey: tabKey,
          label: text(body.label, 40),
          customer: text(body.customer, 100),
          note: text(body.note, 255),
          lines: fresh,
          createdBy: access.userId,
        });
      });
      if (ticket) publishFloor(access.outlet.id, "ticket");
      return { success: true, ticket };
    });
  });

  /** Mulai / Selesai / Tahan / Lanjut / Batal / Buka. */
  app.post("/api/kitchen/tickets/:id/status", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, KITCHEN);
    if (!access) return;
    return handle(reply, async () => {
      const id = ticketParam(request);
      const status = (request.body as any)?.status as TicketStatus;
      if (!TICKET_STATUSES.includes(status)) throw new HttpError(400, "Status tiket tidak valid");
      const now = new Date();
      const updated = await db
        .update(kitchenTicketsTable)
        .set({
          status,
          status_at: now,
          // The Dikerjakan timer runs from Mulai; Tahan → Lanjut → Mulai
          // restarts it, since the dish was not being made in between.
          ...(status === "in_progress" ? { started_at: now } : {}),
          updated_at: now,
        })
        .where(
          and(
            eq(kitchenTicketsTable.id, id),
            eq(kitchenTicketsTable.outlet_id, access.outlet.id),
            sql`${kitchenTicketsTable.status} <> ${status}`,
          ),
        )
        .returning({ id: kitchenTicketsTable.id });
      if (updated.length) publishFloor(access.outlet.id, "ticket");
      return { success: true };
    });
  });

  /**
   * Recall: call a waiter to this ticket. Allowed at any stage but Batal —
   * a question about the order, a dish that ran out, food that is up. Calling
   * again while unanswered re-raises it (and counts it), so the floor sees
   * the latest reason.
   */
  app.post("/api/kitchen/tickets/:id/call", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, KITCHEN);
    if (!access) return;
    return handle(reply, async () => {
      const id = ticketParam(request);
      const note = text((request.body as any)?.note, 100);
      const now = new Date();
      const [row] = await db
        .update(kitchenTicketsTable)
        .set({
          call_at: now,
          call_note: note,
          call_count: sql`${kitchenTicketsTable.call_count} + 1`,
          call_ack_at: null,
          call_ack_by: null,
          updated_at: now,
        })
        .where(
          and(
            eq(kitchenTicketsTable.id, id),
            eq(kitchenTicketsTable.outlet_id, access.outlet.id),
            sql`${kitchenTicketsTable.status} <> 'cancelled'`,
          ),
        )
        .returning({ id: kitchenTicketsTable.id });
      if (!row) throw new HttpError(404, "Tiket tidak ditemukan atau sudah dibatalkan");
      // No seating ids: nothing on a bill changed, so a till holding the
      // table's tab has nothing to re-check.
      publishFloor(access.outlet.id, "call");
      return { success: true };
    });
  });

  /** A waiter answered the Recall. Idempotent: two waiters tapping is fine. */
  app.post("/api/kitchen/tickets/:id/ack", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, ANSWER_CALL);
    if (!access) return;
    return handle(reply, async () => {
      const id = ticketParam(request);
      const now = new Date();
      const [row] = await db
        .update(kitchenTicketsTable)
        .set({ call_ack_at: now, call_ack_by: access.userId, updated_at: now })
        .where(
          and(
            eq(kitchenTicketsTable.id, id),
            eq(kitchenTicketsTable.outlet_id, access.outlet.id),
            isNotNull(kitchenTicketsTable.call_at),
            isNull(kitchenTicketsTable.call_ack_at),
          ),
        )
        .returning({ id: kitchenTicketsTable.id });
      if (row) publishFloor(access.outlet.id, "call");
      return { success: true };
    });
  });
}
