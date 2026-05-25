"use server";

import { getSession } from "@/lib/auth";
import { db } from "@/src/db";
import {
    couriersTable, customersTable, orderDetailsTable,
    ordersTable, outletsTable, productsTable, ratingsTable, usersTable,
} from "@/src/db/schema";
import { and, avg, eq, inArray, sql } from "drizzle-orm";
import { updateRatings } from "@/lib/update-ratings";

type RatingInput = { rating: number; comment: string };
type ProductRatingInput = RatingInput & { productId: string; orderDetailId: number };

export type SubmitResult =
    | { ok: true }
    | { ok: false; error: "already_rated" | "not_found" | "unknown" };

export async function submitCustomerRatingAction(
    orderId: string,
    courierRating: RatingInput,
    productRatings: ProductRatingInput[]
): Promise<SubmitResult> {
    const session = await getSession();

    const [customer] = await db
        .select({ id: customersTable.id })
        .from(customersTable)
        .where(eq(customersTable.user_id, session.user.id))
        .limit(1);
    if (!customer) return { ok: false, error: "not_found" };

    const [order] = await db
        .select({ courierUserId: couriersTable.user_id, courierReviewCount: couriersTable.review_count, courierCurrentRating: couriersTable.ratings })
        .from(ordersTable)
        .innerJoin(couriersTable, eq(ordersTable.courier_id, couriersTable.id))
        .where(and(
            eq(ordersTable.id, orderId),
            eq(ordersTable.customer_id, customer.id),
            eq(ordersTable.status, "delivered")
        ))
        .limit(1);
    if (!order) return { ok: false, error: "not_found" };

    const [firstDetail] = await db
        .select({ id: orderDetailsTable.id })
        .from(orderDetailsTable)
        .where(eq(orderDetailsTable.order_id, orderId))
        .limit(1);
    if (!firstDetail) return { ok: false, error: "not_found" };

    try {
        await db.transaction(async (tx) => {
            // Guard inside transaction
            const allDetailIds = [
                firstDetail.id,
                ...productRatings.map((p) => p.orderDetailId),
            ];
            const [existing] = await tx
                .select({ id: ratingsTable.id })
                .from(ratingsTable)
                .where(and(
                    eq(ratingsTable.reviewer, session.user.id),
                    inArray(ratingsTable.order_details_id, allDetailIds)
                ))
                .limit(1);
            if (existing) throw new Error("already_rated");

            // Insert courier rating
            await tx.insert(ratingsTable).values({
                id: crypto.randomUUID(),
                order_details_id: firstDetail.id,
                ratings: String(courierRating.rating),
                comment: courierRating.comment || null,
                reviewer: session.user.id,
                reciepent: order.courierUserId,
                reciepent_as: "courier",
            });

            //Update courier ratings on couriersTable
            const courierNewRating = updateRatings({
                oldRating: Number(order.courierCurrentRating),
                reviewCount: order.courierReviewCount,
                newRating: courierRating.rating,
            });

            await tx.update(couriersTable)
                .set({ ratings: String(courierNewRating.newAverage), review_count: courierNewRating.newReviewCount })
                .where(eq(couriersTable.user_id, order.courierUserId));


            // Insert product ratings (skip products left at 0 stars)
            for (const p of productRatings) {
                if (p.rating === 0) continue;

                await tx.insert(ratingsTable).values({
                    id: crypto.randomUUID(),
                    order_details_id: p.orderDetailId,
                    ratings: String(p.rating),
                    comment: p.comment || null,
                    reviewer: session.user.id,
                    product_id: p.productId,
                    reciepent_as: "product",
                });


                //update and calculate new Rating average
                const [currentProductRating] = await tx
                .select({productRating: productsTable.ratings, productReviewCount: productsTable.review_count})
                .from(productsTable)
                .where(eq(productsTable.id, p.productId))
                .limit(1);

                const productNewRating = updateRatings({
                    oldRating: Number(currentProductRating.productRating),
                    reviewCount: currentProductRating.productReviewCount,
                    newRating: p.rating,
                });

                await tx.update(productsTable)
                    .set({
                        ratings: String(productNewRating.newAverage),
                        review_count: productNewRating.newReviewCount,
                    })
                    .where(eq(productsTable.id, p.productId));
            }
        });

        return { ok: true };
    } catch (err) {
        if (err instanceof Error && err.message === "already_rated") {
            return { ok: false, error: "already_rated" };
        }
        console.error("[submitCustomerRating]", err);
        return { ok: false, error: "unknown" };
    }
}


//TODO:: baru sampai sini lanjut lagi besok tanggal 26 may
export async function submitCourierRatingAction(
    orderId: string,
    customerRating: RatingInput,
    outletRating: RatingInput
): Promise<SubmitResult> {
    const session = await getSession();

    const [courier] = await db
        .select({ id: couriersTable.id })
        .from(couriersTable)
        .where(eq(couriersTable.user_id, session.user.id))
        .limit(1);
    if (!courier) return { ok: false, error: "not_found" };

    const [order] = await db
        .select({
            customerUserId: usersTable.id,
            outletId: ordersTable.outlet_id,
        })
        .from(ordersTable)
        .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
        .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
        .where(and(
            eq(ordersTable.id, orderId),
            eq(ordersTable.courier_id, courier.id),
            eq(ordersTable.status, "delivered")
        ))
        .limit(1);
    if (!order) return { ok: false, error: "not_found" };

    const [firstDetail] = await db
        .select({ id: orderDetailsTable.id })
        .from(orderDetailsTable)
        .where(eq(orderDetailsTable.order_id, orderId))
        .limit(1);
    if (!firstDetail) return { ok: false, error: "not_found" };

    try {
        await db.transaction(async (tx) => {
            // Guard inside transaction
            const [existing] = await tx
                .select({ id: ratingsTable.id })
                .from(ratingsTable)
                .where(and(
                    eq(ratingsTable.reviewer, session.user.id),
                    eq(ratingsTable.order_details_id, firstDetail.id)
                ))
                .limit(1);
            if (existing) throw new Error("already_rated");

            // Insert customer rating
            await tx.insert(ratingsTable).values({
                id: crypto.randomUUID(),
                order_details_id: firstDetail.id,
                ratings: String(customerRating.rating),
                comment: customerRating.comment || null,
                reviewer: session.user.id,
                reciepent: order.customerUserId,
                reciepent_as: "customer",
            });

            // Recalculate customer avg
            const [custAvg] = await tx
                .select({ value: sql<string>`ROUND(AVG(${ratingsTable.ratings})::numeric, 2)` })
                .from(ratingsTable)
                .where(and(
                    eq(ratingsTable.reciepent, order.customerUserId),
                    eq(ratingsTable.reciepent_as, "customer")
                ));
            await tx.update(customersTable)
                .set({ ratings: custAvg.value })
                .where(eq(customersTable.user_id, order.customerUserId));

            // Insert outlet rating
            await tx.insert(ratingsTable).values({
                id: crypto.randomUUID(),
                order_details_id: firstDetail.id,
                ratings: String(outletRating.rating),
                comment: outletRating.comment || null,
                reviewer: session.user.id,
                outlet_id: order.outletId,
                reciepent_as: "outlet",
            });

            // Recalculate outlet avg
            const [outletAvg] = await tx
                .select({ value: avg(ratingsTable.ratings).as("avg") })
                .from(ratingsTable)
                .where(and(
                    eq(ratingsTable.outlet_id, order.outletId),
                    eq(ratingsTable.reciepent_as, "outlet")
                ));
            await tx.update(outletsTable)
                .set({
                    ratings: sql`ROUND(${outletAvg.value}::numeric, 2)`,
                    review_count: sql`${outletsTable.review_count} + 1`,
                })
                .where(eq(outletsTable.id, order.outletId));
        });

        return { ok: true };
    } catch (err) {
        if (err instanceof Error && err.message === "already_rated") {
            return { ok: false, error: "already_rated" };
        }
        console.error("[submitCourierRating]", err);
        return { ok: false, error: "unknown" };
    }
}
