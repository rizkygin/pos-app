"use server";

import { getSession } from "@/lib/auth";
import { db } from "@/src/db";
import { couriersTable, ordersTable } from "@/src/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export async function acceptOrder(orderId: string) {
    const session = await getSession();

    const [courier] = await db
        .select({ id: couriersTable.id })
        .from(couriersTable)
        .where(eq(couriersTable.user_id, session.user.id))
        .limit(1);

    if (!courier) throw new Error("Not a courier");

    await db
        .update(ordersTable)
        .set({ courier_id: courier.id, status: "preparing" })
        .where(
            and(
                eq(ordersTable.id, orderId),
                eq(ordersTable.status, "confirmed"),
                isNull(ordersTable.courier_id)
            )
        );
}
