"use server";

import { getSession } from "@/lib/auth";
import { db } from "@/src/db";
import { couriersTable, ordersTable } from "@/src/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getCourierAvailability } from "@/lib/utils/courier-availability";

export async function acceptOrder(orderId: string) {
    const session = await getSession();

    const [courier] = await db
        .select({ id: couriersTable.id })
        .from(couriersTable)
        .where(eq(couriersTable.user_id, session.user.id))
        .limit(1);

    if (!courier) throw new Error("Not a courier");

    const availability = await getCourierAvailability(courier.id);

    if (!availability.isOnline) {
        throw new Error("Kamu harus online untuk menerima order");
    }

    if (availability.hasActiveOrder) {
        throw new Error("Selesaikan pesanan aktif kamu sebelum menerima order baru");
    }

    const updated = await db
        .update(ordersTable)
        .set({ courier_id: courier.id, status: "preparing", updatedAt: new Date() })
        .where(
            and(
                eq(ordersTable.id, orderId),
                eq(ordersTable.status, "confirmed"),
                isNull(ordersTable.courier_id)
            )
        )
        .returning({ id: ordersTable.id });

    if (updated.length === 0) {
        throw new Error("Order sudah diambil kurir lain");
    }
}
