"use server";

import { getSession } from "@/lib/auth";
import { db } from "@/src/db"
import { ordersTable, orderDetailsTable } from "@/src/db/schema";


interface NoteJson {
    location: {
        outlet: {
            lat: string,
            long: string,
            address: string,
        },
        customer: {
            lat: string,
            long: string
            note_location: string,
        }
    },
    customer_ratings: string,
    customer_note: string

}

export type OrderItem = {
    product_id: string;
    quantity: number;
    note_product?: string;
    summary_price: string;
};

export type OrdersFormDataForFood = {
    outlet_id: number,
    promo_id?: number,
    discount_amount?: number,
    delivery_fee: string,
    note?: NoteJson | null,
    items: OrderItem[],
}

export async function customerMakingOrder(data: OrdersFormDataForFood) {
    const session = await getSession();
    const orderId = crypto.randomUUID();

    await db.transaction(async (tx) => {
        await tx.insert(ordersTable).values({
            id: orderId,
            customer_id: Number(session.user.id),
            outlet_id: data.outlet_id,
            courier_id: null,
            status: 'pending',
            promo_id: data.promo_id,
            discount_amount: data.discount_amount?.toString(),
            delivery_fee: data.delivery_fee,
            note: data.note ?? null,
            scheduled_at: null,
        });

        if (data.items.length > 0) {
            await tx.insert(orderDetailsTable).values(
                data.items.map((item) => ({
                    order_id: orderId,
                    product_id: item.product_id,
                    quantity: item.quantity,
                    note_product: item.note_product,
                    summary_price: item.summary_price,
                }))
            );
        }
    });
}