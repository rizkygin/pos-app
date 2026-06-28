import type { FastifyInstance } from "fastify";
import { and, eq, isNull, desc, sql, like, or, gte, lte } from "drizzle-orm";
import { db } from "../db";
import { outletsTable, productsTable, productAdsTable, productAdsSchedule, scheduleProductAdsTable } from "../db/schema";
import { getCurrentAdSlot } from "../lib/utils/ad-schedule";

type JoinRow = {
  products: typeof productsTable.$inferSelect;
  outlets: typeof outletsTable.$inferSelect;
};

function mapProductRow(row: JoinRow) {
  return {
    id: row.products.id,
    product_name: row.products.product_name,
    image: row.products.image,
    price: Number(row.products.price),
    price_mark_down: Number(row.products.price_mark_down),
    category: row.products.category,
    isAvailable: row.products.isAvailable,
    description: row.products.description ?? "",
    ratings: Number(row.products.ratings),
    unit: row.products.unit,
    isRecommended: row.products.is_recommended,
    discountPercent: row.products.discount_percent ?? undefined,
    outlet: row.outlets.name,
    outleid: row.outlets.id,
    reviewCount: String(row.outlets.review_count ?? 0),
    features: row.outlets.features ?? [],
  };
}

export async function publicRoutes(app: FastifyInstance) {
  // Public menu for an outlet: the outlet's public info + its available products.
  // { outlet: null } => the page renders Not Found.
  app.get("/api/get-menu", async (request) => {
    const { outlet_id } = request.query as { outlet_id?: string };
    const id = Number(outlet_id);
    if (!outlet_id || Number.isNaN(id)) return { outlet: null, products: [] };

    const [outlet] = await db
      .select({
        id: outletsTable.id,
        name: outletsTable.name,
        address: outletsTable.address,
        phone: outletsTable.phone,
        lat: outletsTable.lat,
        lon: outletsTable.lon,
        avatar: outletsTable.avatar,
        tags: outletsTable.tags,
        is_open: outletsTable.is_open,
        ratings: outletsTable.ratings,
        review_count: outletsTable.review_count,
      })
      .from(outletsTable)
      .where(and(eq(outletsTable.id, id), isNull(outletsTable.deletedAt)))
      .limit(1);

    if (!outlet) return { outlet: null, products: [] };

    const products = await db
      .select({
        id: productsTable.id,
        product_name: productsTable.product_name,
        price: productsTable.price,
        price_mark_down: productsTable.price_mark_down,
        category: productsTable.category,
        image: productsTable.image,
        description: productsTable.description,
        unit: productsTable.unit,
        ratings: productsTable.ratings,
        review_count: productsTable.review_count,
        is_recommended: productsTable.is_recommended,
        isAvailable: productsTable.isAvailable,
        discount_percent: productsTable.discount_percent,
      })
      .from(productsTable)
      .where(
        and(
          eq(productsTable.outlet_id, id),
          eq(productsTable.isAvailable, true),
          isNull(productsTable.deletedAt),
        ),
      );

    return { outlet, products };
  });

  app.get("/api/get-all-outlet", async (request) => {
    const { search } = request.query as { search?: string };

    const rows = await db
      .select({
        id: outletsTable.id,
        name: outletsTable.name,
        image: outletsTable.avatar,
        tags: outletsTable.tags,
        reviewCount: outletsTable.review_count,
        coverImage: outletsTable.avatar,
        address: outletsTable.address,
        phone: outletsTable.phone,
        features: outletsTable.features,
        isOpen: outletsTable.is_open,
        ratings: sql<number>`COALESCE(${outletsTable.ratings}::numeric, 0)`,
      })
      .from(outletsTable)
      .where(and(
        isNull(outletsTable.deletedAt),
        search ? like(outletsTable.name, `%${search}%`) : sql`true`,
      ))
      .orderBy(desc(outletsTable.is_open), desc(sql`${outletsTable.ratings}::numeric`))
      .limit(10);

    const data = rows.map((r) => ({
      ...r,
      estimatedTime: r.isOpen ? "~15 min" : "Tutup",
    }));

    return { data };
  });

  app.get("/api/get-all-product", async (request) => {
    const { name, id, feature } = request.query as { name?: string; id?: string; feature?: string };
    const outletId = id ? Number(id) : NaN;

    const nameFilter = name
      ? or(like(productsTable.product_name, `%${name}%`), like(outletsTable.name, `%${name}%`))
      : sql`true`;

    const featureFilter = feature
      ? sql`${outletsTable.features} @> ARRAY[${feature}]::text[]`
      : sql`true`;

    const baseWhere = and(
      eq(productsTable.isAvailable, true),
      isNull(productsTable.deletedAt),
      nameFilter,
      featureFilter,
    );

    if (!isNaN(outletId) && outletId > 0) {
      const rows = await db.select().from(productsTable)
        .innerJoin(outletsTable, eq(productsTable.outlet_id, outletsTable.id))
        .where(and(baseWhere, eq(productsTable.outlet_id, outletId)));
      return { data: rows.map(mapProductRow) };
    }

    const rows = await db.select().from(productsTable)
      .innerJoin(outletsTable, eq(productsTable.outlet_id, outletsTable.id))
      .where(baseWhere)
      .orderBy(desc(productsTable.ratings))
      .limit(100);

    return { data: rows.map(mapProductRow) };
  });

  app.get("/api/get-outlet-id", async (request, reply) => {
    const { outletId } = request.query as { outletId?: string };
    if (!outletId) return reply.status(400).send({ error: "outletId is required" });

    const rows = await db
      .select({
        id: outletsTable.id,
        name: outletsTable.name,
        image: outletsTable.avatar,
        tags: outletsTable.tags,
        reviewCount: outletsTable.review_count,
        coverImage: outletsTable.avatar,
        address: outletsTable.address,
        phone: outletsTable.phone,
        features: outletsTable.features,
        isOpen: outletsTable.is_open,
        ratings: sql<number>`COALESCE(${outletsTable.ratings}::numeric, 0)`,
      })
      .from(outletsTable)
      .where(eq(outletsTable.id, Number(outletId)))
      .limit(1);

    if (!rows[0]) return reply.status(404).send({ error: "Outlet not found" });

    return { data: { ...rows[0], estimatedTime: rows[0].isOpen ? "~15 min" : "Tutup" } };
  });

  app.get("/api/get-outlet-ads", async (request, reply) => {
    const { outletId: outletIdParam } = request.query as { outletId?: string };
    const outletId = Number(outletIdParam);
    if (!outletId || isNaN(outletId)) {
      return reply.status(400).send({ success: false, data: [] });
    }

    const { now, day, hour } = getCurrentAdSlot();

    const rows = await db
      .select({
        id: productAdsTable.id,
        title: productAdsTable.title,
        description: productAdsTable.description,
        banner_image: productAdsTable.banner_image,
        product_id: productAdsTable.product_id,
      })
      .from(productAdsTable)
      .innerJoin(productAdsSchedule, eq(productAdsSchedule.productAdsSchedule_id, productAdsTable.id))
      .innerJoin(scheduleProductAdsTable, eq(scheduleProductAdsTable.id, productAdsSchedule.scheduleProductAdsTable_id))
      .where(
        and(
          eq(productAdsTable.outlet_id, outletId),
          eq(productAdsTable.status, "approved"),
          eq(productAdsTable.is_active, true),
          lte(productAdsTable.starts_at, now),
          or(isNull(productAdsTable.ends_at), gte(productAdsTable.ends_at, now)),
          sql`${scheduleProductAdsTable.time}->>'day' = ${day}`,
          sql`${scheduleProductAdsTable.time}->>'hour' = ${hour}`,
        ),
      );

    return { success: true, data: rows };
  });

  app.get("/api/get-categories", async (request, reply) => {
    const { outletId: outletIdParam } = request.query as { outletId?: string };
    if (!outletIdParam) return reply.status(400).send({ success: false, message: "Missing outletId" });

    try {
      const categories = await db
        .selectDistinct({ category: productsTable.category })
        .from(productsTable)
        .where(eq(productsTable.outlet_id, parseInt(outletIdParam, 10)));

      return { success: true, message: "Categories fetched successfully", data: categories };
    } catch (error) {
      app.log.error(error, "Failed to fetch categories");
      return reply.status(500).send({ success: false, error: { message: (error as Error).message } });
    }
  });
}
