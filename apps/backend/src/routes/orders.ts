import type { FastifyInstance } from "fastify";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  cashInCategoryTable,
  couriersTable,
  customersTable,
  ordersTable,
  outletsTable,
  locationsTable,
  cashInDetailTable,
  orderDetailsTable,
  productsTable,
  cashFlows,
} from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { getOutletAccess, hasPermission, parseActiveOutletId, getSubscriptionGate, gateBlocks } from "../lib/outlet-access";
import { CATEGORY_IN } from "../lib/cashflow-categories";
import { roadDistance, billableKm } from "../lib/utils/road-distance";
import { sendPushToUser } from "../lib/push";
import { dispatchNextOffer, supersedeOffers } from "../lib/dispatch";

type NoteJson = {
  location: {
    pick_up: { lat: string; long: string; label: string };
    drop_off: { lat: string; long: string; label: string };
  };
  customer_ratings: string;
  customer_note: string;
  customer_review_count: string;
};

type OrderItem = {
  product_id: string;
  quantity: number;
  note_product?: string;
  summary_price: string;
};

type CreateOrderBody = {
  outlet_id: number;
  promo_id?: number;
  discount_amount?: number;
  note?: NoteJson | null;
  items: OrderItem[];
  // Only 'service' is honoured from the client — jasa is picked deliberately by
  // the customer from a service product card. 'delivery' vs 'materials' is NOT a
  // customer choice: it is derived from the cart's products (see resolveLane).
  fulfillment?: "delivery" | "service";
};

/**
 * Decide which lane an order runs in, from the products in the cart.
 *
 * One undeliverable item is enough to pull the whole order onto the outlet's own
 * driver — a courier is never asked to carry half an order. Deliberately server
 * side: the client already knows `courierDeliverable`, but the lane decides who
 * gets paid to move the goods, so it is not something a request body may assert.
 */
async function resolveLane(items: OrderItem[]): Promise<"delivery" | "materials"> {
  const ids = [...new Set(items.map((i) => i.product_id))];
  if (ids.length === 0) return "delivery";

  const [bulky] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(and(inArray(productsTable.id, ids), eq(productsTable.courier_deliverable, false)))
    .limit(1);

  return bulky ? "materials" : "delivery";
}

/**
 * Ceiling on what the outlet may charge to haul an order, in rupiah.
 *
 * Each bulky product carries a [lowest_price, highest_price] band: the floor is
 * the goods, the gap above it is the outlet's operational room. Summed across
 * the order, that gap is the most the owner can add. Recomputed from the
 * products on every call rather than stored, so an owner cannot widen their own
 * ceiling after the customer has already agreed to it.
 */
async function materialsFeeCap(orderId: string): Promise<number> {
  const rows = await db
    .select({
      quantity: orderDetailsTable.quantity,
      lowest: productsTable.lowest_price,
      highest: productsTable.highest_price,
    })
    .from(orderDetailsTable)
    .innerJoin(productsTable, eq(productsTable.id, orderDetailsTable.product_id))
    .where(eq(orderDetailsTable.order_id, orderId));

  return rows.reduce((cap, row) => {
    const low = Number(row.lowest ?? 0);
    const high = Number(row.highest ?? 0);
    // A fixed-price product (no band, or an inverted one) contributes nothing —
    // a bag of cement riding along in a besi order doesn't raise the ceiling.
    const gap = Math.max(0, high - low);
    return cap + gap * Number(row.quantity ?? 0);
  }, 0);
}

// Grace window before a customer can cancel their own order — gives the owner
// a few minutes to start acting on it first. Mirrors the lock in
// active-order-animation.tsx (CANCEL_LOCK_SECONDS).
const CUSTOMER_CANCEL_LOCK_MS = 5 * 60 * 1000;

//SEARCH:: distance pricelist
//
// `km` is ROAD distance (see computeDeliveryFee), not straight-line. It used to
// be the straight line, which under-read by ~40% around here: a 5 km crow-flies
// trip is really ~8.5 km of road, so the courier rode 8.5 km and was paid the
// 5 km rate. Every tier below now means what it says.
//
// The 30 km ceiling is road distance too. Previously a customer 29 km away in a
// straight line — ~50 km by road — passed the check, and a courier accepted a
// ride they had no way of knowing the length of.
// Hard ceiling on how far physical goods travel, road distance. Shared by the
// fee table and the range gate below so the two can't drift — a customer who
// can be charged is a customer who can be served, and vice versa. Mirrored by
// MAX_DELIVERY_KM in routes/public.ts, which hides out-of-range outlets from
// browse; this is the enforcement, that is the courtesy.
const MAX_DELIVERY_KM = 50;

function deliveryFeeFromDistance(km: number): number {
  const MAX_KM = MAX_DELIVERY_KM;
  const BASE_FEE = 10_000; // tarif dasar untuk jarak <= 5 km
  const BASE_KM = 5; // jarak yang sudah tercover base fee
  const RATE_PER_KM = 1_800; // tarif tambahan per km setelah base
  const ROUNDING = 500; // dibulatkan ke atas ke kelipatan ini

  // Finite check, not just `< 0`: NaN fails every comparison below, so it would
  // slip past a sign test, sail through the arithmetic, and return NaN as a
  // price — which String()s to the literal "NaN" in orders.delivery_fee. That is
  // exactly how empty coordinates poisoned outlets.lat/lon before.
  if (!Number.isFinite(km) || km < 0) throw new Error("Jarak tidak valid");
  if (km > MAX_KM) throw new Error(`Jarak pengiriman melebihi batas maksimum (${MAX_KM} km)`);

  if (km <= BASE_KM) return BASE_FEE;

  const extraKm = km - BASE_KM;
  const rawFee = BASE_FEE + extraKm * RATE_PER_KM;

  return Math.ceil(rawFee / ROUNDING) * ROUNDING;
}

async function computeDeliveryFee(userId: string, outletId: number): Promise<number> {
  const [[userLoc], [outlet]] = await Promise.all([
    db
      .select({ lat: locationsTable.lat, lon: locationsTable.lon })
      .from(locationsTable)
      .where(and(eq(locationsTable.user_id, userId), eq(locationsTable.is_default, true)))
      .limit(1),
    db
      .select({ lat: outletsTable.lat, lon: outletsTable.lon })
      .from(outletsTable)
      .where(eq(outletsTable.id, outletId))
      .limit(1),
  ]);

  if (!userLoc) throw new Error("Alamat pengiriman tidak ditemukan");
  if (!outlet) throw new Error("Outlet tidak ditemukan");

  // Real road distance, not the straight line the courier can't actually ride.
  // billableKm scales the straight-line fallback by the local detour factor, so
  // an OSRM outage degrades to an approximation rather than silently reverting
  // to the ~40% undercharge this replaced.
  const distance = await roadDistance(
    { lat: parseFloat(outlet.lat), lon: parseFloat(outlet.lon) },
    { lat: parseFloat(userLoc.lat), lon: parseFloat(userLoc.lon) },
  );

  return deliveryFeeFromDistance(billableKm(distance));
}

/**
 * Refuse an order the outlet cannot physically serve.
 *
 * The delivery lane gets this for free — computeDeliveryFee() throws past the
 * cap — but the materials lane has no distance fee to compute, so without an
 * explicit check an outlet could be handed a 200 km haul it never agreed to and
 * has no courier to refuse it with.
 *
 * Server-side because the browse list and the outlet page only *hide* distant
 * outlets. Anything that hides can be bypassed with a direct API call; this is
 * the part that actually cannot.
 */
async function assertWithinDeliveryRange(userId: string, outletId: number): Promise<void> {
  const [[userLoc], [outlet]] = await Promise.all([
    db
      .select({ lat: locationsTable.lat, lon: locationsTable.lon })
      .from(locationsTable)
      .where(and(eq(locationsTable.user_id, userId), eq(locationsTable.is_default, true)))
      .limit(1),
    db
      .select({ lat: outletsTable.lat, lon: outletsTable.lon })
      .from(outletsTable)
      .where(eq(outletsTable.id, outletId))
      .limit(1),
  ]);

  if (!userLoc) throw new Error("Alamat pengiriman tidak ditemukan");
  if (!outlet) throw new Error("Outlet tidak ditemukan");

  const distance = await roadDistance(
    { lat: parseFloat(outlet.lat), lon: parseFloat(outlet.lon) },
    { lat: parseFloat(userLoc.lat), lon: parseFloat(userLoc.lon) },
  );

  // billableKm, not raw km: a straight-line fallback reads ~40% short here, and
  // letting an outage wave through a haul that is really 70 km would defeat the
  // point of having a cap.
  if (billableKm(distance) > MAX_DELIVERY_KM) {
    throw new Error(`Jarak pengiriman melebihi batas maksimum (${MAX_DELIVERY_KM} km)`);
  }
}

// Owner or employee with the activeOrders permission → outlet {id}, else null.
// Active-outlet cookie + subscription gate (order transitions are writes).
async function outletForOrders(userId: string, request: import("fastify").FastifyRequest) {
  const access = await getOutletAccess(userId, parseActiveOutletId(request));
  if (!access || !hasPermission(access, "activeOrders")) return null;
  const gate = await getSubscriptionGate(access.outlet.user_id);
  if (gateBlocks(gate, "activeOrders", request.method)) return null;
  return { id: access.outlet.id };
}

export async function orderRoutes(app: FastifyInstance) {
  // Compute delivery fee for the signed-in customer's default address.
  // Returns { fee } or { error } in-band (matching the old server action).
  app.get("/api/orders/delivery-fee", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    const outletId = Number((request.query as { outlet_id?: string }).outlet_id);
    if (!outletId) return reply.send({ error: "Outlet tidak ditemukan" });

    try {
      const fee = await computeDeliveryFee(session.user.id, outletId);
      return reply.send({ fee });
    } catch (e) {
      return reply.send({ error: e instanceof Error ? e.message : "Gagal menghitung ongkos kirim" });
    }
  });

  // Customer creates a new pending order
  app.post("/api/orders/create", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    // Backstop for the frontend gate (dashboard/layout.tsx renders
    // EmailVerificationGate instead of any page content for an unverified
    // customer). Enforced here too since a customer could hit this endpoint
    // directly and skip that screen. There is no WhatsApp/phone verification in
    // this app, so a verified email is the only identity check before money
    // changes hands.
    if (!session.user.emailVerified) {
      return reply.status(403).send({
        success: false,
        error: "Verifikasi email kamu terlebih dahulu sebelum membuat pesanan.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    const data = request.body as CreateOrderBody;
    const orderId = crypto.randomUUID();
    const isService = data.fulfillment === "service";

    try {
      // Jasa is the customer's own choice; everything else is decided from the
      // cart. A bulky item routes the order to the outlet's driver.
      const lane = isService ? "service" : await resolveLane(data.items);

      // Neither no-courier lane has a distance fee: jasa has no goods to move,
      // and a materials haul is quoted by the owner into delivery_fee once they
      // have seen the address (see /api/orders/confirm-materials).
      const chargesDistanceFee = lane === "delivery";

      // Materials moves real goods but computes no distance fee, so the range
      // cap has to be asserted for it explicitly. Jasa is exempt: nothing is
      // transported, and the customer travels to the outlet or the owner to
      // them by their own arrangement.
      if (lane === "materials") {
        await assertWithinDeliveryRange(session.user.id, data.outlet_id);
      }

      const [[customer], delivery_fee, [outlet]] = await Promise.all([
        db
          .select({ id: customersTable.id })
          .from(customersTable)
          .where(eq(customersTable.user_id, session.user.id))
          .limit(1),
        chargesDistanceFee ? computeDeliveryFee(session.user.id, data.outlet_id) : Promise.resolve(0),
        db
          .select({ user_id: outletsTable.user_id, name: outletsTable.name })
          .from(outletsTable)
          .where(eq(outletsTable.id, data.outlet_id))
          .limit(1),
      ]);

      if (!customer) throw new Error("Customer record not found for this user");

      await db.transaction(async (tx) => {
        await tx.insert(ordersTable).values({
          id: orderId,
          customer_id: customer.id,
          outlet_id: data.outlet_id,
          courier_id: null,
          fulfillment: lane,
          status: "pending",
          promo_id: data.promo_id,
          discount_amount: data.discount_amount?.toString(),
          delivery_fee: String(delivery_fee),
          note: data.note ?? null,
          scheduled_at: null,
        });

        if (data.items.length > 0) {
          await tx.insert(orderDetailsTable).values(
            data.items.map((item) => ({
              order_id: orderId,
              product_id: item.product_id,
              quantity: item.quantity,
              note_product: item.note_product,
              summary_price: item.summary_price,
            })),
          );
        }
      });

      // Fire-and-forget: a push failure (no subscription, dead endpoint,
      // provider outage) must never fail an order that has already committed.
      // This is why it happens after the transaction, not inside it.
      if (outlet?.user_id) {
        const itemCount = data.items.reduce((sum, i) => sum + i.quantity, 0);
        sendPushToUser(outlet.user_id, {
          title: isService ? "Permintaan layanan baru" : "Pesanan baru masuk",
          body: `${session.user.name ?? "Pelanggan"} · ${itemCount} item${
            isService ? "" : ` · ${orderId.slice(-8).toUpperCase()}`
          }`,
          url: "/dashboard/activeorder",
          // One live notification per outlet's pending queue, not one per
          // order — a burst of orders while the owner's phone is silenced
          // shouldn't leave a stack of a dozen banners to swipe through.
          tag: `orders-pending-${data.outlet_id}`,
        }).catch((err) => app.log.error(err, "Failed to push new-order notification"));
      }

      return reply.send({ success: true, orderId });
    } catch (e) {
      app.log.error(e, "Failed to create order");
      return reply.status(400).send({ success: false, error: e instanceof Error ? e.message : "Gagal membuat order" });
    }
  });

  // Customer cancels their own still-pending order
  app.post("/api/orders/cancel-by-customer", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const { orderId } = (request.body as { orderId?: string }) ?? {};
    if (!orderId) return reply.status(400).send({ success: false, error: "orderId wajib diisi" });

    const [customer] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(eq(customersTable.user_id, session.user.id))
      .limit(1);

    if (!customer) return reply.status(403).send({ success: false, error: "Customer not found" });

    const [order] = await db
      .select({
        status: ordersTable.status,
        fulfillment: ordersTable.fulfillment,
        updatedAt: ordersTable.updatedAt,
        createdAt: ordersTable.createdAt,
      })
      .from(ordersTable)
      .where(and(eq(ordersTable.id, orderId), eq(ordersTable.customer_id, customer.id)))
      .limit(1);

    if (!order) return reply.status(404).send({ success: false, error: "Order tidak ditemukan" });
    if (order.status !== "pending" && order.status !== "confirmed") {
      return reply.status(400).send({ success: false, error: "Order tidak dapat dibatalkan" });
    }

    // A just-quoted materials order is exempt from the grace window. The lock
    // exists to stop a customer yanking a fresh order before the owner has had a
    // chance to act on it — but here the owner has just named a haul price the
    // customer never saw at checkout, and confirm-materials stamps updatedAt, so
    // the lock would restart at the exact moment they need to say no. Refusing
    // the price is the whole point of this step; it cannot be rate-limited.
    const respondingToQuote = order.fulfillment === "materials" && order.status === "confirmed";

    const since = (order.updatedAt ?? order.createdAt).getTime();
    if (!respondingToQuote && Date.now() - since < CUSTOMER_CANCEL_LOCK_MS) {
      return reply.status(400).send({ success: false, error: "Pesanan baru bisa dibatalkan setelah 5 menit" });
    }

    const res = await db
      .update(ordersTable)
      .set({ status: "cancelled", rejected_by: "customer", updatedAt: new Date() })
      .where(
        and(
          eq(ordersTable.id, orderId),
          eq(ordersTable.customer_id, customer.id),
          eq(ordersTable.status, order.status),
        ),
      )
      .returning({ id: ordersTable.id });

    if (res.length === 0) return reply.status(400).send({ success: false, error: "Order tidak dapat dibatalkan" });

    // A courier still holding a clock on a cancelled order would be answering a
    // question that no longer exists — and would take the timeout as a mark
    // against them.
    await supersedeOffers(orderId);

    return reply.send({ success: true });
  });

  // Owner confirms a pending order
  app.post("/api/orders/confirm", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const { orderId } = (request.body as { orderId?: string }) ?? {};
    if (!orderId) return reply.status(400).send({ success: false, error: "orderId wajib diisi" });

    const outlet = await outletForOrders(session.user.id, request);

    if (!outlet) return reply.status(403).send({ success: false, error: "Not an owner" });

    const confirmed = await db
      .update(ordersTable)
      .set({ status: "confirmed", updatedAt: new Date() })
      .where(
        and(
          eq(ordersTable.id, orderId),
          eq(ordersTable.outlet_id, outlet.id),
          eq(ordersTable.status, "pending"),
        ),
      )
      .returning({ id: ordersTable.id, fulfillment: ordersTable.fulfillment });

    // Hand it straight to a courier. Only 'delivery' enters the queue — service
    // and materials move on the outlet's own wheels.
    //
    // Failure here must not fail the confirmation: the order is legitimately
    // confirmed either way, and tickDispatch() picks up anything that never got
    // a first offer the next time a lobby polls.
    if (confirmed[0]?.fulfillment === "delivery") {
      try {
        await dispatchNextOffer(orderId);
      } catch (err) {
        request.log.error({ err, orderId }, "dispatch after confirm failed");
      }
    }

    return reply.send({ success: true });
  });

  // Owner rejects a still-pending order, recording why.
  app.post("/api/orders/reject-by-owner", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const { orderId, reason } = (request.body as { orderId?: string; reason?: string }) ?? {};
    if (!orderId) return reply.status(400).send({ success: false, error: "orderId wajib diisi" });
    const trimmedReason = reason?.trim();
    if (!trimmedReason) return reply.status(400).send({ success: false, error: "Alasan penolakan wajib diisi" });

    const outlet = await outletForOrders(session.user.id, request);
    if (!outlet) return reply.status(403).send({ success: false, error: "Not an owner" });

    const res = await db
      .update(ordersTable)
      .set({
        status: "cancelled",
        rejected_by: "owner",
        rejected_reason: trimmedReason.slice(0, 255),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(ordersTable.id, orderId),
          eq(ordersTable.outlet_id, outlet.id),
          eq(ordersTable.status, "pending"),
        ),
      )
      .returning({ id: ordersTable.id });

    if (res.length === 0) return reply.status(400).send({ success: false, error: "Order tidak dapat ditolak" });
    return reply.send({ success: true });
  });

  // Owner marks a confirmed/preparing order (with assigned courier) as ready
  app.post("/api/orders/mark-ready", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const { orderId } = (request.body as { orderId?: string }) ?? {};
    if (!orderId) return reply.status(400).send({ success: false, error: "orderId wajib diisi" });

    const outlet = await outletForOrders(session.user.id, request);

    if (!outlet) return reply.status(403).send({ success: false, error: "Not an owner" });

    await db
      .update(ordersTable)
      .set({ status: "ready", updatedAt: new Date() })
      .where(
        and(
          eq(ordersTable.id, orderId),
          eq(ordersTable.outlet_id, outlet.id),
          // Delivery orders need a courier assigned before they can be "ready".
          // The two courier-less lanes have none by design, so allow them
          // through — without materials here the owner could never mark a
          // bahan-bangunan order ready and the update would match zero rows.
          or(
            isNotNull(ordersTable.courier_id),
            inArray(ordersTable.fulfillment, ["service", "materials"]),
          ),
          or(eq(ordersTable.status, "confirmed"), eq(ordersTable.status, "preparing")),
        ),
      );

    return reply.send({ success: true });
  });

  // Owner confirms courier pickup of a ready order
  app.post("/api/orders/confirm-pickup", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const { orderId } = (request.body as { orderId?: string }) ?? {};
    if (!orderId) return reply.status(400).send({ success: false, error: "orderId wajib diisi" });

    const outlet = await outletForOrders(session.user.id, request);

    if (!outlet) return reply.status(403).send({ success: false, error: "Not an owner" });

    await db
      .update(ordersTable)
      .set({ status: "on_delivery", updatedAt: new Date() })
      .where(
        and(
          eq(ordersTable.id, orderId),
          eq(ordersTable.outlet_id, outlet.id),
          eq(ordersTable.status, "ready"),
        ),
      );

    return reply.send({ success: true });
  });

  // Courier marks an on_delivery order as delivered; records cash-in for the outlet
  app.post("/api/orders/mark-delivered", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const { orderId } = (request.body as { orderId?: string }) ?? {};
    if (!orderId) return reply.status(400).send({ success: false, error: "orderId wajib diisi" });

    try {
      await db.transaction(async (tx) => {
        const [idCategory] = await tx
          .select({ id: cashInCategoryTable.id })
          .from(cashInCategoryTable)
          .where(eq(cashInCategoryTable.category, CATEGORY_IN[0]))
          .limit(1);

        const [outlet] = await tx
          .select({ id: ordersTable.outlet_id })
          .from(ordersTable)
          .where(eq(ordersTable.id, orderId))
          .limit(1);

        if (!outlet) throw new Error("Not an owner");

        const amount = await tx
          .select({
            sum: sql<number>`sum(cast(${orderDetailsTable.summary_price} as numeric))`,
          })
          .from(orderDetailsTable)
          .where(eq(orderDetailsTable.order_id, orderId));

        const cashIn = await tx
          .insert(cashInDetailTable)
          .values({
            category_id: idCategory.id,
            money_amount: String(amount[0].sum ?? 0),
            type: "cash",
          })
          .returning({ id: cashInDetailTable.id });

        await tx.insert(cashFlows).values({
          outlet_id: Number(outlet.id),
          cash_opname: "cash",
          cash_in_detail_id: cashIn[0].id,
        });

        const [courier] = await tx
          .select({ id: couriersTable.id })
          .from(couriersTable)
          .where(eq(couriersTable.user_id, session.user.id))
          .limit(1);

        if (!courier) throw new Error("Not a courier");

        await tx
          .update(orderDetailsTable)
          .set({ status: "checkout" })
          .where(eq(orderDetailsTable.order_id, orderId));

        await tx
          .update(ordersTable)
          .set({ status: "delivered", updatedAt: new Date() })
          .where(
            and(
              eq(ordersTable.id, orderId),
              eq(ordersTable.courier_id, courier.id),
              eq(ordersTable.status, "on_delivery"),
            ),
          );
      });

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error(error, "Failed to mark order delivered");
      return reply.status(400).send({ success: false, error: error.message ?? "Gagal menyelesaikan order" });
    }
  });

  // ----- Service (no-courier) order lifecycle -----
  // These mirror the delivery transitions but are driven entirely by the owner
  // (and finished by the customer). courier_id stays null the whole time.

  // Helper: resolve the caller's outlet, or reply 403.
  async function requireOwnerOutlet(request: any, reply: any) {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) {
      reply.status(401).send({ success: false, error: "Unauthorized" });
      return null;
    }
    const outlet = await outletForOrders(session.user.id, request);
    if (!outlet) {
      reply.status(403).send({ success: false, error: "Not an owner" });
      return null;
    }
    return { session, outlet };
  }

  // Owner accepts a pending service order at a price they slide within the
  // product's [lowest_price, highest_price] range. The chosen price becomes the
  // agreed price on the order detail. pending -> confirmed.
  app.post("/api/orders/confirm-service", async (request, reply) => {
    const ctx = await requireOwnerOutlet(request, reply);
    if (!ctx) return;

    const { orderId, price } = (request.body as { orderId?: string; price?: number | string }) ?? {};
    if (!orderId || price == null) {
      return reply.status(400).send({ success: false, error: "orderId dan price wajib diisi" });
    }
    const chosen = Number(price);
    if (!Number.isFinite(chosen) || chosen < 0) {
      return reply.status(400).send({ success: false, error: "Harga tidak valid" });
    }

    try {
      // The service product's range (a service order is a single service item).
      const [row] = await db
        .select({
          detailId: orderDetailsTable.id,
          lowest: productsTable.lowest_price,
          highest: productsTable.highest_price,
          status: ordersTable.status,
          fulfillment: ordersTable.fulfillment,
        })
        .from(ordersTable)
        .innerJoin(orderDetailsTable, eq(orderDetailsTable.order_id, ordersTable.id))
        .innerJoin(productsTable, eq(productsTable.id, orderDetailsTable.product_id))
        .where(and(eq(ordersTable.id, orderId), eq(ordersTable.outlet_id, ctx.outlet.id)))
        .limit(1);

      if (!row) return reply.status(404).send({ success: false, error: "Order tidak ditemukan" });
      if (row.fulfillment !== "service") return reply.status(400).send({ success: false, error: "Bukan order layanan" });
      if (row.status !== "pending") return reply.status(400).send({ success: false, error: "Order tidak lagi menunggu konfirmasi" });

      const lowest = Number(row.lowest ?? 0);
      const highest = Number(row.highest ?? row.lowest ?? 0);
      if (chosen < lowest || chosen > highest) {
        return reply.status(400).send({ success: false, error: `Harga harus di antara ${lowest} dan ${highest}` });
      }

      await db.transaction(async (tx) => {
        await tx
          .update(orderDetailsTable)
          .set({ summary_price: String(chosen) })
          .where(eq(orderDetailsTable.order_id, orderId));
        await tx
          .update(ordersTable)
          .set({ status: "confirmed", updatedAt: new Date() })
          .where(and(eq(ordersTable.id, orderId), eq(ordersTable.status, "pending")));
      });

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error(error, "Failed to confirm service order");
      return reply.status(400).send({ success: false, error: error.message ?? "Gagal mengonfirmasi order" });
    }
  });

  // Everything the owner needs to price a haul: the ceiling, and — the part that
  // actually decides the number — where the load is going and how far that is.
  //
  // An address string on its own is not enough to quote against; the owner has
  // to know the distance. Same drop-off the courier lane uses (the customer's
  // default location), so both lanes agree on where an order goes.
  app.get("/api/orders/:orderId/materials-quote", async (request, reply) => {
    const ctx = await requireOwnerOutlet(request, reply);
    if (!ctx) return;

    const { orderId } = request.params as { orderId: string };
    const [row] = await db
      .select({
        fulfillment: ordersTable.fulfillment,
        address: locationsTable.address,
        note: locationsTable.note,
        label: locationsTable.label,
        lat: locationsTable.lat,
        lon: locationsTable.lon,
        outletLat: outletsTable.lat,
        outletLon: outletsTable.lon,
      })
      .from(ordersTable)
      .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
      .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
      // leftJoin: a customer with no saved default address must still let the
      // owner open the quote form — they just won't get a distance.
      .leftJoin(
        locationsTable,
        and(
          eq(locationsTable.user_id, customersTable.user_id),
          eq(locationsTable.is_default, true),
        ),
      )
      .where(and(eq(ordersTable.id, orderId), eq(ordersTable.outlet_id, ctx.outlet.id)))
      .limit(1);

    if (!row) return reply.status(404).send({ success: false, error: "Order tidak ditemukan" });
    if (row.fulfillment !== "materials")
      return reply.status(400).send({ success: false, error: "Bukan order bahan bangunan" });

    const hasCoords = row.lat != null && row.lon != null;
    // Real driving distance, not the straight line. Around here roads run ~1.75x
    // the crow-flies distance, so a straight-line figure would have the owner
    // quoting a haul at nearly half its true length. Falls back to haversine if
    // routing is unavailable, and says which one it used.
    const distance = hasCoords
      ? await roadDistance(
          { lat: parseFloat(row.outletLat), lon: parseFloat(row.outletLon) },
          { lat: parseFloat(row.lat!), lon: parseFloat(row.lon!) },
        )
      : null;

    return reply.send({
      success: true,
      cap: await materialsFeeCap(orderId),
      distanceKm: distance === null ? null : Math.round(distance.km * 10) / 10,
      // 'road' = actual driving route; 'straight' = routing was unavailable and
      // this is the crow-flies distance, which will read short.
      distanceSource: distance?.source ?? null,
      driveMinutes:
        distance?.minutes == null ? null : Math.round(distance.minutes),
      dropoff: hasCoords
        ? {
            label: row.label,
            address: row.address,
            note: row.note,
            lat: row.lat,
            lon: row.lon,
          }
        : null,
    });
  });

  // Owner accepts a pending materials order at a haul price they choose, once
  // they have seen the address. The goods keep their own fixed prices — only the
  // delivery fee is set here, bounded by the products' price bands.
  // pending -> confirmed.
  app.post("/api/orders/confirm-materials", async (request, reply) => {
    const ctx = await requireOwnerOutlet(request, reply);
    if (!ctx) return;

    const { orderId, delivery_fee } =
      (request.body as { orderId?: string; delivery_fee?: number | string }) ?? {};
    if (!orderId || delivery_fee == null) {
      return reply.status(400).send({ success: false, error: "orderId dan delivery_fee wajib diisi" });
    }
    const fee = Number(delivery_fee);
    if (!Number.isFinite(fee) || fee < 0) {
      return reply.status(400).send({ success: false, error: "Ongkos angkut tidak valid" });
    }

    try {
      const [row] = await db
        .select({ status: ordersTable.status, fulfillment: ordersTable.fulfillment })
        .from(ordersTable)
        .where(and(eq(ordersTable.id, orderId), eq(ordersTable.outlet_id, ctx.outlet.id)))
        .limit(1);

      if (!row) return reply.status(404).send({ success: false, error: "Order tidak ditemukan" });
      if (row.fulfillment !== "materials")
        return reply.status(400).send({ success: false, error: "Bukan order bahan bangunan" });
      if (row.status !== "pending")
        return reply.status(400).send({ success: false, error: "Order tidak lagi menunggu konfirmasi" });

      // Recomputed here, never taken from the request: the customer agreed to a
      // ceiling at checkout, and the owner must not be able to raise it after.
      const cap = await materialsFeeCap(orderId);
      if (fee > cap) {
        return reply
          .status(400)
          .send({ success: false, error: `Ongkos angkut maksimal ${cap}` });
      }

      const updated = await db
        .update(ordersTable)
        .set({ delivery_fee: String(fee), status: "confirmed", updatedAt: new Date() })
        .where(and(eq(ordersTable.id, orderId), eq(ordersTable.status, "pending")))
        .returning({ id: ordersTable.id });

      if (updated.length === 0)
        return reply.status(400).send({ success: false, error: "Order tidak lagi menunggu konfirmasi" });

      return reply.send({ success: true, delivery_fee: fee });
    } catch (error: any) {
      app.log.error(error, "Failed to confirm materials order");
      return reply.status(400).send({ success: false, error: error.message ?? "Gagal mengonfirmasi order" });
    }
  });

  // Owner sets the appointment time and an optional discount (amount or percent,
  // stored resolved into discount_amount). confirmed -> preparing.
  app.post("/api/orders/schedule-service", async (request, reply) => {
    const ctx = await requireOwnerOutlet(request, reply);
    if (!ctx) return;

    const { orderId, scheduled_at, discount_amount, discount_percent } =
      (request.body as {
        orderId?: string;
        scheduled_at?: string;
        discount_amount?: number | string;
        discount_percent?: number | string;
      }) ?? {};
    if (!orderId || !scheduled_at) {
      return reply.status(400).send({ success: false, error: "orderId dan scheduled_at wajib diisi" });
    }
    const when = new Date(scheduled_at);
    if (Number.isNaN(when.getTime())) {
      return reply.status(400).send({ success: false, error: "Tanggal jadwal tidak valid" });
    }

    try {
      // Agreed price = sum of the order's detail prices (set at confirm).
      const [{ sum: agreed } = { sum: 0 }] = await db
        .select({ sum: sql<number>`coalesce(sum(cast(${orderDetailsTable.summary_price} as numeric)), 0)` })
        .from(orderDetailsTable)
        .where(eq(orderDetailsTable.order_id, orderId));

      let discount = 0;
      if (discount_percent != null && discount_percent !== "") {
        const pct = Number(discount_percent);
        if (Number.isFinite(pct) && pct > 0) discount = Math.round((Number(agreed) * pct) / 100);
      } else if (discount_amount != null && discount_amount !== "") {
        const amt = Number(discount_amount);
        if (Number.isFinite(amt) && amt > 0) discount = Math.round(amt);
      }
      if (discount > Number(agreed)) discount = Number(agreed);

      const res = await db
        .update(ordersTable)
        .set({ status: "preparing", scheduled_at: when, discount_amount: String(discount), updatedAt: new Date() })
        .where(
          and(
            eq(ordersTable.id, orderId),
            eq(ordersTable.outlet_id, ctx.outlet.id),
            eq(ordersTable.fulfillment, "service"),
            eq(ordersTable.status, "confirmed"),
          ),
        )
        .returning({ id: ordersTable.id });

      if (res.length === 0) return reply.status(400).send({ success: false, error: "Order tidak dapat dijadwalkan" });
      return reply.send({ success: true, discount_amount: discount });
    } catch (error: any) {
      app.log.error(error, "Failed to schedule service order");
      return reply.status(400).send({ success: false, error: error.message ?? "Gagal menjadwalkan order" });
    }
  });

  // Owner closes a scheduled service order once the work is done, handing it to
  // the customer to accept. ready -> on_delivery (reuses on_delivery as "closed").
  app.post("/api/orders/close-service", async (request, reply) => {
    const ctx = await requireOwnerOutlet(request, reply);
    if (!ctx) return;

    const { orderId } = (request.body as { orderId?: string }) ?? {};
    if (!orderId) return reply.status(400).send({ success: false, error: "orderId wajib diisi" });

    const res = await db
      .update(ordersTable)
      .set({ status: "on_delivery", updatedAt: new Date() })
      .where(
        and(
          eq(ordersTable.id, orderId),
          eq(ordersTable.outlet_id, ctx.outlet.id),
          eq(ordersTable.fulfillment, "service"),
          eq(ordersTable.status, "ready"),
        ),
      )
      .returning({ id: ordersTable.id });

    if (res.length === 0) return reply.status(400).send({ success: false, error: "Order tidak dapat ditutup" });
    return reply.send({ success: true });
  });

  // Customer accepts a closed service order. Records the outlet's cash-in
  // (agreed price - discount) and finalises. on_delivery -> delivered.
  app.post("/api/orders/accept-service", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const { orderId } = (request.body as { orderId?: string }) ?? {};
    if (!orderId) return reply.status(400).send({ success: false, error: "orderId wajib diisi" });

    try {
      const [customer] = await db
        .select({ id: customersTable.id })
        .from(customersTable)
        .where(eq(customersTable.user_id, session.user.id))
        .limit(1);
      if (!customer) return reply.status(403).send({ success: false, error: "Customer not found" });

      await db.transaction(async (tx) => {
        const [order] = await tx
          .select({
            outlet_id: ordersTable.outlet_id,
            discount: ordersTable.discount_amount,
          })
          .from(ordersTable)
          .where(
            and(
              eq(ordersTable.id, orderId),
              eq(ordersTable.customer_id, customer.id),
              eq(ordersTable.fulfillment, "service"),
              eq(ordersTable.status, "on_delivery"),
            ),
          )
          .limit(1);
        if (!order) throw new Error("Order tidak dapat diselesaikan");

        const [{ sum: agreed } = { sum: 0 }] = await tx
          .select({ sum: sql<number>`coalesce(sum(cast(${orderDetailsTable.summary_price} as numeric)), 0)` })
          .from(orderDetailsTable)
          .where(eq(orderDetailsTable.order_id, orderId));

        const net = Math.max(0, Number(agreed) - Number(order.discount ?? 0));

        const [idCategory] = await tx
          .select({ id: cashInCategoryTable.id })
          .from(cashInCategoryTable)
          .where(eq(cashInCategoryTable.category, CATEGORY_IN[0]))
          .limit(1);
        if (!idCategory) throw new Error("Kategori kas masuk belum ada");

        const cashIn = await tx
          .insert(cashInDetailTable)
          .values({ category_id: idCategory.id, money_amount: String(net), type: "cash" })
          .returning({ id: cashInDetailTable.id });

        await tx.insert(cashFlows).values({
          outlet_id: Number(order.outlet_id),
          cash_opname: "cash",
          cash_in_detail_id: cashIn[0].id,
        });

        await tx
          .update(orderDetailsTable)
          .set({ status: "checkout" })
          .where(eq(orderDetailsTable.order_id, orderId));

        await tx
          .update(ordersTable)
          .set({ status: "delivered", updatedAt: new Date() })
          .where(and(eq(ordersTable.id, orderId), eq(ordersTable.status, "on_delivery")));
      });

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error(error, "Failed to accept service order");
      return reply.status(400).send({ success: false, error: error.message ?? "Gagal menyelesaikan order" });
    }
  });

  // Owner's driver has left with the load. ready -> on_delivery. Distinct from
  // confirm-pickup, which hands the order to a courier and stamps courier_id;
  // here there is no courier and the outlet is carrying its own goods.
  app.post("/api/orders/dispatch-materials", async (request, reply) => {
    const ctx = await requireOwnerOutlet(request, reply);
    if (!ctx) return;

    const { orderId } = (request.body as { orderId?: string }) ?? {};
    if (!orderId) return reply.status(400).send({ success: false, error: "orderId wajib diisi" });

    const res = await db
      .update(ordersTable)
      .set({ status: "on_delivery", updatedAt: new Date() })
      .where(
        and(
          eq(ordersTable.id, orderId),
          eq(ordersTable.outlet_id, ctx.outlet.id),
          eq(ordersTable.fulfillment, "materials"),
          eq(ordersTable.status, "ready"),
        ),
      )
      .returning({ id: ordersTable.id });

    if (res.length === 0)
      return reply.status(400).send({ success: false, error: "Order tidak dapat dikirim" });
    return reply.send({ success: true });
  });

  // Customer confirms the load arrived. Books the outlet's cash-in and finalises.
  // on_delivery -> delivered.
  //
  // Separate from accept-service rather than shared with it, because the money
  // differs: a jasa order books the agreed price alone, while a materials order
  // books the goods PLUS the haul the owner quoted into delivery_fee. Folding
  // both into one endpoint would mean one of the two silently loses revenue.
  app.post("/api/orders/accept-materials", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const { orderId } = (request.body as { orderId?: string }) ?? {};
    if (!orderId) return reply.status(400).send({ success: false, error: "orderId wajib diisi" });

    try {
      const [customer] = await db
        .select({ id: customersTable.id })
        .from(customersTable)
        .where(eq(customersTable.user_id, session.user.id))
        .limit(1);
      if (!customer) return reply.status(403).send({ success: false, error: "Customer not found" });

      await db.transaction(async (tx) => {
        const [order] = await tx
          .select({
            outlet_id: ordersTable.outlet_id,
            discount: ordersTable.discount_amount,
            delivery_fee: ordersTable.delivery_fee,
          })
          .from(ordersTable)
          .where(
            and(
              eq(ordersTable.id, orderId),
              eq(ordersTable.customer_id, customer.id),
              eq(ordersTable.fulfillment, "materials"),
              eq(ordersTable.status, "on_delivery"),
            ),
          )
          .limit(1);
        if (!order) throw new Error("Order tidak dapat diselesaikan");

        const [{ sum: goods } = { sum: 0 }] = await tx
          .select({ sum: sql<number>`coalesce(sum(cast(${orderDetailsTable.summary_price} as numeric)), 0)` })
          .from(orderDetailsTable)
          .where(eq(orderDetailsTable.order_id, orderId));

        // The haul is the outlet's own revenue here — no courier is taking a cut.
        const net = Math.max(
          0,
          Number(goods) + Number(order.delivery_fee ?? 0) - Number(order.discount ?? 0),
        );

        const [idCategory] = await tx
          .select({ id: cashInCategoryTable.id })
          .from(cashInCategoryTable)
          .where(eq(cashInCategoryTable.category, CATEGORY_IN[0]))
          .limit(1);
        if (!idCategory) throw new Error("Kategori kas masuk belum ada");

        const cashIn = await tx
          .insert(cashInDetailTable)
          .values({ category_id: idCategory.id, money_amount: String(net), type: "cash" })
          .returning({ id: cashInDetailTable.id });

        await tx.insert(cashFlows).values({
          outlet_id: Number(order.outlet_id),
          cash_opname: "cash",
          cash_in_detail_id: cashIn[0].id,
        });

        await tx
          .update(orderDetailsTable)
          .set({ status: "checkout" })
          .where(eq(orderDetailsTable.order_id, orderId));

        await tx
          .update(ordersTable)
          .set({ status: "delivered", updatedAt: new Date() })
          .where(and(eq(ordersTable.id, orderId), eq(ordersTable.status, "on_delivery")));
      });

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error(error, "Failed to accept materials order");
      return reply.status(400).send({ success: false, error: error.message ?? "Gagal menyelesaikan order" });
    }
  });
}
