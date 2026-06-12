"use server";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
    outletsTable,
    productsTable,
    orderDetailsTable,
    ordersTable,
    customersTable,
    usersTable,
} from "@/src/db/schema";
import { eq, sql, desc, and, or, like, gte, lte, inArray } from "drizzle-orm";
import { db } from "@/src/db";
import { headers } from "next/headers";

export const GET = async (req: Request) => {
    try {
        const { searchParams } = new URL(req.url);
        const page   = Math.max(1, Number(searchParams.get("page"))  || 1);
        const limit  = Math.max(1, Number(searchParams.get("limit")) || 10);
        const offset = (page - 1) * limit;
        const search    = searchParams.get("search")   || "";
        const status    = searchParams.get("status")   || "all";
        const dateFrom  = searchParams.get("dateFrom") || "";
        const dateTo    = searchParams.get("dateTo")   || "";

        const session = await auth.api.getSession({ headers: await headers() });
        if (!session?.user) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        const outletRes = await db
            .select({ id: outletsTable.id, name: outletsTable.name })
            .from(outletsTable)
            .where(eq(outletsTable.user_id, session.user.id))
            .limit(1);
        const outlet = outletRes[0];
        if (!outlet) {
            return NextResponse.json({ success: false, error: "No outlet found" }, { status: 403 });
        }

        const dateStart = dateFrom ? new Date(dateFrom)                          : undefined;
        // dateTo is a date like "2024-05-15" — treat it as end of that day
        const dateEnd   = dateTo   ? new Date(`${dateTo}T23:59:59.999Z`)         : undefined;

        type OrderStatus = "pending" | "confirmed" | "preparing" | "ready" | "on_delivery" | "delivered" | "cancelled";
        const ACTIVE_STATUSES: OrderStatus[] = ["confirmed", "preparing", "ready", "on_delivery"];

        const statusFilter =
            status === "all"      ? undefined :
            status === "aktif"    ? inArray(ordersTable.status, ACTIVE_STATUSES) :
            status === "selesai"  ? eq(ordersTable.status, "delivered") :
                                    eq(ordersTable.status, status as OrderStatus);

        const baseFilter = and(
            eq(productsTable.outlet_id, outlet.id),
            statusFilter,
            search ? or(
                like(usersTable.name, `%${search}%`),
                like(orderDetailsTable.order_id, `%${search}%`),
            ) : undefined,
            dateStart ? gte(orderDetailsTable.created_at, dateStart) : undefined,
            dateEnd   ? lte(orderDetailsTable.created_at, dateEnd)   : undefined,
        );

        const [rows, countRows, statsRows] = await Promise.all([
            db
                .select({
                    orderId:      orderDetailsTable.order_id,
                    itemCount:    sql<number>`cast(count(*) as int)`,
                    totalAmount:  sql<number>`coalesce(sum(cast(${orderDetailsTable.summary_price} as numeric)), 0)`,
                    status:       ordersTable.status,
                    createdAt:    sql<string>`max(${orderDetailsTable.created_at})::text`,
                    customerName: usersTable.name,
                })
                .from(orderDetailsTable)
                .innerJoin(productsTable,  eq(orderDetailsTable.product_id, productsTable.id))
                .innerJoin(ordersTable,    eq(orderDetailsTable.order_id,   ordersTable.id))
                .innerJoin(customersTable, eq(ordersTable.customer_id,      customersTable.id))
                .innerJoin(usersTable,     eq(customersTable.user_id,       usersTable.id))
                .where(baseFilter)
                .groupBy(orderDetailsTable.order_id, usersTable.name, ordersTable.status)
                .orderBy(desc(sql`max(${orderDetailsTable.created_at})`))
                .limit(limit)
                .offset(offset),
                

            // total matching orders (for page count)
            db
                .select({ count: sql<number>`count(distinct ${orderDetailsTable.order_id})` })
                .from(orderDetailsTable)
                .innerJoin(productsTable,  eq(orderDetailsTable.product_id, productsTable.id))
                .innerJoin(ordersTable,    eq(orderDetailsTable.order_id,   ordersTable.id))
                .innerJoin(customersTable, eq(ordersTable.customer_id,      customersTable.id))
                .innerJoin(usersTable,     eq(customersTable.user_id,       usersTable.id))
                .where(baseFilter),

            // status summary chips (always unfiltered by status/search)
            db
                .select({
                    status: ordersTable.status,
                })
                .from(ordersTable)
                .where(eq(ordersTable.outlet_id, outlet.id))
                .groupBy(ordersTable.id, ordersTable.status),
        ]);

        const totalCount      = Number(countRows[0]?.count ?? 0);
        const pendingCount    = statsRows.filter(r => r.status === "pending").length;
        const processingCount = statsRows.filter(r => ["confirmed", "preparing", "ready", "on_delivery"].includes(r.status)).length;
        const completedCount  = statsRows.filter(r => r.status === "delivered").length;
        const cancelledCount  = statsRows.filter(r => r.status === "cancelled").length;
        const allCount        = statsRows.length;

        return NextResponse.json({
            success: true,
            data:   rows,
            count:  totalCount,
            stats:  { allCount, pendingCount, processingCount, completedCount, cancelledCount },
        });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
};
