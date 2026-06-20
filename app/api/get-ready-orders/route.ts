import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/src/db";
import { ordersTable, outletsTable, customersTable, usersTable } from "@/src/db/schema";
import { eq, and } from "drizzle-orm";
import { attachOrderItems } from "@/lib/utils/order-items";

export const GET = async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return NextResponse.json({ success: false }, { status: 401 });

    const [outlet] = await db
        .select({ id: outletsTable.id })
        .from(outletsTable)
        .where(eq(outletsTable.user_id, session.user.id))
        .limit(1);

    if (!outlet) return NextResponse.json({ success: false, error: "Not an owner" }, { status: 403 });

    const orders = await db
        .select({
            orderId: ordersTable.id,
            customerName: usersTable.name,
            customerPhone: usersTable.phone,
            deliveryFee: ordersTable.delivery_fee,
            note: ordersTable.note,
            createdAt: ordersTable.createdAt,
        })
        .from(ordersTable)
        .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
        .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
        .where(and(eq(ordersTable.outlet_id, outlet.id), eq(ordersTable.status, "ready")))
        .orderBy(ordersTable.createdAt);

    const ordersWithItems = await attachOrderItems(orders);

    return NextResponse.json({ success: true, orders: ordersWithItems });
};
