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
import { eq, and, isNull } from "drizzle-orm";
import { getCourierAvailability } from "@/lib/utils/courier-availability";
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

    const availability = await getCourierAvailability(courier.id);

    if (!availability.canReceiveOrder) {
        return NextResponse.json({
            success: true,
            orders: [],
            canReceiveOrder: false,
            reason: !availability.isOnline ? "offline" : "busy",
            ratingStatus: availability.ratingStatus,
            delaySeconds: availability.delaySeconds,
        });
    }

    const orders = await db
        .select({
            orderId: ordersTable.id,
            customerName: usersTable.name,
            customerPhone: usersTable.phone,
            deliveryFee: ordersTable.delivery_fee,
            note: ordersTable.note,
            createdAt: ordersTable.createdAt,
            outletName: outletsTable.name,
            outletAddress: outletsTable.address,
        })
        .from(ordersTable)
        .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
        .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
        .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
        .where(and(eq(ordersTable.status, "confirmed"), isNull(ordersTable.courier_id)))
        .orderBy(ordersTable.createdAt);

    const visibleOrders = availability.delaySeconds > 0
        ? orders.filter((order) => {
            const ageMs = Date.now() - new Date(order.createdAt!).getTime();
            return ageMs >= availability.delaySeconds * 1000;
        })
        : orders;

    const ordersWithItems = await attachOrderItems(visibleOrders);

    return NextResponse.json({
        success: true,
        orders: ordersWithItems,
        canReceiveOrder: true,
        reason: null,
        ratingStatus: availability.ratingStatus,
        delaySeconds: availability.delaySeconds,
    });
};
