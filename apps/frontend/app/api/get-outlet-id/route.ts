import { db } from "@/src/db";
import { eq, isNull, sql } from "drizzle-orm";
import { outletsTable } from "@/src/db/schema";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
    const url = new URL(request.url);
    const outletId = url.searchParams.get("outletId");

    if (!outletId) {
        return NextResponse.json({ error: "outletId is required" }, { status: 400 });
    }

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

    if (!rows[0]) {
        return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
    }

    const data = {
        ...rows[0],
        estimatedTime: rows[0].isOpen ? "~15 min" : "Tutup",
    };

    return NextResponse.json({ data });
}
