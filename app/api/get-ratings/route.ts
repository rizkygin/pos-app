import getOutletID from "@/lib/outlet-id";
import { db } from "@/src/db";
import { ratingsTable, usersTable, productsTable } from "@/src/db/schema";
import { eq, or, desc } from "drizzle-orm";
import { NextResponse } from "next/server";

export const GET = async () => {
    const outlet = await getOutletID();

    if (!outlet) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rows = await db
        .select({
            id: ratingsTable.id,
            ratings: ratingsTable.ratings,
            comment: ratingsTable.comment,
            reciepent_as: ratingsTable.reciepent_as,
            created_at: ratingsTable.created_at,
            reviewer_name: usersTable.name,
            product_name: productsTable.product_name,
            outlet_id: ratingsTable.outlet_id,
            product_id: ratingsTable.product_id,
        })
        .from(ratingsTable)
        .leftJoin(usersTable, eq(ratingsTable.reviewer, usersTable.id))
        .leftJoin(productsTable, eq(ratingsTable.product_id, productsTable.id))
        .where(
            or(
                eq(ratingsTable.outlet_id, outlet.id),
                eq(productsTable.outlet_id, outlet.id)
            )
        )
        .orderBy(desc(ratingsTable.created_at));

    const data = rows.map((r) => ({
        id: r.id,
        rating: Number(r.ratings) || 5,
        comment: r.comment ?? "",
        type: r.product_id ? "product" : "outlet",
        created_at: r.created_at,
        reviewer_name: r.reviewer_name ?? "Anonim",
        product_name: r.product_name ?? null,
    }));

    return NextResponse.json({ data });
};
