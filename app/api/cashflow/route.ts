import { getSession } from "@/lib/auth";
import {
    cashFlows,
    cashInCategoryTable,
    cashOutCategoryTable,
    cashInDetailTable,
    cashOutDetailTable,
} from "@/src/db/schema";
import { eq, and, gte, lt, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import getOutletID from "@/lib/outlet-id";
import { NextResponse } from "next/server";
import { getUTCRangeFromLocalDate, getUTCRangeFromLocalMonth } from "@/lib/timezone";
import { db } from "@/src/db";

export const GET = async (req: Request) => {
    const url = new URL(req.url);
    const month = url.searchParams.get("month");
    const timezone = url.searchParams.get("timezone") || "Asia/Jakarta";

    const session = await getSession();
    if (!session) return redirect("/");

    const outlet = await getOutletID();
    if (!outlet) return redirect("/forbidden");

    if (!month) {
        return NextResponse.json({ error: "Missing 'month' parameter" }, { status: 400 });
    }

    const { startUTC, endUTC } = getUTCRangeFromLocalMonth(month, timezone);

    try {
        const rows = await db
            .select({
                id: cashFlows.id,
                cash_in_category_id: cashFlows.cash_in_category_id,
                cash_out_category_id: cashFlows.cash_out_category_id,
                in_category: cashInCategoryTable.category,
                in_amount: cashInDetailTable.money_amount,
                in_date: cashInDetailTable.created_at,
                out_category: cashOutCategoryTable.category,
                out_amount: cashOutDetailTable.money_amount,
                out_date: cashOutDetailTable.created_at,
            })
            .from(cashFlows)
            .leftJoin(cashInDetailTable, eq(cashFlows.cash_in_category_id, cashInDetailTable.id))
            .leftJoin(cashInCategoryTable, eq(cashInDetailTable.category_id, cashInCategoryTable.id))
            .leftJoin(cashOutDetailTable, eq(cashFlows.cash_out_category_id, cashOutDetailTable.id))
            .leftJoin(cashOutCategoryTable, eq(cashOutDetailTable.category_id, cashOutCategoryTable.id))
            .where(
                and(
                    eq(cashFlows.outlet_id, outlet.id),
                    or(
                        and(gte(cashInDetailTable.created_at, startUTC), lt(cashInDetailTable.created_at, endUTC)),
                        and(gte(cashOutDetailTable.created_at, startUTC), lt(cashOutDetailTable.created_at, endUTC))
                    )
                )
            );

        const dateFormatter = new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        });

        const data = rows.map((row) => ({
            id: String(row.id),
            type: (row.cash_in_category_id !== null ? "IN" : "OUT") as "IN" | "OUT",
            category: (row.in_category ?? row.out_category) ?? "",
            amount: Number(row.in_amount ?? row.out_amount ?? "0"),
            date: dateFormatter.format((row.in_date ?? row.out_date)!),
            note: "",
        }));

        return NextResponse.json({ data });
    } catch (error: any) {
        return NextResponse.json({ message: error.message }, { status: 500 });
    }
};

export const POST = async (req: Request) => {
    const session = await getSession();
    if (!session) return redirect("/");

    const outlet = await getOutletID();
    if (!outlet) return redirect("/forbidden");

    const body = await req.json();
    const { type, category, amount, date, timezone = "Asia/Jakarta" } = body;

    if (!type || !category || !amount || !date) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (isNaN(Number(amount)) || Number(amount) <= 0) {
        return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const { startUTC } = getUTCRangeFromLocalDate(date, timezone);

    try {
        if (type === "IN") {
            const [cat] = await db
                .select({ id: cashInCategoryTable.id })
                .from(cashInCategoryTable)
                .where(eq(cashInCategoryTable.category, category))
                .limit(1);

            if (!cat) return NextResponse.json({ error: "Unknown category" }, { status: 400 });

            const [detail] = await db
                .insert(cashInDetailTable)
                .values({ category_id: cat.id, money_amount: String(amount), type: "cash", created_at: startUTC })
                .returning();

            const [cf] = await db
                .insert(cashFlows)
                .values({ outlet_id: outlet.id, cash_in_category_id: detail.id })
                .returning();

            return NextResponse.json({
                data: { id: String(cf.id), type: "IN", category, amount: Number(amount), date, note: "" },
            });
        }

        if (type === "OUT") {
            const [cat] = await db
                .select({ id: cashOutCategoryTable.id })
                .from(cashOutCategoryTable)
                .where(eq(cashOutCategoryTable.category, category))
                .limit(1);

            if (!cat) return NextResponse.json({ error: "Unknown category" }, { status: 400 });

            const [detail] = await db
                .insert(cashOutDetailTable)
                .values({ category_id: cat.id, money_amount: String(amount), type: "cash", created_at: startUTC })
                .returning();

            const [cf] = await db
                .insert(cashFlows)
                .values({ outlet_id: outlet.id, cash_out_category_id: detail.id })
                .returning();

            return NextResponse.json({
                data: { id: String(cf.id), type: "OUT", category, amount: Number(amount), date, note: "" },
            });
        }

        return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    } catch (error: any) {
        return NextResponse.json({ message: error.message }, { status: 500 });
    }
};

export const DELETE = async (req: Request) => {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");

    const session = await getSession();
    if (!session) return redirect("/");

    const outlet = await getOutletID();
    if (!outlet) return redirect("/forbidden");

    if (!id || isNaN(Number(id))) {
        return NextResponse.json({ error: "Missing or invalid 'id' parameter" }, { status: 400 });
    }

    try {
        const [cf] = await db
            .select()
            .from(cashFlows)
            .where(and(eq(cashFlows.id, Number(id)), eq(cashFlows.outlet_id, outlet.id)))
            .limit(1);

        if (!cf) return NextResponse.json({ error: "Not found" }, { status: 404 });

        const inDetailId = cf.cash_in_category_id;
        const outDetailId = cf.cash_out_category_id;

        await db.delete(cashFlows).where(eq(cashFlows.id, Number(id)));

        if (inDetailId) {
            await db.delete(cashInDetailTable).where(eq(cashInDetailTable.id, inDetailId));
        }
        if (outDetailId) {
            await db.delete(cashOutDetailTable).where(eq(cashOutDetailTable.id, outDetailId));
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ message: error.message }, { status: 500 });
    }
};
