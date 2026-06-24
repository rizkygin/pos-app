import type { FastifyInstance } from "fastify";
import { and, avg, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  couriersTable,
  customersTable,
  orderDetailsTable,
  ordersTable,
  outletsTable,
  productsTable,
  ratingsTable,
  usersTable,
} from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { updateRatings } from "../lib/update-ratings";

type RatingInput = { rating: number; comment: string };
type ProductRatingInput = RatingInput & {
  productId: string;
  orderDetailId: number;
};

type SubmitResult =
  | { ok: true }
  | { ok: false; error: "already_rated" | "not_found" | "unknown" };

export async function ratingRoutes(app: FastifyInstance) {
  // Customer rates the courier + the products for a delivered order
  app.post("/api/ratings/customer", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ ok: false, error: "unknown" } satisfies SubmitResult);

    const { orderId, courierRating, productRatings } = (request.body as {
      orderId?: string;
      courierRating?: RatingInput;
      productRatings?: ProductRatingInput[];
    }) ?? {};

    if (!orderId || !courierRating || !Array.isArray(productRatings)) {
      return reply.send({ ok: false, error: "not_found" } satisfies SubmitResult);
    }

    const [customer] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(eq(customersTable.user_id, session.user.id))
      .limit(1);
    if (!customer) return reply.send({ ok: false, error: "not_found" } satisfies SubmitResult);

    const [order] = await db
      .select({
        courierUserId: couriersTable.user_id,
        courierReviewCount: couriersTable.review_count,
        courierCurrentRating: couriersTable.ratings,
      })
      .from(ordersTable)
      .innerJoin(couriersTable, eq(ordersTable.courier_id, couriersTable.id))
      .where(
        and(
          eq(ordersTable.id, orderId),
          eq(ordersTable.customer_id, customer.id),
          eq(ordersTable.status, "delivered"),
        ),
      )
      .limit(1);
    if (!order) return reply.send({ ok: false, error: "not_found" } satisfies SubmitResult);

    const [firstDetail] = await db
      .select({ id: orderDetailsTable.id })
      .from(orderDetailsTable)
      .where(eq(orderDetailsTable.order_id, orderId))
      .limit(1);
    if (!firstDetail) return reply.send({ ok: false, error: "not_found" } satisfies SubmitResult);

    try {
      await db.transaction(async (tx) => {
        const allDetailIds = [firstDetail.id, ...productRatings.map((p) => p.orderDetailId)];
        const [existing] = await tx
          .select({ id: ratingsTable.id })
          .from(ratingsTable)
          .where(
            and(
              eq(ratingsTable.reviewer, session.user.id),
              inArray(ratingsTable.order_details_id, allDetailIds),
            ),
          )
          .limit(1);
        if (existing) throw new Error("already_rated");

        await tx.insert(ratingsTable).values({
          id: crypto.randomUUID(),
          order_details_id: firstDetail.id,
          ratings: String(courierRating.rating),
          comment: courierRating.comment || null,
          reviewer: session.user.id,
          reciepent: order.courierUserId,
          reciepent_as: "courier",
        });

        const courierNewRating = updateRatings({
          oldRating: Number(order.courierCurrentRating),
          reviewCount: order.courierReviewCount,
          newRating: courierRating.rating,
        });

        await tx
          .update(couriersTable)
          .set({
            ratings: String(courierNewRating.newAverage),
            review_count: courierNewRating.newReviewCount,
          })
          .where(eq(couriersTable.user_id, order.courierUserId));

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

          const [currentProductRating] = await tx
            .select({
              productRating: productsTable.ratings,
              productReviewCount: productsTable.review_count,
            })
            .from(productsTable)
            .where(eq(productsTable.id, p.productId))
            .limit(1);

          const productNewRating = updateRatings({
            oldRating: Number(currentProductRating.productRating),
            reviewCount: currentProductRating.productReviewCount,
            newRating: p.rating,
          });

          await tx
            .update(productsTable)
            .set({
              ratings: String(productNewRating.newAverage),
              review_count: productNewRating.newReviewCount,
            })
            .where(eq(productsTable.id, p.productId));
        }
      });

      return reply.send({ ok: true } satisfies SubmitResult);
    } catch (err) {
      if (err instanceof Error && err.message === "already_rated") {
        return reply.send({ ok: false, error: "already_rated" } satisfies SubmitResult);
      }
      app.log.error(err, "[submitCustomerRating]");
      return reply.send({ ok: false, error: "unknown" } satisfies SubmitResult);
    }
  });

  // Courier rates the customer + the outlet for a delivered order
  app.post("/api/ratings/courier", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ ok: false, error: "unknown" } satisfies SubmitResult);

    const { orderId, customerRating, outletRating } = (request.body as {
      orderId?: string;
      customerRating?: RatingInput;
      outletRating?: RatingInput;
    }) ?? {};

    if (!orderId || !customerRating || !outletRating) {
      return reply.send({ ok: false, error: "not_found" } satisfies SubmitResult);
    }

    const [courier] = await db
      .select({ id: couriersTable.id })
      .from(couriersTable)
      .where(eq(couriersTable.user_id, session.user.id))
      .limit(1);
    if (!courier) return reply.send({ ok: false, error: "not_found" } satisfies SubmitResult);

    const [order] = await db
      .select({
        customerUserId: usersTable.id,
        outletId: ordersTable.outlet_id,
      })
      .from(ordersTable)
      .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
      .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
      .where(
        and(
          eq(ordersTable.id, orderId),
          eq(ordersTable.courier_id, courier.id),
          eq(ordersTable.status, "delivered"),
        ),
      )
      .limit(1);
    if (!order) return reply.send({ ok: false, error: "not_found" } satisfies SubmitResult);

    const [firstDetail] = await db
      .select({ id: orderDetailsTable.id })
      .from(orderDetailsTable)
      .where(eq(orderDetailsTable.order_id, orderId))
      .limit(1);
    if (!firstDetail) return reply.send({ ok: false, error: "not_found" } satisfies SubmitResult);

    try {
      await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: ratingsTable.id })
          .from(ratingsTable)
          .where(
            and(
              eq(ratingsTable.reviewer, session.user.id),
              eq(ratingsTable.order_details_id, firstDetail.id),
            ),
          )
          .limit(1);
        if (existing) throw new Error("already_rated");

        await tx.insert(ratingsTable).values({
          id: crypto.randomUUID(),
          order_details_id: firstDetail.id,
          ratings: String(customerRating.rating),
          comment: customerRating.comment || null,
          reviewer: session.user.id,
          reciepent: order.customerUserId,
          reciepent_as: "customer",
        });

        const [custAvg] = await tx
          .select({
            value: sql<string>`ROUND(AVG(${ratingsTable.ratings})::numeric, 2)`,
          })
          .from(ratingsTable)
          .where(
            and(
              eq(ratingsTable.reciepent, order.customerUserId),
              eq(ratingsTable.reciepent_as, "customer"),
            ),
          );
        await tx
          .update(customersTable)
          .set({
            ratings: custAvg.value,
            review_count: sql`${customersTable.review_count} + 1`,
          })
          .where(eq(customersTable.user_id, order.customerUserId));

        await tx.insert(ratingsTable).values({
          id: crypto.randomUUID(),
          order_details_id: firstDetail.id,
          ratings: String(outletRating.rating),
          comment: outletRating.comment || null,
          reviewer: session.user.id,
          outlet_id: order.outletId,
          reciepent_as: "outlet",
        });

        const [outletAvg] = await tx
          .select({ value: avg(ratingsTable.ratings).as("avg") })
          .from(ratingsTable)
          .where(
            and(
              eq(ratingsTable.outlet_id, order.outletId),
              eq(ratingsTable.reciepent_as, "outlet"),
            ),
          );
        await tx
          .update(outletsTable)
          .set({
            ratings: sql`ROUND(${outletAvg.value}::numeric, 2)`,
            review_count: sql`${outletsTable.review_count} + 1`,
          })
          .where(eq(outletsTable.id, order.outletId));
      });

      return reply.send({ ok: true } satisfies SubmitResult);
    } catch (err) {
      if (err instanceof Error && err.message === "already_rated") {
        return reply.send({ ok: false, error: "already_rated" } satisfies SubmitResult);
      }
      app.log.error(err, "[submitCourierRating]");
      return reply.send({ ok: false, error: "unknown" } satisfies SubmitResult);
    }
  });
}
