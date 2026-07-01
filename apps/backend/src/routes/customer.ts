import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull, notInArray, or, sql, sum } from "drizzle-orm";
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
import { attachOrderItems } from "../lib/utils/order-items";
import { getCourierAvailability } from "../lib/utils/courier-availability";
import { getOutletByUserId } from "../lib/outlet-id";

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

    const orders = await db
      .select({
        id: ordersTable.id,
        status: ordersTable.status,
        createdAt: ordersTable.createdAt,
        outletName: outletsTable.name,
        itemCount: sql<number>`COUNT(${orderDetailsTable.id})`.mapWith(Number),
        totalAmount: sum(
          sql<number>`CAST(${orderDetailsTable.summary_price} AS NUMERIC)`,
        ).mapWith(Number),
      })
      .from(ordersTable)
      .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
      .leftJoin(orderDetailsTable, eq(orderDetailsTable.order_id, ordersTable.id))
      .where(eq(ordersTable.customer_id, customer.id))
      .groupBy(ordersTable.id, outletsTable.name)
      .orderBy(desc(ordersTable.createdAt));

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

    const [order] = await db
      .select({
        id: ordersTable.id,
        status: ordersTable.status,
        outletName: outletsTable.name,
        updatedAt: ordersTable.updatedAt,
        createdAt: ordersTable.createdAt,
        fulfillment: ordersTable.fulfillment,
        scheduledAt: ordersTable.scheduled_at,
      })
      .from(ordersTable)
      .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
      .where(and(eq(ordersTable.customer_id, customer.id), notInArray(ordersTable.status, ["cancelled"])))
      .orderBy(desc(ordersTable.createdAt))
      .limit(1);

    if (!order) return { success: false };

    return { success: true, order };
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

    const availability = await getCourierAvailability(courier.id);

    if (!availability.canReceiveOrder) {
      return {
        success: true,
        orders: [],
        canReceiveOrder: false,
        reason: !availability.isOnline ? "offline" : "busy",
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
          eq(ordersTable.status, "confirmed"),
          isNull(ordersTable.courier_id),
          // Service orders are courier-less by design — never surface them here.
          eq(ordersTable.fulfillment, "delivery"),
        ),
      )
      .orderBy(ordersTable.createdAt);

    const visibleOrders = availability.delaySeconds > 0
      ? orders.filter((order) => {
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
      .where(eq(ordersTable.courier_id, courier.id))
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
