import type { FastifyInstance } from "fastify";
import { and, or, eq, desc, sql, gte, lte, ilike, count, inArray, isNull, notInArray, lt } from "drizzle-orm";
import { db } from "../db";
import {
  ordersTable,
  orderDetailsTable,
  productsTable,
  outletsTable,
  customersTable,
  usersTable,
  ratingsTable,
  cashFlows,
  cashInCategoryTable,
  cashOutCategoryTable,
  cashInDetailTable,
  cashOutDetailTable,
  invoicePaymentsTable,
  invoicesTable,
  locationsTable,
} from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { orderNotDeleted } from "../lib/order-scope";
import { getOutletByUserId } from "../lib/outlet-id";
import { getOutletAccess, hasPermission, parseActiveOutletId, getSubscriptionGate, gateBlocks, type EmployeePermission } from "../lib/outlet-access";
import { attachOrderItems } from "../lib/utils/order-items";
import { APP_TIMEZONE, getUTCRangeFromLocalDate, getUTCRangeFromLocalMonth } from "../lib/timezone";
import { getOpenShiftId } from "../lib/shift";
import { money } from "../lib/money-sql";
import { lineCogsSql, orderCogsSql } from "../lib/cogs";

// Money columns (summary_price, buying_price) are varchar and a single blank
// row makes the cast throw, killing the whole aggregate. See lib/money-sql.ts.

// POS/cashier orders are attached to this hardcoded "offline" customer (see
// mutations.ts /api/add-order-detail). Matches admin.ts OFFLINE_CUSTOMER_EMAIL.
const OFFLINE_CUSTOMER_EMAIL = "rizkygin1@gmail.com";

// Owner or employee holding `perm` → the outlet; otherwise null (each route
// already replies 403 on null). Honors the active-outlet cookie and the
// subscription gate (read-only when expired, plan feature boundaries). Routes
// NOT converted stay getOutletByUserId, i.e. strictly owner-only — deny is the
// default for anything unmapped.
async function outletFor(
  userId: string,
  perm: EmployeePermission,
  request: import("fastify").FastifyRequest,
) {
  const access = await getOutletAccess(userId, parseActiveOutletId(request));
  if (!access || !hasPermission(access, perm)) return null;
  const gate = await getSubscriptionGate(access.outlet.user_id);
  if (gateBlocks(gate, perm, request.method)) return null;
  return access.outlet;
}

// The Order Lobby's lanes differ only by status, so they share one query.
// `courier_id` is part of the projection deliberately: the UI gates the "Siap"
// button and the courier-search lane on it, and leaving it out doesn't error —
// it silently reads as undefined and disables the button forever.
async function lobbyOrdersByStatus(
  outletId: number,
  status: "pending" | "confirmed" | "preparing" | "ready",
) {
  const orders = await db
    .select({
      orderId: ordersTable.id,
      customerName: usersTable.name,
      customerPhone: usersTable.phone,
      courierId: ordersTable.courier_id,
      deliveryFee: ordersTable.delivery_fee,
      note: ordersTable.note,
      createdAt: ordersTable.createdAt,
      status: ordersTable.status,
      fulfillment: ordersTable.fulfillment,
      scheduledAt: ordersTable.scheduled_at,
      discountAmount: ordersTable.discount_amount,
      // Needed by the materials lane: the owner prices the haul from how far it
      // has to go, so the drop-off has to be on the card before they can quote.
      // leftJoin — a customer with no saved default address must not vanish from
      // the lobby entirely.
      dropoffAddress: locationsTable.address,
      // Coordinates too, so the card's address can open a driving route rather
      // than a text search that may not resolve a kampung address at all.
      dropoffLat: locationsTable.lat,
      dropoffLon: locationsTable.lon,
    })
    .from(ordersTable)
    .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
    .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
    .leftJoin(
      locationsTable,
      and(eq(locationsTable.user_id, usersTable.id), eq(locationsTable.is_default, true)),
    )
    .where(and(orderNotDeleted, eq(ordersTable.outlet_id, outletId), eq(ordersTable.status, status)))
    .orderBy(ordersTable.createdAt);

  return attachOrderItems(orders);
}

export async function ownerRoutes(app: FastifyInstance) {
  app.get("/api/get-outlet-orders", async (request, reply) => {
    try {
      const { page = "1", limit = "10", search = "", status = "all", dateFrom = "", dateTo = "" } = request.query as Record<string, string>;

      const pageNum = Math.max(1, Number(page) || 1);
      const limitNum = Math.max(1, Number(limit) || 10);
      const offset = (pageNum - 1) * limitNum;

      const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
      if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

      const outlet = await outletFor(session.user.id, "activeOrders", request);
      if (!outlet) return reply.status(403).send({ success: false, error: "No outlet found" });

      const dateStart = dateFrom ? new Date(dateFrom) : undefined;
      const dateEnd = dateTo ? new Date(`${dateTo}T23:59:59.999Z`) : undefined;

      type OrderStatus = "pending" | "confirmed" | "preparing" | "ready" | "on_delivery" | "delivered" | "cancelled";
      const ACTIVE_STATUSES: OrderStatus[] = ["confirmed", "preparing", "ready", "on_delivery"];

      const statusFilter =
        status === "all" ? undefined :
        status === "aktif" ? inArray(ordersTable.status, ACTIVE_STATUSES) :
        status === "selesai" ? eq(ordersTable.status, "delivered") :
        eq(ordersTable.status, status as OrderStatus);

      const baseFilter = and(
        orderNotDeleted,
        eq(productsTable.outlet_id, outlet.id),
        statusFilter,
        search ? or(ilike(usersTable.name, `%${search}%`), ilike(orderDetailsTable.order_id, `%${search}%`)) : undefined,
        dateStart ? gte(orderDetailsTable.created_at, dateStart) : undefined,
        dateEnd ? lte(orderDetailsTable.created_at, dateEnd) : undefined,
      );

      const [rows, countRows, statsRows] = await Promise.all([
        db
          .select({
            orderId: orderDetailsTable.order_id,
            itemCount: sql<number>`cast(count(*) as int)`,
            totalAmount: sql<number>`coalesce(sum(${money(orderDetailsTable.summary_price)}), 0)`,
            status: ordersTable.status,
            // Drives whether the row offers a cancel button — only cashier
            // orders can be cancelled here.
            source: ordersTable.source,
            createdAt: sql<string>`max(${orderDetailsTable.created_at})::text`,
            customerName: usersTable.name,
          })
          .from(orderDetailsTable)
          .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
          .innerJoin(ordersTable, eq(orderDetailsTable.order_id, ordersTable.id))
          .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
          .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
          .where(baseFilter)
          .groupBy(orderDetailsTable.order_id, usersTable.name, ordersTable.status, ordersTable.source)
          .orderBy(desc(sql`max(${orderDetailsTable.created_at})`))
          .limit(limitNum)
          .offset(offset),

        db
          .select({ count: sql<number>`count(distinct ${orderDetailsTable.order_id})` })
          .from(orderDetailsTable)
          .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
          .innerJoin(ordersTable, eq(orderDetailsTable.order_id, ordersTable.id))
          .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
          .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
          .where(baseFilter),

        db
          .select({ status: ordersTable.status })
          .from(ordersTable)
          .where(and(orderNotDeleted, eq(ordersTable.outlet_id, outlet.id)))
          .groupBy(ordersTable.id, ordersTable.status),
      ]);

      const totalCount = Number(countRows[0]?.count ?? 0);
      const pendingCount = statsRows.filter(r => r.status === "pending").length;
      const processingCount = statsRows.filter(r => ["confirmed", "preparing", "ready", "on_delivery"].includes(r.status)).length;
      const completedCount = statsRows.filter(r => r.status === "delivered").length;
      const cancelledCount = statsRows.filter(r => r.status === "cancelled").length;
      const allCount = statsRows.length;

      return {
        success: true,
        data: rows,
        count: totalCount,
        stats: { allCount, pendingCount, processingCount, completedCount, cancelledCount },
      };
    } catch (error) {
      return reply.status(500).send({ success: false, error: String(error) });
    }
  });

  app.get("/api/get-pending-orders", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const outlet = await outletFor(session.user.id, "activeOrders", request);
    if (!outlet) return reply.status(403).send({ success: false, error: "Not an owner" });

    // No courier reaches this outlet, so no courier-delivered order can
    // ever land here. Reported explicitly rather than as an empty list:
    // the client uses it to stop polling and explain the blank screen.
    if (!outlet.courier_reachable) {
      return { success: true, orders: [], courierReachable: false };
    }

    return { success: true, orders: await lobbyOrdersByStatus(outlet.id, "pending"), courierReachable: true };
  });

  // Count-only sibling of the route above. The incoming-order alarm polls this
  // from every dashboard page, so it must stay cheap — no joins, no item
  // fan-out, just how many orders are waiting on the owner right now.
  app.get("/api/get-pending-orders-count", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const outlet = await outletFor(session.user.id, "activeOrders", request);
    if (!outlet) return reply.status(403).send({ success: false, error: "Not an owner" });

    // The alarm polls this from every dashboard page. An outlet no courier
    // reaches can never accumulate a pending courier order, so skip the query
    // entirely rather than counting to zero over and over.
    if (!outlet.courier_reachable) {
      return { success: true, count: 0, courierReachable: false };
    }

    const [row] = await db
      .select({ count: count() })
      .from(ordersTable)
      .where(
        and(orderNotDeleted, eq(ordersTable.outlet_id, outlet.id), eq(ordersTable.status, "pending")),
      );

    return { success: true, count: row?.count ?? 0, courierReachable: true };
  });

  app.get("/api/get-preparing-orders", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const outlet = await outletFor(session.user.id, "activeOrders", request);
    if (!outlet) return reply.status(403).send({ success: false, error: "Not an owner" });

    // No courier reaches this outlet, so no courier-delivered order can
    // ever land here. Reported explicitly rather than as an empty list:
    // the client uses it to stop polling and explain the blank screen.
    if (!outlet.courier_reachable) {
      return { success: true, orders: [], courierReachable: false };
    }

    return { success: true, orders: await lobbyOrdersByStatus(outlet.id, "preparing"), courierReachable: true };
  });

  // "Mencari kurir" lane: the owner has confirmed the order but no courier has
  // claimed it yet (courier.ts flips confirmed -> preparing and sets courier_id
  // in one update). These orders were previously surfaced NOWHERE — they left
  // the pending tab on confirm and only reappeared once a courier accepted.
  app.get("/api/get-confirmed-orders", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const outlet = await outletFor(session.user.id, "activeOrders", request);
    if (!outlet) return reply.status(403).send({ success: false, error: "Not an owner" });

    // No courier reaches this outlet, so no courier-delivered order can
    // ever land here. Reported explicitly rather than as an empty list:
    // the client uses it to stop polling and explain the blank screen.
    if (!outlet.courier_reachable) {
      return { success: true, orders: [], courierReachable: false };
    }

    return { success: true, orders: await lobbyOrdersByStatus(outlet.id, "confirmed"), courierReachable: true };
  });

  app.get("/api/get-ready-orders", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const outlet = await outletFor(session.user.id, "activeOrders", request);
    if (!outlet) return reply.status(403).send({ success: false, error: "Not an owner" });

    // No courier reaches this outlet, so no courier-delivered order can
    // ever land here. Reported explicitly rather than as an empty list:
    // the client uses it to stop polling and explain the blank screen.
    if (!outlet.courier_reachable) {
      return { success: true, orders: [], courierReachable: false };
    }

    return { success: true, orders: await lobbyOrdersByStatus(outlet.id, "ready"), courierReachable: true };
  });

  app.get("/api/get-outlet-order-detail", async (request, reply) => {
    try {
      const { order_id } = request.query as { order_id?: string };
      if (!order_id) return reply.status(400).send({ success: false, error: "Missing order_id" });

      const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
      if (!session?.user) return reply.status(401).send({ success: false });

      const outlet = await outletFor(session.user.id, "activeOrders", request);
      if (!outlet) return reply.status(403).send({ success: false, error: "Not an owner" });

      // Order header + customer (user) info, scoped to this owner's outlet.
      const [order] = await db
        .select({
          status: ordersTable.status,
          note: ordersTable.note,
          discountAmount: ordersTable.discount_amount,
          deliveryFee: ordersTable.delivery_fee,
          createdAt: ordersTable.createdAt,
          customerName: usersTable.name,
          customerEmail: usersTable.email,
          customerPhone: usersTable.phone,
        })
        .from(ordersTable)
        .leftJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
        .leftJoin(usersTable, eq(customersTable.user_id, usersTable.id))
        .where(and(orderNotDeleted, eq(ordersTable.id, order_id), eq(ordersTable.outlet_id, outlet.id)))
        .limit(1);

      if (!order) return reply.status(404).send({ success: false, error: "Order not found" });

      const rows = await db
        .select({
          detailId: orderDetailsTable.id,
          quantity: orderDetailsTable.quantity,
          note: orderDetailsTable.note_product,
          summaryPrice: orderDetailsTable.summary_price,
          createdAt: orderDetailsTable.created_at,
          productId: productsTable.id,
          productName: productsTable.product_name,
          price: productsTable.price,
          category: productsTable.category,
          unit: productsTable.unit,
          image: productsTable.image,
        })
        .from(orderDetailsTable)
        .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
        .where(eq(orderDetailsTable.order_id, order_id))
        .orderBy(desc(orderDetailsTable.created_at));

      const isOfflineOrder = order.customerEmail === OFFLINE_CUSTOMER_EMAIL;

      return {
        success: true,
        // Address/phone/avatar are here for the reprint slip, which rebuilds the
        // same receipt the cashier printed at checkout and needs the full header.
        outlet: {
          id: String(outlet.id),
          name: outlet.name,
          address: outlet.address,
          phone: outlet.phone,
          avatar: outlet.avatar,
        },
        // Whoever is reprinting, not whoever originally rang it up: the order
        // rows don't record a cashier, and the slip's "Kasir" line is only ever
        // read as "who handed me this paper".
        cashierName: session.user.name ?? "",
        order: {
          createdAt: order.createdAt,
          discountAmount: order.discountAmount,
          deliveryFee: order.deliveryFee,
        },
        items: rows.map((i) => ({
          ...i,
          detailId: String(i.detailId),
          status: order.status,
          image: i.image || "not-found.webp",
        })),
        customer: isOfflineOrder
          ? null
          : {
              name: order.customerName ?? null,
              email: order.customerEmail ?? null,
              phone: order.customerPhone ?? null,
              address: null,
            },
        isOfflineOrder,
        offlineNote: isOfflineOrder ? order.note : null,
      };
    } catch (error) {
      return reply.status(500).send({ success: false, error: String(error) });
    }
  });

  app.get("/api/get-data-order", async (request, reply) => {
    try {
      const { search = "", dateFrom = "", dateTo = "" } = request.query as Record<string, string>;

      const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
      if (!session?.user) return reply.status(401).send({ success: false });

      const outlet = await outletFor(session.user.id, "reports", request);
      if (!outlet) return reply.status(403).send({ success: false, error: "Not an owner" });

      const dateStart = dateFrom ? new Date(dateFrom) : undefined;
      const dateEnd = dateTo ? new Date(`${dateTo}T23:59:59.999Z`) : undefined;

      const rows = await db
        .select({
          product_name: productsTable.product_name,
          order_id: orderDetailsTable.order_id,
          quantity: orderDetailsTable.quantity,
          summary_price: orderDetailsTable.summary_price,
          note_product: orderDetailsTable.note_product,
          status: ordersTable.status,
        })
        .from(orderDetailsTable)
        .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
        .innerJoin(ordersTable, eq(orderDetailsTable.order_id, ordersTable.id))
        .where(
          and(
            orderNotDeleted,
            eq(productsTable.outlet_id, outlet.id),
            search ? ilike(productsTable.product_name, `%${search}%`) : undefined,
            dateStart ? gte(orderDetailsTable.created_at, dateStart) : undefined,
            dateEnd ? lte(orderDetailsTable.created_at, dateEnd) : undefined,
            notInArray(ordersTable.status, ["cancelled"]),
          ),
        )
        .orderBy(desc(orderDetailsTable.created_at));

      return { success: true, data: rows };
    } catch (error) {
      return reply.status(500).send({ success: false, error: String(error) });
    }
  });

  app.get("/api/get-owner-ratings", async (request, reply) => {
    try {
      const { page = "1", filter = "all" } = request.query as Record<string, string>;
      const pageNum = Math.max(1, Number(page) || 1);
      const PAGE_SIZE = 20;
      const offset = (pageNum - 1) * PAGE_SIZE;

      const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
      if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

      const outlet = await getOutletByUserId(session.user.id);
      if (!outlet) return reply.status(401).send({ error: "Unauthorized" });

      const filterCond = filter === "all" ? undefined : eq(ratingsTable.reciepent_as, filter as "customer" | "courier" | "outlet" | "product");

      const outletScope = or(eq(ratingsTable.outlet_id, outlet.id), eq(productsTable.outlet_id, outlet.id));

      const [rows, summaryRows, countRows] = await Promise.all([
        db
          .select({
            id: ratingsTable.id,
            rating: ratingsTable.ratings,
            comment: ratingsTable.comment,
            reciepent_as: ratingsTable.reciepent_as,
            created_at: ratingsTable.createdAt,
            reviewer_name: usersTable.name,
            product_name: productsTable.product_name,
          })
          .from(ratingsTable)
          .leftJoin(usersTable, eq(ratingsTable.reviewer, usersTable.id))
          .leftJoin(productsTable, eq(ratingsTable.product_id, productsTable.id))
          .where(and(outletScope, filterCond))
          .orderBy(desc(ratingsTable.createdAt))
          .limit(PAGE_SIZE)
          .offset(offset),

        // Summary is split per recipient (outlet vs product) and ignores the tab
        // filter, so the two summary cards always reflect totals across all ratings.
        db
          .select({ reciepent_as: ratingsTable.reciepent_as, rating: ratingsTable.ratings, count: count() })
          .from(ratingsTable)
          .leftJoin(productsTable, eq(ratingsTable.product_id, productsTable.id))
          .where(outletScope)
          .groupBy(ratingsTable.reciepent_as, ratingsTable.ratings),

        db
          .select({ count: count() })
          .from(ratingsTable)
          .leftJoin(productsTable, eq(ratingsTable.product_id, productsTable.id))
          .where(and(outletScope, filterCond)),
      ]);

      const buildSection = (kind: "outlet" | "product") => {
        const dist = [5, 4, 3, 2, 1].map((star) => ({
          star,
          count: (summaryRows as any[])
            .filter((r: any) => r.reciepent_as === kind && Math.round(Number(r.rating)) === star)
            .reduce((a: number, r: any) => a + Number(r.count), 0),
        }));
        const sectionCount = dist.reduce((a, d) => a + d.count, 0);
        const avg = sectionCount > 0 ? dist.reduce((a, d) => a + d.star * d.count, 0) / sectionCount : 0;
        return { avg: Number(avg.toFixed(2)), count: sectionCount, dist };
      };

      const totalCount = (countRows as any[])[0]?.count ?? 0;

      return {
        success: true,
        data: (rows || []).map((r) => ({
          id: r.id,
          rating: Number(r.rating) || 5,
          comment: r.comment ?? "",
          type: r.product_name ? "product" : "outlet",
          created_at: r.created_at,
          reviewer_name: r.reviewer_name ?? "Anonim",
          product_name: r.product_name ?? null,
        })),
        summary: { outlet: buildSection("outlet"), product: buildSection("product") },
        total: totalCount,
        page: pageNum,
        totalPages: Math.ceil(totalCount / PAGE_SIZE),
      };
    } catch (error) {
      return reply.status(500).send({ success: false, error: String(error) });
    }
  });

  app.get("/api/get-data-chart", async (request, reply) => {
    try {
      const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
      if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

      const outlet = await outletFor(session.user.id, "reports", request);
      if (!outlet) return reply.status(401).send({ error: "Unauthorized" });

      // Month edges must be local midnight, not the container's. new Date(y, m, 1)
      // reads the process zone — UTC in the deployed image — which shifts every
      // boundary 7 hours and misfiles orders placed late on the last of the month.
      const { timezone = "Asia/Jakarta" } = request.query as Record<string, string>;

      function getLast6Months() {
        const months = [];
        const todayLocal = new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date());
        const [localYear, localMonth] = todayLocal.split("-").map(Number);

        for (let i = 5; i >= 0; i--) {
          // UTC arithmetic here is just a calendar cursor; the helper turns each
          // year-month into the real UTC instant that local midnight falls on.
          const cursor = new Date(Date.UTC(localYear, localMonth - 1 - i, 1));
          const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
          const { startUTC: start, endUTC: end } = getUTCRangeFromLocalMonth(key, timezone);
          months.push({
            start,
            end,
            month: cursor.toLocaleString("default", { month: "short", timeZone: "UTC" }),
          });
        }
        return months;
      }

      const months = getLast6Months();
      const data = await Promise.all(
        months.map(async ({ start, end, month }) => {
          const [result] = await db
            .select({ total: sql<string>`coalesce(sum(${money(orderDetailsTable.summary_price)}), 0)` })
            .from(orderDetailsTable)
            .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
            .where(and(eq(productsTable.outlet_id, outlet.id), gte(orderDetailsTable.created_at, start), lt(orderDetailsTable.created_at, end)));
          return { month, total: Number(result?.total ?? 0) };
        }),
      );

      return { success: true, data };
    } catch (error) {
      return reply.status(500).send({ success: false, error: String(error) });
    }
  });

  app.get("/api/get-hourly-orders", async (request, reply) => {
    try {
      const { date = "", timezone = "Asia/Jakarta" } = request.query as Record<string, string>;

      const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
      if (!session?.user) return reply.status(401).send({ success: false });

      const outlet = await outletFor(session.user.id, "reports", request);
      if (!outlet) return reply.status(401).send({ success: false, error: "Not an owner" });

      if (!date) return reply.status(400).send({ success: false, error: "Missing 'date' parameter" });

      const { startUTC, endUTC } = getUTCRangeFromLocalDate(date, timezone);

      const rows = await db
        .select({
          hour: sql<number>`extract(hour from ${orderDetailsTable.created_at} at time zone ${timezone})::int`,
          count: sql<number>`count(distinct ${orderDetailsTable.order_id})`,
          total: sql<number>`coalesce(sum(${money(orderDetailsTable.summary_price)}), 0)`,
        })
        .from(orderDetailsTable)
        .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
        .where(
          and(
            eq(productsTable.outlet_id, outlet.id),
            gte(orderDetailsTable.created_at, startUTC),
            lt(orderDetailsTable.created_at, endUTC),
          ),
        )
        // Group/order by the SELECT's first output column (the hour expression).
        // Repeating the expression would emit a separate $-param for the timezone
        // each time, so Postgres wouldn't treat them as the same grouped expression
        // ("must appear in the GROUP BY clause").
        .groupBy(sql`1`)
        .orderBy(sql`1`);

      const hourlyData = Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        count: 0,
        total: 0,
      }));

      rows.forEach((row) => {
        const idx = row.hour ?? 0;
        if (idx >= 0 && idx < 24) {
          hourlyData[idx] = { hour: idx, count: row.count, total: Number(row.total) };
        }
      });

      return { success: true, data: hourlyData };
    } catch (error) {
      return reply.status(500).send({ success: false, error: String(error) });
    }
  });

  // Owner reports summary for a period: KPIs (revenue, HPP/cogs, profit, orders,
  // AOV) with previous-period comparison, daily sales trend, top products by
  // revenue/profit, and hourly distribution. Sales = non-cancelled, non-pending
  // orders (matches the dashboard's realized-sales definition).
  app.get("/api/reports/summary", async (request, reply) => {
    try {
      const { period = "30d", timezone = "Asia/Jakarta" } = request.query as Record<string, string>;

      const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
      if (!session?.user) return reply.status(401).send({ success: false });

      const outlet = await outletFor(session.user.id, "reports", request);
      if (!outlet) return reply.status(403).send({ success: false, error: "Not an owner" });

      // Local "today" (YYYY-MM-DD) in the outlet's timezone.
      const now = new Date();
      const localDateStr = (d: Date) => {
        const p: any = {};
        new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        })
          .formatToParts(d)
          .forEach((x) => (p[x.type] = x.value));
        return `${p.year}-${p.month}-${p.day}`;
      };

      const today = localDateStr(now);
      let from: Date;
      const to = now;
      if (period === "today") {
        from = getUTCRangeFromLocalDate(today, timezone).startUTC;
      } else if (period === "7d") {
        from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (period === "month") {
        from = getUTCRangeFromLocalDate(`${today.slice(0, 7)}-01`, timezone).startUTC;
      } else {
        from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }
      // Previous window of equal length, immediately before `from`.
      const spanMs = to.getTime() - from.getTime();
      const prevFrom = new Date(from.getTime() - spanMs);
      const prevTo = from;

      const scope = (start: Date, end: Date) =>
        and(
          orderNotDeleted,
          eq(productsTable.outlet_id, outlet.id),
          gte(orderDetailsTable.created_at, start),
          lt(orderDetailsTable.created_at, end),
          notInArray(ordersTable.status, ["cancelled", "pending"]),
        );

      const kpiSelect = {
        revenue: sql<number>`coalesce(sum(${money(orderDetailsTable.summary_price)}), 0)`.mapWith(Number),
        orders: sql<number>`count(distinct ${orderDetailsTable.order_id})`.mapWith(Number),
      };

      // Aggregated per ORDER rather than per line, and so a separate query
      // rather than another column in kpiSelect. Since 0066 a line CAN be costed
      // on its own (see lineCogsSql, used by topProducts below), but only the
      // order-level reader carries the pre-0066 branch — an order written before
      // the tag has a ledger total and no way to split it — so this stays the
      // more truthful of the two for the headline number.
      //
      // Windowed on orders.created_at rather than orderDetails.created_at (what
      // `scope` above uses). They are written in the same transaction, so the
      // two agree in practice; the order's own timestamp is the right key for an
      // order-level total.
      const cogsFor = async (start: Date, end: Date) => {
        const res = await db.execute(sql`
          select coalesce(sum(c.cogs), 0)::float8 as cogs
          from (
            select ${orderCogsSql(sql`o.id`)} as cogs
            from orders o
            where o.outlet_id = ${outlet.id}
              and o.deleted_at is null
              and o.status not in ('cancelled', 'pending')
              and o.created_at >= ${start}
              and o.created_at < ${end}
          ) c
        `);
        const row = (res as unknown as { rows?: { cogs: number }[] }).rows?.[0]
          ?? (Array.isArray(res) ? (res[0] as { cogs: number }) : undefined);
        return Number(row?.cogs ?? 0);
      };

      const [cur, prev, curCogs, prevCogs, trendRows, topRows, hourRows] = await Promise.all([
        db
          .select(kpiSelect)
          .from(orderDetailsTable)
          .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
          .innerJoin(ordersTable, eq(orderDetailsTable.order_id, ordersTable.id))
          .where(scope(from, to)),
        db
          .select(kpiSelect)
          .from(orderDetailsTable)
          .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
          .innerJoin(ordersTable, eq(orderDetailsTable.order_id, ordersTable.id))
          .where(scope(prevFrom, prevTo)),
        cogsFor(from, to),
        cogsFor(prevFrom, prevTo),
        db
          .select({
            day: sql<string>`(${orderDetailsTable.created_at} at time zone ${timezone})::date`,
            revenue: sql<number>`coalesce(sum(${money(orderDetailsTable.summary_price)}), 0)`.mapWith(Number),
          })
          .from(orderDetailsTable)
          .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
          .innerJoin(ordersTable, eq(orderDetailsTable.order_id, ordersTable.id))
          .where(scope(from, to))
          .groupBy(sql`1`)
          .orderBy(sql`1`),
        db
          .select({
            name: productsTable.product_name,
            qty: sql<number>`coalesce(sum(${orderDetailsTable.quantity}), 0)`.mapWith(Number),
            revenue: sql<number>`coalesce(sum(${money(orderDetailsTable.summary_price)}), 0)`.mapWith(Number),
            // From the cost ledger, the same source as the profit KPI above.
            // This used to be a live buying_price join with a note explaining
            // that per-product cost was unreadable from the ledger — true until
            // migration 0066 tagged each movement with the orderDetails row
            // that caused it, ingredient movements of a composition included.
            // Until then a nasi goreng cost whatever was typed into its
            // buying_price, which for a recipe product is usually nothing, so
            // the dishes an owner actually makes ranked as pure profit.
            profit: sql<number>`coalesce(sum(${money(orderDetailsTable.summary_price)} - ${lineCogsSql({
              id: orderDetailsTable.id,
              unitCost: orderDetailsTable.unit_cost,
              quantity: orderDetailsTable.quantity,
              buyingPrice: productsTable.buying_price,
            })}), 0)`.mapWith(Number),
          })
          .from(orderDetailsTable)
          .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
          .innerJoin(ordersTable, eq(orderDetailsTable.order_id, ordersTable.id))
          .where(scope(from, to))
          .groupBy(productsTable.id)
          .orderBy(desc(sql`coalesce(sum(${money(orderDetailsTable.summary_price)}), 0)`))
          .limit(8),
        db
          .select({
            hour: sql<number>`extract(hour from (${orderDetailsTable.created_at} at time zone ${timezone}))::int`,
            orders: sql<number>`count(distinct ${orderDetailsTable.order_id})`.mapWith(Number),
            revenue: sql<number>`coalesce(sum(${money(orderDetailsTable.summary_price)}), 0)`.mapWith(Number),
          })
          .from(orderDetailsTable)
          .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
          .innerJoin(ordersTable, eq(orderDetailsTable.order_id, ordersTable.id))
          .where(scope(from, to))
          .groupBy(sql`1`)
          .orderBy(sql`1`),
      ]);

      const c = { ...(cur[0] ?? { revenue: 0, orders: 0 }), cogs: curCogs };
      const p = { ...(prev[0] ?? { revenue: 0, orders: 0 }), cogs: prevCogs };
      const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : a > 0 ? 100 : 0);

      const hourly = Array.from({ length: 24 }, (_, i) => ({ hour: i, orders: 0, revenue: 0 }));
      hourRows.forEach((r) => {
        const h = r.hour ?? 0;
        if (h >= 0 && h < 24) hourly[h] = { hour: h, orders: r.orders, revenue: Number(r.revenue) };
      });

      return {
        success: true,
        period,
        kpis: {
          revenue: c.revenue,
          cogs: c.cogs,
          profit: c.revenue - c.cogs,
          orders: c.orders,
          aov: c.orders > 0 ? Math.round(c.revenue / c.orders) : 0,
          revenueDeltaPct: Number(pct(c.revenue, p.revenue).toFixed(1)),
          profitDeltaPct: Number(pct(c.revenue - c.cogs, p.revenue - p.cogs).toFixed(1)),
          ordersDeltaPct: Number(pct(c.orders, p.orders).toFixed(1)),
        },
        trend: trendRows.map((r) => ({ day: String(r.day), revenue: Number(r.revenue) })),
        topProducts: topRows.map((r) => ({
          name: r.name,
          qty: r.qty,
          revenue: Number(r.revenue),
          profit: Number(r.profit),
        })),
        hourly,
      };
    } catch (error) {
      return reply.status(500).send({ success: false, error: String(error) });
    }
  });

  app.get("/api/cashflow", async (request, reply) => {
    try {
      const { month, timezone = "Asia/Jakarta" } = request.query as Record<string, string>;

      const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
      if (!session?.user) return reply.status(401).send({ success: false });

      const outlet = await outletFor(session.user.id, "cashflow", request);
      if (!outlet) return reply.status(401).send({ success: false });

      if (!month) return reply.status(400).send({ error: "Missing 'month' parameter" });

      const { startUTC, endUTC } = getUTCRangeFromLocalMonth(month, timezone);

      const rows = await db
        .select({
          id: cashFlows.id,
          in_detail_id: cashFlows.cash_in_detail_id,
          out_detail_id: cashFlows.cash_out_detail_id,
          in_category: cashInCategoryTable.category,
          in_amount: cashInDetailTable.money_amount,
          in_date: cashInDetailTable.created_at,
          out_category: cashOutCategoryTable.category,
          out_amount: cashOutDetailTable.money_amount,
          out_date: cashOutDetailTable.created_at,
          invoice_number: invoicesTable.number,
        })
        .from(cashFlows)
        .leftJoin(cashInDetailTable, eq(cashFlows.cash_in_detail_id, cashInDetailTable.id))
        .leftJoin(cashInCategoryTable, eq(cashInDetailTable.category_id, cashInCategoryTable.id))
        .leftJoin(cashOutDetailTable, eq(cashFlows.cash_out_detail_id, cashOutDetailTable.id))
        .leftJoin(cashOutCategoryTable, eq(cashOutDetailTable.category_id, cashOutCategoryTable.id))
        // Invoice payments link back to their invoice via invoice_payments —
        // sales cash-ins through cash_in_detail_id, purchase cash-outs through
        // cash_out_detail_id. Surface the invoice number as the row note so each
        // payment is traceable to its invoice.
        .leftJoin(
          invoicePaymentsTable,
          or(
            eq(invoicePaymentsTable.cash_in_detail_id, cashInDetailTable.id),
            eq(invoicePaymentsTable.cash_out_detail_id, cashOutDetailTable.id),
          ),
        )
        .leftJoin(invoicesTable, eq(invoicesTable.id, invoicePaymentsTable.invoice_id))
        .where(
          and(
            eq(cashFlows.outlet_id, outlet.id),
            or(
              and(gte(cashInDetailTable.created_at, startUTC), lt(cashInDetailTable.created_at, endUTC)),
              and(gte(cashOutDetailTable.created_at, startUTC), lt(cashOutDetailTable.created_at, endUTC)),
            ),
          ),
        );

      const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
      const timeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false });

      const data = rows.map((row) => {
        const date = row.in_date ?? row.out_date!;
        return {
          id: String(row.id),
          type: (row.in_detail_id !== null ? "IN" : "OUT") as "IN" | "OUT",
          category: (row.in_category ?? row.out_category) ?? "",
          amount: Number(row.in_amount ?? row.out_amount ?? "0"),
          date: dateFormatter.format(date),
          time: timeFormatter.format(date),
          note: row.invoice_number ?? "",
        };
      });

      return { data };
    } catch (error) {
      return reply.status(500).send({ message: String(error) });
    }
  });

  app.post("/api/cashflow", async (request, reply) => {
    try {
      const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
      if (!session?.user) return reply.status(401).send({ success: false });

      const outlet = await outletFor(session.user.id, "cashflow", request);
      if (!outlet) return reply.status(401).send({ success: false });

      const { type, category, amount, date, timezone = "Asia/Jakarta" } = request.body as Record<string, any>;

      if (!type || !category || !amount || !date) return reply.status(400).send({ error: "Missing required fields" });
      if (isNaN(Number(amount)) || Number(amount) <= 0) return reply.status(400).send({ error: "Invalid amount" });

      const { startUTC, endUTC } = getUTCRangeFromLocalDate(date, timezone);
      const now = new Date();
      const created_at = now >= startUTC && now <= endUTC ? now : startUTC;

      // Money moved right now, while a shift is open, came out of (or went
      // into) that drawer — petty cash for ice, a supplier paid from the till —
      // so it belongs on that shift's closing report.
      //
      // Only for entries happening NOW. A backdated entry gets no shift: it
      // describes a day that is over, and hanging it on today's open drawer
      // would make that drawer come up short against a count that was already
      // correct.
      const isBackdated = created_at !== now;
      const shift_id = isBackdated ? null : await getOpenShiftId(db, outlet.id);

      const timeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false });

      if (type === "IN") {
        const [cat] = await db
          .select({ id: cashInCategoryTable.id })
          .from(cashInCategoryTable)
          .where(eq(cashInCategoryTable.category, category))
          .limit(1);

        if (!cat) return reply.status(400).send({ error: "Unknown category" });

        const [detail] = await db.insert(cashInDetailTable).values({ category_id: cat.id, money_amount: String(amount), type: "cash", created_at }).returning();
        const [cf] = await db.insert(cashFlows).values({ outlet_id: outlet.id, cash_in_detail_id: detail.id, shift_id }).returning();

        return { data: { id: String(cf.id), type: "IN", category, amount: Number(amount), date, time: timeFormatter.format(detail.created_at), note: "" } };
      }

      if (type === "OUT") {
        const [cat] = await db
          .select({ id: cashOutCategoryTable.id })
          .from(cashOutCategoryTable)
          .where(eq(cashOutCategoryTable.category, category))
          .limit(1);

        if (!cat) return reply.status(400).send({ error: "Unknown category" });

        const [detail] = await db.insert(cashOutDetailTable).values({ category_id: cat.id, money_amount: String(amount), type: "cash", created_at }).returning();
        const [cf] = await db.insert(cashFlows).values({ outlet_id: outlet.id, cash_out_detail_id: detail.id, shift_id }).returning();

        return { data: { id: String(cf.id), type: "OUT", category, amount: Number(amount), date, time: timeFormatter.format(detail.created_at), note: "" } };
      }

      return reply.status(400).send({ error: "Invalid type" });
    } catch (error) {
      return reply.status(500).send({ message: String(error) });
    }
  });

  app.delete("/api/cashflow", async (request, reply) => {
    try {
      const { id } = request.query as { id?: string };

      const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
      if (!session?.user) return reply.status(401).send({ success: false });

      const outlet = await outletFor(session.user.id, "cashflow", request);
      if (!outlet) return reply.status(401).send({ success: false });

      if (!id || isNaN(Number(id))) return reply.status(400).send({ error: "Missing or invalid 'id' parameter" });

      const [cf] = await db
        .select()
        .from(cashFlows)
        .where(and(eq(cashFlows.id, Number(id)), eq(cashFlows.outlet_id, outlet.id)))
        .limit(1);

      if (!cf) return reply.status(404).send({ error: "Not found" });

      const inDetailId = cf.cash_in_detail_id;
      const outDetailId = cf.cash_out_detail_id;

      await db.delete(cashFlows).where(eq(cashFlows.id, Number(id)));

      if (inDetailId) await db.delete(cashInDetailTable).where(eq(cashInDetailTable.id, inDetailId));
      if (outDetailId) await db.delete(cashOutDetailTable).where(eq(cashOutDetailTable.id, outDetailId));

      return { success: true };
    } catch (error) {
      return reply.status(500).send({ message: String(error) });
    }
  });

  app.get("/api/get-pos-cashin", async (request, reply) => {
    try {
      const { timezone = "Asia/Jakarta", date } = request.query as Record<string, string>;

      const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
      if (!session?.user) return reply.status(401).send({ success: false });

      const outlet = await outletFor(session.user.id, "reports", request);
      if (!outlet) return reply.status(401).send({ success: false });

      if (!date) return reply.status(400).send({ success: false, error: "Missing 'date' parameter" });

      const { startUTC, endUTC } = getUTCRangeFromLocalDate(date, timezone);

      const rows = await db
        .select({
          id: cashInDetailTable.id,
          category: cashInCategoryTable.category,
          money_amount: sql<string>`cast(${cashInDetailTable.money_amount} as text)`,
          created_at: cashInDetailTable.created_at,
        })
        .from(cashInDetailTable)
        .innerJoin(cashInCategoryTable, eq(cashInDetailTable.category_id, cashInCategoryTable.id))
        .innerJoin(cashFlows, eq(cashFlows.cash_in_detail_id, cashInDetailTable.id))
        .where(and(eq(cashFlows.outlet_id, outlet.id), gte(cashInDetailTable.created_at, startUTC), lt(cashInDetailTable.created_at, endUTC)))
        .orderBy(desc(cashInDetailTable.created_at));

      const total = rows.reduce((sum, r) => sum + Number(r.money_amount), 0);

      return {
        success: true,
        // Formatted server-side, so it needs an explicit zone — a bare
        // toLocaleTimeString() reads the process TZ and prints UTC.
        data: rows.map((r) => ({
          id: r.id,
          category: r.category,
          amount: Number(r.money_amount),
          time: new Date(r.created_at).toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: APP_TIMEZONE,
          }),
        })),
        total,
      };
    } catch (error) {
      return reply.status(500).send({ success: false, error: String(error) });
    }
  });

  app.get("/api/get-pos-summary", async (request, reply) => {
    try {
      const { date = "", month = "", timeZone = "Asia/Jakarta" } = request.query as Record<string, string>;

      const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
      if (!session?.user) return reply.status(401).send({ success: false });

      const outlet = await outletFor(session.user.id, "reports", request);
      if (!outlet) return reply.status(401).send({ success: false });

      let startUTC, endUTC;

      if (date) {
        ({ startUTC, endUTC } = getUTCRangeFromLocalDate(date, timeZone));
      } else if (month) {
        ({ startUTC, endUTC } = getUTCRangeFromLocalMonth(month, timeZone));
      } else {
        return reply.status(400).send({ success: false, error: "Missing 'date' or 'month' parameter" });
      }

      const [salesResult] = await db
        .select({
          total: sql<string>`coalesce(sum(${money(orderDetailsTable.summary_price)}), 0)`,
          count: sql<number>`count(distinct ${orderDetailsTable.order_id})`,
        })
        .from(orderDetailsTable)
        .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
        .where(and(eq(productsTable.outlet_id, outlet.id), gte(orderDetailsTable.created_at, startUTC), lt(orderDetailsTable.created_at, endUTC)));

      const [cashInResult] = await db
        .select({ total: sql<string>`coalesce(sum(cast(${cashInDetailTable.money_amount} as numeric)), 0)` })
        .from(cashInDetailTable)
        .innerJoin(cashFlows, eq(cashFlows.cash_in_detail_id, cashInDetailTable.id))
        .where(and(eq(cashFlows.outlet_id, outlet.id), gte(cashInDetailTable.created_at, startUTC), lt(cashInDetailTable.created_at, endUTC)));

      const [cashOutResult] = await db
        .select({ total: sql<string>`coalesce(sum(cast(${cashOutDetailTable.money_amount} as numeric)), 0)` })
        .from(cashOutDetailTable)
        .innerJoin(cashFlows, eq(cashFlows.cash_out_detail_id, cashOutDetailTable.id))
        .where(and(eq(cashFlows.outlet_id, outlet.id), gte(cashOutDetailTable.created_at, startUTC), lt(cashOutDetailTable.created_at, endUTC)));

      return {
        success: true,
        sales: Number(salesResult?.total ?? 0),
        salesCount: Number(salesResult?.count ?? 0),
        cashIn: Number(cashInResult?.total ?? 0),
        cashOut: Number(cashOutResult?.total ?? 0),
        balance: Number(salesResult?.total ?? 0) + Number(cashInResult?.total ?? 0) - Number(cashOutResult?.total ?? 0),
      };
    } catch (error) {
      return reply.status(500).send({ success: false, error: String(error) });
    }
  });
}
