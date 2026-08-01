import type { FastifyInstance } from "fastify";
import { and, asc, count, countDistinct, desc, eq, gte, ilike, inArray, isNull, lt, notInArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db";
import {
  adminsTable,
  couriersTable,
  courierSessionsTable,
  customersTable,
  ordersTable,
  outletsTable,
  productsTable,
  productAdsTable,
  productAdsSchedule,
  scheduleProductAdsTable,
  ratingsTable,
  orderDetailsTable,
  usersTable,
  serviceAreaTable,
} from "../db/schema";

const OFFLINE_CUSTOMER_EMAIL = "rizkygin1@gmail.com";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { closeStaleCourierSessions, staleShiftCutoff } from "../lib/utils/courier-availability";
import { getServiceArea, recomputeCourierReachable } from "../lib/service-area";
import { parseCoordPair } from "../lib/utils/coords";

async function requireAdmin(userId: string) {
  const [admin] = await db
    .select({ id: adminsTable.id })
    .from(adminsTable)
    .where(eq(adminsTable.user_id, userId))
    .limit(1);
  return !!admin;
}

function formatTimeSlot(slot: { day: string; hour: string }) {
  const day = slot.day.charAt(0).toUpperCase() + slot.day.slice(1);
  return `${day} ${slot.hour}:00`;
}

export async function adminRoutes(app: FastifyInstance) {
  app.get("/api/admin/ads", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const isAdmin = await requireAdmin(session.user.id);
    if (!isAdmin) return reply.status(403).send({ success: false, error: "Forbidden" });

    const { page = "1", limit = "10", status = "" } = request.query as Record<string, string>;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 10);
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    if (status === "pending" || status === "approved" || status === "rejected") {
      conditions.push(eq(productAdsTable.status, status));
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, countRows] = await Promise.all([
      db
        .select({
          id: productAdsTable.id,
          title: productAdsTable.title,
          description: productAdsTable.description,
          banner_image: productAdsTable.banner_image,
          status: productAdsTable.status,
          is_active: productAdsTable.is_active,
          rejection_reason: productAdsTable.rejection_reason,
          outlet_id: productAdsTable.outlet_id,
          outlet_name: outletsTable.name,
          product_id: productAdsTable.product_id,
          product_name: productsTable.product_name,
          starts_at: productAdsTable.starts_at,
          ends_at: productAdsTable.ends_at,
        })
        .from(productAdsTable)
        .innerJoin(outletsTable, eq(productAdsTable.outlet_id, outletsTable.id))
        .innerJoin(productsTable, eq(productAdsTable.product_id, productsTable.id))
        .where(where)
        .orderBy(desc(productAdsTable.createdAt))
        .limit(limitNum)
        .offset(offset),
      db.select({ total: count() }).from(productAdsTable).where(where),
    ]);

    const adIds = rows.map((row) => row.id);

    const scheduleRows = adIds.length
      ? await db
          .select({
            adId: productAdsSchedule.productAdsSchedule_id,
            time: scheduleProductAdsTable.time,
          })
          .from(productAdsSchedule)
          .innerJoin(scheduleProductAdsTable, eq(productAdsSchedule.scheduleProductAdsTable_id, scheduleProductAdsTable.id))
          .where(inArray(productAdsSchedule.productAdsSchedule_id, adIds))
      : [];

    const scheduleByAd = new Map<number, { day: string; hour: string }[]>();
    for (const row of scheduleRows) {
      if (!row.time) continue;
      const slots = scheduleByAd.get(row.adId) ?? [];
      slots.push(row.time);
      scheduleByAd.set(row.adId, slots);
    }

    const data = rows.map((row) => {
      const slots = scheduleByAd.get(row.id) ?? [];
      let time_start: string | null = null;
      let time_end: string | null = null;

      if (slots.length > 0) {
        const sorted = [...slots].sort((a, b) => Number(a.hour) - Number(b.hour));
        time_start = formatTimeSlot(sorted[0]);
        time_end = formatTimeSlot(sorted[sorted.length - 1]);
      }

      return { ...row, time_start, time_end };
    });

    return {
      success: true,
      data,
      count: (countRows as any[])[0]?.total ?? 0,
    };
  });

  app.get("/api/admin/products", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const isAdmin = await requireAdmin(session.user.id);
    if (!isAdmin) return reply.status(403).send({ success: false, error: "Forbidden" });

    const { page = "1", limit = "10", search = "", outletId = "", minRating = "", minPrice = "", maxPrice = "", sortBy = "", sortOrder = "desc" } = request.query as Record<string, string>;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 10);
    const offset = (pageNum - 1) * limitNum;

    const now = new Date();
    const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const trafficSubquery = (since: Date) =>
      sql<number>`COALESCE((SELECT SUM(${orderDetailsTable.quantity}) FROM ${orderDetailsTable} WHERE ${orderDetailsTable.product_id} = ${productsTable.id} AND ${orderDetailsTable.created_at} >= ${since}), 0)`.mapWith(Number);

    const conditions = [isNull(productsTable.deletedAt)];

    if (search) {
      conditions.push(or(ilike(productsTable.product_name, `%${search}%`), ilike(outletsTable.name, `%${search}%`))!);
    }

    if (outletId) {
      conditions.push(eq(productsTable.outlet_id, Number(outletId)));
    }

    if (minRating) {
      conditions.push(sql`CAST(${productsTable.ratings} AS NUMERIC) >= ${Number(minRating)}`);
    }

    if (minPrice) {
      conditions.push(sql`CAST(${productsTable.price} AS NUMERIC) >= ${Number(minPrice)}`);
    }

    if (maxPrice) {
      conditions.push(sql`CAST(${productsTable.price} AS NUMERIC) <= ${Number(maxPrice)}`);
    }

    const where = and(...conditions);

    const sortColumns: Record<string, SQL> = {
      price: sql`CAST(${productsTable.price} AS NUMERIC)`,
      rating: sql`CAST(${productsTable.ratings} AS NUMERIC)`,
      traffic_today: trafficSubquery(dayStart),
      traffic_week: trafficSubquery(weekStart),
      traffic_month: trafficSubquery(monthStart),
    };
    const orderByColumn = sortColumns[sortBy];
    const isSortAsc = sortOrder === "asc";

    const [rows, countRows, outlets] = await Promise.all([
      db
        .select({
          id: productsTable.id,
          product_name: productsTable.product_name,
          image: productsTable.image,
          category: productsTable.category,
          price: productsTable.price,
          price_mark_down: productsTable.price_mark_down,
          ratings: productsTable.ratings,
          review_count: productsTable.review_count,
          is_recommended: productsTable.is_recommended,
          outlet_id: productsTable.outlet_id,
          outlet_name: outletsTable.name,
          traffic_today: trafficSubquery(dayStart),
          traffic_week: trafficSubquery(weekStart),
          traffic_month: trafficSubquery(monthStart),
        })
        .from(productsTable)
        .innerJoin(outletsTable, eq(productsTable.outlet_id, outletsTable.id))
        .where(where)
        .orderBy(orderByColumn ? (isSortAsc ? asc(orderByColumn) : desc(orderByColumn)) : desc(productsTable.createdAt))
        .limit(limitNum)
        .offset(offset),
      db.select({ total: count() }).from(productsTable).innerJoin(outletsTable, eq(productsTable.outlet_id, outletsTable.id)).where(where),
      db.select({ id: outletsTable.id, name: outletsTable.name }).from(outletsTable),
    ]);

    return {
      success: true,
      data: rows,
      count: (countRows as any[])[0]?.total ?? 0,
      outlets,
    };
  });

  app.get("/api/admin/outlets", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const isAdmin = await requireAdmin(session.user.id);
    if (!isAdmin) return reply.status(403).send({ success: false, error: "Forbidden" });

    const { page = "1", limit = "10", search = "", is_open = "", minRating = "", features = "", sortBy = "", sortOrder = "desc" } = request.query as Record<string, string>;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 10);
    const offset = (pageNum - 1) * limitNum;

    const conditions = [isNull(outletsTable.deletedAt)];

    if (search) {
      conditions.push(
        or(
          ilike(outletsTable.name, `%${search}%`),
          ilike(outletsTable.address, `%${search}%`),
          ilike(outletsTable.email, `%${search}%`),
          ilike(outletsTable.phone, `%${search}%`),
        )!,
      );
    }

    if (is_open === "true") {
      conditions.push(eq(outletsTable.is_open, true));
    } else if (is_open === "false") {
      conditions.push(eq(outletsTable.is_open, false));
    }

    if (minRating) {
      conditions.push(gte(sql`CAST(${outletsTable.ratings} AS NUMERIC)`, Number(minRating)));
    }

    if (features) {
      const slugs = features.split(",").filter(Boolean);
      if (slugs.length > 0) {
        conditions.push(sql`${outletsTable.features} @> ARRAY[${sql.join(slugs.map((s) => sql`${s}`), sql`, `)}]::text[]`);
      }
    }

    const where = and(...conditions);

    const sortMap: Record<string, any> = {
      name: outletsTable.name,
      ratings: sql`CAST(${outletsTable.ratings} AS NUMERIC)`,
      review_count: outletsTable.review_count,
      created_at: outletsTable.createdAt,
    };

    const orderByCol = sortMap[sortBy];
    const isSortAsc = sortOrder === "asc";

    const [rows, countRows] = await Promise.all([
      db
        .select({
          id: outletsTable.id,
          name: outletsTable.name,
          phone: outletsTable.phone,
          email: outletsTable.email,
          address: outletsTable.address,
          avatar: outletsTable.avatar,
          ratings: outletsTable.ratings,
          review_count: outletsTable.review_count,
          is_open: outletsTable.is_open,
          tags: outletsTable.tags,
          features: outletsTable.features,
          created_at: outletsTable.createdAt,
        })
        .from(outletsTable)
        .where(where)
        .orderBy(orderByCol ? (isSortAsc ? asc(orderByCol) : desc(orderByCol)) : desc(outletsTable.createdAt))
        .limit(limitNum)
        .offset(offset),
      db.select({ total: count() }).from(outletsTable).where(where),
    ]);

    return {
      success: true,
      data: rows,
      count: (countRows as any[])[0]?.total ?? 0,
    };
  });

  app.get("/api/admin/product-ratings", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const isAdmin = await requireAdmin(session.user.id);
    if (!isAdmin) return reply.status(403).send({ success: false, error: "Forbidden" });

    const { productId = "" } = request.query as Record<string, string>;
    if (!productId) return reply.status(400).send({ success: false, error: "productId is required" });

    const where = and(eq(ratingsTable.product_id, productId), eq(ratingsTable.reciepent_as, "product"));

    const [rows, countRows] = await Promise.all([
      db
        .select({
          id: ratingsTable.id,
          rating: ratingsTable.ratings,
          comment: ratingsTable.comment,
          created_at: ratingsTable.createdAt,
          reviewer_name: usersTable.name,
        })
        .from(ratingsTable)
        .leftJoin(usersTable, eq(ratingsTable.reviewer, usersTable.id))
        .where(where)
        .orderBy(desc(ratingsTable.createdAt))
        .limit(25),
      db.select({ total: count() }).from(ratingsTable).where(where),
    ]);

    const data = rows.map((r) => ({
      id: r.id,
      rating: Number(r.rating) || 5,
      comment: r.comment ?? "",
      created_at: r.created_at,
      reviewer_name: r.reviewer_name ?? "Anonim",
    }));

    const average = data.length > 0 ? data.reduce((acc, r) => acc + r.rating, 0) / data.length : 0;

    return {
      success: true,
      data,
      total: (countRows as any[])[0]?.total ?? 0,
      average,
    };
  });

  // Toggle a product's recommended flag
  app.post("/api/admin/set-recommended", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, message: "Unauthorized" });

    const isAdmin = await requireAdmin(session.user.id);
    if (!isAdmin) return reply.status(403).send({ success: false, message: "Forbidden" });

    try {
      const { productId, isRecommended } = (request.body as {
        productId?: string;
        isRecommended?: boolean;
      }) ?? {};
      if (!productId) return reply.status(400).send({ success: false, message: "productId is required" });

      await db
        .update(productsTable)
        .set({ is_recommended: !!isRecommended })
        .where(eq(productsTable.id, productId));

      return reply.send({ success: true });
    } catch (error) {
      app.log.error(error, "Failed to update recommended status");
      return reply.status(500).send({ success: false, message: "Failed to update recommended status." });
    }
  });

  // Admin edits a product's core fields
  app.post("/api/admin/update-product", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, message: "Unauthorized" });

    const isAdmin = await requireAdmin(session.user.id);
    if (!isAdmin) return reply.status(403).send({ success: false, message: "Forbidden" });

    try {
      const { productId, data } = (request.body as {
        productId?: string;
        data?: {
          product_name: string;
          price: string;
          price_mark_down: string;
          category: string;
          description: string;
        };
      }) ?? {};
      if (!productId || !data) {
        return reply.status(400).send({ success: false, message: "productId and data are required" });
      }

      await db
        .update(productsTable)
        .set({
          product_name: data.product_name,
          price: data.price,
          price_mark_down: data.price_mark_down,
          category: data.category,
          description: data.description,
        })
        .where(eq(productsTable.id, productId));

      return reply.send({ success: true, message: "Product updated successfully." });
    } catch (error) {
      app.log.error(error, "Failed to update product");
      return reply.status(500).send({ success: false, message: "Failed to update product." });
    }
  });

  // ---- Manage Courier ----
  app.get("/api/admin/couriers", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });
    if (!(await requireAdmin(session.user.id))) return reply.status(403).send({ success: false, error: "Forbidden" });

    const { page = "1", limit = "10", search = "", sortBy = "", sortOrder = "desc" } = request.query as Record<string, string>;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 10);
    const offset = (pageNum - 1) * limitNum;

    const conditions = [isNull(couriersTable.deletedAt)];
    if (search) {
      conditions.push(
        or(
          ilike(usersTable.name, `%${search}%`),
          ilike(usersTable.email, `%${search}%`),
          ilike(couriersTable.vehicle_plate, `%${search}%`),
        )!,
      );
    }
    const where = and(...conditions);

    const sortMap: Record<string, SQL | any> = {
      ratings: sql`CAST(${couriersTable.ratings} AS NUMERIC)`,
      review_count: couriersTable.review_count,
      created_at: couriersTable.createdAt,
    };
    const orderByCol = sortMap[sortBy];
    const isSortAsc = sortOrder === "asc";

    const [data, countRows] = await Promise.all([
      db
        .select({
          id: couriersTable.id,
          user_id: couriersTable.user_id,
          name: usersTable.name,
          email: usersTable.email,
          phone: usersTable.phone,
          avatar: couriersTable.avatar,
          vehicle_plate: couriersTable.vehicle_plate,
          vehicle_type: couriersTable.vehicle_type,
          ratings: couriersTable.ratings,
          review_count: couriersTable.review_count,
          created_at: couriersTable.createdAt,
        })
        .from(couriersTable)
        .innerJoin(usersTable, eq(couriersTable.user_id, usersTable.id))
        .where(where)
        .orderBy(orderByCol ? (isSortAsc ? asc(orderByCol) : desc(orderByCol)) : desc(couriersTable.createdAt))
        .limit(limitNum)
        .offset(offset),
      db.select({ total: count() }).from(couriersTable).innerJoin(usersTable, eq(couriersTable.user_id, usersTable.id)).where(where),
    ]);

    return { success: true, data, count: (countRows as any[])[0]?.total ?? 0 };
  });

  app.post("/api/admin/couriers/update", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });
    if (!(await requireAdmin(session.user.id))) return reply.status(403).send({ success: false, error: "Forbidden" });

    const { id, vehicle_plate, vehicle_type } = request.body as { id?: number; vehicle_plate?: string; vehicle_type?: "car" | "motorcycle" };
    if (!id) return reply.status(400).send({ success: false, message: "id is required" });

    await db
      .update(couriersTable)
      .set({
        ...(vehicle_plate !== undefined && { vehicle_plate }),
        ...(vehicle_type !== undefined && { vehicle_type }),
      })
      .where(eq(couriersTable.id, id));

    return reply.send({ success: true, message: "Courier updated." });
  });

  app.post("/api/admin/couriers/delete", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });
    if (!(await requireAdmin(session.user.id))) return reply.status(403).send({ success: false, error: "Forbidden" });

    const { id } = request.body as { id?: number };
    if (!id) return reply.status(400).send({ success: false, message: "id is required" });

    await db.update(couriersTable).set({ deletedAt: new Date() }).where(eq(couriersTable.id, id));
    return reply.send({ success: true, message: "Courier removed." });
  });

  // ---- Manage Customer ----
  app.get("/api/admin/customers", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });
    if (!(await requireAdmin(session.user.id))) return reply.status(403).send({ success: false, error: "Forbidden" });

    const { page = "1", limit = "10", search = "", sortBy = "", sortOrder = "desc" } = request.query as Record<string, string>;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 10);
    const offset = (pageNum - 1) * limitNum;

    const conditions = [isNull(customersTable.deletedAt)];
    if (search) {
      conditions.push(or(ilike(usersTable.name, `%${search}%`), ilike(usersTable.email, `%${search}%`))!);
    }
    const where = and(...conditions);

    const sortMap: Record<string, SQL | any> = {
      ratings: sql`CAST(${customersTable.ratings} AS NUMERIC)`,
      review_count: customersTable.review_count,
      created_at: customersTable.createdAt,
    };
    const orderByCol = sortMap[sortBy];
    const isSortAsc = sortOrder === "asc";

    const [data, countRows] = await Promise.all([
      db
        .select({
          id: customersTable.id,
          user_id: customersTable.user_id,
          name: usersTable.name,
          email: usersTable.email,
          phone: usersTable.phone,
          image: usersTable.image,
          ratings: customersTable.ratings,
          review_count: customersTable.review_count,
          created_at: customersTable.createdAt,
        })
        .from(customersTable)
        .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
        .where(where)
        .orderBy(orderByCol ? (isSortAsc ? asc(orderByCol) : desc(orderByCol)) : desc(customersTable.createdAt))
        .limit(limitNum)
        .offset(offset),
      db.select({ total: count() }).from(customersTable).innerJoin(usersTable, eq(customersTable.user_id, usersTable.id)).where(where),
    ]);

    return { success: true, data, count: (countRows as any[])[0]?.total ?? 0 };
  });

  app.post("/api/admin/customers/delete", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });
    if (!(await requireAdmin(session.user.id))) return reply.status(403).send({ success: false, error: "Forbidden" });

    const { id } = request.body as { id?: number };
    if (!id) return reply.status(400).send({ success: false, message: "id is required" });

    await db.update(customersTable).set({ deletedAt: new Date() }).where(eq(customersTable.id, id));
    return reply.send({ success: true, message: "Customer removed." });
  });

  // ---- Manage User ----
  app.get("/api/admin/users", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });
    if (!(await requireAdmin(session.user.id))) return reply.status(403).send({ success: false, error: "Forbidden" });

    const { page = "1", limit = "10", search = "", sortBy = "", sortOrder = "desc" } = request.query as Record<string, string>;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 10);
    const offset = (pageNum - 1) * limitNum;

    const conditions = [isNull(usersTable.deletedAt)];
    if (search) {
      conditions.push(
        or(
          ilike(usersTable.name, `%${search}%`),
          ilike(usersTable.email, `%${search}%`),
          ilike(usersTable.phone, `%${search}%`),
        )!,
      );
    }
    const where = and(...conditions);

    const sortMap: Record<string, SQL | any> = {
      name: usersTable.name,
      email: usersTable.email,
      created_at: usersTable.createdAt,
    };
    const orderByCol = sortMap[sortBy];
    const isSortAsc = sortOrder === "asc";

    // Derived role via correlated existence subqueries on the role tables.
    // Use the qualified "users"."id" so it isn't shadowed by the subquery tables.
    const roleExpr = sql<string>`
      CASE
        WHEN EXISTS (SELECT 1 FROM admins a WHERE a.user_id = "users"."id") THEN 'admin'
        WHEN EXISTS (SELECT 1 FROM outlets o WHERE o.user_id = "users"."id") THEN 'owner'
        WHEN EXISTS (SELECT 1 FROM couriers c WHERE c.user_id = "users"."id") THEN 'courier'
        WHEN EXISTS (SELECT 1 FROM customers cu WHERE cu.user_id = "users"."id") THEN 'customer'
        ELSE 'none'
      END
    `;

    const [data, countRows] = await Promise.all([
      db
        .select({
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
          phone: usersTable.phone,
          address: usersTable.address,
          image: usersTable.image,
          emailVerified: usersTable.emailVerified,
          role: roleExpr,
          created_at: usersTable.createdAt,
        })
        .from(usersTable)
        .where(where)
        .orderBy(orderByCol ? (isSortAsc ? asc(orderByCol) : desc(orderByCol)) : desc(usersTable.createdAt))
        .limit(limitNum)
        .offset(offset),
      db.select({ total: count() }).from(usersTable).where(where),
    ]);

    return { success: true, data, count: (countRows as any[])[0]?.total ?? 0 };
  });

  app.post("/api/admin/users/update", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });
    if (!(await requireAdmin(session.user.id))) return reply.status(403).send({ success: false, error: "Forbidden" });

    const { id, name, phone, address } = request.body as { id?: string; name?: string; phone?: string; address?: string };
    if (!id) return reply.status(400).send({ success: false, message: "id is required" });

    await db
      .update(usersTable)
      .set({
        ...(name !== undefined && { name }),
        ...(phone !== undefined && { phone }),
        ...(address !== undefined && { address }),
      })
      .where(eq(usersTable.id, id));

    return reply.send({ success: true, message: "User updated." });
  });

  app.post("/api/admin/users/delete", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });
    if (!(await requireAdmin(session.user.id))) return reply.status(403).send({ success: false, error: "Forbidden" });

    const { id } = request.body as { id?: string };
    if (!id) return reply.status(400).send({ success: false, message: "id is required" });

    await db.update(usersTable).set({ deletedAt: new Date() }).where(eq(usersTable.id, id));
    return reply.send({ success: true, message: "User removed." });
  });

  // ---- Admin dashboard analytics ----
  app.get("/api/admin/dashboard", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });
    if (!(await requireAdmin(session.user.id))) return reply.status(403).send({ success: false, error: "Forbidden" });

    const now = new Date();
    const currentPeriodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const previousPeriodStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const subtotalSubquery = sql<number>`COALESCE((
      SELECT SUM(CAST(${orderDetailsTable.summary_price} AS NUMERIC))
      FROM ${orderDetailsTable}
      WHERE ${orderDetailsTable.order_id} = ${ordersTable.id}
    ), 0)`.mapWith(Number);

    const revenueExpr = sql<number>`COALESCE(SUM(
      ${subtotalSubquery} + CAST(COALESCE(${ordersTable.delivery_fee}, '0') AS NUMERIC) - CAST(COALESCE(${ordersTable.discount_amount}, '0') AS NUMERIC)
    ), 0)`.mapWith(Number);

    const customerUser = alias(usersTable, "customer_user");
    const courierUser = alias(usersTable, "courier_user");

    const [
      [{ total: currentRevenue }],
      [{ total: previousRevenue }],
      [{ total: pendingOrdersCount }],
      [{ total: activeOrdersCount }],
      [{ total: onlineCouriersCount }],
      [{ total: totalOutlets }],
      [{ total: totalCouriers }],
      [{ total: totalCustomers }],
      recentOrdersRaw,
    ] = await Promise.all([
      db
        .select({ total: revenueExpr })
        .from(ordersTable)
        .where(and(eq(ordersTable.status, "delivered"), gte(ordersTable.createdAt, currentPeriodStart))),
      db
        .select({ total: revenueExpr })
        .from(ordersTable)
        .where(
          and(
            eq(ordersTable.status, "delivered"),
            gte(ordersTable.createdAt, previousPeriodStart),
            lt(ordersTable.createdAt, currentPeriodStart),
          ),
        ),
      db.select({ total: count() }).from(ordersTable).where(eq(ordersTable.status, "pending")),
      db
        .select({ total: count() })
        .from(ordersTable)
        .where(notInArray(ordersTable.status, ["pending", "delivered", "cancelled"])),
      db
        .select({ total: countDistinct(courierSessionsTable.courier_id) })
        .from(courierSessionsTable)
        // Abandoned sessions past the 12h cap aren't "online" — without this
        // the couriers-online KPI only ever climbs.
        .where(
          and(
            isNull(courierSessionsTable.ended_at),
            gte(courierSessionsTable.started_at, staleShiftCutoff()),
          ),
        ),
      db.select({ total: count() }).from(outletsTable).where(isNull(outletsTable.deletedAt)),
      db.select({ total: count() }).from(couriersTable).where(isNull(couriersTable.deletedAt)),
      db.select({ total: count() }).from(customersTable).where(isNull(customersTable.deletedAt)),
      db
        .select({
          id: ordersTable.id,
          status: ordersTable.status,
          delivery_fee: ordersTable.delivery_fee,
          discount_amount: ordersTable.discount_amount,
          created_at: ordersTable.createdAt,
          outlet_name: outletsTable.name,
          customer_name: customerUser.name,
          customer_email: customerUser.email,
          subtotal: subtotalSubquery,
        })
        .from(ordersTable)
        .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
        .innerJoin(customerUser, eq(customersTable.user_id, customerUser.id))
        .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
        .leftJoin(couriersTable, eq(ordersTable.courier_id, couriersTable.id))
        .leftJoin(courierUser, eq(couriersTable.user_id, courierUser.id))
        .orderBy(desc(ordersTable.createdAt))
        .limit(5),
    ]);

    const recentOrders = recentOrdersRaw.map((r) => {
      const deliveryFee = Number(r.delivery_fee ?? 0);
      const discount = Number(r.discount_amount ?? 0);
      return {
        id: r.id,
        status: r.status,
        outlet_name: r.outlet_name,
        customer_name: r.customer_name,
        total_paid: r.subtotal + deliveryFee - discount,
        is_offline: r.customer_email === OFFLINE_CUSTOMER_EMAIL,
      };
    });

    const revenuePercentageChange =
      previousRevenue > 0
        ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
        : currentRevenue > 0
          ? 100
          : 0;

    return reply.send({
      success: true,
      revenue30Days: currentRevenue,
      revenuePercentageChange,
      pendingOrdersCount,
      activeOrdersCount,
      onlineCouriersCount,
      totalOutlets,
      totalCouriers,
      totalCustomers,
      recentOrders,
    });
  });

  // ---- Manage Order ----
  app.get("/api/admin/orders", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });
    if (!(await requireAdmin(session.user.id))) return reply.status(403).send({ success: false, error: "Forbidden" });

    const ORDER_STATUSES = ["pending", "confirmed", "preparing", "ready", "on_delivery", "delivered", "cancelled"] as const;
    const { page = "1", limit = "10", search = "", status = "", type = "", sortOrder = "desc" } = request.query as Record<string, string>;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 10);
    const offset = (pageNum - 1) * limitNum;
    const order = sortOrder === "asc" ? asc : desc;

    const customerUser = alias(usersTable, "customer_user");
    const courierUser = alias(usersTable, "courier_user");

    const conditions: SQL[] = [];
    if (search) {
      conditions.push(
        or(
          ilike(ordersTable.id, `%${search}%`),
          ilike(customerUser.name, `%${search}%`),
          ilike(outletsTable.name, `%${search}%`),
        )!,
      );
    }
    if (status && (ORDER_STATUSES as readonly string[]).includes(status)) {
      conditions.push(eq(ordersTable.status, status as (typeof ORDER_STATUSES)[number]));
    }
    if (type === "offline") {
      conditions.push(eq(customerUser.email, OFFLINE_CUSTOMER_EMAIL));
    } else if (type === "online") {
      conditions.push(sql`${customerUser.email} != ${OFFLINE_CUSTOMER_EMAIL}`);
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const subtotalSubquery = sql<number>`COALESCE((
      SELECT SUM(CAST(${orderDetailsTable.summary_price} AS NUMERIC))
      FROM ${orderDetailsTable}
      WHERE ${orderDetailsTable.order_id} = ${ordersTable.id}
    ), 0)`.mapWith(Number);

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          id: ordersTable.id,
          status: ordersTable.status,
          delivery_fee: ordersTable.delivery_fee,
          discount_amount: ordersTable.discount_amount,
          created_at: ordersTable.createdAt,
          outlet_name: outletsTable.name,
          customer_name: customerUser.name,
          customer_email: customerUser.email,
          courier_name: courierUser.name,
          subtotal: subtotalSubquery,
        })
        .from(ordersTable)
        .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
        .innerJoin(customerUser, eq(customersTable.user_id, customerUser.id))
        .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
        .leftJoin(couriersTable, eq(ordersTable.courier_id, couriersTable.id))
        .leftJoin(courierUser, eq(couriersTable.user_id, courierUser.id))
        .where(where)
        .orderBy(order(ordersTable.createdAt))
        .limit(limitNum)
        .offset(offset),
      db
        .select({ total: count() })
        .from(ordersTable)
        .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
        .innerJoin(customerUser, eq(customersTable.user_id, customerUser.id))
        .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
        .where(where),
    ]);

    const data = rows.map((r) => {
      const subtotal = r.subtotal;
      const deliveryFee = Number(r.delivery_fee ?? 0);
      const discount = Number(r.discount_amount ?? 0);
      return {
        id: r.id,
        status: r.status,
        outlet_name: r.outlet_name,
        customer_name: r.customer_name,
        courier_name: r.courier_name,
        subtotal,
        delivery_fee: deliveryFee,
        discount_amount: discount,
        total_paid: subtotal + deliveryFee - discount,
        is_offline: r.customer_email === OFFLINE_CUSTOMER_EMAIL,
        created_at: r.created_at,
      };
    });

    return reply.send({ success: true, data, count: total });
  });

  app.get("/api/admin/orders/:id", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });
    if (!(await requireAdmin(session.user.id))) return reply.status(403).send({ success: false, error: "Forbidden" });

    const { id: orderId } = request.params as { id: string };
    const courierUser = alias(usersTable, "courier_user");

    const [order] = await db
      .select({
        id: ordersTable.id,
        status: ordersTable.status,
        delivery_fee: ordersTable.delivery_fee,
        discount_amount: ordersTable.discount_amount,
        note: ordersTable.note,
        rejected_by: ordersTable.rejected_by,
        rejected_reason: ordersTable.rejected_reason,
        scheduled_at: ordersTable.scheduled_at,
        created_at: ordersTable.createdAt,
        updated_at: ordersTable.updatedAt,
        outlet_name: outletsTable.name,
        outlet_address: outletsTable.address,
        outlet_phone: outletsTable.phone,
        customer_name: usersTable.name,
        customer_email: usersTable.email,
        customer_phone: usersTable.phone,
        customer_address: usersTable.address,
        courier_name: courierUser.name,
        courier_phone: courierUser.phone,
        courier_plate: couriersTable.vehicle_plate,
        courier_vehicle: couriersTable.vehicle_type,
      })
      .from(ordersTable)
      .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
      .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
      .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
      .leftJoin(couriersTable, eq(ordersTable.courier_id, couriersTable.id))
      .leftJoin(courierUser, eq(couriersTable.user_id, courierUser.id))
      .where(eq(ordersTable.id, orderId))
      .limit(1);

    if (!order) return reply.status(404).send({ success: false, error: "Not found" });

    const items = await db
      .select({
        detail_id: orderDetailsTable.id,
        quantity: orderDetailsTable.quantity,
        note: orderDetailsTable.note_product,
        summary_price: orderDetailsTable.summary_price,
        product_name: productsTable.product_name,
        price: productsTable.price,
        category: productsTable.category,
        unit: productsTable.unit,
      })
      .from(orderDetailsTable)
      .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
      .where(eq(orderDetailsTable.order_id, orderId));

    return reply.send({ success: true, order, items });
  });

  // Courier shift log. Sessions are platform-wide (couriers have no outlet_id),
  // so this is admin-only — an outlet owner has no basis to see a courier's
  // whole working day, only the orders of theirs that courier carried.
  //
  // Returns two lists rather than one paginated feed: "who is on shift right
  // now" is the operational question, and it must not get buried under history.
  app.get("/api/admin/courier-sessions", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });
    if (!(await requireAdmin(session.user.id))) {
      return reply.status(403).send({ success: false, error: "Forbidden" });
    }

    const { limit = "50" } = request.query as Record<string, string>;
    const historyLimit = Math.min(200, Math.max(1, Number(limit) || 50));

    // Tidy overran shifts before reading so the log self-heals: this page is
    // the one place a human looks at session data, and it's not hot enough for
    // the write to matter.
    await closeStaleCourierSessions();

    const baseFields = {
      sessionId: courierSessionsTable.id,
      courierId: couriersTable.id,
      courierName: usersTable.name,
      courierPhone: usersTable.phone,
      avatar: couriersTable.avatar,
      vehiclePlate: couriersTable.vehicle_plate,
      vehicleType: couriersTable.vehicle_type,
      startedAt: courierSessionsTable.started_at,
      endedAt: courierSessionsTable.ended_at,
    };

    const [online, history] = await Promise.all([
      // DISTINCT ON courier: a courier with more than one open row (crashed
      // client, missed go-offline) is still one person on shift, and listing
      // them twice would misreport the headcount. Newest open session wins.
      db
        .selectDistinctOn([courierSessionsTable.courier_id], baseFields)
        .from(courierSessionsTable)
        .innerJoin(couriersTable, eq(courierSessionsTable.courier_id, couriersTable.id))
        .innerJoin(usersTable, eq(couriersTable.user_id, usersTable.id))
        .where(isNull(courierSessionsTable.ended_at))
        .orderBy(courierSessionsTable.courier_id, desc(courierSessionsTable.started_at)),
      db
        .select(baseFields)
        .from(courierSessionsTable)
        .innerJoin(couriersTable, eq(courierSessionsTable.courier_id, couriersTable.id))
        .innerJoin(usersTable, eq(couriersTable.user_id, usersTable.id))
        .where(sql`${courierSessionsTable.ended_at} is not null`)
        .orderBy(desc(courierSessionsTable.started_at))
        .limit(historyLimit),
    ]);

    return reply.send({ success: true, online, history });
  });

  /**
   * Courier coverage area — the circle admins draw on the map.
   *
   * Also returns every outlet's position so the map can show which ones fall
   * inside and which are stranded. Moving the centre has real consequences for
   * existing outlets, and an admin should be able to see them before saving
   * rather than discovering them through support tickets.
   */
  app.get("/api/admin/service-area", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });
    if (!(await requireAdmin(session.user.id)))
      return reply.status(403).send({ success: false, error: "Admin only" });

    const area = await getServiceArea();

    const outlets = await db
      .select({
        id: outletsTable.id,
        name: outletsTable.name,
        lat: outletsTable.lat,
        lon: outletsTable.lon,
        isOpen: outletsTable.is_open,
        reachable: outletsTable.courier_reachable,
      })
      .from(outletsTable)
      .where(isNull(outletsTable.deletedAt));

    return reply.send({
      success: true,
      area,
      outlets: outlets
        .map((o) => {
          const coords = parseCoordPair(o.lat, o.lon);
          return coords
            ? { id: o.id, name: o.name, isOpen: o.isOpen, reachable: o.reachable, ...coords }
            : null;
        })
        // Outlets with unusable coordinates simply can't be plotted. Dropped
        // rather than defaulted, so the map never invents a position.
        .filter((o): o is NonNullable<typeof o> => o !== null),
    });
  });

  app.put("/api/admin/service-area", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });
    if (!(await requireAdmin(session.user.id)))
      return reply.status(403).send({ success: false, error: "Admin only" });

    const body = (request.body ?? {}) as { lat?: unknown; lon?: unknown; radiusKm?: unknown };
    const coords = parseCoordPair(body.lat, body.lon);
    if (!coords) {
      return reply.status(400).send({ success: false, error: "Titik pusat tidak valid" });
    }

    const radiusKm = Number(body.radiusKm ?? 50);
    if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 500) {
      return reply.status(400).send({ success: false, error: "Radius harus antara 1 dan 500 km" });
    }

    // Insert, not update: each change is a new row, so the centre's history is
    // preserved and getServiceArea() reads the newest.
    await db.insert(serviceAreaTable).values({
      center_lat: String(coords.lat),
      center_lon: String(coords.lon),
      radius_km: Math.round(radiusKm),
      updated_by: session.user.id,
    });

    // Moving the circle changes who is inside it, so every outlet is
    // re-evaluated here. Doing it at save time — rather than lazily — means the
    // admin finds out immediately how many outlets they just affected, instead
    // of it surfacing days later as a support ticket.
    const changed = await recomputeCourierReachable();

    return reply.send({ success: true, area: await getServiceArea(), changed });
  });

  /**
   * Manual override of a single outlet's reachability.
   *
   * The circle is an approximation of where couriers actually go. When it
   * disagrees with reality — a shop just past the line that a courier passes
   * anyway — an admin should be able to correct that one outlet without
   * reshaping the geometry for everyone else.
   *
   * Note this is overwritten the next time the service area is saved, since
   * that recomputes every outlet from the circle. Deliberate: the geometry is
   * the rule, and an override is a patch on top of the current rule, not a
   * permanent exemption from future ones.
   */
  app.put("/api/admin/outlet/:outletId/reachable", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });
    if (!(await requireAdmin(session.user.id)))
      return reply.status(403).send({ success: false, error: "Admin only" });

    const { outletId } = request.params as { outletId: string };
    const id = Number(outletId);
    if (!Number.isInteger(id)) {
      return reply.status(400).send({ success: false, error: "outletId tidak valid" });
    }

    const reachable = (request.body as { reachable?: unknown })?.reachable;
    if (typeof reachable !== "boolean") {
      return reply.status(400).send({ success: false, error: "reachable harus true/false" });
    }

    const updated = await db
      .update(outletsTable)
      .set({ courier_reachable: reachable })
      .where(and(eq(outletsTable.id, id), isNull(outletsTable.deletedAt)))
      .returning({ id: outletsTable.id });

    if (updated.length === 0)
      return reply.status(404).send({ success: false, error: "Outlet tidak ditemukan" });

    return reply.send({ success: true, reachable });
  });
}
