"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.customerRoutes = customerRoutes;
const pg_core_1 = require("drizzle-orm/pg-core");
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../auth");
const web_headers_1 = require("../lib/web-headers");
const order_scope_1 = require("../lib/order-scope");
const order_items_1 = require("../lib/utils/order-items");
const courier_availability_1 = require("../lib/utils/courier-availability");
const dispatch_1 = require("../lib/dispatch");
const outlet_id_1 = require("../lib/outlet-id");
const coords_1 = require("../lib/utils/coords");
const delivery_eta_1 = require("../lib/utils/delivery-eta");
const phone_1 = require("../lib/utils/phone");
// The courier's own user row. Aliased because several queries here already join
// usersTable for the CUSTOMER, and one query needs both sides at once.
const courierUser = (0, pg_core_1.alias)(schema_1.usersTable, "courier_user");
async function customerRoutes(app) {
    // The caller's full order history with per-order item count + total. Backs the
    // customer history-order page. { success: false } when the user isn't a customer.
    app.get("/api/get-customer-history", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false });
        const [customer] = await db_1.db
            .select({ id: schema_1.customersTable.id })
            .from(schema_1.customersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, session.user.id))
            .limit(1);
        if (!customer)
            return reply.send({ success: false, orders: [] });
        const base = await db_1.db
            .select({
            orderId: schema_1.ordersTable.id,
            status: schema_1.ordersTable.status,
            createdAt: schema_1.ordersTable.createdAt,
            outletName: schema_1.outletsTable.name,
            fulfillment: schema_1.ordersTable.fulfillment,
        })
            .from(schema_1.ordersTable)
            .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, schema_1.outletsTable.id))
            .where((0, drizzle_orm_1.and)(order_scope_1.orderNotDeleted, (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, customer.id)))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.ordersTable.createdAt));
        // Attach the actual purchased items (name + qty) + total per order.
        const withItems = await (0, order_items_1.attachOrderItems)(base);
        // Orders this customer has already rated (a rating row referencing any of the
        // order's detail rows, authored by this user).
        const orderIds = base.map((o) => o.orderId);
        const ratedRows = orderIds.length
            ? await db_1.db
                .selectDistinct({ orderId: schema_1.orderDetailsTable.order_id })
                .from(schema_1.ratingsTable)
                .innerJoin(schema_1.orderDetailsTable, (0, drizzle_orm_1.eq)(schema_1.ratingsTable.order_details_id, schema_1.orderDetailsTable.id))
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ratingsTable.reviewer, session.user.id), (0, drizzle_orm_1.inArray)(schema_1.orderDetailsTable.order_id, orderIds)))
            : [];
        const ratedSet = new Set(ratedRows.map((r) => r.orderId));
        // Rating stays open for 7 days after the order was made; after that it's no
        // longer relevant. Both delivery (rate courier + products) and service
        // (rate owner + products) orders are rateable once delivered.
        const RATING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        const orders = withItems.map((o) => {
            const createdMs = o.createdAt ? new Date(o.createdAt).getTime() : now;
            const withinWindow = now - createdMs <= RATING_WINDOW_MS;
            const rated = ratedSet.has(o.orderId);
            const rateable = o.status === "delivered";
            return {
                id: o.orderId,
                status: o.status,
                createdAt: o.createdAt,
                outletName: o.outletName,
                fulfillment: o.fulfillment,
                items: o.items.map((it) => ({ name: it.productName, quantity: it.quantity })),
                itemCount: o.items.length,
                totalAmount: o.totalAmount,
                rated,
                canRate: rateable && withinWindow && !rated,
                ratingExpired: rateable && !withinWindow && !rated,
            };
        });
        return reply.send({ success: true, orders });
    });
    // Customer's scheduled (service) orders that aren't finished yet — i.e. service
    // orders still in flight (not delivered/cancelled). Backs the "Scheduled Order"
    // sidebar page.
    app.get("/api/get-scheduled-orders", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false });
        const [customer] = await db_1.db
            .select({ id: schema_1.customersTable.id })
            .from(schema_1.customersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, session.user.id))
            .limit(1);
        if (!customer)
            return reply.send({ success: false, orders: [] });
        const orders = await db_1.db
            .select({
            id: schema_1.ordersTable.id,
            status: schema_1.ordersTable.status,
            createdAt: schema_1.ordersTable.createdAt,
            scheduledAt: schema_1.ordersTable.scheduled_at,
            discountAmount: schema_1.ordersTable.discount_amount,
            outletName: schema_1.outletsTable.name,
            serviceName: (0, drizzle_orm_1.sql) `MAX(${schema_1.productsTable.product_name})`,
            totalAmount: (0, drizzle_orm_1.sum)((0, drizzle_orm_1.sql) `CAST(${schema_1.orderDetailsTable.summary_price} AS NUMERIC)`).mapWith(Number),
        })
            .from(schema_1.ordersTable)
            .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, schema_1.outletsTable.id))
            .leftJoin(schema_1.orderDetailsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, schema_1.ordersTable.id))
            .leftJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, schema_1.productsTable.id))
            .where((0, drizzle_orm_1.and)(order_scope_1.orderNotDeleted, (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, customer.id), (0, drizzle_orm_1.eq)(schema_1.ordersTable.fulfillment, "service"), (0, drizzle_orm_1.notInArray)(schema_1.ordersTable.status, ["delivered", "cancelled"])))
            .groupBy(schema_1.ordersTable.id, schema_1.outletsTable.name)
            .orderBy((0, drizzle_orm_1.desc)(schema_1.ordersTable.scheduled_at));
        return reply.send({ success: true, orders });
    });
    app.get("/api/get-active-order", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false });
        const [customer] = await db_1.db
            .select({ id: schema_1.customersTable.id })
            .from(schema_1.customersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, session.user.id))
            .limit(1);
        if (!customer)
            return reply.status(403).send({ success: false });
        // 'cancelled' is included (unlike other terminal-status filtering elsewhere)
        // so a customer whose pending order the owner just rejected still sees it as
        // their "active" order — activeorder/page.tsx renders the rejection reason
        // instead of redirecting them away. It naturally stops being "active" the
        // moment they place a new order, since this only ever returns the latest one.
        const [order] = await db_1.db
            .select({
            id: schema_1.ordersTable.id,
            status: schema_1.ordersTable.status,
            outletName: schema_1.outletsTable.name,
            updatedAt: schema_1.ordersTable.updatedAt,
            createdAt: schema_1.ordersTable.createdAt,
            fulfillment: schema_1.ordersTable.fulfillment,
            scheduledAt: schema_1.ordersTable.scheduled_at,
            rejectedBy: schema_1.ordersTable.rejected_by,
            rejectedReason: schema_1.ordersTable.rejected_reason,
            // On the materials lane this is the haul price the owner quoted after
            // seeing the address. The customer only agreed to a CEILING at checkout,
            // so without this they never learn the figure they actually owe until
            // the load turns up — the one number they might want to refuse.
            deliveryFee: schema_1.ordersTable.delivery_fee,
            discountAmount: schema_1.ordersTable.discount_amount,
            // Route endpoints + the courier's last reported position, for the live
            // arrival estimate below.
            outletLat: schema_1.outletsTable.lat,
            outletLon: schema_1.outletsTable.lon,
            courierLat: schema_1.couriersTable.last_lat,
            courierLon: schema_1.couriersTable.last_lon,
            courierLocationAt: schema_1.couriersTable.last_location_at,
            // Who is actually bringing this. A name and a face turn "a courier is on
            // the way" into a specific person the customer can recognise at the door.
            courierName: courierUser.name,
            courierAvatar: schema_1.couriersTable.avatar,
            courierVehiclePlate: schema_1.couriersTable.vehicle_plate,
            courierPhone: courierUser.phone,
        })
            .from(schema_1.ordersTable)
            .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, schema_1.outletsTable.id))
            // leftJoin — most of an order's life has no courier attached.
            .leftJoin(schema_1.couriersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.courier_id, schema_1.couriersTable.id))
            .leftJoin(courierUser, (0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, courierUser.id))
            .where((0, drizzle_orm_1.and)(order_scope_1.orderNotDeleted, (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, customer.id)))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.ordersTable.createdAt))
            .limit(1);
        if (!order)
            return { success: false };
        const [{ sum: goodsTotal } = { sum: 0 }] = await db_1.db
            .select({
            sum: (0, drizzle_orm_1.sql) `coalesce(sum(cast(${schema_1.orderDetailsTable.summary_price} as numeric)), 0)`,
        })
            .from(schema_1.orderDetailsTable)
            .where((0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, order.id));
        const { outletLat, outletLon, courierLat, courierLon, courierLocationAt, courierName, courierAvatar, courierVehiclePlate, courierPhone, ...rest } = order;
        // Null until an order is actually assigned, so the UI can key the whole
        // "your courier" card off its presence rather than on order status.
        const courier = courierName
            ? {
                name: courierName,
                avatar: courierAvatar,
                vehiclePlate: courierVehiclePlate,
                // Canonical 628… so the customer's WhatsApp button is a direct link;
                // null when the stored number is unusable, and the button is hidden.
                phone: (0, phone_1.normalizeIndonesianPhone)(courierPhone),
            }
            : null;
        const eta = await (0, delivery_eta_1.deliveryEta)({
            status: order.status,
            customerUserId: session.user.id,
            outlet: (0, coords_1.parseCoordPair)(outletLat, outletLon),
            courier: (0, coords_1.parseCoordPair)(courierLat, courierLon),
            courierSeenAt: courierLocationAt,
        });
        return { success: true, order: { ...rest, courier, goodsTotal: Number(goodsTotal), ...eta } };
    });
    app.get("/api/get-available-orders", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false });
        const [courier] = await db_1.db
            .select({ id: schema_1.couriersTable.id })
            .from(schema_1.couriersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, session.user.id))
            .limit(1);
        if (!courier)
            return reply.status(403).send({ success: false, error: "Not a courier" });
        // Expire what is due and move those orders on, before deciding what this
        // courier can see. The lobby polls every two seconds, so this is what keeps
        // the queue flowing without a scheduler process.
        await (0, dispatch_1.tickDispatch)();
        const availability = await (0, courier_availability_1.getCourierAvailability)(courier.id);
        if (!availability.canReceiveOrder) {
            return {
                success: true,
                orders: [],
                canReceiveOrder: false,
                // Verification is checked first: an unverified courier who is online
                // and idle would otherwise be told "busy", which is both false and
                // unactionable. Each reason has to name the thing they can fix.
                reason: !availability.isApproved
                    ? "not_verified"
                    : !availability.isOnline
                        ? "offline"
                        : "busy",
                ratingStatus: availability.ratingStatus,
                delaySeconds: availability.delaySeconds,
            };
        }
        // What this courier may see: the one order they have been offered, plus
        // anything that has fallen through to the open pool. Not "every confirmed
        // order", which is what made staring at the lobby the way to earn.
        const { offeredOrderId, offerExpiresAt, offerRemainingMs, openPoolOrderIds } = await (0, dispatch_1.visibleOrderIdsFor)(courier.id);
        const visibleIds = [offeredOrderId, ...openPoolOrderIds].filter((id) => id !== null);
        if (visibleIds.length === 0) {
            return {
                success: true,
                orders: [],
                canReceiveOrder: true,
                reason: null,
                offeredOrderId: null,
                offerExpiresAt: null,
                offerRemainingMs: null,
                ratingStatus: availability.ratingStatus,
                delaySeconds: availability.delaySeconds,
            };
        }
        const orders = await db_1.db
            .select({
            orderId: schema_1.ordersTable.id,
            customerName: schema_1.usersTable.name,
            customerPhone: schema_1.usersTable.phone,
            deliveryFee: schema_1.ordersTable.delivery_fee,
            note: schema_1.ordersTable.note,
            createdAt: schema_1.ordersTable.createdAt,
            outletName: schema_1.outletsTable.name,
            outletAddress: schema_1.outletsTable.address,
        })
            .from(schema_1.ordersTable)
            .innerJoin(schema_1.customersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, schema_1.customersTable.id))
            .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, schema_1.usersTable.id))
            .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, schema_1.outletsTable.id))
            .where((0, drizzle_orm_1.and)(order_scope_1.orderNotDeleted, (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "confirmed"), (0, drizzle_orm_1.isNull)(schema_1.ordersTable.courier_id), 
        // Service and materials orders are courier-less by design — the
        // outlet moves those itself, so they never reach the courier lobby.
        (0, drizzle_orm_1.eq)(schema_1.ordersTable.fulfillment, "delivery"), (0, drizzle_orm_1.inArray)(schema_1.ordersTable.id, visibleIds)))
            .orderBy(schema_1.ordersTable.createdAt);
        // Probation still slows the open pool — it is the only place first-come
        // still decides anything, so it is the only place the handicap can apply.
        // A direct offer is never delayed: it is already this courier's turn.
        const visibleOrders = availability.delaySeconds > 0
            ? orders.filter((order) => {
                if (order.orderId === offeredOrderId)
                    return true;
                const ageMs = Date.now() - new Date(order.createdAt).getTime();
                return ageMs >= availability.delaySeconds * 1000;
            })
            : orders;
        const ordersWithItems = await (0, order_items_1.attachOrderItems)(visibleOrders);
        return {
            success: true,
            orders: ordersWithItems,
            canReceiveOrder: true,
            reason: null,
            // The UI needs both: which card is a personal offer, and when its clock
            // runs out, so it can show a countdown instead of a silent disappearance.
            offeredOrderId,
            offerExpiresAt,
            // Milliseconds left as measured by the database, for a countdown that
            // doesn't depend on the phone's clock being right.
            offerRemainingMs,
            ratingStatus: availability.ratingStatus,
            delaySeconds: availability.delaySeconds,
        };
    });
    app.get("/api/get-courier-history", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false });
        const [courier] = await db_1.db
            .select({ id: schema_1.couriersTable.id })
            .from(schema_1.couriersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, session.user.id))
            .limit(1);
        if (!courier)
            return reply.status(403).send({ success: false, error: "Not a courier" });
        const history = await db_1.db
            .select({
            id: schema_1.ordersTable.id,
            status: schema_1.ordersTable.status,
            deliveryFee: schema_1.ordersTable.delivery_fee,
            timestamp: schema_1.ordersTable.updatedAt,
            customerName: schema_1.usersTable.name,
            outletName: schema_1.outletsTable.name,
            dropoff: schema_1.locationsTable.address,
        })
            .from(schema_1.ordersTable)
            .innerJoin(schema_1.customersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, schema_1.customersTable.id))
            .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, schema_1.usersTable.id))
            .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, schema_1.outletsTable.id))
            .leftJoin(schema_1.locationsTable, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.locationsTable.user_id, schema_1.usersTable.id), (0, drizzle_orm_1.eq)(schema_1.locationsTable.is_default, true)))
            .where((0, drizzle_orm_1.and)(order_scope_1.orderNotDeleted, (0, drizzle_orm_1.eq)(schema_1.ordersTable.courier_id, courier.id)))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.ordersTable.updatedAt))
            .limit(3);
        return { success: true, history };
    });
    app.get("/api/get-courier-orders", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false });
        const [courier] = await db_1.db
            .select({ id: schema_1.couriersTable.id })
            .from(schema_1.couriersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, session.user.id))
            .limit(1);
        if (!courier)
            return reply.status(403).send({ success: false, error: "Not a courier" });
        const orders = await db_1.db
            .select({
            orderId: schema_1.ordersTable.id,
            customerName: schema_1.usersTable.name,
            customerPhone: schema_1.usersTable.phone,
            deliveryFee: schema_1.ordersTable.delivery_fee,
            note: schema_1.ordersTable.note,
            createdAt: schema_1.ordersTable.createdAt,
            status: schema_1.ordersTable.status,
            outletName: schema_1.outletsTable.name,
            outletAddress: schema_1.outletsTable.address,
        })
            .from(schema_1.ordersTable)
            .innerJoin(schema_1.customersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, schema_1.customersTable.id))
            .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, schema_1.usersTable.id))
            .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, schema_1.outletsTable.id))
            .where((0, drizzle_orm_1.and)(order_scope_1.orderNotDeleted, (0, drizzle_orm_1.eq)(schema_1.ordersTable.courier_id, courier.id), (0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "confirmed"), (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "preparing"), (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "ready"), (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "on_delivery"))))
            .orderBy(schema_1.ordersTable.createdAt);
        const ordersWithItems = await (0, order_items_1.attachOrderItems)(orders);
        return { success: true, orders: ordersWithItems };
    });
    app.get("/api/get-courier-ratings", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ error: "Unauthorized" });
        const rows = await db_1.db
            .select({
            id: schema_1.ratingsTable.id,
            ratings: schema_1.ratingsTable.ratings,
            comment: schema_1.ratingsTable.comment,
            created_at: schema_1.ratingsTable.createdAt,
            reviewer_name: schema_1.usersTable.name,
        })
            .from(schema_1.ratingsTable)
            .leftJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.ratingsTable.reviewer, schema_1.usersTable.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ratingsTable.reciepent, session.user.id), (0, drizzle_orm_1.eq)(schema_1.ratingsTable.reciepent_as, "courier")))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.ratingsTable.createdAt));
        const data = rows.map((r) => ({
            id: r.id,
            rating: Number(r.ratings) || 5,
            comment: r.comment ?? "",
            created_at: r.created_at,
            reviewer_name: r.reviewer_name ?? "Anonim",
        }));
        return { data };
    });
    app.get("/api/get-order-locations", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false });
        const { outlet_id: outletId } = request.query;
        if (!outletId)
            return reply.status(400).send({ success: false, error: "Missing outlet_id" });
        const [[customer], [outlet]] = await Promise.all([
            db_1.db
                .select({ id: schema_1.customersTable.id, ratings: schema_1.customersTable.ratings, review_count: schema_1.customersTable.review_count })
                .from(schema_1.customersTable)
                .where((0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, session.user.id))
                .limit(1),
            db_1.db
                .select({ lat: schema_1.outletsTable.lat, lon: schema_1.outletsTable.lon, name: schema_1.outletsTable.name })
                .from(schema_1.outletsTable)
                .where((0, drizzle_orm_1.eq)(schema_1.outletsTable.id, Number(outletId)))
                .limit(1),
        ]);
        if (!customer || !outlet)
            return reply.status(404).send({ success: false, error: "Not found" });
        const [customerUser] = await db_1.db
            .select({ name: schema_1.usersTable.name })
            .from(schema_1.usersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.usersTable.id, session.user.id))
            .limit(1);
        const [defaultLocation] = await db_1.db
            .select({ lat: schema_1.locationsTable.lat, lon: schema_1.locationsTable.lon, address: schema_1.locationsTable.address })
            .from(schema_1.locationsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.locationsTable.user_id, session.user.id), (0, drizzle_orm_1.eq)(schema_1.locationsTable.is_default, true)))
            .limit(1);
        return {
            success: true,
            pickup: { lat: outlet.lat, lon: outlet.lon, label: outlet.name },
            dropoff: {
                lat: defaultLocation?.lat ?? null,
                lon: defaultLocation?.lon ?? null,
                label: defaultLocation?.address ?? customerUser?.name ?? "",
            },
            customer: {
                ratings: customer.ratings ?? "5",
                review_count: customer.review_count,
            },
        };
    });
    app.get("/api/get-ratings", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ error: "Unauthorized" });
        const outlet = await (0, outlet_id_1.getOutletByUserId)(session.user.id);
        if (!outlet)
            return reply.status(401).send({ error: "Unauthorized" });
        const rows = await db_1.db
            .select({
            id: schema_1.ratingsTable.id,
            ratings: schema_1.ratingsTable.ratings,
            comment: schema_1.ratingsTable.comment,
            reciepent_as: schema_1.ratingsTable.reciepent_as,
            created_at: schema_1.ratingsTable.createdAt,
            reviewer_name: schema_1.usersTable.name,
            product_name: schema_1.productsTable.product_name,
            outlet_id: schema_1.ratingsTable.outlet_id,
            product_id: schema_1.ratingsTable.product_id,
        })
            .from(schema_1.ratingsTable)
            .leftJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.ratingsTable.reviewer, schema_1.usersTable.id))
            .leftJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.ratingsTable.product_id, schema_1.productsTable.id))
            .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.ratingsTable.outlet_id, outlet.id), (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, outlet.id)))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.ratingsTable.createdAt));
        const data = rows.map((r) => ({
            id: r.id,
            rating: Number(r.ratings) || 5,
            comment: r.comment ?? "",
            type: r.product_id ? "product" : "outlet",
            created_at: r.created_at,
            reviewer_name: r.reviewer_name ?? "Anonim",
            product_name: r.product_name ?? null,
        }));
        return { data };
    });
}
