import { getSession } from "@/lib/auth";
import { orderDetailsTable, outletsTable, productsTable } from "@/src/db/schema";
import { eq, sql, and, gte, lt } from "drizzle-orm";
import { redirect } from "next/navigation";
import getOutletID from "@/lib/outlet-id";
import { NextResponse } from "next/server";
import { getUTCRangeFromLocalDate, getUTCRangeFromLocalMonth } from "@/lib/timezone";
import { db } from "@/src/db";

export const GET = async (req: Request) => {
    const url = new URL(req.url);
    const date = url.searchParams.get("date");
    const month = url.searchParams.get("month");
    const timeZone = url.searchParams.get("timezone") || "Asia/Jakarta";

    const session = await getSession();

    if (!session) {
        return redirect("/");
    }
    const outlet = await getOutletID();
    if (!outlet) {
        return redirect("/forbidden");
    }

    if (!date && !month) {
        return NextResponse.json({ error: "Missing 'date' or 'month' parameter" }, { status: 400 });
    }

    const { startUTC, endUTC } = month
        ? getUTCRangeFromLocalMonth(month, timeZone)
        : getUTCRangeFromLocalDate(date!, timeZone);

    if (isNaN(startUTC.getTime()) || isNaN(endUTC.getTime())) {
        return NextResponse.json({ error: "Calculated UTC range is invalid" }, { status: 400 });
    }

    if (session.user)
        try {
            const summaryOrders = await db.select(
                {
                    sum: sql<number>`coalesce(sum(cast(${orderDetailsTable.summary_price} as numeric)), 0)`
                }
            ).from(outletsTable)
                .leftJoin(productsTable, eq(outletsTable.id, productsTable.outlet_id))
                .leftJoin(orderDetailsTable, eq(productsTable.id, orderDetailsTable.product_id))
                .where(and(
                    eq(outletsTable.id, outlet.id),
                    gte(orderDetailsTable.created_at, startUTC),
                    lt(orderDetailsTable.created_at, endUTC),
                ))
            return NextResponse.json({
                date: {
                    startUTC: startUTC,
                    endUTC: endUTC,
                }, data: summaryOrders[0]
            });

        }

        catch (error: any) {
            return NextResponse.json(
                {
                    message: error.message,
                },
                { status: 500 }
            );
        }
}