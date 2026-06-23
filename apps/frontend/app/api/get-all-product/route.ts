import { db } from "@/src/db";
import { eq, and, isNull, desc, like, sql, or } from "drizzle-orm"
import { productsTable, outletsTable } from "@/src/db/schema";

type JoinRow = {
    products: typeof productsTable.$inferSelect;
    outlets: typeof outletsTable.$inferSelect;
};

function mapRow(row: JoinRow) {
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
        // expose outlet features so the client can filter by category
        features: row.outlets.features ?? [],
    };
}

export async function GET(request: Request) {
    const url = new URL(request.url);
    const name = url.searchParams.get('name');
    const id = url.searchParams.get('id');
    const feature = url.searchParams.get('feature');
    const outletId = id ? Number(id) : NaN;

    const nameFilter = name
        ? or(like(productsTable.product_name, `%${name}%`), like(outletsTable.name, `%${name}%`))
        : sql`true`;

    // Filter by outlet's features array when a feature/category is requested
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
        return Response.json({ data: rows.map(mapRow) });
    }

    const rows = await db.select().from(productsTable)
        .innerJoin(outletsTable, eq(productsTable.outlet_id, outletsTable.id))
        .where(baseWhere)
        .orderBy(desc(productsTable.ratings))
        .limit(100);

    return Response.json({ data: rows.map(mapRow) });
}
