import type { FastifyInstance } from "fastify";
import { and, or, eq, desc, sql, gte, lte, like, count, inArray, isNull, notInArray, lt } from "drizzle-orm";
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
} from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { getOutletByUserId } from "../lib/outlet-id";
import { attachOrderItems } from "../lib/utils/order-items";
import { getUTCRangeFromLocalDate, getUTCRangeFromLocalMonth } from "../lib/timezone";

export async function ownerRoutes(app: FastifyInstance) {
  app.get("/api/get-outlet-orders", async (request, reply) => {
    try {
      const { page = "1", limit = "10", search = "", status = "all", dateFrom = "", dateTo = "" } = request.query as Record<string, string>;

      const pageNum = Math.max(1, Number(page) || 1);
      const limitNum = Math.max(1, Number(limit) || 10);
      const offset = (pageNum - 1) * limitNum;

      const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
      if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

      const outlet = await getOutletByUserId(session.user.id);
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
        eq(productsTable.outlet_id, outlet.id),
        statusFilter,
        search ? or(like(usersTable.name, `%${search}%`), like(orderDetailsTable.order_id, `%${search}%`)) : undefined,
        dateStart ? gte(orderDetailsTable.created_at, dateStart) : undefined,
        dateEnd ? lte(orderDetailsTable.created_at, dateEnd) : undefined,
      );

      const [rows, countRows, statsRows] = await Promise.all([
        db
          .select({
            orderId: orderDetailsTable.order_id,
            itemCount: sql<number>`cast(count(*) as int)`,
            totalAmount: sql<number>`coalesce(sum(cast(${orderDetailsTable.summary_price} as numeric)), 0)`,
            status: ordersTable.status,
            createdAt: sql<string>`max(${orderDetailsTable.created_at})::text`,
            customerName: usersTable.name,
          })
          .from(orderDetailsTable)
          .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
          .innerJoin(ordersTable, eq(orderDetailsTable.order_id, ordersTable.id))
          .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
          .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
          .where(baseFilter)
          .groupBy(orderDetailsTable.order_id, usersTable.name, ordersTable.status)
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
          .where(eq(ordersTable.outlet_id, outlet.id))
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

    const outlet = await getOutletByUserId(session.user.id);
    if (!outlet) return reply.status(403).send({ success: false, error: "Not an owner" });

    const orders = await db
      .select({
        orderId: ordersTable.id,
        customerName: usersTable.name,
        customerPhone: usersTable.phone,
        deliveryFee: ordersTable.delivery_fee,
        note: ordersTable.note,
        createdAt: ordersTable.createdAt,
      })
      .from(ordersTable)
      .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
      .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
      .where(and(eq(ordersTable.outlet_id, outlet.id), eq(ordersTable.status, "pending")))
      .orderBy(ordersTable.createdAt);

    const ordersWithItems = await attachOrderItems(orders);
    return { success: true, orders: ordersWithItems };
  });

  app.get("/api/get-preparing-orders", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const outlet = await getOutletByUserId(session.user.id);
    if (!outlet) return reply.status(403).send({ success: false, error: "Not an owner" });

    const orders = await db
      .select({
        orderId: ordersTable.id,
        customerName: usersTable.name,
        customerPhone: usersTable.phone,
        deliveryFee: ordersTable.delivery_fee,
        note: ordersTable.note,
        createdAt: ordersTable.createdAt,
      })
      .from(ordersTable)
      .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
      .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
      .where(and(eq(ordersTable.outlet_id, outlet.id), eq(ordersTable.status, "preparing")))
      .orderBy(ordersTable.createdAt);

    const ordersWithItems = await attachOrderItems(orders);
    return { success: true, orders: ordersWithItems };
  });

  app.get("/api/get-ready-orders", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const outlet = await getOutletByUserId(session.user.id);
    if (!outlet) return reply.status(403).send({ success: false, error: "Not an owner" });

    const orders = await db
      .select({
        orderId: ordersTable.id,
        customerName: usersTable.name,
        customerPhone: usersTable.phone,
        deliveryFee: ordersTable.delivery_fee,
        note: ordersTable.note,
        createdAt: ordersTable.createdAt,
      })
      .from(ordersTable)
      .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
      .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
      .where(and(eq(ordersTable.outlet_id, outlet.id), eq(ordersTable.status, "ready")))
      .orderBy(ordersTable.createdAt);

    const ordersWithItems = await attachOrderItems(orders);
    return { success: true, orders: ordersWithItems };
  });

  app.get("/api/get-outlet-order-detail", async (request, reply) => {
    try {
      const { order_id } = request.query as { order_id?: string };
      if (!order_id) return reply.status(400).send({ success: false, error: "Missing order_id" });

      const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
      if (!session?.user) return reply.status(401).send({ success: false });

      const outlet = await getOutletByUserId(session.user.id);
      if (!outlet) return reply.status(403).send({ success: false, error: "Not an owner" });

      const items = await db
        .select({
          productId: productsTable.id,
          productName: productsTable.product_name,
          quantity: orderDetailsTable.quantity,
          price: orderDetailsTable.summary_price,
          image: productsTable.image,
          note: orderDetailsTable.note_product,
          status: ordersTable.status,
        })
        .from(orderDetailsTable)
        .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
        .innerJoin(ordersTable, eq(orderDetailsTable.order_id, ordersTable.id))
        .where(and(eq(orderDetailsTable.order_id, order_id), eq(productsTable.outlet_id, outlet.id)))
        .orderBy(desc(orderDetailsTable.created_at));

      if (items.length === 0) return reply.status(404).send({ success: false, error: "Order not found" });

      const status = items[0].status;
      return {
        success: true,
        items: items.map((i) => ({ ...i, image: i.image || "not-found.webp" })),
        status,
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

      const outlet = await getOutletByUserId(session.user.id);
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
            eq(productsTable.outlet_id, outlet.id),
            search ? like(productsTable.product_name, `%${search}%`) : undefined,
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

      const outlet = await getOutletByUserId(session.user.id);
      if (!outlet) return reply.status(401).send({ error: "Unauthorized" });

      function getLast6Months() {
        const months = [];
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
          const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
          months.push({ start, end, month: start.toLocaleString("default", { month: "short" }) });
        }
        return months;
      }

      const months = getLast6Months();
      const data = await Promise.all(
        months.map(async ({ start, end, month }) => {
          const [result] = await db
            .select({ total: sql<string>`coalesce(sum(cast(${orderDetailsTable.summary_price} as numeric)), 0)` })
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

      const outlet = await getOutletByUserId(session.user.id);
      if (!outlet) return reply.status(401).send({ success: false, error: "Not an owner" });

      if (!date) return reply.status(400).send({ success: false, error: "Missing 'date' parameter" });

      const { startUTC, endUTC } = getUTCRangeFromLocalDate(date, timezone);

      const rows = await db
        .select({
          hour: sql<number>`extract(hour from ${orderDetailsTable.created_at} at time zone ${timezone})::int`,
          count: sql<number>`count(distinct ${orderDetailsTable.order_id})`,
          total: sql<number>`coalesce(sum(cast(${orderDetailsTable.summary_price} as numeric)), 0)`,
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

  app.get("/api/cashflow", async (request, reply) => {
    try {
      const { month, timezone = "Asia/Jakarta" } = request.query as Record<string, string>;

      const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
      if (!session?.user) return reply.status(401).send({ success: false });

      const outlet = await getOutletByUserId(session.user.id);
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
        })
        .from(cashFlows)
        .leftJoin(cashInDetailTable, eq(cashFlows.cash_in_detail_id, cashInDetailTable.id))
        .leftJoin(cashInCategoryTable, eq(cashInDetailTable.category_id, cashInCategoryTable.id))
        .leftJoin(cashOutDetailTable, eq(cashFlows.cash_out_detail_id, cashOutDetailTable.id))
        .leftJoin(cashOutCategoryTable, eq(cashOutDetailTable.category_id, cashOutCategoryTable.id))
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
          note: "",
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

      const outlet = await getOutletByUserId(session.user.id);
      if (!outlet) return reply.status(401).send({ success: false });

      const { type, category, amount, date, timezone = "Asia/Jakarta" } = request.body as Record<string, any>;

      if (!type || !category || !amount || !date) return reply.status(400).send({ error: "Missing required fields" });
      if (isNaN(Number(amount)) || Number(amount) <= 0) return reply.status(400).send({ error: "Invalid amount" });

      const { startUTC, endUTC } = getUTCRangeFromLocalDate(date, timezone);
      const now = new Date();
      const created_at = now >= startUTC && now <= endUTC ? now : startUTC;

      const timeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false });

      if (type === "IN") {
        const [cat] = await db
          .select({ id: cashInCategoryTable.id })
          .from(cashInCategoryTable)
          .where(eq(cashInCategoryTable.category, category))
          .limit(1);

        if (!cat) return reply.status(400).send({ error: "Unknown category" });

        const [detail] = await db.insert(cashInDetailTable).values({ category_id: cat.id, money_amount: String(amount), type: "cash", created_at }).returning();
        const [cf] = await db.insert(cashFlows).values({ outlet_id: outlet.id, cash_in_detail_id: detail.id }).returning();

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
        const [cf] = await db.insert(cashFlows).values({ outlet_id: outlet.id, cash_out_detail_id: detail.id }).returning();

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

      const outlet = await getOutletByUserId(session.user.id);
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

      const outlet = await getOutletByUserId(session.user.id);
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
        data: rows.map((r) => ({ id: r.id, category: r.category, amount: Number(r.money_amount), time: new Date(r.created_at).toLocaleTimeString() })),
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

      const outlet = await getOutletByUserId(session.user.id);
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
          total: sql<string>`coalesce(sum(cast(${orderDetailsTable.summary_price} as numeric)), 0)`,
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
