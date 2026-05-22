import { db } from "@/src/db";
import { and, isNull, desc, sql, like } from "drizzle-orm";
import { outletsTable } from "@/src/db/schema";

export async function GET(request: Request) {
    const url = new URL(request.url);
    // const feature = url.searchParams.get("feature");

    const search = url.searchParams.get('search')

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
        .orderBy(desc(outletsTable.is_open), desc(sql`${outletsTable.ratings}::numeric`)).limit(10);

    const data = rows.map((r) => ({
        ...r,
        estimatedTime: r.isOpen ? "~15 min" : "Tutup",
    }));

    return Response.json({ data });
}
