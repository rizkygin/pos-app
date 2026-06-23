import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/src/db";
import {
    couriersTable, customersTable, orderDetailsTable,
    ordersTable, outletsTable, productsTable, ratingsTable, usersTable,
} from "@/src/db/schema";
import { and, eq } from "drizzle-orm";
import { RatingSubmitForm } from "@/components/ratings/rating-submit-form";
import { submitCustomerRatingAction } from "@/app/dashboard/ratings/actions";

export default async function CustomerRatingPage({
    params,
}: {
    params: Promise<{ orderId: string }>;
}) {
    const { orderId } = await params;
    const session = await getSession();

    const [customer] = await db
        .select({ id: customersTable.id })
        .from(customersTable)
        .where(eq(customersTable.user_id, session.user.id))
        .limit(1);
    if (!customer) redirect("/dashboard/order");

    // Fetch order + courier info — only show if order is delivered and belongs to this customer
    const [order] = await db
        .select({
            courierName: usersTable.name,
            vehicleType: couriersTable.vehicle_type,
            vehiclePlate: couriersTable.vehicle_plate,
        })
        .from(ordersTable)
        .innerJoin(couriersTable, eq(ordersTable.courier_id, couriersTable.id))
        .innerJoin(usersTable, eq(couriersTable.user_id, usersTable.id))
        .where(and(
            eq(ordersTable.id, orderId),
            eq(ordersTable.customer_id, customer.id),
            eq(ordersTable.status, "delivered")
        ))
        .limit(1);
    if (!order) redirect("/dashboard/order");

    // Fetch products in this order
    const products = await db
        .select({
            orderDetailId: orderDetailsTable.id,
            productId: productsTable.id,
            name: productsTable.product_name,
            quantity: orderDetailsTable.quantity,
        })
        .from(orderDetailsTable)
        .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
        .where(eq(orderDetailsTable.order_id, orderId));
    if (products.length === 0) redirect("/dashboard/order");

    // Page-level guard: redirect if already rated
    const [existingRating] = await db
        .select({ id: ratingsTable.id })
        .from(ratingsTable)
        .where(and(
            eq(ratingsTable.reviewer, session.user.id),
            eq(ratingsTable.order_details_id, products[0].orderDetailId)
        ))
        .limit(1);
    if (existingRating) redirect("/dashboard/order");

    // Inline server action — captures orderId from closure
    async function handleSubmit(
        courierRating: { rating: number; comment: string },
        productRatings: { productId: string; orderDetailId: number; rating: number; comment: string }[]
    ) {
        "use server";
        return submitCustomerRatingAction(orderId, courierRating, productRatings);
    }

    return (
        <main className="px-4 pb-12">
            <RatingSubmitForm
                userType="customer"
                orderId={orderId}
                courier={{
                    name: order.courierName ?? "Kurir",
                    vehicleType: order.vehicleType === "motorcycle" ? "Motor" : "Mobil",
                    vehiclePlate: order.vehiclePlate,
                }}
                products={products.map((p) => ({
                    id: p.productId,
                    orderDetailId: p.orderDetailId,
                    name: p.name,
                    quantity: p.quantity,
                }))}
                onSubmit={handleSubmit}
            />
        </main>
    );
}
