import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/src/db";
import {
    couriersTable, customersTable, orderDetailsTable,
    ordersTable, outletsTable, ratingsTable, usersTable,
} from "@/src/db/schema";
import { and, eq } from "drizzle-orm";
import { RatingSubmitForm } from "@/components/ratings/rating-submit-form";
import { submitCourierRatingAction } from "@/app/dashboard/ratings/actions";

export default async function CourierRatingPage({
    params,
}: {
    params: Promise<{ orderId: string }>;
}) {
    const { orderId } = await params;
    const session = await getSession();

    const [courier] = await db
        .select({ id: couriersTable.id })
        .from(couriersTable)
        .where(eq(couriersTable.user_id, session.user.id))
        .limit(1);
    if (!courier) redirect("/dashboard/order");

    // Fetch order + customer + outlet info — only if delivered and assigned to this courier
    const [order] = await db
        .select({
            customerName: usersTable.name,
            customerPhone: usersTable.phone,
            outletName: outletsTable.name,
            outletAddress: outletsTable.address,
        })
        .from(ordersTable)
        .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
        .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
        .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
        .where(and(
            eq(ordersTable.id, orderId),
            eq(ordersTable.courier_id, courier.id),
            eq(ordersTable.status, "delivered")
        ))
        .limit(1);
    if (!order) redirect("/dashboard/order");

    // Fetch first orderDetail as guard anchor
    const [firstDetail] = await db
        .select({ id: orderDetailsTable.id })
        .from(orderDetailsTable)
        .where(eq(orderDetailsTable.order_id, orderId))
        .limit(1);
    if (!firstDetail) redirect("/dashboard/order");

    // Page-level guard: redirect if already rated
    const [existingRating] = await db
        .select({ id: ratingsTable.id })
        .from(ratingsTable)
        .where(and(
            eq(ratingsTable.reviewer, session.user.id),
            eq(ratingsTable.order_details_id, firstDetail.id)
        ))
        .limit(1);
    if (existingRating) redirect("/dashboard/order");

    // Inline server action — captures orderId from closure
    async function handleSubmit(
        customerRating: { rating: number; comment: string },
        outletRating: { rating: number; comment: string }
    ) {
        "use server";
        return submitCourierRatingAction(orderId, customerRating, outletRating);
    }

    return (
        <main className="px-4 pb-12">
            <RatingSubmitForm
                userType="courier"
                orderId={orderId}
                customer={{
                    name: order.customerName ?? "Pelanggan",
                    phone: order.customerPhone ?? null,
                }}
                outlet={{
                    name: order.outletName,
                    address: order.outletAddress,
                }}
                onSubmit={handleSubmit}
            />
        </main>
    );
}
