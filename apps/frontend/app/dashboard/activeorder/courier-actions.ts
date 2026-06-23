"use server";

import { getSession } from "@/lib/auth";
import { db } from "@/src/db";
import { couriersTable, ordersTable } from "@/src/db/schema";
import { and, eq, isNull } from "drizzle-orm";

async function getCourier() {
    const session = await getSession();
    const [courier] = await db
        .select({ id: couriersTable.id })
        .from(couriersTable)
        .where(eq(couriersTable.user_id, session.user.id))
        .limit(1);
    if (!courier) throw new Error("Not a courier");
    return courier;
}

export async function acceptOrder(orderId: string) {
    const courier = await getCourier();

    await db
        .update(ordersTable)
        .set({ courier_id: courier.id, updatedAt: new Date() })
        .where(
            and(
                eq(ordersTable.id, orderId),
                eq(ordersTable.status, "confirmed"),
                isNull(ordersTable.courier_id)
            )
        );
}

export async function pickupOrder(orderId: string) {
    const courier = await getCourier();

    await db
        .update(ordersTable)
        .set({ status: "on_delivery", updatedAt: new Date() })
        .where(
            and(
                eq(ordersTable.id, orderId),
                eq(ordersTable.courier_id, courier.id),
                eq(ordersTable.status, "ready")
            )
        );
}

export async function deliverOrder(orderId: string) {
    const courier = await getCourier();

    await db
        .update(ordersTable)
        .set({ status: "delivered", updatedAt: new Date() })
        .where(
            and(
                eq(ordersTable.id, orderId),
                eq(ordersTable.courier_id, courier.id),
                eq(ordersTable.status, "on_delivery")
            )
        );
}
