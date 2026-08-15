import type { FastifyInstance } from "fastify";
import { and, asc, avg, eq, inArray, sql } from "drizzle-orm";
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
import { orderNotDeleted } from "../lib/order-scope";
import { updateRatings } from "../lib/update-ratings";

type RatingInput = { rating: number; comment: string };
type ProductRatingInput = RatingInput & {
  productId: string;
  orderDetailId: number;
};

type SubmitResult =
  | { ok: true }
  | { ok: false; error: "already_rated" | "not_found" | "unknown" };

/**
 * Has this person already rated this order?
 *
 * Asked of the WHOLE order, not of one hand-picked order detail. A rating row
 * hangs off an order_details id, and the courier/customer rating is anchored to
 * whichever detail the writer happened to see first — an unordered LIMIT 1,
 * which Postgres is free to answer differently from one query plan to the next.
 * Checking one specific detail therefore missed ratings that exist on a sibling
 * row, and the customer was sent back to rate an order they had already rated
 * (the submit then failed with already_rated). Any rating by this reviewer
 * against any detail of this order settles the question.
 */
async function alreadyRatedOrder(reviewerUserId: string, orderId: string) {
  const [existing] = await db
    .select({ id: ratingsTable.id })
    .from(ratingsTable)
    .innerJoin(orderDetailsTable, eq(ratingsTable.order_details_id, orderDetailsTable.id))
    .where(
      and(
        eq(ratingsTable.reviewer, reviewerUserId),
        eq(orderDetailsTable.order_id, orderId),
      ),
    )
    .limit(1);
  return !!existing;
}

/**
 * The order detail the courier/outlet rating hangs off.
 *
 * Ordered, unlike the reads it used to mirror: the anchor has to be the same row
 * every time or the "already rated" question above has no stable answer.
 */
async function ratingAnchorDetail(orderId: string) {
  const [detail] = await db
    .select({ id: orderDetailsTable.id })
    .from(orderDetailsTable)
    .where(eq(orderDetailsTable.order_id, orderId))
    .orderBy(asc(orderDetailsTable.id))
    .limit(1);
  return detail ?? null;
}

export async function ratingRoutes(app: FastifyInstance) {
  // Data for the courier's "rate the customer + outlet" page, with all the
  // page guards (must be this courier's delivered order, must have details, must
  // not be already rated). { ok: false } => the page redirects to /dashboard/order.
  app.get("/api/ratings/courier-page", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ ok: false });

    const { orderId } = request.query as { orderId?: string };
    if (!orderId) return reply.send({ ok: false });

    const [courier] = await db
      .select({ id: couriersTable.id })
      .from(couriersTable)
      .where(eq(couriersTable.user_id, session.user.id))
      .limit(1);
    if (!courier) return reply.send({ ok: false });

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
      .where(
        and(
          orderNotDeleted,
          eq(ordersTable.id, orderId),
          eq(ordersTable.courier_id, courier.id),
          eq(ordersTable.status, "delivered"),
        ),
      )
      .limit(1);
    if (!order) return reply.send({ ok: false });

    if (!(await ratingAnchorDetail(orderId))) return reply.send({ ok: false });
    if (await alreadyRatedOrder(session.user.id, orderId)) return reply.send({ ok: false });

    return reply.send({ ok: true, order });
  });

  // Data for the customer's "rate the courier + products" page, with the same
  // guard pattern. { ok: false } => the page redirects to /dashboard/order.
  app.get("/api/ratings/customer-page", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ ok: false });

    const { orderId } = request.query as { orderId?: string };
    if (!orderId) return reply.send({ ok: false });

    const [customer] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(eq(customersTable.user_id, session.user.id))
      .limit(1);
    if (!customer) return reply.send({ ok: false });

    const [order] = await db
      .select({
        courierName: usersTable.name,
        vehicleType: couriersTable.vehicle_type,
        vehiclePlate: couriersTable.vehicle_plate,
        createdAt: ordersTable.createdAt,
      })
      .from(ordersTable)
      .innerJoin(couriersTable, eq(ordersTable.courier_id, couriersTable.id))
      .innerJoin(usersTable, eq(couriersTable.user_id, usersTable.id))
      .where(
        and(
          orderNotDeleted,
          eq(ordersTable.id, orderId),
          eq(ordersTable.customer_id, customer.id),
          eq(ordersTable.status, "delivered"),
        ),
      )
      .limit(1);
    if (!order) return reply.send({ ok: false });

    // Rating closes 7 days after the order was made.
    const RATING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
    if (order.createdAt && Date.now() - new Date(order.createdAt).getTime() > RATING_WINDOW_MS) {
      return reply.send({ ok: false });
    }

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
    if (products.length === 0) return reply.send({ ok: false });

    if (await alreadyRatedOrder(session.user.id, orderId)) return reply.send({ ok: false });

    return reply.send({ ok: true, order, products });
  });

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
        createdAt: ordersTable.createdAt,
      })
      .from(ordersTable)
      .innerJoin(couriersTable, eq(ordersTable.courier_id, couriersTable.id))
      .where(
        and(
          orderNotDeleted,
          eq(ordersTable.id, orderId),
          eq(ordersTable.customer_id, customer.id),
          eq(ordersTable.status, "delivered"),
        ),
      )
      .limit(1);
    if (!order) return reply.send({ ok: false, error: "not_found" } satisfies SubmitResult);

    // Rating closes 7 days after the order was made.
    const RATING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
    if (order.createdAt && Date.now() - new Date(order.createdAt).getTime() > RATING_WINDOW_MS) {
      return reply.send({ ok: false, error: "not_found" } satisfies SubmitResult);
    }

    const firstDetail = await ratingAnchorDetail(orderId);
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

  // Data for the customer's SERVICE rating page: rate the provider (owner) +
  // the service product(s). Same guards as the delivery flow but for a delivered
  // service order (no courier — the owner is the reviewee).
  app.get("/api/ratings/service-page", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.send({ ok: false });

    const { orderId } = request.query as { orderId?: string };
    if (!orderId) return reply.send({ ok: false });

    const [customer] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(eq(customersTable.user_id, session.user.id))
      .limit(1);
    if (!customer) return reply.send({ ok: false });

    const [order] = await db
      .select({
        outletName: outletsTable.name,
        ownerName: usersTable.name,
        createdAt: ordersTable.createdAt,
      })
      .from(ordersTable)
      .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
      .innerJoin(usersTable, eq(outletsTable.user_id, usersTable.id))
      .where(
        and(
          orderNotDeleted,
          eq(ordersTable.id, orderId),
          eq(ordersTable.customer_id, customer.id),
          // Both courier-less lanes rate the outlet here: there is no courier
          // to rate, so the service rating page is the only path they have.
          inArray(ordersTable.fulfillment, ["service", "materials"]),
          eq(ordersTable.status, "delivered"),
        ),
      )
      .limit(1);
    if (!order) return reply.send({ ok: false });

    const RATING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
    if (order.createdAt && Date.now() - new Date(order.createdAt).getTime() > RATING_WINDOW_MS) {
      return reply.send({ ok: false });
    }

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
    if (products.length === 0) return reply.send({ ok: false });

    if (await alreadyRatedOrder(session.user.id, orderId)) return reply.send({ ok: false });

    return reply.send({
      ok: true,
      order: { outletName: order.outletName, ownerName: order.ownerName },
      products,
    });
  });

  // Customer rates the provider (owner) + the service product(s) for a delivered
  // service order. The owner rating is recorded as the outlet's rating.
  app.post("/api/ratings/service", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ ok: false, error: "unknown" } satisfies SubmitResult);

    const { orderId, ownerRating, productRatings } = (request.body as {
      orderId?: string;
      ownerRating?: RatingInput;
      productRatings?: ProductRatingInput[];
    }) ?? {};

    if (!orderId || !ownerRating || !Array.isArray(productRatings)) {
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
        outletId: ordersTable.outlet_id,
        ownerUserId: outletsTable.user_id,
        createdAt: ordersTable.createdAt,
      })
      .from(ordersTable)
      .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
      .where(
        and(
          orderNotDeleted,
          eq(ordersTable.id, orderId),
          eq(ordersTable.customer_id, customer.id),
          // Both courier-less lanes rate the outlet here: there is no courier
          // to rate, so the service rating page is the only path they have.
          inArray(ordersTable.fulfillment, ["service", "materials"]),
          eq(ordersTable.status, "delivered"),
        ),
      )
      .limit(1);
    if (!order) return reply.send({ ok: false, error: "not_found" } satisfies SubmitResult);

    const RATING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
    if (order.createdAt && Date.now() - new Date(order.createdAt).getTime() > RATING_WINDOW_MS) {
      return reply.send({ ok: false, error: "not_found" } satisfies SubmitResult);
    }

    const firstDetail = await ratingAnchorDetail(orderId);
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

        // Owner rating -> recorded as the outlet's rating (the owner represents
        // the outlet/provider).
        await tx.insert(ratingsTable).values({
          id: crypto.randomUUID(),
          order_details_id: firstDetail.id,
          ratings: String(ownerRating.rating),
          comment: ownerRating.comment || null,
          reviewer: session.user.id,
          reciepent: order.ownerUserId,
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
      app.log.error(err, "[submitServiceRating]");
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
          orderNotDeleted,
          eq(ordersTable.id, orderId),
          eq(ordersTable.courier_id, courier.id),
          eq(ordersTable.status, "delivered"),
        ),
      )
      .limit(1);
    if (!order) return reply.send({ ok: false, error: "not_found" } satisfies SubmitResult);

    const firstDetail = await ratingAnchorDetail(orderId);
    if (!firstDetail) return reply.send({ ok: false, error: "not_found" } satisfies SubmitResult);

    try {
      await db.transaction(async (tx) => {
        // Order-wide, matching the page guard — a rating written against a
        // different detail of this order still means "already rated". Kept
        // inside the transaction so two taps cannot both pass it.
        const [existing] = await tx
          .select({ id: ratingsTable.id })
          .from(ratingsTable)
          .innerJoin(
            orderDetailsTable,
            eq(ratingsTable.order_details_id, orderDetailsTable.id),
          )
          .where(
            and(
              eq(ratingsTable.reviewer, session.user.id),
              eq(orderDetailsTable.order_id, orderId),
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
