import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/src/db";
import {
    ordersTable,
    outletsTable,
    customersTable,
    usersTable,
    couriersTable,
} from "@/src/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { attachOrderItems } from "@/lib/utils/order-items";

export const GET = async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return NextResponse.json({ success: false }, { status: 401 });

    const [courier] = await db
        .select({ id: couriersTable.id })
        .from(couriersTable)
        .where(eq(couriersTable.user_id, session.user.id))
        .limit(1);

    if (!courier) return NextResponse.json({ success: false, error: "Not a courier" }, { status: 403 });

    const orders = await db
        .select({
            orderId: ordersTable.id,
            customerName: usersTable.name,
            customerPhone: usersTable.phone,
            deliveryFee: ordersTable.delivery_fee,
            note: ordersTable.note,
            createdAt: ordersTable.createdAt,
            status: ordersTable.status,
            outletName: outletsTable.name,
            outletAddress: outletsTable.address,
        })
        .from(ordersTable)
        .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
        .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
        .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
        .where(
            and(
                eq(ordersTable.courier_id, courier.id),
                inArray(ordersTable.status, ["confirmed", "preparing", "ready", "on_delivery"])
            )
        )
        .orderBy(ordersTable.createdAt);

    const ordersWithItems = await attachOrderItems(orders);

    return NextResponse.json({ success: true, orders: ordersWithItems });
};
