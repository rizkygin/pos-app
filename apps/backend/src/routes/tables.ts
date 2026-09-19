import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, asc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "../db";
import {
  diningTablesTable,
  diningZonesTable,
  outletsTable,
  productsTable,
  tableReservationsTable,
  tableSessionLinesTable,
  tableSessionsTable,
  tableWaitlistTable,
  type FloorWall,
} from "../db/schema";
import {
  hasFeature,
  hasPermission,
  requireOutletAccess,
  type OutletAccess,
  type SubscriptionGate,
} from "../lib/outlet-access";
import {
  HttpError,
  LIVE_SESSION,
  lineUnitPrice,
  parseCartLine,
  releaseSessionTables,
  unpaidLines,
  type LineAddon,
  type LineProduct,
  type Tx,
} from "../lib/tables";
import { getOpenShift } from "../lib/shift";
import { publishFloor, subscribeFloor } from "../lib/floor-events";
import { APP_TIMEZONE, getUTCRangeFromLocalDate } from "../lib/timezone";
import { taxConfigFrom } from "../lib/tax";
import { normalizeIndonesianPhone } from "../lib/utils/phone";

/**
 * Manajemen Meja — floor plan, seating, open table bills, waitlist and
 * reservations. See the table management section of db/schema.ts for the
 * model, and lib/tables.ts for how a bill hands over to the cashier.
 *
 * PERMISSIONS. Floor work (seating, moving, layout) needs `tables`. A bill's
 * contents can also be edited by `cashier`, because the cashier is who rings
 * the items in; so can reading the floor.
 *
 * PLAN GATING (`tableManagement`, Max Lite and up) follows the shift rule:
 * what STARTS something is gated — editing the layout, seating a table, adding
 * to the waitlist or the book, blocking a table. What winds down a seating
 * that already exists is not: saving and paying its bill, moving it, clearing
 * it. A merchant who downgrades mid-service must still be able to take the
 * money for the tables that are sitting down, or their bills are held hostage
 * by a settings page.
 */

const FEATURE = "tableManagement";
const UPGRADE_MESSAGE =
  "Manajemen Meja tersedia mulai paket Max Lite — upgrade paket untuk membukanya.";

const FLOOR = ["tables"] as const;
const FLOOR_OR_CASHIER = ["tables", "cashier"] as const;

/** The layout editor's fixed canvas, in its own units. */
const CANVAS_W = 900;
const CANVAS_H = 620;

/** A booked table shows as held from an hour before until 30 minutes late. */
const HOLD_BEFORE_MS = 60 * 60_000;
const HOLD_AFTER_MS = 30 * 60_000;

type Access = OutletAccess & { userId: string; gate: SubscriptionGate };

// ── small parsing helpers ────────────────────────────────────────────────────

function intIn(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Trimmed text, or null when blank. Over-long input is cut, never refused. */
function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
}

function idParam(request: FastifyRequest, name = "id"): number {
  const id = Number((request.params as Record<string, string>)[name]);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "Id tidak valid");
  return id;
}

function sessionParam(request: FastifyRequest): string {
  const id = (request.params as Record<string, string>).id ?? "";
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) throw new HttpError(400, "Sesi meja tidak valid");
  return id;
}

/** Canonical 628… when it parses; digits as typed otherwise; null when blank. */
function phoneOf(v: unknown): string | null {
  const raw = text(v, 30);
  if (!raw) return null;
  return normalizeIndonesianPhone(raw) ?? raw.replace(/[^\d+]/g, "").slice(0, 20) ?? null;
}

/** The caller's zone for "today", validated — an unknown zone falls back. */
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

/** YYYY-MM-DD of `at` in `tz`. */
function localDate(tz: string, at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

/**
 * May this caller take items back off a table's saved bill (a void)? The
 * owner and floor staff may; a Kasir-only account may only add and pay.
 */
const canVoid = (access: Access) => access.isOwner || hasPermission(access, "tables");

/** Which add-ons a line carries, order-independent, for "is it the same line". */
const addonKey = (addons: LineAddon[] | null | undefined) =>
  JSON.stringify(
    (addons ?? []).map((a) => `${a.product_id}:${a.quantity}`).sort(),
  );

function requireEntitled(access: Access) {
  if (!hasFeature(access.gate, FEATURE)) throw new HttpError(403, UPGRADE_MESSAGE, "PLAN_FEATURE");
}

/**
 * Run a handler, turning an HttpError into its response. Anything else is a
 * real failure and goes to Fastify's 500 as before.
 */
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

// ── seating primitives ───────────────────────────────────────────────────────

/** Lock a seating of this outlet that is still on the floor, or fail. */
async function lockLiveSession(tx: Tx, outletId: number, sessionId: string) {
  const [s] = await tx
    .select()
    .from(tableSessionsTable)
    .where(and(eq(tableSessionsTable.id, sessionId), eq(tableSessionsTable.outlet_id, outletId)))
    .limit(1)
    .for("update");
  if (!s) throw new HttpError(404, "Sesi meja tidak ditemukan");
  if (s.closed_at) throw new HttpError(409, "Meja ini sudah dikosongkan");
  return s;
}

/** Lock one table of this outlet, or fail. */
async function lockTable(tx: Tx, outletId: number, tableId: number) {
  const [t] = await tx
    .select()
    .from(diningTablesTable)
    .where(
      and(
        eq(diningTablesTable.id, tableId),
        eq(diningTablesTable.outlet_id, outletId),
        isNull(diningTablesTable.deletedAt),
      ),
    )
    .limit(1)
    .for("update");
  if (!t) throw new HttpError(404, "Meja tidak ditemukan");
  return t;
}

/**
 * Put `sessionId` on a free table. Conditional on the table still being free,
 * so two hosts seating the same table at once resolve to one winner and one
 * 409 — a read-then-write check in here could not win that race.
 */
async function claimTable(tx: Tx, outletId: number, tableId: number, sessionId: string) {
  const claimed = await tx
    .update(diningTablesTable)
    .set({ session_id: sessionId, updatedAt: new Date() })
    .where(
      and(
        eq(diningTablesTable.id, tableId),
        eq(diningTablesTable.outlet_id, outletId),
        isNull(diningTablesTable.session_id),
        isNull(diningTablesTable.blocked_at),
        isNull(diningTablesTable.deletedAt),
      ),
    )
    .returning({ id: diningTablesTable.id, label: diningTablesTable.label });
  if (claimed.length) return claimed[0];

  const [t] = await tx
    .select({
      label: diningTablesTable.label,
      session: diningTablesTable.session_id,
      blocked: diningTablesTable.blocked_at,
    })
    .from(diningTablesTable)
    .where(
      and(
        eq(diningTablesTable.id, tableId),
        eq(diningTablesTable.outlet_id, outletId),
        isNull(diningTablesTable.deletedAt),
      ),
    )
    .limit(1);
  if (!t) throw new HttpError(404, "Meja tidak ditemukan");
  if (t.blocked) throw new HttpError(409, `Meja ${t.label} sedang diblokir`);
  throw new HttpError(409, `Meja ${t.label} sudah terisi`);
}

/** A new seating on a free table. Returns its id. */
async function seatTable(
  tx: Tx,
  args: { outletId: number; tableId: number; guestName: string | null; pax: number; userId: string },
) {
  const id = crypto.randomUUID();
  // The seating first: the table's pointer to it is a foreign key.
  await tx.insert(tableSessionsTable).values({
    id,
    outlet_id: args.outletId,
    guest_name: args.guestName,
    pax: args.pax,
    opened_by: args.userId,
  });
  await claimTable(tx, args.outletId, args.tableId, id);
  return id;
}

/** Bump a seating's version: its bill changed shape under any open tab. */
async function bumpVersion(tx: Tx, sessionId: string, extra: Record<string, unknown> = {}) {
  await tx
    .update(tableSessionsTable)
    .set({ version: sql`${tableSessionsTable.version} + 1`, updatedAt: new Date(), ...extra })
    .where(eq(tableSessionsTable.id, sessionId));
}

/**
 * A seating whose unpaid lines just changed: reopen it if it had been paid
 * off and something new arrived, or mark it paid if the last unpaid item left
 * and something was paid before. Returns the status it should now have.
 */
async function reconcileStatus(tx: Tx, sessionId: string, current: string) {
  const [counts] = await tx
    .select({
      unpaid: sql<number>`count(*) filter (where ${tableSessionLinesTable.order_id} is null)::int`,
      paid: sql<number>`count(*) filter (where ${tableSessionLinesTable.order_id} is not null)::int`,
    })
    .from(tableSessionLinesTable)
    .where(eq(tableSessionLinesTable.session_id, sessionId));
  const unpaid = Number(counts?.unpaid ?? 0);
  const paid = Number(counts?.paid ?? 0);
  if (current === "paid" && unpaid > 0) return { status: "open", paid_at: null };
  if (current === "open" && unpaid === 0 && paid > 0) return { status: "paid", paid_at: new Date() };
  return {};
}

// ── serialisation ────────────────────────────────────────────────────────────

type LineRow = typeof tableSessionLinesTable.$inferSelect;

function lineSummary(l: LineRow) {
  const product = l.product as LineProduct;
  const addons = (l.addons as LineAddon[]) ?? [];
  const unitPrice = lineUnitPrice(product, addons);
  return {
    id: l.id,
    billNo: l.bill_no,
    productId: l.product_id,
    name: product.product_name,
    variantName: (product.variant_name as string | null | undefined) ?? null,
    quantity: l.quantity,
    unitPrice,
    total: unitPrice * l.quantity,
    addons: addons.map((a) => (a.quantity > 1 ? `${a.quantity}x ${a.name}` : a.name)),
    note: l.note,
    sentQty: l.sent_qty,
  };
}

/** A line as the cashier's cart holds it — product snapshot and all. */
function cartLine(l: LineRow) {
  return {
    lineId: l.id,
    billNo: l.bill_no,
    product: l.product,
    quantity: l.quantity,
    addons: l.addons ?? [],
    note: l.note ?? undefined,
    sentQty: l.sent_qty,
  };
}

async function sessionDetail(dbx: Tx | typeof db, outletId: number, sessionId: string) {
  const [s] = await dbx
    .select()
    .from(tableSessionsTable)
    .where(and(eq(tableSessionsTable.id, sessionId), eq(tableSessionsTable.outlet_id, outletId)))
    .limit(1);
  if (!s) throw new HttpError(404, "Sesi meja tidak ditemukan");
  const [tables, lines] = await Promise.all([
    dbx
      .select({ id: diningTablesTable.id, label: diningTablesTable.label })
      .from(diningTablesTable)
      .where(eq(diningTablesTable.session_id, sessionId))
      .orderBy(asc(diningTablesTable.label)),
    unpaidLines(dbx, sessionId),
  ]);
  return {
    id: s.id,
    guestName: s.guest_name,
    pax: s.pax,
    status: s.status,
    version: s.version,
    splitCount: s.split_count,
    seatedAt: iso(s.seated_at),
    closed: s.closed_at !== null,
    tables,
    lines: lines.map(cartLine),
  };
}

// ── routes ───────────────────────────────────────────────────────────────────

export async function tableRoutes(app: FastifyInstance) {
  /**
   * Everything the floor screen draws, in one read. Polled every few seconds
   * by every host and cashier device, which is what "tersinkron" means on the
   * screen — so it stays a handful of indexed queries, all scoped to one
   * outlet's live rows.
   */
  app.get("/api/floor", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR_OR_CASHIER);
    if (!access) return;
    const outletId = access.outlet.id;
    const tz = timezoneOf(request);
    const now = new Date();
    const { startUTC, endUTC } = getUTCRangeFromLocalDate(localDate(tz, now), tz);

    const [zones, tables, sessions, reservations, waitlist, shift, todayRows] = await Promise.all([
      db
        .select()
        .from(diningZonesTable)
        .where(and(eq(diningZonesTable.outlet_id, outletId), isNull(diningZonesTable.deletedAt)))
        .orderBy(asc(diningZonesTable.sort_order), asc(diningZonesTable.id)),
      db
        .select()
        .from(diningTablesTable)
        .where(and(eq(diningTablesTable.outlet_id, outletId), isNull(diningTablesTable.deletedAt)))
        .orderBy(asc(diningTablesTable.id)),
      db
        .select()
        .from(tableSessionsTable)
        .where(and(eq(tableSessionsTable.outlet_id, outletId), LIVE_SESSION))
        .orderBy(asc(tableSessionsTable.seated_at)),
      db
        .select()
        .from(tableReservationsTable)
        .where(
          and(
            eq(tableReservationsTable.outlet_id, outletId),
            isNull(tableReservationsTable.deletedAt),
            gte(tableReservationsTable.reserved_at, startUTC),
            lte(tableReservationsTable.reserved_at, endUTC),
          ),
        )
        .orderBy(asc(tableReservationsTable.reserved_at)),
      db
        .select()
        .from(tableWaitlistTable)
        .where(
          and(
            eq(tableWaitlistTable.outlet_id, outletId),
            isNull(tableWaitlistTable.seated_at),
            isNull(tableWaitlistTable.cancelled_at),
            gte(tableWaitlistTable.created_at, startUTC),
          ),
        )
        .orderBy(asc(tableWaitlistTable.created_at)),
      getOpenShift(db, outletId),
      // Today's counter sales, split by whether a table's bill became them.
      db.execute(sql`
        select count(*)::int as total,
               count(*) filter (where exists (
                 select 1 from table_session_lines l where l.order_id = o.id
               ))::int as dine_in
          from orders o
         where o.outlet_id = ${outletId}
           and o.source = 'pos'
           and o.deleted_at is null
           and o.created_at >= ${startUTC}
           and o.created_at <= ${endUTC}
      `),
    ]);

    const sessionIds = sessions.map((s) => s.id);
    const lines = sessionIds.length
      ? await db
          .select()
          .from(tableSessionLinesTable)
          .where(inArray(tableSessionLinesTable.session_id, sessionIds))
          .orderBy(asc(tableSessionLinesTable.created_at), asc(tableSessionLinesTable.id))
      : [];

    const linesBySession = new Map<string, LineRow[]>();
    for (const l of lines) {
      const list = linesBySession.get(l.session_id);
      if (list) list.push(l);
      else linesBySession.set(l.session_id, [l]);
    }
    const tablesBySession = new Map<string, number[]>();
    for (const t of tables) {
      if (!t.session_id) continue;
      const list = tablesBySession.get(t.session_id);
      if (list) list.push(t.id);
      else tablesBySession.set(t.session_id, [t.id]);
    }

    // The booking that holds each table right now: the earliest one due
    // within the hold window that has not been seated or written off.
    const holding = new Map<number, (typeof reservations)[number]>();
    for (const r of reservations) {
      if (r.status !== "booked" || !r.table_id) continue;
      const at = new Date(r.reserved_at).getTime();
      if (at - HOLD_BEFORE_MS > now.getTime() || at + HOLD_AFTER_MS < now.getTime()) continue;
      if (!holding.has(r.table_id)) holding.set(r.table_id, r);
    }

    const today = (todayRows.rows[0] ?? {}) as { total?: number; dine_in?: number };
    const tableLabel = new Map(tables.map((t) => [t.id, t.label]));

    return {
      success: true,
      serverTime: now.toISOString(),
      entitled: hasFeature(access.gate, FEATURE),
      permissions: {
        tables: hasPermission(access, "tables"),
        cashier: hasPermission(access, "cashier"),
        owner: access.isOwner,
      },
      outlet: {
        id: outletId,
        name: access.outlet.name,
        address: access.outlet.address,
        phone: access.outlet.phone,
        avatar: access.outlet.avatar,
        overtimeMinutes: access.outlet.table_overtime_minutes,
        // Resolved against the plan, like the cashier page does, so a pre-bill
        // printed here can never carry a tax line the till would not charge.
        tax: hasFeature(access.gate, "tax")
          ? taxConfigFrom(access.outlet)
          : { enabled: false, rate: 0, inclusive: false, label: "Pajak" },
      },
      shift: shift ? { cashierName: shift.cashier_name, openedAt: iso(shift.opened_at) } : null,
      today: {
        dineIn: Number(today.dine_in ?? 0),
        takeAway: Number(today.total ?? 0) - Number(today.dine_in ?? 0),
      },
      zones: zones.map((z) => ({
        id: z.id,
        name: z.name,
        sortOrder: z.sort_order,
        walls: z.walls ?? [],
      })),
      tables: tables.map((t) => {
        const r = holding.get(t.id);
        return {
          id: t.id,
          zoneId: t.zone_id,
          label: t.label,
          capacity: t.capacity,
          shape: t.shape,
          x: t.x,
          y: t.y,
          w: t.w,
          h: t.h,
          sessionId: t.session_id,
          blockedAt: iso(t.blocked_at),
          blockedReason: t.blocked_reason,
          reservation: r
            ? { id: r.id, guestName: r.guest_name, pax: r.pax, reservedAt: iso(r.reserved_at) }
            : null,
        };
      }),
      sessions: sessions.map((s) => {
        const all = linesBySession.get(s.id) ?? [];
        const unpaid = all.filter((l) => l.order_id === null).map(lineSummary);
        const paidTotal = all
          .filter((l) => l.order_id !== null)
          .reduce((sum, l) => sum + lineSummary(l).total, 0);
        return {
          id: s.id,
          guestName: s.guest_name,
          pax: s.pax,
          status: s.status,
          version: s.version,
          seatedAt: iso(s.seated_at),
          billRequestedAt: iso(s.bill_requested_at),
          alertAt: iso(s.alert_at),
          alertNote: s.alert_note,
          splitCount: s.split_count,
          paidAt: iso(s.paid_at),
          tableIds: tablesBySession.get(s.id) ?? [],
          lines: unpaid,
          total: unpaid.reduce((sum, l) => sum + l.total, 0),
          paidTotal,
          unsentQty: unpaid.reduce((n, l) => n + Math.max(0, l.quantity - l.sentQty), 0),
        };
      }),
      reservations: reservations.map((r) => ({
        id: r.id,
        guestName: r.guest_name,
        phone: r.phone,
        pax: r.pax,
        reservedAt: iso(r.reserved_at),
        tableId: r.table_id,
        tableLabel: r.table_id ? (tableLabel.get(r.table_id) ?? null) : null,
        note: r.note,
        status: r.status,
      })),
      waitlist: waitlist.map((w) => ({
        id: w.id,
        queueNo: w.queue_no,
        guestName: w.guest_name,
        phone: w.phone,
        pax: w.pax,
        note: w.note,
        calledAt: iso(w.called_at),
        createdAt: iso(w.created_at),
      })),
    };
  });

  /**
   * Live updates for the floor, as Server-Sent Events.
   *
   * Pushes a `floor` event whenever this outlet's floor changes (see
   * lib/floor-events.ts); the device re-reads what it needs. Authorised once,
   * at connect — the stream itself carries nothing but "changed", so a device
   * whose access is revoked learns nothing from staying connected, and every
   * re-read it triggers is checked again.
   *
   * A comment line every 20s keeps idle proxies from closing the connection,
   * and `retry` tells the browser how soon to reconnect when one does anyway.
   */
  app.get("/api/floor/stream", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR_OR_CASHIER);
    if (!access) return;

    reply.hijack();
    const res = reply.raw;
    // Hijacking skips Fastify's send pipeline, so the headers already set on
    // the reply — CORS above all, which a credentialed cross-origin
    // EventSource cannot do without — are copied across by hand.
    const headers: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(reply.getHeaders())) {
      if (v !== undefined) headers[k] = Array.isArray(v) ? v.map(String) : String(v);
    }
    res.writeHead(200, {
      ...headers,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx-style proxies buffer responses unless told not to.
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n");
    res.write("event: ready\ndata: {}\n\n");

    const unsubscribe = subscribeFloor(access.outlet.id, (event) => {
      res.write(`event: floor\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
    request.raw.on("close", () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  // ── Layout: zones, tables, walls ───────────────────────────────────────────

  app.post("/api/floor/zones", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      requireEntitled(access);
      const name = text((request.body as any)?.name, 40);
      if (!name) throw new HttpError(400, "Nama zona wajib diisi");
      const [{ next }] = await db
        .select({ next: sql<number>`coalesce(max(${diningZonesTable.sort_order}), 0)::int + 1` })
        .from(diningZonesTable)
        .where(and(eq(diningZonesTable.outlet_id, access.outlet.id), isNull(diningZonesTable.deletedAt)));
      const [zone] = await db
        .insert(diningZonesTable)
        .values({ outlet_id: access.outlet.id, name, sort_order: Number(next) || 1 })
        .returning({ id: diningZonesTable.id });
      publishFloor(access.outlet.id, "layout");
      return { success: true, zoneId: zone.id };
    });
  });

  app.patch("/api/floor/zones/:id", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      requireEntitled(access);
      const id = idParam(request);
      const body = (request.body as any) ?? {};
      const patch: Partial<typeof diningZonesTable.$inferInsert> = { updatedAt: new Date() };
      if (body.name !== undefined) {
        const name = text(body.name, 40);
        if (!name) throw new HttpError(400, "Nama zona wajib diisi");
        patch.name = name;
      }
      if (body.sortOrder !== undefined) {
        const order = intIn(body.sortOrder, 0, 1000);
        if (order === null) throw new HttpError(400, "Urutan zona tidak valid");
        patch.sort_order = order;
      }
      const updated = await db
        .update(diningZonesTable)
        .set(patch)
        .where(
          and(
            eq(diningZonesTable.id, id),
            eq(diningZonesTable.outlet_id, access.outlet.id),
            isNull(diningZonesTable.deletedAt),
          ),
        )
        .returning({ id: diningZonesTable.id });
      if (!updated.length) throw new HttpError(404, "Zona tidak ditemukan");
      publishFloor(access.outlet.id, "layout");
      return { success: true };
    });
  });

  /**
   * Remove a zone and its tables. Refused while anyone is sitting in it —
   * deleting an occupied table would strand a live bill with no table to
   * find it by. Bookings on those tables keep their guest and lose the table.
   */
  app.delete("/api/floor/zones/:id", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      const id = idParam(request);
      await db.transaction(async (tx) => {
        const [zone] = await tx
          .select({ id: diningZonesTable.id })
          .from(diningZonesTable)
          .where(
            and(
              eq(diningZonesTable.id, id),
              eq(diningZonesTable.outlet_id, access.outlet.id),
              isNull(diningZonesTable.deletedAt),
            ),
          )
          .limit(1)
          .for("update");
        if (!zone) throw new HttpError(404, "Zona tidak ditemukan");

        const inZone = await tx
          .select({ id: diningTablesTable.id, label: diningTablesTable.label, session: diningTablesTable.session_id })
          .from(diningTablesTable)
          .where(and(eq(diningTablesTable.zone_id, id), isNull(diningTablesTable.deletedAt)))
          .for("update");
        const busy = inZone.find((t) => t.session);
        if (busy) throw new HttpError(409, `Meja ${busy.label} sedang terisi — kosongkan dulu`);

        const now = new Date();
        const ids = inZone.map((t) => t.id);
        if (ids.length) {
          await tx
            .update(diningTablesTable)
            .set({ deletedAt: now })
            .where(inArray(diningTablesTable.id, ids));
          await tx
            .update(tableReservationsTable)
            .set({ table_id: null, updatedAt: now })
            .where(
              and(
                inArray(tableReservationsTable.table_id, ids),
                eq(tableReservationsTable.status, "booked"),
              ),
            );
        }
        await tx.update(diningZonesTable).set({ deletedAt: now }).where(eq(diningZonesTable.id, id));
      });
      publishFloor(access.outlet.id, "layout");
      return { success: true };
    });
  });

  /**
   * Save one zone's layout whole: every table in it and every wall.
   *
   * Tables are matched by id: present ones are updated, new ones (no id) are
   * inserted, and ones missing from the payload are removed — unless someone
   * is sitting at them, which refuses the whole save rather than half of it.
   */
  app.put("/api/floor/zones/:id/layout", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      requireEntitled(access);
      const zoneId = idParam(request);
      const body = (request.body as any) ?? {};
      if (!Array.isArray(body.tables) || body.tables.length > 200) {
        throw new HttpError(400, "Daftar meja tidak valid");
      }
      if (!Array.isArray(body.walls) || body.walls.length > 100) {
        throw new HttpError(400, "Daftar dinding tidak valid");
      }

      type TableIn = {
        id: number | null;
        label: string;
        capacity: number;
        shape: "square" | "round";
        x: number;
        y: number;
        w: number;
        h: number;
      };
      const tablesIn: TableIn[] = body.tables.map((t: any, i: number) => {
        const label = text(t?.label, 10);
        const w = intIn(t?.w, 40, 400);
        const h = intIn(t?.h, 40, 400);
        const capacity = intIn(t?.capacity, 1, 50);
        if (!label) throw new HttpError(400, `Meja ke-${i + 1} belum punya nomor`);
        if (w === null || h === null) throw new HttpError(400, `Ukuran meja ${label} tidak valid`);
        if (capacity === null) throw new HttpError(400, `Kapasitas meja ${label} tidak valid`);
        const x = intIn(t?.x, 0, CANVAS_W - w);
        const y = intIn(t?.y, 0, CANVAS_H - h);
        if (x === null || y === null) throw new HttpError(400, `Posisi meja ${label} di luar kanvas`);
        const id = t?.id == null ? null : intIn(t.id, 1, 2_147_483_647);
        if (t?.id != null && id === null) throw new HttpError(400, `Meja ${label} tidak dikenal`);
        return { id, label, capacity, shape: t?.shape === "round" ? "round" : "square", x, y, w, h };
      });

      const walls: FloorWall[] = body.walls.map((wl: any, i: number) => {
        const w = intIn(wl?.w, 4, CANVAS_W);
        const h = intIn(wl?.h, 4, CANVAS_H);
        if (w === null || h === null) throw new HttpError(400, `Dinding ke-${i + 1} tidak valid`);
        const x = intIn(wl?.x, 0, CANVAS_W - w);
        const y = intIn(wl?.y, 0, CANVAS_H - h);
        if (x === null || y === null) throw new HttpError(400, `Dinding ke-${i + 1} di luar kanvas`);
        const id = typeof wl?.id === "string" && wl.id ? wl.id.slice(0, 40) : `w${i + 1}`;
        return { id, x, y, w, h, kind: wl?.kind === "bar" ? "bar" : "wall" };
      });

      const seen = new Set<string>();
      for (const t of tablesIn) {
        const key = t.label.toLowerCase();
        if (seen.has(key)) throw new HttpError(400, `Nomor meja ${t.label} dipakai dua kali`);
        seen.add(key);
      }

      await db.transaction(async (tx) => {
        const [zone] = await tx
          .select({ id: diningZonesTable.id })
          .from(diningZonesTable)
          .where(
            and(
              eq(diningZonesTable.id, zoneId),
              eq(diningZonesTable.outlet_id, access.outlet.id),
              isNull(diningZonesTable.deletedAt),
            ),
          )
          .limit(1)
          .for("update");
        if (!zone) throw new HttpError(404, "Zona tidak ditemukan");

        const existing = await tx
          .select({ id: diningTablesTable.id, label: diningTablesTable.label, session: diningTablesTable.session_id })
          .from(diningTablesTable)
          .where(and(eq(diningTablesTable.zone_id, zoneId), isNull(diningTablesTable.deletedAt)))
          .for("update");
        const existingIds = new Set(existing.map((t) => t.id));
        for (const t of tablesIn) {
          if (t.id !== null && !existingIds.has(t.id)) {
            throw new HttpError(400, `Meja ${t.label} bukan bagian dari zona ini`);
          }
        }

        // Numbers are unique across the outlet, not just the zone: "Meja 5"
        // is what staff shout across the room.
        const elsewhere = await tx
          .select({ label: diningTablesTable.label })
          .from(diningTablesTable)
          .where(
            and(
              eq(diningTablesTable.outlet_id, access.outlet.id),
              ne(diningTablesTable.zone_id, zoneId),
              isNull(diningTablesTable.deletedAt),
            ),
          );
        const taken = new Set(elsewhere.map((t) => t.label.toLowerCase()));
        const clash = tablesIn.find((t) => taken.has(t.label.toLowerCase()));
        if (clash) throw new HttpError(409, `Nomor meja ${clash.label} sudah dipakai di zona lain`);

        const keep = new Set(tablesIn.flatMap((t) => (t.id === null ? [] : [t.id])));
        const removed = existing.filter((t) => !keep.has(t.id));
        const busy = removed.find((t) => t.session);
        if (busy) {
          throw new HttpError(409, `Meja ${busy.label} sedang terisi — kosongkan dulu sebelum dihapus`);
        }

        const now = new Date();
        if (removed.length) {
          const ids = removed.map((t) => t.id);
          await tx.update(diningTablesTable).set({ deletedAt: now }).where(inArray(diningTablesTable.id, ids));
          await tx
            .update(tableReservationsTable)
            .set({ table_id: null, updatedAt: now })
            .where(
              and(
                inArray(tableReservationsTable.table_id, ids),
                eq(tableReservationsTable.status, "booked"),
              ),
            );
        }

        for (const t of tablesIn) {
          const values = {
            label: t.label,
            capacity: t.capacity,
            shape: t.shape,
            x: t.x,
            y: t.y,
            w: t.w,
            h: t.h,
          };
          if (t.id === null) {
            await tx
              .insert(diningTablesTable)
              .values({ ...values, outlet_id: access.outlet.id, zone_id: zoneId });
          } else {
            await tx
              .update(diningTablesTable)
              .set({ ...values, updatedAt: now })
              .where(eq(diningTablesTable.id, t.id));
          }
        }

        await tx
          .update(diningZonesTable)
          .set({ walls, updatedAt: now })
          .where(eq(diningZonesTable.id, zoneId));
      });
      publishFloor(access.outlet.id, "layout");
      return { success: true };
    });
  });

  /** Floor-wide settings. Only the overtime threshold for now. */
  app.patch("/api/floor/settings", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      requireEntitled(access);
      const minutes = intIn((request.body as any)?.overtimeMinutes, 10, 600);
      if (minutes === null) throw new HttpError(400, "Batas waktu harus 10–600 menit");
      await db
        .update(outletsTable)
        .set({ table_overtime_minutes: minutes, updatedAt: new Date() })
        .where(eq(outletsTable.id, access.outlet.id));
      publishFloor(access.outlet.id, "settings");
      return { success: true };
    });
  });

  // ── Tables: seat, block ────────────────────────────────────────────────────

  app.post("/api/tables/:id/seat", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      requireEntitled(access);
      const tableId = idParam(request);
      const body = (request.body as any) ?? {};
      const pax = intIn(body.pax ?? 1, 1, 200);
      if (pax === null) throw new HttpError(400, "Jumlah tamu tidak valid");
      const sessionId = await db.transaction((tx) =>
        seatTable(tx, {
          outletId: access.outlet.id,
          tableId,
          guestName: text(body.guestName, 100),
          pax,
          userId: access.userId,
        }),
      );
      publishFloor(access.outlet.id, "seat", [sessionId]);
      return { success: true, sessionId };
    });
  });

  app.post("/api/tables/:id/block", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      requireEntitled(access);
      const tableId = idParam(request);
      const reason = text((request.body as any)?.reason, 100);
      await db.transaction(async (tx) => {
        const t = await lockTable(tx, access.outlet.id, tableId);
        if (t.session_id) throw new HttpError(409, `Meja ${t.label} sedang terisi`);
        await tx
          .update(diningTablesTable)
          .set({ blocked_at: t.blocked_at ?? new Date(), blocked_reason: reason, updatedAt: new Date() })
          .where(eq(diningTablesTable.id, tableId));
      });
      publishFloor(access.outlet.id, "block");
      return { success: true };
    });
  });

  app.post("/api/tables/:id/unblock", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      const tableId = idParam(request);
      const updated = await db
        .update(diningTablesTable)
        .set({ blocked_at: null, blocked_reason: null, updatedAt: new Date() })
        .where(
          and(
            eq(diningTablesTable.id, tableId),
            eq(diningTablesTable.outlet_id, access.outlet.id),
            isNull(diningTablesTable.deletedAt),
          ),
        )
        .returning({ id: diningTablesTable.id });
      if (!updated.length) throw new HttpError(404, "Meja tidak ditemukan");
      publishFloor(access.outlet.id, "block");
      return { success: true };
    });
  });

  // ── Seatings ───────────────────────────────────────────────────────────────

  /**
   * Open table bills, for the till's "Meja" picker.
   *
   * A cashier tab is device-local, so the till that did NOT take the order
   * has no tab for it — this is how it finds the bill to ring up. Readable
   * with the cashier permission alone: whoever takes the money at the till
   * may not be allowed on the floor plan, and must still be able to settle
   * a table. Lighter than /api/floor on purpose — the till refreshes it on
   * every live event.
   */
  app.get("/api/table-sessions", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR_OR_CASHIER);
    if (!access) return;
    const sessions = await db
      .select()
      .from(tableSessionsTable)
      .where(
        and(
          eq(tableSessionsTable.outlet_id, access.outlet.id),
          eq(tableSessionsTable.status, "open"),
          LIVE_SESSION,
        ),
      )
      .orderBy(asc(tableSessionsTable.seated_at));
    if (sessions.length === 0) return { success: true, sessions: [] };

    const ids = sessions.map((s) => s.id);
    const [tables, lines] = await Promise.all([
      db
        .select({ label: diningTablesTable.label, sessionId: diningTablesTable.session_id })
        .from(diningTablesTable)
        .where(inArray(diningTablesTable.session_id, ids)),
      db
        .select()
        .from(tableSessionLinesTable)
        .where(and(inArray(tableSessionLinesTable.session_id, ids), isNull(tableSessionLinesTable.order_id))),
    ]);

    return {
      success: true,
      sessions: sessions.map((s) => {
        const own = lines.filter((l) => l.session_id === s.id).map(lineSummary);
        const billNos = [...new Set(own.map((l) => l.billNo))].sort((a, b) => a - b);
        return {
          id: s.id,
          guestName: s.guest_name,
          pax: s.pax,
          seatedAt: iso(s.seated_at),
          billRequestedAt: iso(s.bill_requested_at),
          splitCount: s.split_count,
          tableLabel: tables
            .filter((t) => t.sessionId === s.id)
            .map((t) => t.label)
            .sort((a, b) => a.localeCompare(b, "id", { numeric: true }))
            .join("+"),
          total: own.reduce((n, l) => n + l.total, 0),
          unsentQty: own.reduce((n, l) => n + Math.max(0, l.quantity - l.sentQty), 0),
          // A seating with nothing ordered yet still has a bill 1 to start.
          bills: (billNos.length ? billNos : [1]).map((b) => {
            const onBill = own.filter((l) => l.billNo === b);
            return {
              billNo: b,
              itemCount: onBill.reduce((n, l) => n + l.quantity, 0),
              total: onBill.reduce((n, l) => n + l.total, 0),
            };
          }),
        };
      }),
    };
  });

  /** A seating's bill as the cashier's cart holds it. */
  app.get("/api/table-sessions/:id", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR_OR_CASHIER);
    if (!access) return;
    return handle(reply, async () => {
      const session = await sessionDetail(db, access.outlet.id, sessionParam(request));
      // Tells the till whether to lock saved lines (see the void rule below).
      return { success: true, session, canVoid: canVoid(access) };
    });
  });

  app.patch("/api/table-sessions/:id", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      const id = sessionParam(request);
      const body = (request.body as any) ?? {};
      const patch: Partial<typeof tableSessionsTable.$inferInsert> = { updatedAt: new Date() };
      if (body.guestName !== undefined) patch.guest_name = text(body.guestName, 100);
      if (body.pax !== undefined) {
        const pax = intIn(body.pax, 1, 200);
        if (pax === null) throw new HttpError(400, "Jumlah tamu tidak valid");
        patch.pax = pax;
      }
      const updated = await db
        .update(tableSessionsTable)
        .set(patch)
        .where(
          and(
            eq(tableSessionsTable.id, id),
            eq(tableSessionsTable.outlet_id, access.outlet.id),
            LIVE_SESSION,
          ),
        )
        .returning({ id: tableSessionsTable.id });
      if (!updated.length) throw new HttpError(404, "Sesi meja tidak ditemukan");
      publishFloor(access.outlet.id, "guest", [id]);
      return { success: true };
    });
  });

  /**
   * Replace ONE bill's unpaid lines with what the cashier's tab holds.
   *
   * Carries the version the tab was built from and loses on mismatch: the tab
   * is a local copy, and saving it over a change made elsewhere (an item moved
   * to another table) would quietly undo that change. Lines keep their ids, so
   * what the kitchen was already told about (sent_qty) survives the save.
   */
  app.put("/api/table-sessions/:id/bills/:billNo/lines", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR_OR_CASHIER);
    if (!access) return;
    return handle(reply, async () => {
      const sessionId = sessionParam(request);
      const billNo = idParam(request, "billNo");
      if (billNo > 20) throw new HttpError(400, "Nomor bill tidak valid");
      const body = (request.body as any) ?? {};
      const version = Number(body.version);
      if (!Array.isArray(body.lines) || body.lines.length > 300) {
        throw new HttpError(400, "Daftar item tidak valid");
      }

      const parsed = body.lines.map(parseCartLine);
      const bad = parsed.find((p: unknown) => typeof p === "string");
      if (bad) throw new HttpError(400, bad);
      const incoming = parsed as Exclude<ReturnType<typeof parseCartLine>, string>[];
      const ids = new Set(incoming.map((l) => l.id));
      if (ids.size !== incoming.length) throw new HttpError(400, "Ada baris keranjang ganda");

      // Every product must be this outlet's own. A table bill is a place other
      // outlets' products must never be able to reach.
      const productIds = [...new Set(incoming.map((l) => l.product.id))];
      if (productIds.length) {
        const own = await db
          .select({ id: productsTable.id })
          .from(productsTable)
          .where(and(eq(productsTable.outlet_id, access.outlet.id), inArray(productsTable.id, productIds)));
        if (own.length !== productIds.length) throw new HttpError(400, "Produk tidak dikenal di outlet ini");
      }

      const session = await db.transaction(async (tx) => {
        const s = await lockLiveSession(tx, access.outlet.id, sessionId);
        if (s.status !== "open" && s.status !== "paid") throw new HttpError(409, "Meja ini sudah ditutup");
        if (s.version !== version) {
          throw new HttpError(
            409,
            "Bill meja ini diubah dari perangkat lain. Muat ulang bill dulu.",
            "TABLE_CONFLICT",
          );
        }

        const current = await tx
          .select()
          .from(tableSessionLinesTable)
          .where(inArray(tableSessionLinesTable.id, [...ids, "__none__"]));
        const mine = new Map<string, LineRow>();
        for (const l of current) {
          // A known id anywhere else — another bill, another table, or already
          // paid — means this tab is older than the bill it thinks it holds.
          if (l.session_id !== sessionId || l.bill_no !== billNo || l.order_id !== null) {
            throw new HttpError(
              409,
              "Sebagian item sudah dipindah atau dibayar. Muat ulang bill dulu.",
              "TABLE_CONFLICT",
            );
          }
          mine.set(l.id, l);
        }

        // What is saved on a table's bill is a record of what the table
        // ordered, and most of it is already in the kitchen. Taking it back —
        // deleting a line, lowering a quantity, swapping what a line is — is a
        // void, and voids belong to the owner or the floor (the `tables`
        // permission), not to a Kasir-only account: otherwise one till can
        // quietly empty a bill another till rang in. Adding is always fine.
        if (!canVoid(access)) {
          const saved = await tx
            .select()
            .from(tableSessionLinesTable)
            .where(
              and(
                eq(tableSessionLinesTable.session_id, sessionId),
                eq(tableSessionLinesTable.bill_no, billNo),
                isNull(tableSessionLinesTable.order_id),
              ),
            );
          const next = new Map(incoming.map((l) => [l.id, l]));
          for (const prev of saved) {
            const name = (prev.product as LineProduct).product_name;
            const kept = next.get(prev.id);
            const taken =
              !kept ||
              kept.quantity < prev.quantity ||
              kept.product.id !== prev.product_id ||
              addonKey(kept.addons) !== addonKey(prev.addons as LineAddon[]);
            if (taken) {
              throw new HttpError(
                403,
                `${name} sudah tersimpan di bill meja. Mengurangi atau menghapusnya butuh izin ` +
                  "Manajemen Meja — minta pemilik atau petugas lantai.",
                "VOID_FORBIDDEN",
              );
            }
          }
        }

        const now = new Date();
        for (const l of incoming) {
          const prev = mine.get(l.id);
          if (prev) {
            await tx
              .update(tableSessionLinesTable)
              .set({
                product: l.product,
                quantity: l.quantity,
                addons: l.addons,
                note: l.note,
                // A reduced line can't have told the kitchen about more than
                // it now holds.
                sent_qty: Math.min(prev.sent_qty, l.quantity),
                updated_at: now,
              })
              .where(eq(tableSessionLinesTable.id, l.id));
          } else {
            await tx.insert(tableSessionLinesTable).values({
              id: l.id,
              session_id: sessionId,
              bill_no: billNo,
              product_id: l.product.id,
              product: l.product,
              quantity: l.quantity,
              addons: l.addons,
              note: l.note,
            });
          }
        }

        // Lines on this bill the tab no longer holds were removed there.
        const gone = await tx
          .select({ id: tableSessionLinesTable.id })
          .from(tableSessionLinesTable)
          .where(
            and(
              eq(tableSessionLinesTable.session_id, sessionId),
              eq(tableSessionLinesTable.bill_no, billNo),
              isNull(tableSessionLinesTable.order_id),
            ),
          );
        const drop = gone.map((g) => g.id).filter((id) => !ids.has(id));
        if (drop.length) {
          await tx.delete(tableSessionLinesTable).where(inArray(tableSessionLinesTable.id, drop));
        }

        await bumpVersion(tx, sessionId, await reconcileStatus(tx, sessionId, s.status));
        return sessionDetail(tx, access.outlet.id, sessionId);
      });
      publishFloor(access.outlet.id, "bill", [sessionId]);
      return { success: true, session, canVoid: canVoid(access) };
    });
  });

  /**
   * The kitchen has been told: every unpaid line's sent_qty catches up with
   * its quantity (or just the listed lines). Not a change to the bill, so no
   * version bump — a tab holding this bill stays valid.
   */
  app.post("/api/table-sessions/:id/sent", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR_OR_CASHIER);
    if (!access) return;
    return handle(reply, async () => {
      const sessionId = sessionParam(request);
      const body = (request.body as any) ?? {};
      const lineIds: string[] | null = Array.isArray(body.lineIds)
        ? body.lineIds.filter((x: unknown) => typeof x === "string").slice(0, 300)
        : null;
      if (lineIds && lineIds.length === 0) return { success: true };
      await db.transaction(async (tx) => {
        await lockLiveSession(tx, access.outlet.id, sessionId);
        await tx
          .update(tableSessionLinesTable)
          .set({ sent_qty: sql`${tableSessionLinesTable.quantity}`, updated_at: new Date() })
          .where(
            and(
              eq(tableSessionLinesTable.session_id, sessionId),
              isNull(tableSessionLinesTable.order_id),
              lineIds ? inArray(tableSessionLinesTable.id, lineIds) : undefined,
            ),
          );
      });
      publishFloor(access.outlet.id, "kitchen", [sessionId]);
      return { success: true };
    });
  });

  /** Pindah Meja: one table's occupancy moves to a free table. */
  app.post("/api/table-sessions/:id/move", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      const sessionId = sessionParam(request);
      const body = (request.body as any) ?? {};
      const toTableId = intIn(body.toTableId, 1, 2_147_483_647);
      if (toTableId === null) throw new HttpError(400, "Pilih meja tujuan");
      await db.transaction(async (tx) => {
        await lockLiveSession(tx, access.outlet.id, sessionId);
        const held = await tx
          .select({ id: diningTablesTable.id })
          .from(diningTablesTable)
          .where(eq(diningTablesTable.session_id, sessionId))
          .for("update");
        const fromTableId =
          body.fromTableId != null ? intIn(body.fromTableId, 1, 2_147_483_647) : held.length === 1 ? held[0].id : null;
        if (fromTableId === null || !held.some((t) => t.id === fromTableId)) {
          throw new HttpError(400, "Pilih meja asal yang dipindah");
        }
        await claimTable(tx, access.outlet.id, toTableId, sessionId);
        await tx
          .update(diningTablesTable)
          .set({ session_id: null, updatedAt: new Date() })
          .where(eq(diningTablesTable.id, fromTableId));
      });
      publishFloor(access.outlet.id, "move", [sessionId]);
      return { success: true };
    });
  });

  /**
   * Gabung Meja: bring more tables into this seating. A free table just joins.
   * An occupied one brings its guests and its unpaid bill along, and its own
   * seating ends as "merged" — two parties who pushed their tables together
   * pay one bill, and nothing either of them ordered can be lost on the way.
   */
  app.post("/api/table-sessions/:id/merge", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      const sessionId = sessionParam(request);
      const raw = (request.body as any)?.tableIds;
      if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) {
        throw new HttpError(400, "Pilih meja yang digabung");
      }
      const tableIds = [...new Set(raw.map((v: unknown) => intIn(v, 1, 2_147_483_647)))];
      if (tableIds.some((v) => v === null)) throw new HttpError(400, "Meja tidak valid");

      // Seatings folded into this one: their tabs at the till are now stale.
      const absorbed: string[] = [];
      await db.transaction(async (tx) => {
        const s = await lockLiveSession(tx, access.outlet.id, sessionId);
        let pax = s.pax;
        let guestName = s.guest_name;
        let gainedLines = false;
        const now = new Date();

        for (const tableId of tableIds as number[]) {
          const t = await lockTable(tx, access.outlet.id, tableId);
          if (t.session_id === sessionId) continue;
          if (t.blocked_at) throw new HttpError(409, `Meja ${t.label} sedang diblokir`);
          if (!t.session_id) {
            await claimTable(tx, access.outlet.id, tableId, sessionId);
            continue;
          }
          const other = await lockLiveSession(tx, access.outlet.id, t.session_id);
          absorbed.push(other.id);
          const moved = await tx
            .update(tableSessionLinesTable)
            .set({ session_id: sessionId, bill_no: 1, updated_at: now })
            .where(
              and(
                eq(tableSessionLinesTable.session_id, other.id),
                isNull(tableSessionLinesTable.order_id),
              ),
            )
            .returning({ id: tableSessionLinesTable.id });
          if (moved.length) gainedLines = true;
          pax += other.pax;
          guestName = guestName ?? other.guest_name;
          await tx
            .update(diningTablesTable)
            .set({ session_id: sessionId, updatedAt: now })
            .where(eq(diningTablesTable.session_id, other.id));
          await tx
            .update(tableSessionsTable)
            .set({
              status: "merged",
              merged_into: sessionId,
              closed_at: now,
              version: sql`${tableSessionsTable.version} + 1`,
              updatedAt: now,
            })
            .where(eq(tableSessionsTable.id, other.id));
        }

        // Bills merged together start over as one: a per-item split that
        // made sense for one party means nothing across two.
        await tx
          .update(tableSessionLinesTable)
          .set({ bill_no: 1 })
          .where(and(eq(tableSessionLinesTable.session_id, sessionId), isNull(tableSessionLinesTable.order_id)));
        await bumpVersion(tx, sessionId, {
          pax,
          guest_name: guestName,
          ...(gainedLines ? { split_count: null } : {}),
          ...(gainedLines ? await reconcileStatus(tx, sessionId, s.status) : {}),
        });
      });
      publishFloor(access.outlet.id, "merge", [sessionId, ...absorbed]);
      return { success: true };
    });
  });

  /** Undo part of a merge: one table leaves the seating (never the last one). */
  app.post("/api/table-sessions/:id/release-table", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      const sessionId = sessionParam(request);
      const tableId = intIn((request.body as any)?.tableId, 1, 2_147_483_647);
      if (tableId === null) throw new HttpError(400, "Pilih meja yang dilepas");
      await db.transaction(async (tx) => {
        await lockLiveSession(tx, access.outlet.id, sessionId);
        const held = await tx
          .select({ id: diningTablesTable.id })
          .from(diningTablesTable)
          .where(eq(diningTablesTable.session_id, sessionId))
          .for("update");
        if (!held.some((t) => t.id === tableId)) throw new HttpError(400, "Meja itu bukan bagian sesi ini");
        if (held.length < 2) throw new HttpError(409, "Meja terakhir tidak bisa dilepas — kosongkan mejanya");
        await tx
          .update(diningTablesTable)
          .set({ session_id: null, updatedAt: new Date() })
          .where(eq(diningTablesTable.id, tableId));
      });
      publishFloor(access.outlet.id, "release", [sessionId]);
      return { success: true };
    });
  });

  /**
   * Pindah Item: unpaid lines go to another table's bill. A free target table
   * gets a seating of its own to hold them — the guest who moved over.
   */
  app.post("/api/table-sessions/:id/move-lines", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      const sessionId = sessionParam(request);
      const body = (request.body as any) ?? {};
      const lineIds: string[] = Array.isArray(body.lineIds)
        ? [...new Set<string>(body.lineIds.filter((x: unknown) => typeof x === "string"))]
        : [];
      const toTableId = intIn(body.toTableId, 1, 2_147_483_647);
      if (lineIds.length === 0) throw new HttpError(400, "Pilih item yang dipindah");
      if (toTableId === null) throw new HttpError(400, "Pilih meja tujuan");

      const target = await db.transaction(async (tx) => {
        const s = await lockLiveSession(tx, access.outlet.id, sessionId);
        const lines = await unpaidLines(tx, sessionId, lineIds);
        if (lines.length !== lineIds.length) {
          throw new HttpError(409, "Sebagian item sudah dibayar atau berubah. Muat ulang dulu.");
        }

        const t = await lockTable(tx, access.outlet.id, toTableId);
        if (t.session_id === sessionId) throw new HttpError(400, "Pilih meja lain sebagai tujuan");
        if (t.blocked_at) throw new HttpError(409, `Meja ${t.label} sedang diblokir`);

        let targetId: string;
        let targetStatus = "open";
        if (t.session_id) {
          const other = await lockLiveSession(tx, access.outlet.id, t.session_id);
          targetId = other.id;
          targetStatus = other.status;
        } else {
          targetId = await seatTable(tx, {
            outletId: access.outlet.id,
            tableId: toTableId,
            guestName: null,
            pax: 1,
            userId: access.userId,
          });
        }

        await tx
          .update(tableSessionLinesTable)
          .set({ session_id: targetId, bill_no: 1, updated_at: new Date() })
          .where(inArray(tableSessionLinesTable.id, lineIds));

        await bumpVersion(tx, targetId, await reconcileStatus(tx, targetId, targetStatus));
        await bumpVersion(tx, sessionId, await reconcileStatus(tx, sessionId, s.status));
        return targetId;
      });
      publishFloor(access.outlet.id, "move-lines", [sessionId, target]);
      return { success: true, targetSessionId: target };
    });
  });

  /**
   * Pisah Bill.
   *   even  one bill shown as N equal shares (split_count); settles as ONE
   *         order — it is a way of reading the bill, not of paying it
   *   item  lines assigned to separate bills, each paid as its own order with
   *         its own method; a line can be broken across bills by quantity
   *   none  back to a single bill
   */
  app.put("/api/table-sessions/:id/split", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR_OR_CASHIER);
    if (!access) return;
    return handle(reply, async () => {
      const sessionId = sessionParam(request);
      const body = (request.body as any) ?? {};
      const mode = body.mode;
      if (mode !== "even" && mode !== "item" && mode !== "none") {
        throw new HttpError(400, "Cara memisah tidak dikenal");
      }

      await db.transaction(async (tx) => {
        await lockLiveSession(tx, access.outlet.id, sessionId);
        const lines = await unpaidLines(tx, sessionId);
        const now = new Date();

        if (mode === "even" || mode === "none") {
          const count = mode === "even" ? intIn(body.count, 2, 20) : null;
          if (mode === "even" && count === null) throw new HttpError(400, "Jumlah bill 2–20");
          await tx
            .update(tableSessionLinesTable)
            .set({ bill_no: 1, updated_at: now })
            .where(and(eq(tableSessionLinesTable.session_id, sessionId), isNull(tableSessionLinesTable.order_id)));
          await bumpVersion(tx, sessionId, { split_count: count });
          return;
        }

        // Per item: every unpaid line fully allocated, nothing invented.
        if (!Array.isArray(body.allocations)) throw new HttpError(400, "Pembagian item tidak valid");
        const byLine = new Map<string, { billNo: number; qty: number }[]>();
        for (const a of body.allocations as any[]) {
          const billNo = intIn(a?.billNo, 1, 20);
          const qty = intIn(a?.qty, 1, 9999);
          if (typeof a?.lineId !== "string" || billNo === null || qty === null) {
            throw new HttpError(400, "Pembagian item tidak valid");
          }
          const list = byLine.get(a.lineId) ?? [];
          list.push({ billNo, qty });
          byLine.set(a.lineId, list);
        }
        if (byLine.size !== lines.length || lines.some((l) => !byLine.has(l.id))) {
          throw new HttpError(409, "Bill berubah sejak dibuka. Muat ulang lalu bagi lagi.");
        }

        for (const l of lines) {
          const allocs = byLine.get(l.id)!;
          const sum = allocs.reduce((n, a) => n + a.qty, 0);
          if (sum !== l.quantity) {
            const name = (l.product as LineProduct).product_name;
            throw new HttpError(400, `Jumlah ${name} tidak habis dibagi (${sum} dari ${l.quantity})`);
          }
          // The kitchen already knows about sent_qty units; that knowledge is
          // shared out in allocation order so no unit is told twice.
          let sentLeft = l.sent_qty;
          const [first, ...rest] = allocs;
          const firstSent = Math.min(sentLeft, first.qty);
          sentLeft -= firstSent;
          await tx
            .update(tableSessionLinesTable)
            .set({ bill_no: first.billNo, quantity: first.qty, sent_qty: firstSent, updated_at: now })
            .where(eq(tableSessionLinesTable.id, l.id));
          for (const a of rest) {
            const sent = Math.min(sentLeft, a.qty);
            sentLeft -= sent;
            await tx.insert(tableSessionLinesTable).values({
              id: crypto.randomUUID(),
              session_id: sessionId,
              bill_no: a.billNo,
              product_id: l.product_id,
              product: l.product,
              quantity: a.qty,
              addons: l.addons,
              note: l.note,
              sent_qty: sent,
            });
          }
        }
        await bumpVersion(tx, sessionId, { split_count: null });
      });
      publishFloor(access.outlet.id, "split", [sessionId]);
      return { success: true };
    });
  });

  /** Cetak Bill / Minta Bayar: the table is waiting to pay ("Ck Dropped"). */
  app.post("/api/table-sessions/:id/request-bill", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR_OR_CASHIER);
    if (!access) return;
    return handle(reply, async () => {
      const id = sessionParam(request);
      const updated = await db
        .update(tableSessionsTable)
        .set({
          bill_requested_at: sql`coalesce(${tableSessionsTable.bill_requested_at}, now())`,
          updatedAt: new Date(),
        })
        .where(
          and(eq(tableSessionsTable.id, id), eq(tableSessionsTable.outlet_id, access.outlet.id), LIVE_SESSION),
        )
        .returning({ id: tableSessionsTable.id });
      if (!updated.length) throw new HttpError(404, "Sesi meja tidak ditemukan");
      publishFloor(access.outlet.id, "bill-requested", [id]);
      return { success: true };
    });
  });

  /** Raise or lower the "perlu perhatian" flag. */
  app.post("/api/table-sessions/:id/alert", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      const id = sessionParam(request);
      const body = (request.body as any) ?? {};
      const on = body.on === true;
      const updated = await db
        .update(tableSessionsTable)
        .set({
          alert_at: on ? new Date() : null,
          alert_note: on ? text(body.note, 100) : null,
          updatedAt: new Date(),
        })
        .where(
          and(eq(tableSessionsTable.id, id), eq(tableSessionsTable.outlet_id, access.outlet.id), LIVE_SESSION),
        )
        .returning({ id: tableSessionsTable.id });
      if (!updated.length) throw new HttpError(404, "Sesi meja tidak ditemukan");
      publishFloor(access.outlet.id, "alert", [id]);
      return { success: true };
    });
  });

  /**
   * Kosongkan Meja: the guests have gone. Only with nothing left unpaid — an
   * unpaid bill is money, and clearing it away is what "Batalkan" is for,
   * with its own confirmation.
   */
  app.post("/api/table-sessions/:id/clear", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR_OR_CASHIER);
    if (!access) return;
    return handle(reply, async () => {
      const sessionId = sessionParam(request);
      await db.transaction(async (tx) => {
        const s = await lockLiveSession(tx, access.outlet.id, sessionId);
        const open = await unpaidLines(tx, sessionId);
        if (open.length) throw new HttpError(409, "Masih ada item yang belum dibayar", "HAS_UNPAID");
        const now = new Date();
        await tx
          .update(tableSessionsTable)
          .set({
            // Nothing was ever paid for: they sat down and left.
            status: s.status === "paid" ? "closed" : "cancelled",
            closed_at: now,
            version: sql`${tableSessionsTable.version} + 1`,
            updatedAt: now,
          })
          .where(eq(tableSessionsTable.id, sessionId));
        await releaseSessionTables(tx, sessionId);
      });
      publishFloor(access.outlet.id, "clear", [sessionId]);
      return { success: true };
    });
  });

  /**
   * Batalkan: end the seating even with items unpaid. Needs `force` when
   * there are any — those lines were never a sale, so nothing is reversed,
   * but they stay on the seating as the record of what was walked away from.
   */
  app.post("/api/table-sessions/:id/cancel", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      const sessionId = sessionParam(request);
      const force = (request.body as any)?.force === true;
      await db.transaction(async (tx) => {
        await lockLiveSession(tx, access.outlet.id, sessionId);
        const open = await unpaidLines(tx, sessionId);
        if (open.length && !force) {
          throw new HttpError(409, `Masih ada ${open.length} item belum dibayar`, "HAS_UNPAID");
        }
        const now = new Date();
        await tx
          .update(tableSessionsTable)
          .set({
            status: "cancelled",
            closed_at: now,
            version: sql`${tableSessionsTable.version} + 1`,
            updatedAt: now,
          })
          .where(eq(tableSessionsTable.id, sessionId));
        await releaseSessionTables(tx, sessionId);
      });
      publishFloor(access.outlet.id, "cancel", [sessionId]);
      return { success: true };
    });
  });

  // ── Waiting list ───────────────────────────────────────────────────────────

  app.post("/api/waitlist", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      requireEntitled(access);
      const body = (request.body as any) ?? {};
      const guestName = text(body.guestName, 100);
      if (!guestName) throw new HttpError(400, "Nama tamu wajib diisi");
      const pax = intIn(body.pax ?? 2, 1, 200);
      if (pax === null) throw new HttpError(400, "Jumlah tamu tidak valid");
      const tz = timezoneOf(request);
      const { startUTC } = getUTCRangeFromLocalDate(localDate(tz), tz);

      const entry = await db.transaction(async (tx) => {
        // Serialise numbering per outlet: two hosts adding at once must not
        // hand out the same "W4".
        await tx.execute(sql`select pg_advisory_xact_lock(74, ${access.outlet.id})`);
        const [{ last }] = await tx
          .select({ last: sql<number>`coalesce(max(${tableWaitlistTable.queue_no}), 0)::int` })
          .from(tableWaitlistTable)
          .where(
            and(eq(tableWaitlistTable.outlet_id, access.outlet.id), gte(tableWaitlistTable.created_at, startUTC)),
          );
        const [row] = await tx
          .insert(tableWaitlistTable)
          .values({
            outlet_id: access.outlet.id,
            queue_no: Number(last) + 1,
            guest_name: guestName,
            phone: phoneOf(body.phone),
            pax,
            note: text(body.note, 255),
          })
          .returning({ id: tableWaitlistTable.id, queueNo: tableWaitlistTable.queue_no });
        return row;
      });
      publishFloor(access.outlet.id, "waitlist");
      return { success: true, entry };
    });
  });

  app.post("/api/waitlist/:id/call", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      const id = idParam(request);
      const updated = await db
        .update(tableWaitlistTable)
        .set({ called_at: new Date(), updated_at: new Date() })
        .where(
          and(
            eq(tableWaitlistTable.id, id),
            eq(tableWaitlistTable.outlet_id, access.outlet.id),
            isNull(tableWaitlistTable.seated_at),
            isNull(tableWaitlistTable.cancelled_at),
          ),
        )
        .returning({ id: tableWaitlistTable.id });
      if (!updated.length) throw new HttpError(404, "Tamu tidak ada di daftar tunggu");
      publishFloor(access.outlet.id, "waitlist");
      return { success: true };
    });
  });

  app.post("/api/waitlist/:id/seat", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      requireEntitled(access);
      const id = idParam(request);
      const tableId = intIn((request.body as any)?.tableId, 1, 2_147_483_647);
      if (tableId === null) throw new HttpError(400, "Pilih meja");
      const sessionId = await db.transaction(async (tx) => {
        const [w] = await tx
          .select()
          .from(tableWaitlistTable)
          .where(and(eq(tableWaitlistTable.id, id), eq(tableWaitlistTable.outlet_id, access.outlet.id)))
          .limit(1)
          .for("update");
        if (!w || w.seated_at || w.cancelled_at) throw new HttpError(409, "Tamu sudah tidak menunggu");
        const sid = await seatTable(tx, {
          outletId: access.outlet.id,
          tableId,
          guestName: w.guest_name,
          pax: w.pax,
          userId: access.userId,
        });
        await tx
          .update(tableWaitlistTable)
          .set({ seated_at: new Date(), session_id: sid, updated_at: new Date() })
          .where(eq(tableWaitlistTable.id, id));
        return sid;
      });
      publishFloor(access.outlet.id, "seat", [sessionId]);
      return { success: true, sessionId };
    });
  });

  app.delete("/api/waitlist/:id", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      const id = idParam(request);
      const updated = await db
        .update(tableWaitlistTable)
        .set({ cancelled_at: new Date(), updated_at: new Date() })
        .where(
          and(
            eq(tableWaitlistTable.id, id),
            eq(tableWaitlistTable.outlet_id, access.outlet.id),
            isNull(tableWaitlistTable.seated_at),
            isNull(tableWaitlistTable.cancelled_at),
          ),
        )
        .returning({ id: tableWaitlistTable.id });
      if (!updated.length) throw new HttpError(404, "Tamu tidak ada di daftar tunggu");
      publishFloor(access.outlet.id, "waitlist");
      return { success: true };
    });
  });

  // ── Reservations ───────────────────────────────────────────────────────────

  /** One local day's book, for Ringkasan Reservasi. */
  app.get("/api/reservations", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      const tz = timezoneOf(request);
      const q = request.query as Record<string, string>;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(q.date ?? "") ? q.date : localDate(tz);
      const { startUTC, endUTC } = getUTCRangeFromLocalDate(date, tz);
      const rows = await db
        .select({
          r: tableReservationsTable,
          tableLabel: diningTablesTable.label,
        })
        .from(tableReservationsTable)
        .leftJoin(diningTablesTable, eq(diningTablesTable.id, tableReservationsTable.table_id))
        .where(
          and(
            eq(tableReservationsTable.outlet_id, access.outlet.id),
            isNull(tableReservationsTable.deletedAt),
            gte(tableReservationsTable.reserved_at, startUTC),
            lte(tableReservationsTable.reserved_at, endUTC),
          ),
        )
        .orderBy(asc(tableReservationsTable.reserved_at));
      return {
        success: true,
        date,
        reservations: rows.map(({ r, tableLabel }) => ({
          id: r.id,
          guestName: r.guest_name,
          phone: r.phone,
          pax: r.pax,
          reservedAt: iso(r.reserved_at),
          tableId: r.table_id,
          tableLabel,
          note: r.note,
          status: r.status,
        })),
      };
    });
  });

  /** Shared validation for create and edit. */
  async function reservationValues(body: any, outletId: number) {
    const guestName = text(body.guestName, 100);
    if (!guestName) throw new HttpError(400, "Nama tamu wajib diisi");
    const pax = intIn(body.pax ?? 2, 1, 200);
    if (pax === null) throw new HttpError(400, "Jumlah tamu tidak valid");
    const at = new Date(typeof body.reservedAt === "string" ? body.reservedAt : "");
    if (Number.isNaN(at.getTime())) throw new HttpError(400, "Waktu reservasi tidak valid");
    let tableId: number | null = null;
    if (body.tableId != null && body.tableId !== "") {
      tableId = intIn(body.tableId, 1, 2_147_483_647);
      if (tableId === null) throw new HttpError(400, "Meja tidak valid");
      const [t] = await db
        .select({ id: diningTablesTable.id })
        .from(diningTablesTable)
        .where(
          and(
            eq(diningTablesTable.id, tableId),
            eq(diningTablesTable.outlet_id, outletId),
            isNull(diningTablesTable.deletedAt),
          ),
        )
        .limit(1);
      if (!t) throw new HttpError(404, "Meja tidak ditemukan");
    }
    return {
      guest_name: guestName,
      phone: phoneOf(body.phone),
      pax,
      reserved_at: at,
      table_id: tableId,
      note: text(body.note, 255),
    };
  }

  app.post("/api/reservations", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      requireEntitled(access);
      const values = await reservationValues((request.body as any) ?? {}, access.outlet.id);
      const [row] = await db
        .insert(tableReservationsTable)
        .values({ ...values, outlet_id: access.outlet.id, created_by: access.userId })
        .returning({ id: tableReservationsTable.id });
      publishFloor(access.outlet.id, "reservation");
      return { success: true, id: row.id };
    });
  });

  app.patch("/api/reservations/:id", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      const id = idParam(request);
      const values = await reservationValues((request.body as any) ?? {}, access.outlet.id);
      const updated = await db
        .update(tableReservationsTable)
        .set({ ...values, updatedAt: new Date() })
        .where(
          and(
            eq(tableReservationsTable.id, id),
            eq(tableReservationsTable.outlet_id, access.outlet.id),
            eq(tableReservationsTable.status, "booked"),
            isNull(tableReservationsTable.deletedAt),
          ),
        )
        .returning({ id: tableReservationsTable.id });
      if (!updated.length) throw new HttpError(409, "Reservasi ini sudah tidak bisa diubah");
      publishFloor(access.outlet.id, "reservation");
      return { success: true };
    });
  });

  /** Batal / tidak datang, or back to booked when either was a mistake. */
  app.post("/api/reservations/:id/status", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      const id = idParam(request);
      const status = (request.body as any)?.status;
      if (status !== "booked" && status !== "cancelled" && status !== "no_show") {
        throw new HttpError(400, "Status reservasi tidak dikenal");
      }
      const updated = await db
        .update(tableReservationsTable)
        .set({ status, updatedAt: new Date() })
        .where(
          and(
            eq(tableReservationsTable.id, id),
            eq(tableReservationsTable.outlet_id, access.outlet.id),
            isNull(tableReservationsTable.deletedAt),
            // A seated booking is history: it has a seating behind it.
            ne(tableReservationsTable.status, "seated"),
          ),
        )
        .returning({ id: tableReservationsTable.id });
      if (!updated.length) throw new HttpError(409, "Reservasi ini sudah didudukkan");
      publishFloor(access.outlet.id, "reservation");
      return { success: true };
    });
  });

  /** The booked party arrived: seat them at their table (or another). */
  app.post("/api/reservations/:id/seat", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, FLOOR);
    if (!access) return;
    return handle(reply, async () => {
      requireEntitled(access);
      const id = idParam(request);
      const bodyTable = (request.body as any)?.tableId;
      const sessionId = await db.transaction(async (tx) => {
        const [r] = await tx
          .select()
          .from(tableReservationsTable)
          .where(
            and(
              eq(tableReservationsTable.id, id),
              eq(tableReservationsTable.outlet_id, access.outlet.id),
              isNull(tableReservationsTable.deletedAt),
            ),
          )
          .limit(1)
          .for("update");
        if (!r || r.status !== "booked") throw new HttpError(409, "Reservasi ini tidak sedang menunggu");
        const tableId = bodyTable != null ? intIn(bodyTable, 1, 2_147_483_647) : r.table_id;
        if (tableId === null) throw new HttpError(400, "Pilih meja untuk tamu ini");
        const sid = await seatTable(tx, {
          outletId: access.outlet.id,
          tableId,
          guestName: r.guest_name,
          pax: r.pax,
          userId: access.userId,
        });
        await tx
          .update(tableReservationsTable)
          .set({ status: "seated", session_id: sid, table_id: tableId, updatedAt: new Date() })
          .where(eq(tableReservationsTable.id, id));
        return sid;
      });
      publishFloor(access.outlet.id, "seat", [sessionId]);
      return { success: true, sessionId };
    });
  });
}
