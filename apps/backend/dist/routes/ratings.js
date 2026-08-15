"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ratingRoutes = ratingRoutes;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../auth");
const web_headers_1 = require("../lib/web-headers");
const update_ratings_1 = require("../lib/update-ratings");
async function ratingRoutes(app) {
    // Data for the courier's "rate the customer + outlet" page, with all the
    // page guards (must be this courier's delivered order, must have details, must
    // not be already rated). { ok: false } => the page redirects to /dashboard/order.
    app.get("/api/ratings/courier-page", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ ok: false });
        const { orderId } = request.query;
        if (!orderId)
            return reply.send({ ok: false });
        const [courier] = await db_1.db
            .select({ id: schema_1.couriersTable.id })
            .from(schema_1.couriersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, session.user.id))
            .limit(1);
        if (!courier)
            return reply.send({ ok: false });
        const [order] = await db_1.db
            .select({
            customerName: schema_1.usersTable.name,
            customerPhone: schema_1.usersTable.phone,
            outletName: schema_1.outletsTable.name,
            outletAddress: schema_1.outletsTable.address,
        })
            .from(schema_1.ordersTable)
            .innerJoin(schema_1.customersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, schema_1.customersTable.id))
            .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, schema_1.usersTable.id))
            .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, schema_1.outletsTable.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ordersTable.id, orderId), (0, drizzle_orm_1.eq)(schema_1.ordersTable.courier_id, courier.id), (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "delivered")))
            .limit(1);
        if (!order)
            return reply.send({ ok: false });
        const [firstDetail] = await db_1.db
            .select({ id: schema_1.orderDetailsTable.id })
            .from(schema_1.orderDetailsTable)
            .where((0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, orderId))
            .limit(1);
        if (!firstDetail)
            return reply.send({ ok: false });
        const [existingRating] = await db_1.db
            .select({ id: schema_1.ratingsTable.id })
            .from(schema_1.ratingsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ratingsTable.reviewer, session.user.id), (0, drizzle_orm_1.eq)(schema_1.ratingsTable.order_details_id, firstDetail.id)))
            .limit(1);
        if (existingRating)
            return reply.send({ ok: false });
        return reply.send({ ok: true, order });
    });
    // Data for the customer's "rate the courier + products" page, with the same
    // guard pattern. { ok: false } => the page redirects to /dashboard/order.
    app.get("/api/ratings/customer-page", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ ok: false });
        const { orderId } = request.query;
        if (!orderId)
            return reply.send({ ok: false });
        const [customer] = await db_1.db
            .select({ id: schema_1.customersTable.id })
            .from(schema_1.customersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, session.user.id))
            .limit(1);
        if (!customer)
            return reply.send({ ok: false });
        const [order] = await db_1.db
            .select({
            courierName: schema_1.usersTable.name,
            vehicleType: schema_1.couriersTable.vehicle_type,
            vehiclePlate: schema_1.couriersTable.vehicle_plate,
            createdAt: schema_1.ordersTable.createdAt,
        })
            .from(schema_1.ordersTable)
            .innerJoin(schema_1.couriersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.courier_id, schema_1.couriersTable.id))
            .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, schema_1.usersTable.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ordersTable.id, orderId), (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, customer.id), (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "delivered")))
            .limit(1);
        if (!order)
            return reply.send({ ok: false });
        // Rating closes 7 days after the order was made.
        const RATING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
        if (order.createdAt && Date.now() - new Date(order.createdAt).getTime() > RATING_WINDOW_MS) {
            return reply.send({ ok: false });
        }
        const products = await db_1.db
            .select({
            orderDetailId: schema_1.orderDetailsTable.id,
            productId: schema_1.productsTable.id,
            name: schema_1.productsTable.product_name,
            quantity: schema_1.orderDetailsTable.quantity,
        })
            .from(schema_1.orderDetailsTable)
            .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, schema_1.productsTable.id))
            .where((0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, orderId));
        if (products.length === 0)
            return reply.send({ ok: false });
        const [existingRating] = await db_1.db
            .select({ id: schema_1.ratingsTable.id })
            .from(schema_1.ratingsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ratingsTable.reviewer, session.user.id), (0, drizzle_orm_1.eq)(schema_1.ratingsTable.order_details_id, products[0].orderDetailId)))
            .limit(1);
        if (existingRating)
            return reply.send({ ok: false });
        return reply.send({ ok: true, order, products });
    });
    // Customer rates the courier + the products for a delivered order
    app.post("/api/ratings/customer", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ ok: false, error: "unknown" });
        const { orderId, courierRating, productRatings } = request.body ?? {};
        if (!orderId || !courierRating || !Array.isArray(productRatings)) {
            return reply.send({ ok: false, error: "not_found" });
        }
        const [customer] = await db_1.db
            .select({ id: schema_1.customersTable.id })
            .from(schema_1.customersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, session.user.id))
            .limit(1);
        if (!customer)
            return reply.send({ ok: false, error: "not_found" });
        const [order] = await db_1.db
            .select({
            courierUserId: schema_1.couriersTable.user_id,
            courierReviewCount: schema_1.couriersTable.review_count,
            courierCurrentRating: schema_1.couriersTable.ratings,
            createdAt: schema_1.ordersTable.createdAt,
        })
            .from(schema_1.ordersTable)
            .innerJoin(schema_1.couriersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.courier_id, schema_1.couriersTable.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ordersTable.id, orderId), (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, customer.id), (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "delivered")))
            .limit(1);
        if (!order)
            return reply.send({ ok: false, error: "not_found" });
        // Rating closes 7 days after the order was made.
        const RATING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
        if (order.createdAt && Date.now() - new Date(order.createdAt).getTime() > RATING_WINDOW_MS) {
            return reply.send({ ok: false, error: "not_found" });
        }
        const [firstDetail] = await db_1.db
            .select({ id: schema_1.orderDetailsTable.id })
            .from(schema_1.orderDetailsTable)
            .where((0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, orderId))
            .limit(1);
        if (!firstDetail)
            return reply.send({ ok: false, error: "not_found" });
        try {
            await db_1.db.transaction(async (tx) => {
                const allDetailIds = [firstDetail.id, ...productRatings.map((p) => p.orderDetailId)];
                const [existing] = await tx
                    .select({ id: schema_1.ratingsTable.id })
                    .from(schema_1.ratingsTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ratingsTable.reviewer, session.user.id), (0, drizzle_orm_1.inArray)(schema_1.ratingsTable.order_details_id, allDetailIds)))
                    .limit(1);
                if (existing)
                    throw new Error("already_rated");
                await tx.insert(schema_1.ratingsTable).values({
                    id: crypto.randomUUID(),
                    order_details_id: firstDetail.id,
                    ratings: String(courierRating.rating),
                    comment: courierRating.comment || null,
                    reviewer: session.user.id,
                    reciepent: order.courierUserId,
                    reciepent_as: "courier",
                });
                const courierNewRating = (0, update_ratings_1.updateRatings)({
                    oldRating: Number(order.courierCurrentRating),
                    reviewCount: order.courierReviewCount,
                    newRating: courierRating.rating,
                });
                await tx
                    .update(schema_1.couriersTable)
                    .set({
                    ratings: String(courierNewRating.newAverage),
                    review_count: courierNewRating.newReviewCount,
                })
                    .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, order.courierUserId));
                for (const p of productRatings) {
                    if (p.rating === 0)
                        continue;
                    await tx.insert(schema_1.ratingsTable).values({
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
                        productRating: schema_1.productsTable.ratings,
                        productReviewCount: schema_1.productsTable.review_count,
                    })
                        .from(schema_1.productsTable)
                        .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, p.productId))
                        .limit(1);
                    const productNewRating = (0, update_ratings_1.updateRatings)({
                        oldRating: Number(currentProductRating.productRating),
                        reviewCount: currentProductRating.productReviewCount,
                        newRating: p.rating,
                    });
                    await tx
                        .update(schema_1.productsTable)
                        .set({
                        ratings: String(productNewRating.newAverage),
                        review_count: productNewRating.newReviewCount,
                    })
                        .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, p.productId));
                }
            });
            return reply.send({ ok: true });
        }
        catch (err) {
            if (err instanceof Error && err.message === "already_rated") {
                return reply.send({ ok: false, error: "already_rated" });
            }
            app.log.error(err, "[submitCustomerRating]");
            return reply.send({ ok: false, error: "unknown" });
        }
    });
    // Data for the customer's SERVICE rating page: rate the provider (owner) +
    // the service product(s). Same guards as the delivery flow but for a delivered
    // service order (no courier — the owner is the reviewee).
    app.get("/api/ratings/service-page", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.send({ ok: false });
        const { orderId } = request.query;
        if (!orderId)
            return reply.send({ ok: false });
        const [customer] = await db_1.db
            .select({ id: schema_1.customersTable.id })
            .from(schema_1.customersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, session.user.id))
            .limit(1);
        if (!customer)
            return reply.send({ ok: false });
        const [order] = await db_1.db
            .select({
            outletName: schema_1.outletsTable.name,
            ownerName: schema_1.usersTable.name,
            createdAt: schema_1.ordersTable.createdAt,
        })
            .from(schema_1.ordersTable)
            .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, schema_1.outletsTable.id))
            .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.outletsTable.user_id, schema_1.usersTable.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ordersTable.id, orderId), (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, customer.id), 
        // Both courier-less lanes rate the outlet here: there is no courier
        // to rate, so the service rating page is the only path they have.
        (0, drizzle_orm_1.inArray)(schema_1.ordersTable.fulfillment, ["service", "materials"]), (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "delivered")))
            .limit(1);
        if (!order)
            return reply.send({ ok: false });
        const RATING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
        if (order.createdAt && Date.now() - new Date(order.createdAt).getTime() > RATING_WINDOW_MS) {
            return reply.send({ ok: false });
        }
        const products = await db_1.db
            .select({
            orderDetailId: schema_1.orderDetailsTable.id,
            productId: schema_1.productsTable.id,
            name: schema_1.productsTable.product_name,
            quantity: schema_1.orderDetailsTable.quantity,
        })
            .from(schema_1.orderDetailsTable)
            .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, schema_1.productsTable.id))
            .where((0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, orderId));
        if (products.length === 0)
            return reply.send({ ok: false });
        const [existingRating] = await db_1.db
            .select({ id: schema_1.ratingsTable.id })
            .from(schema_1.ratingsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ratingsTable.reviewer, session.user.id), (0, drizzle_orm_1.eq)(schema_1.ratingsTable.order_details_id, products[0].orderDetailId)))
            .limit(1);
        if (existingRating)
            return reply.send({ ok: false });
        return reply.send({
            ok: true,
            order: { outletName: order.outletName, ownerName: order.ownerName },
            products,
        });
    });
    // Customer rates the provider (owner) + the service product(s) for a delivered
    // service order. The owner rating is recorded as the outlet's rating.
    app.post("/api/ratings/service", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ ok: false, error: "unknown" });
        const { orderId, ownerRating, productRatings } = request.body ?? {};
        if (!orderId || !ownerRating || !Array.isArray(productRatings)) {
            return reply.send({ ok: false, error: "not_found" });
        }
        const [customer] = await db_1.db
            .select({ id: schema_1.customersTable.id })
            .from(schema_1.customersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, session.user.id))
            .limit(1);
        if (!customer)
            return reply.send({ ok: false, error: "not_found" });
        const [order] = await db_1.db
            .select({
            outletId: schema_1.ordersTable.outlet_id,
            ownerUserId: schema_1.outletsTable.user_id,
            createdAt: schema_1.ordersTable.createdAt,
        })
            .from(schema_1.ordersTable)
            .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, schema_1.outletsTable.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ordersTable.id, orderId), (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, customer.id), 
        // Both courier-less lanes rate the outlet here: there is no courier
        // to rate, so the service rating page is the only path they have.
        (0, drizzle_orm_1.inArray)(schema_1.ordersTable.fulfillment, ["service", "materials"]), (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "delivered")))
            .limit(1);
        if (!order)
            return reply.send({ ok: false, error: "not_found" });
        const RATING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
        if (order.createdAt && Date.now() - new Date(order.createdAt).getTime() > RATING_WINDOW_MS) {
            return reply.send({ ok: false, error: "not_found" });
        }
        const [firstDetail] = await db_1.db
            .select({ id: schema_1.orderDetailsTable.id })
            .from(schema_1.orderDetailsTable)
            .where((0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, orderId))
            .limit(1);
        if (!firstDetail)
            return reply.send({ ok: false, error: "not_found" });
        try {
            await db_1.db.transaction(async (tx) => {
                const allDetailIds = [firstDetail.id, ...productRatings.map((p) => p.orderDetailId)];
                const [existing] = await tx
                    .select({ id: schema_1.ratingsTable.id })
                    .from(schema_1.ratingsTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ratingsTable.reviewer, session.user.id), (0, drizzle_orm_1.inArray)(schema_1.ratingsTable.order_details_id, allDetailIds)))
                    .limit(1);
                if (existing)
                    throw new Error("already_rated");
                // Owner rating -> recorded as the outlet's rating (the owner represents
                // the outlet/provider).
                await tx.insert(schema_1.ratingsTable).values({
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
                    .select({ value: (0, drizzle_orm_1.avg)(schema_1.ratingsTable.ratings).as("avg") })
                    .from(schema_1.ratingsTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ratingsTable.outlet_id, order.outletId), (0, drizzle_orm_1.eq)(schema_1.ratingsTable.reciepent_as, "outlet")));
                await tx
                    .update(schema_1.outletsTable)
                    .set({
                    ratings: (0, drizzle_orm_1.sql) `ROUND(${outletAvg.value}::numeric, 2)`,
                    review_count: (0, drizzle_orm_1.sql) `${schema_1.outletsTable.review_count} + 1`,
                })
                    .where((0, drizzle_orm_1.eq)(schema_1.outletsTable.id, order.outletId));
                for (const p of productRatings) {
                    if (p.rating === 0)
                        continue;
                    await tx.insert(schema_1.ratingsTable).values({
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
                        productRating: schema_1.productsTable.ratings,
                        productReviewCount: schema_1.productsTable.review_count,
                    })
                        .from(schema_1.productsTable)
                        .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, p.productId))
                        .limit(1);
                    const productNewRating = (0, update_ratings_1.updateRatings)({
                        oldRating: Number(currentProductRating.productRating),
                        reviewCount: currentProductRating.productReviewCount,
                        newRating: p.rating,
                    });
                    await tx
                        .update(schema_1.productsTable)
                        .set({
                        ratings: String(productNewRating.newAverage),
                        review_count: productNewRating.newReviewCount,
                    })
                        .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, p.productId));
                }
            });
            return reply.send({ ok: true });
        }
        catch (err) {
            if (err instanceof Error && err.message === "already_rated") {
                return reply.send({ ok: false, error: "already_rated" });
            }
            app.log.error(err, "[submitServiceRating]");
            return reply.send({ ok: false, error: "unknown" });
        }
    });
    // Courier rates the customer + the outlet for a delivered order
    app.post("/api/ratings/courier", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ ok: false, error: "unknown" });
        const { orderId, customerRating, outletRating } = request.body ?? {};
        if (!orderId || !customerRating || !outletRating) {
            return reply.send({ ok: false, error: "not_found" });
        }
        const [courier] = await db_1.db
            .select({ id: schema_1.couriersTable.id })
            .from(schema_1.couriersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, session.user.id))
            .limit(1);
        if (!courier)
            return reply.send({ ok: false, error: "not_found" });
        const [order] = await db_1.db
            .select({
            customerUserId: schema_1.usersTable.id,
            outletId: schema_1.ordersTable.outlet_id,
        })
            .from(schema_1.ordersTable)
            .innerJoin(schema_1.customersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, schema_1.customersTable.id))
            .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, schema_1.usersTable.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ordersTable.id, orderId), (0, drizzle_orm_1.eq)(schema_1.ordersTable.courier_id, courier.id), (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "delivered")))
            .limit(1);
        if (!order)
            return reply.send({ ok: false, error: "not_found" });
        const [firstDetail] = await db_1.db
            .select({ id: schema_1.orderDetailsTable.id })
            .from(schema_1.orderDetailsTable)
            .where((0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, orderId))
            .limit(1);
        if (!firstDetail)
            return reply.send({ ok: false, error: "not_found" });
        try {
            await db_1.db.transaction(async (tx) => {
                const [existing] = await tx
                    .select({ id: schema_1.ratingsTable.id })
                    .from(schema_1.ratingsTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ratingsTable.reviewer, session.user.id), (0, drizzle_orm_1.eq)(schema_1.ratingsTable.order_details_id, firstDetail.id)))
                    .limit(1);
                if (existing)
                    throw new Error("already_rated");
                await tx.insert(schema_1.ratingsTable).values({
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
                    value: (0, drizzle_orm_1.sql) `ROUND(AVG(${schema_1.ratingsTable.ratings})::numeric, 2)`,
                })
                    .from(schema_1.ratingsTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ratingsTable.reciepent, order.customerUserId), (0, drizzle_orm_1.eq)(schema_1.ratingsTable.reciepent_as, "customer")));
                await tx
                    .update(schema_1.customersTable)
                    .set({
                    ratings: custAvg.value,
                    review_count: (0, drizzle_orm_1.sql) `${schema_1.customersTable.review_count} + 1`,
                })
                    .where((0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, order.customerUserId));
                await tx.insert(schema_1.ratingsTable).values({
                    id: crypto.randomUUID(),
                    order_details_id: firstDetail.id,
                    ratings: String(outletRating.rating),
                    comment: outletRating.comment || null,
                    reviewer: session.user.id,
                    outlet_id: order.outletId,
                    reciepent_as: "outlet",
                });
                const [outletAvg] = await tx
                    .select({ value: (0, drizzle_orm_1.avg)(schema_1.ratingsTable.ratings).as("avg") })
                    .from(schema_1.ratingsTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ratingsTable.outlet_id, order.outletId), (0, drizzle_orm_1.eq)(schema_1.ratingsTable.reciepent_as, "outlet")));
                await tx
                    .update(schema_1.outletsTable)
                    .set({
                    ratings: (0, drizzle_orm_1.sql) `ROUND(${outletAvg.value}::numeric, 2)`,
                    review_count: (0, drizzle_orm_1.sql) `${schema_1.outletsTable.review_count} + 1`,
                })
                    .where((0, drizzle_orm_1.eq)(schema_1.outletsTable.id, order.outletId));
            });
            return reply.send({ ok: true });
        }
        catch (err) {
            if (err instanceof Error && err.message === "already_rated") {
                return reply.send({ ok: false, error: "already_rated" });
            }
            app.log.error(err, "[submitCourierRating]");
            return reply.send({ ok: false, error: "unknown" });
        }
    });
}
