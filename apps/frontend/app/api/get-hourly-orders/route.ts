import { getSession } from "@/lib/auth";
import { db } from "@/src/db";
import { orderDetailsTable, ordersTable, productsTable } from "@/src/db/schema";
import { getUTCRangeFromLocalDate } from "@/lib/timezone";
import getOutletID from "@/lib/outlet-id";
import { NextResponse } from "next/server";
import { sql, countDistinct, and, gte, lt, eq, notInArray } from "drizzle-orm";
import { redirect } from "next/navigation";

export const GET = async (req: Request) => {
    const session = await getSession();
    if (!session) return redirect("/");

    const outlet = await getOutletID();
    if (!outlet) return redirect("/forbidden");

    const url = new URL(req.url);
    const date = url.searchParams.get("date");
    const timezone = url.searchParams.get("timezone") || "Asia/Jakarta";

    if (!date) {
        return NextResponse.json({ error: "Missing 'date' parameter" }, { status: 400 });
    }

    const { startUTC, endUTC } = getUTCRangeFromLocalDate(date, timezone);

    // AT TIME ZONE requires a literal — validate to prevent injection
    const safeTz = /^[A-Za-z0-9_\-\/+]+$/.test(timezone) ? timezone : "UTC";
    const tzLiteral = sql.raw(`'${safeTz}'`);

    try {
        const rows = await db
            .select({
                hour: sql<number>`EXTRACT(HOUR FROM (${orderDetailsTable.created_at} AT TIME ZONE ${tzLiteral}))::int`,
                orders: countDistinct(orderDetailsTable.order_id),
            })
            .from(orderDetailsTable)
            .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
            .innerJoin(ordersTable, eq(orderDetailsTable.order_id, ordersTable.id))
            .where(
                and(
                    eq(productsTable.outlet_id, outlet.id),
                    gte(orderDetailsTable.created_at, startUTC),
                    lt(orderDetailsTable.created_at, endUTC),
                    notInArray(ordersTable.status, ['cancelled', 'pending']),
                )
            )
            .groupBy(sql`EXTRACT(HOUR FROM (${orderDetailsTable.created_at} AT TIME ZONE ${tzLiteral}))`);

        const hourMap = new Map(rows.map(r => [r.hour, r.orders]));
        const data = Array.from({ length: 24 }, (_, i) => ({
            hour: `${String(i).padStart(2, "0")}:00`,
            orders: hourMap.get(i) ?? 0,
        }));

        return NextResponse.json({ data });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
};
