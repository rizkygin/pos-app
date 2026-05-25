"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/src/db";
import { couriersTable, customersTable, ordersTable, outletsTable } from "@/src/db/schema";
import { and, eq, isNotNull, or } from "drizzle-orm";

export async function cancelOrder(orderId: string) {
    const session = await getSession();

    const [customer] = await db
        .select({ id: customersTable.id })
        .from(customersTable)
        .where(eq(customersTable.user_id, session.user.id))
        .limit(1);

    if (!customer) throw new Error("Customer not found");

    await db
        .update(ordersTable)
        .set({ status: "cancelled" })
        .where(
            and(
                eq(ordersTable.id, orderId),
                eq(ordersTable.customer_id, customer.id),
                eq(ordersTable.status, "pending")
            )
        );

    redirect("/dashboard/order");
}

export async function confirmOrder(orderId: string) {
    const session = await getSession();

    const [outlet] = await db
        .select({ id: outletsTable.id })
        .from(outletsTable)
        .where(eq(outletsTable.user_id, session.user.id))
        .limit(1);

    if (!outlet) throw new Error("Not an owner");

    await db
        .update(ordersTable)
        .set({ status: "confirmed" })
        .where(
            and(
                eq(ordersTable.id, orderId),
                eq(ordersTable.outlet_id, outlet.id),
                eq(ordersTable.status, "pending")
            )
        );
}

export async function confirmPickup(orderId: string) {
    const session = await getSession();

    const [outlet] = await db
        .select({ id: outletsTable.id })
        .from(outletsTable)
        .where(eq(outletsTable.user_id, session.user.id))
        .limit(1);

    if (!outlet) throw new Error("Not an owner");

    await db
        .update(ordersTable)
        .set({ status: "on_delivery" })
        .where(
            and(
                eq(ordersTable.id, orderId),
                eq(ordersTable.outlet_id, outlet.id),
                eq(ordersTable.status, "ready")
            )
        );
}

export async function markOrderDelivered(orderId: string) {
    const session = await getSession();

    const [courier] = await db
        .select({ id: couriersTable.id })
        .from(couriersTable)
        .where(eq(couriersTable.user_id, session.user.id))
        .limit(1);

    if (!courier) throw new Error("Not a courier");

    await db
        .update(ordersTable)
        .set({ status: "delivered" })
        .where(
            and(
                eq(ordersTable.id, orderId),
                eq(ordersTable.courier_id, courier.id),
                eq(ordersTable.status, "on_delivery")
            )
        );
}

export async function markOrderReady(orderId: string) {
    const session = await getSession();

    const [outlet] = await db
        .select({ id: outletsTable.id })
        .from(outletsTable)
        .where(eq(outletsTable.user_id, session.user.id))
        .limit(1);

    if (!outlet) throw new Error("Not an owner");

    await db
        .update(ordersTable)
        .set({ status: "ready" })
        .where(
            and(
                eq(ordersTable.id, orderId),
                eq(ordersTable.outlet_id, outlet.id),
                isNotNull(ordersTable.courier_id),
                or(eq(ordersTable.status, "confirmed"), eq(ordersTable.status, "preparing"))
            )
        );
}
