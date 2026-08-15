import type { FastifyInstance } from "fastify";
import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, inArray, isNull, notInArray, or, sql, sum } from "drizzle-orm";
import { db } from "../db";
import {
  customersTable,
  ordersTable,
  orderDetailsTable,
  outletsTable,
  couriersTable,
  usersTable,
  locationsTable,
  ratingsTable,
  productsTable,
} from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { orderNotDeleted } from "../lib/order-scope";
import { attachOrderItems } from "../lib/utils/order-items";
import { getCourierAvailability } from "../lib/utils/courier-availability";
import { tickDispatch, visibleOrderIdsFor } from "../lib/dispatch";
import { getOutletByUserId } from "../lib/outlet-id";
import { parseCoordPair } from "../lib/utils/coords";
import { deliveryEta } from "../lib/utils/delivery-eta";
import { normalizeIndonesianPhone } from "../lib/utils/phone";

// The courier's own user row. Aliased because several queries here already join
// usersTable for the CUSTOMER, and one query needs both sides at once.
const courierUser = alias(usersTable, "courier_user");

export async function customerRoutes(app: FastifyInstance) {
  // The caller's full order history with per-order item count + total. Backs the
  // customer history-order page. { success: false } when the user isn't a customer.
  app.get("/api/get-customer-history", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const [customer] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(eq(customersTable.user_id, session.user.id))
      .limit(1);

    if (!customer) return reply.send({ success: false, orders: [] });

    const base = await db
      .select({
        orderId: ordersTable.id,
        status: ordersTable.status,
        createdAt: ordersTable.createdAt,
        outletName: outletsTable.name,
        fulfillment: ordersTable.fulfillment,
      })
      .from(ordersTable)
      .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
      .where(and(orderNotDeleted, eq(ordersTable.customer_id, customer.id)))
      .orderBy(desc(ordersTable.createdAt));

    // Attach the actual purchased items (name + qty) + total per order.
    const withItems = await attachOrderItems(base);

    // Orders this customer has already rated (a rating row referencing any of the
    // order's detail rows, authored by this user).
    const orderIds = base.map((o) => o.orderId);
    const ratedRows = orderIds.length
      ? await db
          .selectDistinct({ orderId: orderDetailsTable.order_id })
          .from(ratingsTable)
          .innerJoin(orderDetailsTable, eq(ratingsTable.order_details_id, orderDetailsTable.id))
          .where(
            and(
              eq(ratingsTable.reviewer, session.user.id),
              inArray(orderDetailsTable.order_id, orderIds),
            ),
          )
      : [];
    const ratedSet = new Set(ratedRows.map((r) => r.orderId));

    // Rating stays open for 7 days after the order was made; after that it's no
    // longer relevant. Both delivery (rate courier + products) and service
    // (rate owner + products) orders are rateable once delivered.
    const RATING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const orders = withItems.map((o) => {
      const createdMs = o.createdAt ? new Date(o.createdAt).getTime() : now;
      const withinWindow = now - createdMs <= RATING_WINDOW_MS;
      const rated = ratedSet.has(o.orderId);
      const rateable = o.status === "delivered";
      return {
        id: o.orderId,
        status: o.status,
        createdAt: o.createdAt,
        outletName: o.outletName,
        fulfillment: o.fulfillment,
        items: o.items.map((it) => ({ name: it.productName, quantity: it.quantity })),
        itemCount: o.items.length,
        totalAmount: o.totalAmount,
        rated,
        canRate: rateable && withinWindow && !rated,
        ratingExpired: rateable && !withinWindow && !rated,
      };
    });

    return reply.send({ success: true, orders });
  });

  // Customer's scheduled (service) orders that aren't finished yet — i.e. service
  // orders still in flight (not delivered/cancelled). Backs the "Scheduled Order"
  // sidebar page.
  app.get("/api/get-scheduled-orders", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const [customer] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(eq(customersTable.user_id, session.user.id))
      .limit(1);

    if (!customer) return reply.send({ success: false, orders: [] });

    const orders = await db
      .select({
        id: ordersTable.id,
        status: ordersTable.status,
        createdAt: ordersTable.createdAt,
        scheduledAt: ordersTable.scheduled_at,
        discountAmount: ordersTable.discount_amount,
        outletName: outletsTable.name,
        serviceName: sql<string>`MAX(${productsTable.product_name})`,
        totalAmount: sum(
          sql<number>`CAST(${orderDetailsTable.summary_price} AS NUMERIC)`,
        ).mapWith(Number),
      })
      .from(ordersTable)
      .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
      .leftJoin(orderDetailsTable, eq(orderDetailsTable.order_id, ordersTable.id))
      .leftJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
      .where(
        and(
          orderNotDeleted,
          eq(ordersTable.customer_id, customer.id),
          eq(ordersTable.fulfillment, "service"),
          notInArray(ordersTable.status, ["delivered", "cancelled"]),
        ),
      )
      .groupBy(ordersTable.id, outletsTable.name)
      .orderBy(desc(ordersTable.scheduled_at));

    return reply.send({ success: true, orders });
  });

  app.get("/api/get-active-order", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const [customer] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(eq(customersTable.user_id, session.user.id))
      .limit(1);

    if (!customer) return reply.status(403).send({ success: false });

    // 'cancelled' is included (unlike other terminal-status filtering elsewhere)
    // so a customer whose pending order the owner just rejected still sees it as
    // their "active" order — activeorder/page.tsx renders the rejection reason
    // instead of redirecting them away. It naturally stops being "active" the
    // moment they place a new order, since this only ever returns the latest one.
    const [order] = await db
      .select({
        id: ordersTable.id,
        status: ordersTable.status,
        outletName: outletsTable.name,
        updatedAt: ordersTable.updatedAt,
        createdAt: ordersTable.createdAt,
        fulfillment: ordersTable.fulfillment,
        scheduledAt: ordersTable.scheduled_at,
        rejectedBy: ordersTable.rejected_by,
        rejectedReason: ordersTable.rejected_reason,
        // On the materials lane this is the haul price the owner quoted after
        // seeing the address. The customer only agreed to a CEILING at checkout,
        // so without this they never learn the figure they actually owe until
        // the load turns up — the one number they might want to refuse.
        deliveryFee: ordersTable.delivery_fee,
        discountAmount: ordersTable.discount_amount,
        // Route endpoints + the courier's last reported position, for the live
        // arrival estimate below.
        outletLat: outletsTable.lat,
        outletLon: outletsTable.lon,
        courierLat: couriersTable.last_lat,
        courierLon: couriersTable.last_lon,
        courierLocationAt: couriersTable.last_location_at,
        // Who is actually bringing this. A name and a face turn "a courier is on
        // the way" into a specific person the customer can recognise at the door.
        courierName: courierUser.name,
        courierAvatar: couriersTable.avatar,
        courierVehiclePlate: couriersTable.vehicle_plate,
        courierPhone: courierUser.phone,
      })
      .from(ordersTable)
      .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
      // leftJoin — most of an order's life has no courier attached.
      .leftJoin(couriersTable, eq(ordersTable.courier_id, couriersTable.id))
      .leftJoin(courierUser, eq(couriersTable.user_id, courierUser.id))
      .where(and(orderNotDeleted, eq(ordersTable.customer_id, customer.id)))
      .orderBy(desc(ordersTable.createdAt))
      .limit(1);

    if (!order) return { success: false };

    const [{ sum: goodsTotal } = { sum: 0 }] = await db
      .select({
        sum: sql<number>`coalesce(sum(cast(${orderDetailsTable.summary_price} as numeric)), 0)`,
      })
      .from(orderDetailsTable)
      .where(eq(orderDetailsTable.order_id, order.id));

    const {
      outletLat, outletLon, courierLat, courierLon, courierLocationAt,
      courierName, courierAvatar, courierVehiclePlate, courierPhone, ...rest
    } = order;

    // Null until an order is actually assigned, so the UI can key the whole
    // "your courier" card off its presence rather than on order status.
    const courier = courierName
      ? {
          name: courierName,
          avatar: courierAvatar,
          vehiclePlate: courierVehiclePlate,
          // Canonical 628… so the customer's WhatsApp button is a direct link;
          // null when the stored number is unusable, and the button is hidden.
          phone: normalizeIndonesianPhone(courierPhone),
        }
      : null;

    const eta = await deliveryEta({
      status: order.status,
      customerUserId: session.user.id,
      outlet: parseCoordPair(outletLat, outletLon),
      courier: parseCoordPair(courierLat, courierLon),
      courierSeenAt: courierLocationAt,
    });

    return { success: true, order: { ...rest, courier, goodsTotal: Number(goodsTotal), ...eta } };
  });

  app.get("/api/get-available-orders", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const [courier] = await db
      .select({ id: couriersTable.id })
      .from(couriersTable)
      .where(eq(couriersTable.user_id, session.user.id))
      .limit(1);

    if (!courier) return reply.status(403).send({ success: false, error: "Not a courier" });

    // Expire what is due and move those orders on, before deciding what this
    // courier can see. The lobby polls every two seconds, so this is what keeps
    // the queue flowing without a scheduler process.
    await tickDispatch();

    const availability = await getCourierAvailability(courier.id);

    if (!availability.canReceiveOrder) {
      return {
        success: true,
        orders: [],
        canReceiveOrder: false,
        // Verification is checked first: an unverified courier who is online
        // and idle would otherwise be told "busy", which is both false and
        // unactionable. Each reason has to name the thing they can fix.
        reason: !availability.isApproved
          ? "not_verified"
          : !availability.isOnline
            ? "offline"
            : "busy",
        ratingStatus: availability.ratingStatus,
        delaySeconds: availability.delaySeconds,
      };
    }

    // What this courier may see: the one order they have been offered, plus
    // anything that has fallen through to the open pool. Not "every confirmed
    // order", which is what made staring at the lobby the way to earn.
    const { offeredOrderId, offerExpiresAt, offerRemainingMs, openPoolOrderIds } =
      await visibleOrderIdsFor(courier.id);

    const visibleIds = [offeredOrderId, ...openPoolOrderIds].filter(
      (id): id is string => id !== null,
    );

    if (visibleIds.length === 0) {
      return {
        success: true,
        orders: [],
        canReceiveOrder: true,
        reason: null,
        offeredOrderId: null,
        offerExpiresAt: null,
        offerRemainingMs: null,
        ratingStatus: availability.ratingStatus,
        delaySeconds: availability.delaySeconds,
      };
    }

    const orders = await db
      .select({
        orderId: ordersTable.id,
        customerName: usersTable.name,
        customerPhone: usersTable.phone,
        deliveryFee: ordersTable.delivery_fee,
        note: ordersTable.note,
        createdAt: ordersTable.createdAt,
        outletName: outletsTable.name,
        outletAddress: outletsTable.address,
      })
      .from(ordersTable)
      .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
      .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
      .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
      .where(
        and(
          orderNotDeleted,
          eq(ordersTable.status, "confirmed"),
          isNull(ordersTable.courier_id),
          // Service and materials orders are courier-less by design — the
          // outlet moves those itself, so they never reach the courier lobby.
          eq(ordersTable.fulfillment, "delivery"),
          inArray(ordersTable.id, visibleIds),
        ),
      )
      .orderBy(ordersTable.createdAt);

    // Probation still slows the open pool — it is the only place first-come
    // still decides anything, so it is the only place the handicap can apply.
    // A direct offer is never delayed: it is already this courier's turn.
    const visibleOrders =
      availability.delaySeconds > 0
        ? orders.filter((order) => {
            if (order.orderId === offeredOrderId) return true;
            const ageMs = Date.now() - new Date(order.createdAt!).getTime();
            return ageMs >= availability.delaySeconds * 1000;
          })
        : orders;

    const ordersWithItems = await attachOrderItems(visibleOrders);

    return {
      success: true,
      orders: ordersWithItems,
      canReceiveOrder: true,
      reason: null,
      // The UI needs both: which card is a personal offer, and when its clock
      // runs out, so it can show a countdown instead of a silent disappearance.
      offeredOrderId,
      offerExpiresAt,
      // Milliseconds left as measured by the database, for a countdown that
      // doesn't depend on the phone's clock being right.
      offerRemainingMs,
      ratingStatus: availability.ratingStatus,
      delaySeconds: availability.delaySeconds,
    };
  });

  app.get("/api/get-courier-history", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const [courier] = await db
      .select({ id: couriersTable.id })
      .from(couriersTable)
      .where(eq(couriersTable.user_id, session.user.id))
      .limit(1);

    if (!courier) return reply.status(403).send({ success: false, error: "Not a courier" });

    const history = await db
      .select({
        id: ordersTable.id,
        status: ordersTable.status,
        deliveryFee: ordersTable.delivery_fee,
        timestamp: ordersTable.updatedAt,
        customerName: usersTable.name,
        outletName: outletsTable.name,
        dropoff: locationsTable.address,
      })
      .from(ordersTable)
      .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
      .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
      .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
      .leftJoin(locationsTable, and(eq(locationsTable.user_id, usersTable.id), eq(locationsTable.is_default, true)))
      .where(and(orderNotDeleted, eq(ordersTable.courier_id, courier.id)))
      .orderBy(desc(ordersTable.updatedAt))
      .limit(3);

    return { success: true, history };
  });

  app.get("/api/get-courier-orders", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const [courier] = await db
      .select({ id: couriersTable.id })
      .from(couriersTable)
      .where(eq(couriersTable.user_id, session.user.id))
      .limit(1);

    if (!courier) return reply.status(403).send({ success: false, error: "Not a courier" });

    const orders = await db
      .select({
        orderId: ordersTable.id,
        customerName: usersTable.name,
        customerPhone: usersTable.phone,
        deliveryFee: ordersTable.delivery_fee,
        note: ordersTable.note,
        createdAt: ordersTable.createdAt,
        status: ordersTable.status,
        outletName: outletsTable.name,
        outletAddress: outletsTable.address,
      })
      .from(ordersTable)
      .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
      .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
      .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
      .where(and(
        orderNotDeleted,
        eq(ordersTable.courier_id, courier.id),
        or(
          eq(ordersTable.status, "confirmed"),
          eq(ordersTable.status, "preparing"),
          eq(ordersTable.status, "ready"),
          eq(ordersTable.status, "on_delivery"),
        ),
      ))
      .orderBy(ordersTable.createdAt);

    const ordersWithItems = await attachOrderItems(orders);

    return { success: true, orders: ordersWithItems };
  });

  app.get("/api/get-courier-ratings", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    const rows = await db
      .select({
        id: ratingsTable.id,
        ratings: ratingsTable.ratings,
        comment: ratingsTable.comment,
        created_at: ratingsTable.createdAt,
        reviewer_name: usersTable.name,
      })
      .from(ratingsTable)
      .leftJoin(usersTable, eq(ratingsTable.reviewer, usersTable.id))
      .where(and(eq(ratingsTable.reciepent, session.user.id), eq(ratingsTable.reciepent_as, "courier")))
      .orderBy(desc(ratingsTable.createdAt));

    const data = rows.map((r) => ({
      id: r.id,
      rating: Number(r.ratings) || 5,
      comment: r.comment ?? "",
      created_at: r.created_at,
      reviewer_name: r.reviewer_name ?? "Anonim",
    }));

    return { data };
  });

  app.get("/api/get-order-locations", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const { outlet_id: outletId } = request.query as { outlet_id?: string };
    if (!outletId) return reply.status(400).send({ success: false, error: "Missing outlet_id" });

    const [[customer], [outlet]] = await Promise.all([
      db
        .select({ id: customersTable.id, ratings: customersTable.ratings, review_count: customersTable.review_count })
        .from(customersTable)
        .where(eq(customersTable.user_id, session.user.id))
        .limit(1),
      db
        .select({ lat: outletsTable.lat, lon: outletsTable.lon, name: outletsTable.name })
        .from(outletsTable)
        .where(eq(outletsTable.id, Number(outletId)))
        .limit(1),
    ]);

    if (!customer || !outlet) return reply.status(404).send({ success: false, error: "Not found" });

    const [customerUser] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, session.user.id))
      .limit(1);

    const [defaultLocation] = await db
      .select({ lat: locationsTable.lat, lon: locationsTable.lon, address: locationsTable.address })
      .from(locationsTable)
      .where(and(eq(locationsTable.user_id, session.user.id), eq(locationsTable.is_default, true)))
      .limit(1);

    return {
      success: true,
      pickup: { lat: outlet.lat, lon: outlet.lon, label: outlet.name },
      dropoff: {
        lat: defaultLocation?.lat ?? null,
        lon: defaultLocation?.lon ?? null,
        label: defaultLocation?.address ?? customerUser?.name ?? "",
      },
      customer: {
        ratings: customer.ratings ?? "5",
        review_count: customer.review_count,
      },
    };
  });

  app.get("/api/get-ratings", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    const outlet = await getOutletByUserId(session.user.id);
    if (!outlet) return reply.status(401).send({ error: "Unauthorized" });

    const rows = await db
      .select({
        id: ratingsTable.id,
        ratings: ratingsTable.ratings,
        comment: ratingsTable.comment,
        reciepent_as: ratingsTable.reciepent_as,
        created_at: ratingsTable.createdAt,
        reviewer_name: usersTable.name,
        product_name: productsTable.product_name,
        outlet_id: ratingsTable.outlet_id,
        product_id: ratingsTable.product_id,
      })
      .from(ratingsTable)
      .leftJoin(usersTable, eq(ratingsTable.reviewer, usersTable.id))
      .leftJoin(productsTable, eq(ratingsTable.product_id, productsTable.id))
      .where(or(eq(ratingsTable.outlet_id, outlet.id), eq(productsTable.outlet_id, outlet.id)))
      .orderBy(desc(ratingsTable.createdAt));

    const data = rows.map((r) => ({
      id: r.id,
      rating: Number(r.ratings) || 5,
      comment: r.comment ?? "",
      type: r.product_id ? "product" : "outlet",
      created_at: r.created_at,
      reviewer_name: r.reviewer_name ?? "Anonim",
      product_name: r.product_name ?? null,
    }));

    return { data };
  });
}
