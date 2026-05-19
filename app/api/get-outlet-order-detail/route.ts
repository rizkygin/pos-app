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
import { eq, and } from "drizzle-orm";
import { db } from "@/src/db";
import { headers } from "next/headers";

export const GET = async (req: Request) => {
    try {
        const { searchParams } = new URL(req.url);
        const order_id = searchParams.get("order_id");
        if (!order_id) {
            return NextResponse.json({ success: false, error: "order_id is required" }, { status: 400 });
        }

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

        const [items, customerRes] = await Promise.all([
            db
                .select({
                    detailId: orderDetailsTable.id,
                    quantity: orderDetailsTable.quantity,
                    note: orderDetailsTable.note_product,
                    summaryPrice: orderDetailsTable.summary_price,
                    status: orderDetailsTable.status,
                    createdAt: orderDetailsTable.created_at,
                    productId: productsTable.id,
                    productName: productsTable.product_name,
                    price: productsTable.price,
                    category: productsTable.category,
                    unit: productsTable.unit,
                    image: productsTable.image,
                })
                .from(orderDetailsTable)
                .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
                .where(
                    and(
                        eq(orderDetailsTable.order_id, order_id),
                        eq(productsTable.outlet_id, outlet.id),
                    )
                ),

            db
                .select({
                    name: usersTable.name,
                    email: usersTable.email,
                    phone: usersTable.phone,
                    address: usersTable.address,
                })
                .from(ordersTable)
                .innerJoin(customersTable, eq(ordersTable.costomer_id, customersTable.id))
                .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
                .where(eq(ordersTable.id, order_id))
                .limit(1),
        ]);

        if (items.length === 0) {
            return NextResponse.json({ success: false, error: "Order not found" }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            outlet: { id: outlet.id, name: outlet.name },
            items,
            customer: customerRes[0] ?? null,
        });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
};
