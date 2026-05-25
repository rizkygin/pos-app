import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/src/db";
import { customersTable, ordersTable, outletsTable } from "@/src/db/schema";
import { and, desc, eq, notInArray } from "drizzle-orm";

export const GET = async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return NextResponse.json({ success: false }, { status: 401 });

    const [customer] = await db
        .select({ id: customersTable.id })
        .from(customersTable)
        .where(eq(customersTable.user_id, session.user.id))
        .limit(1);

    if (!customer) return NextResponse.json({ success: false }, { status: 403 });

    const [order] = await db
        .select({
            id: ordersTable.id,
            status: ordersTable.status,
            outletName: outletsTable.name,
        })
        .from(ordersTable)
        .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
        .where(
            and(
                eq(ordersTable.customer_id, customer.id),
                notInArray(ordersTable.status, ["cancelled"])
            )
        )
        .orderBy(desc(ordersTable.createdAt))
        .limit(1);

    if (!order) return NextResponse.json({ success: false });

    return NextResponse.json({ success: true, order });
};
