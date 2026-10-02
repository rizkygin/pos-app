import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import {
  diningTablesTable,
  diningZonesTable,
  menuGroupsTable,
  outletsTable,
  productsTable,
  selfOrdersTable,
  tableSessionLinesTable,
} from "../db/schema";
import {
  getSubscriptionGate,
  hasFeature,
  requireOutletAccess,
} from "../lib/outlet-access";
import { addonGroupsForProducts, type AddonGroupView } from "../lib/addons";
import { INTERNAL_CATEGORIES } from "../lib/outlet-features";
import {
  HttpError,
  lineUnitPrice,
  type LineAddon,
  type LineProduct,
  type Tx,
} from "../lib/tables";
import { haversineKm } from "../lib/utils/geo";
import { APP_TIMEZONE, getUTCRangeFromLocalDate } from "../lib/timezone";
import { parseServiceType } from "../lib/service-type";
import { taxConfigFrom } from "../lib/tax";
import { publishSelfOrder, subscribeSelfOrder } from "../lib/self-order-events";
import { publishFloor } from "../lib/floor-events";
import { openEventStream } from "../lib/sse";
import { sendSelfOrderPush } from "../lib/fcm";
import { registerStaffDevice, revokeStaffDevice } from "../lib/staff-device";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { bumpVersion, lockLiveSession, lockTable, reconcileStatus, seatTable } from "./tables";

/**
 * Pesan Mandiri — the customer orders from their own phone on /menu/[outlet]
 * and pays at the cashier. See selfOrdersTable in db/schema.ts for the model.
 *
 * THE FLOW. The phone sends (POST /api/self-order) → the till rings (SSE) →
 * a cashier accepts it into a till tab, or onto the table's bill when it came
 * from a table QR → the customer pays at the counter and the cashier checks it
 * out like any other sale. A self order never becomes an `orders` row by
 * itself: the cashier's checkout is the one place a sale is written.
 *
 * WHO MAY SEND. Nobody signs in — a customer at a table will not make an
 * account to order a coffee. What keeps orders from arriving from the other
 * side of town is the location check: the phone must be within the owner's
 * radius of the outlet's pin, re-checked on every send. A browser's location
 * can be faked by someone determined; the cashier's accept step is the second
 * gate, and nothing here moves money or stock.
 *
 * PLAN GATING (`selfOrder`, Max Lite and up) follows the shift rule: what
 * STARTS something is gated — a customer sending a new order, the owner
 * switching it on. Working off the orders already waiting is not, so a
 * merchant who downgrades mid-service can still take the money.
 */

const FEATURE = "selfOrder";
const UPGRADE_MESSAGE =
  "Pesan Mandiri tersedia mulai paket Max Lite — upgrade paket untuk membukanya.";

/** Who works the self-order inbox: the till, or the host on the floor. */
const STAFF = ["cashier", "tables"] as const;

export const RADIUS_MIN_M = 30;
export const RADIUS_MAX_M = 1000;
/**
 * GPS slack. A phone reports where it thinks it is plus how sure it is; indoors
 * that can be off by tens of metres, so a customer at the back of the shop
 * whose fix drifted must not be refused. Capped, or a coarse network fix
 * ("±2 km") would pass from anywhere in the neighbourhood.
 */
const ACCURACY_SLACK_MAX_M = 100;
/** Worse than this is an IP-grade guess, not a location. */
const ACCURACY_REJECT_M = 1500;

/** A pending order older than this is stale: off the till, "kedaluwarsa" to the customer. */
const PENDING_TTL_MS = 12 * 60 * 60_000;
/** Accepted/rejected orders the inbox still shows under "Terakhir". */
const RECENT_WINDOW_MS = 6 * 60 * 60_000;
/** One busy evening's worth; beyond it something is flooding the till. */
const MAX_PENDING_PER_OUTLET = 40;
const MAX_LINES = 40;
const MAX_LINE_QTY = 50;

const ORDER_ID = /^[A-Za-z0-9-]{8,64}$/;

// ── small helpers ────────────────────────────────────────────────────────────

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

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
}

function orderIdParam(request: FastifyRequest): string {
  const id = (request.params as Record<string, string>).id ?? "";
  if (!ORDER_ID.test(id)) throw new HttpError(400, "Pesanan tidak valid");
  return id;
}

/** The caller's zone for "today" (queue numbers), validated — unknown falls back. */
function zoneOf(v: unknown): string {
  if (typeof v === "string" && v) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: v });
      return v;
    } catch {
      /* fall through */
    }
  }
  return APP_TIMEZONE;
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

const fmtDistance = (m: number) =>
  m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`;

type OutletRow = typeof outletsTable.$inferSelect;

/** The outlet's pin, or null when the owner never set one. "0" is the unset sentinel. */
function outletPin(o: Pick<OutletRow, "lat" | "lon">): { lat: number; lon: number } | null {
  const lat = Number(o.lat);
  const lon = Number(o.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 || lon === 0 || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

const clampRadius = (m: number) =>
  Math.min(RADIUS_MAX_M, Math.max(RADIUS_MIN_M, Math.round(m)));

/**
 * Can this outlet take self orders right now, and if not, why. The gate is only
 * consulted once the owner has switched the feature on: this is read on a
 * public page, and getSubscriptionGate creates a trial for an owner who has
 * never had a subscription — a side effect an anonymous visitor must not cause.
 */
async function availability(outlet: OutletRow): Promise<
  | { enabled: true; problem: null }
  | { enabled: false; problem: "off" | "no_location" | "plan"; message: string }
> {
  if (!outlet.self_order_enabled) {
    return { enabled: false, problem: "off", message: "Outlet ini belum membuka Pesan Mandiri." };
  }
  if (!outletPin(outlet)) {
    return { enabled: false, problem: "no_location", message: "Lokasi outlet belum diatur." };
  }
  const gate = await getSubscriptionGate(outlet.user_id);
  if (!gate.alive || !hasFeature(gate, FEATURE)) {
    return { enabled: false, problem: "plan", message: "Pesan Mandiri sedang tidak tersedia di outlet ini." };
  }
  return { enabled: true, problem: null };
}

type GeoResult =
  | { ok: true; lat: number; lon: number; accuracyM: number; distanceM: number }
  | { ok: false; code: "NO_LOCATION" | "INACCURATE" | "TOO_FAR"; message: string; distanceM?: number };

/** Is this phone inside the outlet? The same rule for the preflight and the send. */
function checkLocation(outlet: OutletRow, raw: unknown): GeoResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const lat = Number(r.lat);
  const lon = Number(r.lon);
  const accuracy = Number(r.accuracy);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180 ||
    (lat === 0 && lon === 0)
  ) {
    return {
      ok: false,
      code: "NO_LOCATION",
      message: "Lokasi HP tidak terbaca. Izinkan akses lokasi lalu coba lagi.",
    };
  }
  const accuracyM = Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : ACCURACY_REJECT_M;
  if (accuracyM > ACCURACY_REJECT_M) {
    return {
      ok: false,
      code: "INACCURATE",
      message: `Lokasi HP kurang akurat (±${fmtDistance(accuracyM)}). Nyalakan GPS lalu coba lagi.`,
    };
  }
  const pin = outletPin(outlet)!;
  const distanceM = haversineKm(lat, lon, pin.lat, pin.lon) * 1000;
  const allowed = outlet.self_order_radius_m + Math.min(accuracyM, ACCURACY_SLACK_MAX_M);
  if (distanceM > allowed) {
    return {
      ok: false,
      code: "TOO_FAR",
      distanceM: Math.round(distanceM),
      message: `Kamu sekitar ${fmtDistance(distanceM)} dari ${outlet.name}. Pesan Mandiri hanya bisa dipakai di outlet.`,
    };
  }
  return { ok: true, lat, lon, accuracyM: Math.round(accuracyM), distanceM: Math.round(distanceM) };
}

// ── lines ────────────────────────────────────────────────────────────────────

/** A line as the phone sends it: what was picked, never what it costs. */
type IncomingLine = {
  productId: string;
  quantity: number;
  optionIds: number[];
  note: string | null;
};

/** A line as it is stored, in the cashier's CartItem shape. */
export type SelfOrderLine = {
  lineId: string;
  product: LineProduct;
  quantity: number;
  addons: LineAddon[];
  note?: string;
};

function parseIncoming(raw: unknown): IncomingLine | string {
  if (!raw || typeof raw !== "object") return "Item pesanan tidak valid";
  const r = raw as Record<string, unknown>;
  const productId = typeof r.productId === "string" ? r.productId : "";
  if (!productId || productId.length > 64) return "Item pesanan tidak valid";
  const quantity = Number(r.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QTY) {
    return `Jumlah per item 1–${MAX_LINE_QTY}`;
  }
  const optionIds = Array.isArray(r.optionIds)
    ? [...new Set((r.optionIds as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : [];
  if (optionIds.length > 30) return "Terlalu banyak tambahan pada satu item";
  return { productId, quantity, optionIds, note: text(r.note, 200) };
}

/**
 * Price and snapshot the phone's picks from the LIVE catalogue.
 *
 * This is the composition side (see lib/addons.ts): the product must be on
 * sale and available right now, a chosen add-on must belong to the dish's
 * groups, and the group's min/max hold. A variant inherits its base's add-on
 * groups, same as in the cashier's picker. Prices come from here, never from
 * the phone.
 */
async function buildLines(outletId: number, incoming: IncomingLine[]) {
  const ids = [...new Set(incoming.map((l) => l.productId))];
  const rows = await db
    .select({
      id: productsTable.id,
      product_name: productsTable.product_name,
      price: productsTable.price,
      price_mark_down: productsTable.price_mark_down,
      category: productsTable.category,
      image: productsTable.image,
      unit: productsTable.unit,
      isAvailable: productsTable.isAvailable,
      is_for_sale: productsTable.is_for_sale,
      barcode: productsTable.barcode,
      menu_group: menuGroupsTable.name,
      menu_group_order: menuGroupsTable.sort_order,
      variant_of: productsTable.variant_of,
      variant_name: productsTable.variant_name,
      variant_label: productsTable.variant_label,
      variant_sort: productsTable.variant_sort,
    })
    .from(productsTable)
    .leftJoin(menuGroupsTable, eq(productsTable.menu_group_id, menuGroupsTable.id))
    .where(
      and(
        eq(productsTable.outlet_id, outletId),
        inArray(productsTable.id, ids),
        isNull(productsTable.deletedAt),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));

  const baseIds = [...new Set(rows.map((r) => r.variant_of ?? r.id))];
  const groupsByBase = await addonGroupsForProducts(outletId, baseIds);

  const lines: SelfOrderLine[] = [];
  let subtotal = 0;
  for (const l of incoming) {
    const p = byId.get(l.productId);
    if (!p || !p.is_for_sale || INTERNAL_CATEGORIES.includes(p.category)) {
      throw new HttpError(409, "Ada menu yang sudah tidak dijual. Muat ulang menu.", "MENU_CHANGED");
    }
    if (!p.isAvailable) {
      throw new HttpError(409, `${p.product_name} sedang habis.`, "SOLD_OUT");
    }

    const groups: AddonGroupView[] = groupsByBase.get(p.variant_of ?? p.id) ?? [];
    const addons: LineAddon[] = [];
    for (const optionId of l.optionIds) {
      const group = groups.find((g) => g.options.some((o) => o.id === optionId));
      const option = group?.options.find((o) => o.id === optionId);
      if (!group || !option) {
        throw new HttpError(409, "Pilihan tambahan sudah berubah. Muat ulang menu.", "MENU_CHANGED");
      }
      if (!option.available) {
        throw new HttpError(409, `${option.name} sedang habis.`, "SOLD_OUT");
      }
      addons.push({
        product_id: option.product_id,
        option_id: option.id,
        name: option.name,
        quantity: 1,
        price: option.price,
      });
    }
    for (const g of groups) {
      const picked = g.options.filter((o) => l.optionIds.includes(o.id)).length;
      if (picked < g.min_select) {
        throw new HttpError(400, `Pilih ${g.name} untuk ${p.product_name}.`);
      }
      if (g.max_select !== null && picked > g.max_select) {
        throw new HttpError(400, `${g.name} maksimal ${g.max_select} pilihan.`);
      }
    }

    const product: LineProduct = {
      id: p.id,
      product_name: p.product_name,
      price: String(p.price),
      price_mark_down: p.price_mark_down ? String(p.price_mark_down) : "0",
      category: p.category,
      image: p.image,
      unit: p.unit,
      isAvailable: p.isAvailable,
      barcode: p.barcode,
      menu_group: p.menu_group,
      menu_group_order: p.menu_group_order,
      variant_of: p.variant_of,
      variant_name: p.variant_name,
      variant_label: p.variant_label,
      variant_sort: p.variant_sort,
    };
    lines.push({
      lineId: crypto.randomUUID(),
      product,
      quantity: l.quantity,
      addons,
      ...(l.note ? { note: l.note } : {}),
    });
    subtotal += lineUnitPrice(product, addons) * l.quantity;
  }
  return { lines, subtotal };
}

/** "#N" for the outlet's local day. Serialised per outlet, like kitchen tickets. */
async function nextQueueNo(tx: Tx, outletId: number, tz: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(86, ${outletId})`);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const { startUTC } = getUTCRangeFromLocalDate(today, tz);
  const [{ last }] = await tx
    .select({ last: sql<number>`coalesce(max(${selfOrdersTable.queue_no}), 0)::int` })
    .from(selfOrdersTable)
    .where(and(eq(selfOrdersTable.outlet_id, outletId), gte(selfOrdersTable.created_at, startUTC)));
  return Number(last) + 1;
}

// ── serialisation ────────────────────────────────────────────────────────────

type Row = typeof selfOrdersTable.$inferSelect;

/** Pending past its TTL reads as expired — nobody at the till is looking for it any more. */
function effectiveStatus(row: Row) {
  if (row.status === "pending" && Date.now() - new Date(row.created_at).getTime() > PENDING_TTL_MS) {
    return "expired";
  }
  return row.status;
}

function lineSummary(l: SelfOrderLine) {
  const unitPrice = lineUnitPrice(l.product, l.addons ?? []);
  return {
    name: l.product.product_name,
    variantName: (l.product.variant_name as string | null | undefined) ?? null,
    quantity: l.quantity,
    addons: (l.addons ?? []).map((a) => a.name),
    note: l.note ?? null,
    unitPrice,
    total: unitPrice * l.quantity,
  };
}

/** What the customer's phone sees. No location, no staff names. */
function publicView(row: Row, outletName: string) {
  const lines = (row.lines as SelfOrderLine[]) ?? [];
  return {
    id: row.id,
    outletId: row.outlet_id,
    outletName,
    queueNo: row.queue_no,
    status: effectiveStatus(row),
    customerName: row.customer_name,
    note: row.note,
    serviceType: row.service_type,
    tableLabel: row.table_label,
    lines: lines.map(lineSummary),
    subtotal: Number(row.subtotal),
    createdAt: iso(row.created_at),
    acceptedAt: iso(row.accepted_at),
    rejectedAt: iso(row.rejected_at),
    rejectReason: row.reject_reason,
  };
}

/** What the till sees: the summary plus the cart lines it opens a tab from. */
function staffView(row: Row) {
  const lines = (row.lines as SelfOrderLine[]) ?? [];
  return {
    id: row.id,
    queueNo: row.queue_no,
    status: effectiveStatus(row),
    customerName: row.customer_name,
    note: row.note,
    serviceType: row.service_type,
    tableId: row.table_id,
    tableLabel: row.table_label,
    summary: lines.map(lineSummary),
    cart: lines,
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
    subtotal: Number(row.subtotal),
    distanceM: row.distance_m,
    sessionId: row.session_id,
    createdAt: iso(row.created_at),
    acceptedAt: iso(row.accepted_at),
    rejectedAt: iso(row.rejected_at),
    rejectReason: row.reject_reason,
    cancelledAt: iso(row.cancelled_at),
  };
}

// ── public menu additions ────────────────────────────────────────────────────

/**
 * What /menu/[outlet] needs to offer ordering: whether it may, the radius it
 * will be held to, the questions the cart asks, the tax line to show, and the
 * table a QR code named. Read by /api/get-menu.
 */
export async function menuSelfOrderInfo(outletId: number, rawTableId: unknown) {
  const [outlet] = await db
    .select()
    .from(outletsTable)
    .where(and(eq(outletsTable.id, outletId), isNull(outletsTable.deletedAt)))
    .limit(1);
  if (!outlet) return null;

  const avail = await availability(outlet);
  if (!avail.enabled) return { enabled: false as const, reason: avail.problem };

  let table: { id: number; label: string } | null = null;
  const tableId = Number(rawTableId);
  if (Number.isInteger(tableId) && tableId > 0) {
    const [t] = await db
      .select({ id: diningTablesTable.id, label: diningTablesTable.label })
      .from(diningTablesTable)
      .where(
        and(
          eq(diningTablesTable.id, tableId),
          eq(diningTablesTable.outlet_id, outletId),
          isNull(diningTablesTable.deletedAt),
        ),
      )
      .limit(1);
    table = t ?? null;
  }

  // Tax is shown only when the plan includes it, the same gate the till uses —
  // otherwise the phone would promise a tax line the receipt will not print.
  const gate = await getSubscriptionGate(outlet.user_id);
  const tax = hasFeature(gate, "tax") ? taxConfigFrom(outlet) : null;

  return {
    enabled: true as const,
    radiusM: outlet.self_order_radius_m,
    askServiceType: outlet.service_type_enabled,
    tax: tax?.enabled ? tax : null,
    table,
  };
}

// ── routes ───────────────────────────────────────────────────────────────────

export async function selfOrderRoutes(app: FastifyInstance) {
  // ── customer (public) ─────────────────────────────────────────────────────

  /**
   * "Am I close enough?" — asked before the menu offers a cart, so a customer
   * at home is told straight away instead of after filling one. Not a pass:
   * the send checks again.
   */
  app.post("/api/self-order/locate", async (request, reply) => {
    return handle(reply, async () => {
      const body = (request.body as any) ?? {};
      const outletId = Number(body.outletId);
      if (!Number.isInteger(outletId) || outletId < 1) throw new HttpError(400, "Outlet tidak valid");
      const [outlet] = await db
        .select()
        .from(outletsTable)
        .where(and(eq(outletsTable.id, outletId), isNull(outletsTable.deletedAt)))
        .limit(1);
      if (!outlet) throw new HttpError(404, "Outlet tidak ditemukan");
      const avail = await availability(outlet);
      if (!avail.enabled) throw new HttpError(403, avail.message, "UNAVAILABLE");
      const geo = checkLocation(outlet, body.location);
      if (!geo.ok) {
        return reply
          .status(403)
          .send({ success: false, error: geo.message, code: geo.code, distanceM: geo.distanceM ?? null });
      }
      return { success: true, distanceM: geo.distanceM, radiusM: outlet.self_order_radius_m };
    });
  });

  /** Send an order from the phone. Idempotent on the phone-minted id. */
  app.post("/api/self-order", async (request, reply) => {
    return handle(reply, async () => {
      const body = (request.body as any) ?? {};
      const id = typeof body.id === "string" ? body.id : "";
      if (!ORDER_ID.test(id)) throw new HttpError(400, "Pesanan tidak valid");
      const outletId = Number(body.outletId);
      if (!Number.isInteger(outletId) || outletId < 1) throw new HttpError(400, "Outlet tidak valid");

      const [outlet] = await db
        .select()
        .from(outletsTable)
        .where(and(eq(outletsTable.id, outletId), isNull(outletsTable.deletedAt)))
        .limit(1);
      if (!outlet) throw new HttpError(404, "Outlet tidak ditemukan");

      // A retry of a send whose answer was lost: same id, same order.
      const [existing] = await db.select().from(selfOrdersTable).where(eq(selfOrdersTable.id, id)).limit(1);
      if (existing) {
        if (existing.outlet_id !== outletId) throw new HttpError(409, "Pesanan tidak valid");
        return { success: true, order: publicView(existing, outlet.name), replay: true };
      }

      const avail = await availability(outlet);
      if (!avail.enabled) throw new HttpError(403, avail.message, "UNAVAILABLE");

      const geo = checkLocation(outlet, body.location);
      if (!geo.ok) {
        return reply
          .status(403)
          .send({ success: false, error: geo.message, code: geo.code, distanceM: geo.distanceM ?? null });
      }

      const customerName = text(body.customerName, 60);
      if (!customerName) throw new HttpError(400, "Isi nama kamu dulu, supaya kasir bisa memanggil.");

      if (!Array.isArray(body.lines) || body.lines.length === 0) {
        throw new HttpError(400, "Keranjang masih kosong");
      }
      if (body.lines.length > MAX_LINES) throw new HttpError(400, `Maksimal ${MAX_LINES} item per pesanan`);
      const parsed = (body.lines as unknown[]).map(parseIncoming);
      const bad = parsed.find((p) => typeof p === "string");
      if (bad) throw new HttpError(400, bad as string);

      // A table QR: the order is dine in at that table. A table that was
      // deleted since the sticker was printed falls back to the counter.
      let table: { id: number; label: string } | null = null;
      const tableId = Number(body.tableId);
      if (Number.isInteger(tableId) && tableId > 0) {
        const [t] = await db
          .select({ id: diningTablesTable.id, label: diningTablesTable.label, blocked: diningTablesTable.blocked_at })
          .from(diningTablesTable)
          .where(
            and(
              eq(diningTablesTable.id, tableId),
              eq(diningTablesTable.outlet_id, outletId),
              isNull(diningTablesTable.deletedAt),
            ),
          )
          .limit(1);
        if (t?.blocked) throw new HttpError(409, `Meja ${t.label} sedang tidak dipakai. Tanya kasir, ya.`);
        if (t) table = { id: t.id, label: t.label };
      }

      const [{ pending }] = await db
        .select({ pending: sql<number>`count(*)::int` })
        .from(selfOrdersTable)
        .where(
          and(
            eq(selfOrdersTable.outlet_id, outletId),
            eq(selfOrdersTable.status, "pending"),
            gte(selfOrdersTable.created_at, new Date(Date.now() - PENDING_TTL_MS)),
          ),
        );
      if (Number(pending) >= MAX_PENDING_PER_OUTLET) {
        throw new HttpError(429, "Kasir sedang ramai. Coba lagi sebentar, atau pesan langsung di kasir.");
      }

      const { lines, subtotal } = await buildLines(outletId, parsed as IncomingLine[]);

      const serviceType = table
        ? "dine_in"
        : outlet.service_type_enabled
          ? parseServiceType(body.serviceType)
          : null;

      const row = await db.transaction(async (tx) => {
        const queueNo = await nextQueueNo(tx, outletId, zoneOf(body.timezone));
        const [inserted] = await tx
          .insert(selfOrdersTable)
          .values({
            id,
            outlet_id: outletId,
            queue_no: queueNo,
            customer_name: customerName,
            note: text(body.note, 200),
            service_type: serviceType,
            table_id: table?.id ?? null,
            table_label: table?.label ?? null,
            lines,
            subtotal: String(subtotal),
            lat: String(geo.lat),
            lon: String(geo.lon),
            accuracy_m: geo.accuracyM,
            distance_m: geo.distanceM,
          })
          .onConflictDoNothing({ target: selfOrdersTable.id })
          .returning();
        return inserted ?? null;
      });
      // Two identical sends racing: the other one won; answer with its row.
      const saved =
        row ?? (await db.select().from(selfOrdersTable).where(eq(selfOrdersTable.id, id)).limit(1))[0];
      if (row) {
        publishSelfOrder(outletId, "new", id);
        // Tills with the app closed ring too. Not awaited: the customer is not
        // kept waiting on Google, and a failed push leaves the order on the
        // inbox exactly as before.
        sendSelfOrderPush({
          orderId: row.id,
          outletId,
          queueNo: row.queue_no,
          customerName: row.customer_name,
          tableLabel: row.table_label,
          itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
          subtotal,
        }).catch((err) => console.error("[self-order] push failed", err));
      }
      return { success: true, order: publicView(saved, outlet.name) };
    });
  });

  /** The phone's status screen. The id is the capability. */
  app.get("/api/self-order/:id", async (request, reply) => {
    return handle(reply, async () => {
      const id = orderIdParam(request);
      const [hit] = await db
        .select({ order: selfOrdersTable, outletName: outletsTable.name })
        .from(selfOrdersTable)
        .innerJoin(outletsTable, eq(outletsTable.id, selfOrdersTable.outlet_id))
        .where(eq(selfOrdersTable.id, id))
        .limit(1);
      if (!hit) throw new HttpError(404, "Pesanan tidak ditemukan");
      return { success: true, order: publicView(hit.order, hit.outletName) };
    });
  });

  /** The customer changed their mind — only while no one at the till has taken it. */
  app.post("/api/self-order/:id/cancel", async (request, reply) => {
    return handle(reply, async () => {
      const id = orderIdParam(request);
      const [row] = await db
        .update(selfOrdersTable)
        .set({ status: "cancelled", cancelled_at: new Date(), updated_at: new Date() })
        .where(and(eq(selfOrdersTable.id, id), eq(selfOrdersTable.status, "pending")))
        .returning();
      if (!row) {
        const [current] = await db.select().from(selfOrdersTable).where(eq(selfOrdersTable.id, id)).limit(1);
        if (!current) throw new HttpError(404, "Pesanan tidak ditemukan");
        if (current.status === "cancelled") return { success: true };
        throw new HttpError(409, "Pesanan sudah diproses kasir. Batalkan langsung di kasir, ya.");
      }
      publishSelfOrder(row.outlet_id, "cancelled", id);
      return { success: true };
    });
  });

  // ── till ──────────────────────────────────────────────────────────────────

  /** Waiting orders (oldest first) and the last few handled ones. */
  app.get("/api/self-orders", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, STAFF);
    if (!access) return;
    const outletId = access.outlet.id;
    const [pending, recent] = await Promise.all([
      db
        .select()
        .from(selfOrdersTable)
        .where(
          and(
            eq(selfOrdersTable.outlet_id, outletId),
            eq(selfOrdersTable.status, "pending"),
            gte(selfOrdersTable.created_at, new Date(Date.now() - PENDING_TTL_MS)),
          ),
        )
        .orderBy(asc(selfOrdersTable.created_at)),
      db
        .select()
        .from(selfOrdersTable)
        .where(
          and(
            eq(selfOrdersTable.outlet_id, outletId),
            ne(selfOrdersTable.status, "pending"),
            gte(selfOrdersTable.created_at, new Date(Date.now() - RECENT_WINDOW_MS)),
          ),
        )
        .orderBy(desc(selfOrdersTable.created_at))
        .limit(20),
    ]);
    return {
      success: true,
      pending: pending.map(staffView),
      recent: recent.map(staffView),
      canUseTables: hasFeature(access.gate, "tableManagement"),
    };
  });

  /** "Something changed" — the till re-reads /api/self-orders. */
  app.get("/api/self-orders/stream", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, STAFF);
    if (!access) return;
    const stream = openEventStream(request, reply);
    stream.onClose(subscribeSelfOrder(access.outlet.id, (event) => stream.send("self-order", event)));
  });

  /**
   * Take an order. Exactly one till wins; the others get a 409 and the stream
   * clears it off their screens.
   *
   * A table order goes onto that table's bill (seating the table when it is
   * free) where the plan has Manajemen Meja, so it is paid, split and sent to
   * the kitchen like anything the waiter rang in. Everything else — and a
   * table order at an outlet without the floor plan — comes back as cart lines
   * for the till to open as a tab.
   *
   * The same cashier accepting again gets the same answer: a retry after a
   * lost response must not leave the order accepted with no tab anywhere.
   */
  app.post("/api/self-orders/:id/accept", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, STAFF);
    if (!access) return;
    return handle(reply, async () => {
      const id = orderIdParam(request);
      const outletId = access.outlet.id;
      const onFloor = hasFeature(access.gate, "tableManagement");

      const result = await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(selfOrdersTable)
          .where(and(eq(selfOrdersTable.id, id), eq(selfOrdersTable.outlet_id, outletId)))
          .limit(1)
          .for("update");
        if (!row) throw new HttpError(404, "Pesanan tidak ditemukan");
        if (row.status === "accepted" && row.accepted_by === access.userId) {
          return { row, replay: true };
        }
        if (row.status === "accepted") throw new HttpError(409, "Pesanan ini sudah diterima di perangkat lain.");
        if (row.status === "rejected") throw new HttpError(409, "Pesanan ini sudah ditolak.");
        if (row.status === "cancelled") throw new HttpError(409, "Pesanan ini dibatalkan pelanggan.");

        let sessionId: string | null = null;
        if (row.table_id && onFloor) {
          const [live] = await tx
            .select({ id: diningTablesTable.id })
            .from(diningTablesTable)
            .where(
              and(
                eq(diningTablesTable.id, row.table_id),
                eq(diningTablesTable.outlet_id, outletId),
                isNull(diningTablesTable.deletedAt),
              ),
            )
            .limit(1);
          if (live) {
            const t = await lockTable(tx, outletId, live.id);
            // A fresh seating starts open; an existing one may be "paid" (all
            // settled, not yet cleared) and reopens when these lines land.
            let sessionStatus = "open";
            if (t.session_id) {
              const s = await lockLiveSession(tx, outletId, t.session_id);
              if (s.status !== "open" && s.status !== "paid") {
                throw new HttpError(409, `Meja ${t.label} sedang ditutup. Selesaikan dulu di Manajemen Meja.`);
              }
              sessionId = s.id;
              sessionStatus = s.status;
            } else {
              if (t.blocked_at) throw new HttpError(409, `Meja ${t.label} sedang diblokir.`);
              sessionId = await seatTable(tx, {
                outletId,
                tableId: t.id,
                guestName: row.customer_name,
                pax: 1,
                userId: access.userId,
              });
            }
            const lines = (row.lines as SelfOrderLine[]) ?? [];
            if (lines.length) {
              await tx.insert(tableSessionLinesTable).values(
                lines.map((l) => ({
                  id: l.lineId,
                  session_id: sessionId!,
                  bill_no: 1,
                  product_id: l.product.id,
                  product: l.product,
                  quantity: l.quantity,
                  addons: l.addons ?? [],
                  note: l.note ?? null,
                })),
              );
            }
            await bumpVersion(tx, sessionId, await reconcileStatus(tx, sessionId, sessionStatus));
          }
        }

        const [updated] = await tx
          .update(selfOrdersTable)
          .set({
            status: "accepted",
            accepted_at: new Date(),
            accepted_by: access.userId,
            session_id: sessionId,
            updated_at: new Date(),
          })
          .where(eq(selfOrdersTable.id, id))
          .returning();
        return { row: updated, replay: false };
      });

      if (!result.replay) {
        publishSelfOrder(outletId, "accepted", id);
        if (result.row.session_id) publishFloor(outletId, "bill", [result.row.session_id]);
      }
      return { success: true, order: staffView(result.row) };
    });
  });

  app.post("/api/self-orders/:id/reject", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, STAFF);
    if (!access) return;
    return handle(reply, async () => {
      const id = orderIdParam(request);
      const reason = text((request.body as any)?.reason, 120);
      const [row] = await db
        .update(selfOrdersTable)
        .set({ status: "rejected", rejected_at: new Date(), reject_reason: reason, updated_at: new Date() })
        .where(
          and(
            eq(selfOrdersTable.id, id),
            eq(selfOrdersTable.outlet_id, access.outlet.id),
            eq(selfOrdersTable.status, "pending"),
          ),
        )
        .returning();
      if (!row) {
        const [current] = await db
          .select({ status: selfOrdersTable.status })
          .from(selfOrdersTable)
          .where(and(eq(selfOrdersTable.id, id), eq(selfOrdersTable.outlet_id, access.outlet.id)))
          .limit(1);
        if (!current) throw new HttpError(404, "Pesanan tidak ditemukan");
        throw new HttpError(409, "Pesanan ini sudah diproses.");
      }
      publishSelfOrder(access.outlet.id, "rejected", id);
      return { success: true, order: staffView(row) };
    });
  });

  // ── the till app's phones ─────────────────────────────────────────────────

  /**
   * This phone rings for the caller's outlet when a customer sends an order,
   * even with the app closed (an FCM push; see staffDevicesTable). The app
   * calls it while signed in on an outlet with Pesan Mandiri, on every new FCM
   * token and after switching outlets. Not plan-gated beyond the write gate:
   * a push only ever follows an order, which the plan already gates.
   */
  app.post("/api/self-orders/devices", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, STAFF);
    if (!access) return;
    const body = (request.body as Record<string, unknown>) ?? {};
    const fcmToken = typeof body.fcmToken === "string" ? body.fcmToken.trim() : "";
    if (fcmToken.length < 20 || fcmToken.length > 4096) {
      return reply.status(400).send({ success: false, error: "fcmToken tidak valid" });
    }
    await registerStaffDevice({
      userId: access.userId,
      outletId: access.outlet.id,
      fcmToken,
      platform: typeof body.platform === "string" ? body.platform : undefined,
      appVersion: typeof body.appVersion === "string" ? body.appVersion : undefined,
    });
    return { success: true, outletId: access.outlet.id };
  });

  /**
   * This phone stops ringing: signing out, or an outlet without Pesan Mandiri.
   * Only a session is asked for, not outlet access, so someone whose access
   * just ended can still quiet their own phone.
   */
  app.post("/api/self-orders/devices/revoke", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });
    const body = (request.body as Record<string, unknown>) ?? {};
    const fcmToken = typeof body.fcmToken === "string" ? body.fcmToken.trim() : "";
    if (fcmToken) await revokeStaffDevice(session.user.id, fcmToken);
    return { success: true };
  });

  // ── owner settings ────────────────────────────────────────────────────────

  app.get("/api/self-orders/settings", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "owner");
    if (!access) return;
    const o = access.outlet;
    const tables = await db
      .select({ id: diningTablesTable.id, label: diningTablesTable.label, zone: diningZonesTable.name })
      .from(diningTablesTable)
      .innerJoin(diningZonesTable, eq(diningZonesTable.id, diningTablesTable.zone_id))
      .where(and(eq(diningTablesTable.outlet_id, o.id), isNull(diningTablesTable.deletedAt)))
      .orderBy(asc(diningZonesTable.sort_order), asc(diningTablesTable.label));
    return {
      success: true,
      outletId: o.id,
      enabled: o.self_order_enabled,
      radiusM: o.self_order_radius_m,
      radiusMin: RADIUS_MIN_M,
      radiusMax: RADIUS_MAX_M,
      hasLocation: outletPin(o) !== null,
      planAllowed: hasFeature(access.gate, FEATURE),
      canUseTables: hasFeature(access.gate, "tableManagement"),
      tables,
    };
  });

  app.patch("/api/self-orders/settings", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "owner");
    if (!access) return;
    return handle(reply, async () => {
      const body = (request.body as any) ?? {};
      const set: Partial<typeof outletsTable.$inferInsert> = {};
      if (body.radiusM !== undefined) {
        const r = Number(body.radiusM);
        if (!Number.isFinite(r)) throw new HttpError(400, "Radius tidak valid");
        set.self_order_radius_m = clampRadius(r);
      }
      if (body.enabled !== undefined) {
        const enabled = body.enabled === true;
        // Switching it ON is starting something; switching it off never is.
        if (enabled && !hasFeature(access.gate, FEATURE)) {
          throw new HttpError(403, UPGRADE_MESSAGE, "PLAN_FEATURE");
        }
        if (enabled && !outletPin(access.outlet)) {
          throw new HttpError(400, "Atur lokasi outlet di peta dulu — Pesan Mandiri memeriksa jarak pelanggan ke titik itu.");
        }
        set.self_order_enabled = enabled;
      }
      if (Object.keys(set).length === 0) return { success: true };
      await db
        .update(outletsTable)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(outletsTable.id, access.outlet.id));
      return { success: true };
    });
  });
}
