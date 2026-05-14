import { db } from "@/src/db";
import getOutletID from "@/lib/outlet-id";
import { redirect } from "next/navigation";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUTCRangeFromLocalDate } from "@/lib/timezone";
import { cashFlows, cashInDetailTable, cashInCategoryTable } from "@/src/db/schema";
import { CATEGORY_IN } from "@/lib/cashflow-categories";

export const GET = async (req: Request) => {
    const url = new URL(req.url);
    const timezone = url.searchParams.get("timezone") || "Asia/Jakarta";
    const date = url.searchParams.get("date");

    const session = await getSession();
    if (!session) return redirect("/");

    const outlet = await getOutletID();
    if (!outlet) return redirect("/forbidden");

    if (!date) {
        return NextResponse.json({ error: "Missing 'date' parameter" }, { status: 400 });
    }

    const { startUTC, endUTC } = getUTCRangeFromLocalDate(date, timezone);

    try {
        const cashInDetails = await db.select({
            sum: sql<number>`coalesce(sum(cast(${cashInDetailTable.money_amount} as numeric)), 0)`
        }).from(cashInDetailTable)
            .innerJoin(cashInCategoryTable, eq(cashInDetailTable.category_id, cashInCategoryTable.id))
            .innerJoin(cashFlows, eq(cashInDetailTable.id, cashFlows.cash_in_detail_id))
            .where(and(
                eq(cashFlows.outlet_id, outlet.id),
                gte(cashInDetailTable.created_at, startUTC),
                lt(cashInDetailTable.created_at, endUTC),
                eq(cashInCategoryTable.category, CATEGORY_IN[0])
            ))

        return NextResponse.json({
            date: {
                startUTC: startUTC,
                endUTC: endUTC,
            }, data: cashInDetails[0]
        });
    } catch (error: any) {
        return NextResponse.json({ message: error.message }, { status: 500 });
    }
}