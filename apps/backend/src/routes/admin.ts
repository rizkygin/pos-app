import type { FastifyInstance } from "fastify";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  adminsTable,
  outletsTable,
  productsTable,
  productAdsTable,
  productAdsSchedule,
  scheduleProductAdsTable,
  ratingsTable,
  orderDetailsTable,
  usersTable,
} from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";

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
}
