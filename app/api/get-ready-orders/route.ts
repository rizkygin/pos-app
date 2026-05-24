import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/src/db";
import { ordersTable, orderDetailsTable, productsTable, outletsTable, customersTable, usersTable } from "@/src/db/schema";
import { eq, and } from "drizzle-orm";

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

    const ordersWithItems = await Promise.all(
        orders.map(async (order) => {
            const items = await db
                .select({
                    productName: productsTable.product_name,
                    quantity: orderDetailsTable.quantity,
                    noteProduct: orderDetailsTable.note_product,
                    summaryPrice: orderDetailsTable.summary_price,
                })
                .from(orderDetailsTable)
                .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
                .where(eq(orderDetailsTable.order_id, order.orderId));

            const totalAmount = items.reduce((sum, item) => sum + parseInt(item.summaryPrice || "0"), 0);

            return { ...order, items, totalAmount };
        })
    );

    return NextResponse.json({ success: true, orders: ordersWithItems });
};
