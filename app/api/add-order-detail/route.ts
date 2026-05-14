import { getSession } from "@/lib/auth";
import { db } from "@/src/db";
import { eq } from "drizzle-orm";

import { ordersTable, usersTable, customersTable, couriersTable, orderDetailsTable } from "@/src/db/schema";
import { NextResponse } from "next/server";
import { addPosToCashflowin } from "@/lib/cashflow";

export async function POST(req: Request) {
    try {

        const body = await req.json();
        // console.log(body);
        // return NextResponse.json({ success: true, data: body });

        const session = await getSession();
        const EMAIL = "rizkygin1@gmail.com";
        const EMAIL_COURIER = "rizkygin3@gmail.com";

        if (!session) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const customer_offline = await db.query.usersTable.findFirst({
            where: eq(usersTable.email, EMAIL),
            with: {
                hasRoleCustomer: true
            }
        });
        const courier_offline = await db.query.usersTable.findFirst({
            where: eq(usersTable.email, EMAIL_COURIER),
            with: {
                hasRoleCourier: true
            }
        })

        const customer = customer_offline?.hasRoleCustomer?.id;
        const courier = courier_offline?.hasRoleCourier?.id;

        let new_order_id: string | undefined;
        await db.transaction(async (tx) => {
            if (body.cart.length > 0) {
                new_order_id = crypto.randomUUID();
                await tx.insert(ordersTable).values({
                    id: new_order_id,
                    costomer_id: customer!,
                    courier_id: courier!,
                });

                for (const e of body.cart as any) {
                    const summary_price = e.product.price_mark_down && e.product.price_mark_down !== "0" ? parseFloat(e.product.price_mark_down) * e.quantity : parseFloat(e.product.price) * e.quantity;
                    await tx.insert(orderDetailsTable).values({
                        order_id: new_order_id,
                        product_id: e.product.id,
                        quantity: e.quantity,
                        note_product: e.note_product || "-",
                        summary_price: summary_price.toString(),
                        status: "checkout",
                    });
                }
            }
            await addPosToCashflowin(body.total, tx);
        });
        return NextResponse.json({ success: true, message: "Order created successfully", orderId: new_order_id });



    } catch (error: any) {
        return NextResponse.json({ error: { message: error.message || "Internal server error" } }, { status: 500 });
    }
}