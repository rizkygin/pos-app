"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ownerRoutes = ownerRoutes;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../auth");
const web_headers_1 = require("../lib/web-headers");
const order_scope_1 = require("../lib/order-scope");
const outlet_id_1 = require("../lib/outlet-id");
const outlet_access_1 = require("../lib/outlet-access");
const order_items_1 = require("../lib/utils/order-items");
const timezone_1 = require("../lib/timezone");
// Money columns (summary_price, buying_price) are varchar; a single blank or
// non-numeric row makes `cast(... as numeric)` throw and kills the whole
// aggregate ("invalid input syntax for type numeric"). Guard the cast so bad or
// blank values count as 0 instead of crashing the query.
const money = (col) => (0, drizzle_orm_1.sql) `(case when ${col} ~ '^\\s*-?[0-9]+(\\.[0-9]+)?\\s*$' then cast(${col} as numeric) else 0 end)`;
// POS/cashier orders are attached to this hardcoded "offline" customer (see
// mutations.ts /api/add-order-detail). Matches admin.ts OFFLINE_CUSTOMER_EMAIL.
const OFFLINE_CUSTOMER_EMAIL = "rizkygin1@gmail.com";
// Owner or employee holding `perm` → the outlet; otherwise null (each route
// already replies 403 on null). Honors the active-outlet cookie and the
// subscription gate (read-only when expired, plan feature boundaries). Routes
// NOT converted stay getOutletByUserId, i.e. strictly owner-only — deny is the
// default for anything unmapped.
async function outletFor(userId, perm, request) {
    const access = await (0, outlet_access_1.getOutletAccess)(userId, (0, outlet_access_1.parseActiveOutletId)(request));
    if (!access || !(0, outlet_access_1.hasPermission)(access, perm))
        return null;
    const gate = await (0, outlet_access_1.getSubscriptionGate)(access.outlet.user_id);
    if ((0, outlet_access_1.gateBlocks)(gate, perm, request.method))
        return null;
    return access.outlet;
}
// The Order Lobby's lanes differ only by status, so they share one query.
// `courier_id` is part of the projection deliberately: the UI gates the "Siap"
// button and the courier-search lane on it, and leaving it out doesn't error —
// it silently reads as undefined and disables the button forever.
async function lobbyOrdersByStatus(outletId, status) {
    const orders = await db_1.db
        .select({
        orderId: schema_1.ordersTable.id,
        customerName: schema_1.usersTable.name,
        customerPhone: schema_1.usersTable.phone,
        courierId: schema_1.ordersTable.courier_id,
        deliveryFee: schema_1.ordersTable.delivery_fee,
        note: schema_1.ordersTable.note,
        createdAt: schema_1.ordersTable.createdAt,
        status: schema_1.ordersTable.status,
        fulfillment: schema_1.ordersTable.fulfillment,
        scheduledAt: schema_1.ordersTable.scheduled_at,
        discountAmount: schema_1.ordersTable.discount_amount,
        // Needed by the materials lane: the owner prices the haul from how far it
        // has to go, so the drop-off has to be on the card before they can quote.
        // leftJoin — a customer with no saved default address must not vanish from
        // the lobby entirely.
        dropoffAddress: schema_1.locationsTable.address,
        // Coordinates too, so the card's address can open a driving route rather
        // than a text search that may not resolve a kampung address at all.
        dropoffLat: schema_1.locationsTable.lat,
        dropoffLon: schema_1.locationsTable.lon,
    })
        .from(schema_1.ordersTable)
        .innerJoin(schema_1.customersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, schema_1.customersTable.id))
        .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, schema_1.usersTable.id))
        .leftJoin(schema_1.locationsTable, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.locationsTable.user_id, schema_1.usersTable.id), (0, drizzle_orm_1.eq)(schema_1.locationsTable.is_default, true)))
        .where((0, drizzle_orm_1.and)(order_scope_1.orderNotDeleted, (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, outletId), (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, status)))
        .orderBy(schema_1.ordersTable.createdAt);
    return (0, order_items_1.attachOrderItems)(orders);
}
async function ownerRoutes(app) {
    app.get("/api/get-outlet-orders", async (request, reply) => {
        try {
            const { page = "1", limit = "10", search = "", status = "all", dateFrom = "", dateTo = "" } = request.query;
            const pageNum = Math.max(1, Number(page) || 1);
            const limitNum = Math.max(1, Number(limit) || 10);
            const offset = (pageNum - 1) * limitNum;
            const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
            if (!session?.user)
                return reply.status(401).send({ success: false, error: "Unauthorized" });
            const outlet = await outletFor(session.user.id, "activeOrders", request);
            if (!outlet)
                return reply.status(403).send({ success: false, error: "No outlet found" });
            const dateStart = dateFrom ? new Date(dateFrom) : undefined;
            const dateEnd = dateTo ? new Date(`${dateTo}T23:59:59.999Z`) : undefined;
            const ACTIVE_STATUSES = ["confirmed", "preparing", "ready", "on_delivery"];
            const statusFilter = status === "all" ? undefined :
                status === "aktif" ? (0, drizzle_orm_1.inArray)(schema_1.ordersTable.status, ACTIVE_STATUSES) :
                    status === "selesai" ? (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "delivered") :
                        (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, status);
            const baseFilter = (0, drizzle_orm_1.and)(order_scope_1.orderNotDeleted, (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, outlet.id), statusFilter, search ? (0, drizzle_orm_1.or)((0, drizzle_orm_1.ilike)(schema_1.usersTable.name, `%${search}%`), (0, drizzle_orm_1.ilike)(schema_1.orderDetailsTable.order_id, `%${search}%`)) : undefined, dateStart ? (0, drizzle_orm_1.gte)(schema_1.orderDetailsTable.created_at, dateStart) : undefined, dateEnd ? (0, drizzle_orm_1.lte)(schema_1.orderDetailsTable.created_at, dateEnd) : undefined);
            const [rows, countRows, statsRows] = await Promise.all([
                db_1.db
                    .select({
                    orderId: schema_1.orderDetailsTable.order_id,
                    itemCount: (0, drizzle_orm_1.sql) `cast(count(*) as int)`,
                    totalAmount: (0, drizzle_orm_1.sql) `coalesce(sum(${money(schema_1.orderDetailsTable.summary_price)}), 0)`,
                    status: schema_1.ordersTable.status,
                    // Drives whether the row offers a cancel button — only cashier
                    // orders can be cancelled here.
                    source: schema_1.ordersTable.source,
                    createdAt: (0, drizzle_orm_1.sql) `max(${schema_1.orderDetailsTable.created_at})::text`,
                    customerName: schema_1.usersTable.name,
                })
                    .from(schema_1.orderDetailsTable)
                    .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, schema_1.productsTable.id))
                    .innerJoin(schema_1.ordersTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, schema_1.ordersTable.id))
                    .innerJoin(schema_1.customersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, schema_1.customersTable.id))
                    .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, schema_1.usersTable.id))
                    .where(baseFilter)
                    .groupBy(schema_1.orderDetailsTable.order_id, schema_1.usersTable.name, schema_1.ordersTable.status, schema_1.ordersTable.source)
                    .orderBy((0, drizzle_orm_1.desc)((0, drizzle_orm_1.sql) `max(${schema_1.orderDetailsTable.created_at})`))
                    .limit(limitNum)
                    .offset(offset),
                db_1.db
                    .select({ count: (0, drizzle_orm_1.sql) `count(distinct ${schema_1.orderDetailsTable.order_id})` })
                    .from(schema_1.orderDetailsTable)
                    .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, schema_1.productsTable.id))
                    .innerJoin(schema_1.ordersTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, schema_1.ordersTable.id))
                    .innerJoin(schema_1.customersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, schema_1.customersTable.id))
                    .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, schema_1.usersTable.id))
                    .where(baseFilter),
                db_1.db
                    .select({ status: schema_1.ordersTable.status })
                    .from(schema_1.ordersTable)
                    .where((0, drizzle_orm_1.and)(order_scope_1.orderNotDeleted, (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, outlet.id)))
                    .groupBy(schema_1.ordersTable.id, schema_1.ordersTable.status),
            ]);
            const totalCount = Number(countRows[0]?.count ?? 0);
            const pendingCount = statsRows.filter(r => r.status === "pending").length;
            const processingCount = statsRows.filter(r => ["confirmed", "preparing", "ready", "on_delivery"].includes(r.status)).length;
            const completedCount = statsRows.filter(r => r.status === "delivered").length;
            const cancelledCount = statsRows.filter(r => r.status === "cancelled").length;
            const allCount = statsRows.length;
            return {
                success: true,
                data: rows,
                count: totalCount,
                stats: { allCount, pendingCount, processingCount, completedCount, cancelledCount },
            };
        }
        catch (error) {
            return reply.status(500).send({ success: false, error: String(error) });
        }
    });
    app.get("/api/get-pending-orders", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false });
        const outlet = await outletFor(session.user.id, "activeOrders", request);
        if (!outlet)
            return reply.status(403).send({ success: false, error: "Not an owner" });
        // No courier reaches this outlet, so no courier-delivered order can
        // ever land here. Reported explicitly rather than as an empty list:
        // the client uses it to stop polling and explain the blank screen.
        if (!outlet.courier_reachable) {
            return { success: true, orders: [], courierReachable: false };
        }
        return { success: true, orders: await lobbyOrdersByStatus(outlet.id, "pending"), courierReachable: true };
    });
    // Count-only sibling of the route above. The incoming-order alarm polls this
    // from every dashboard page, so it must stay cheap — no joins, no item
    // fan-out, just how many orders are waiting on the owner right now.
    app.get("/api/get-pending-orders-count", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false });
        const outlet = await outletFor(session.user.id, "activeOrders", request);
        if (!outlet)
            return reply.status(403).send({ success: false, error: "Not an owner" });
        // The alarm polls this from every dashboard page. An outlet no courier
        // reaches can never accumulate a pending courier order, so skip the query
        // entirely rather than counting to zero over and over.
        if (!outlet.courier_reachable) {
            return { success: true, count: 0, courierReachable: false };
        }
        const [row] = await db_1.db
            .select({ count: (0, drizzle_orm_1.count)() })
            .from(schema_1.ordersTable)
            .where((0, drizzle_orm_1.and)(order_scope_1.orderNotDeleted, (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, outlet.id), (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "pending")));
        return { success: true, count: row?.count ?? 0, courierReachable: true };
    });
    app.get("/api/get-preparing-orders", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false });
        const outlet = await outletFor(session.user.id, "activeOrders", request);
        if (!outlet)
            return reply.status(403).send({ success: false, error: "Not an owner" });
        // No courier reaches this outlet, so no courier-delivered order can
        // ever land here. Reported explicitly rather than as an empty list:
        // the client uses it to stop polling and explain the blank screen.
        if (!outlet.courier_reachable) {
            return { success: true, orders: [], courierReachable: false };
        }
        return { success: true, orders: await lobbyOrdersByStatus(outlet.id, "preparing"), courierReachable: true };
    });
    // "Mencari kurir" lane: the owner has confirmed the order but no courier has
    // claimed it yet (courier.ts flips confirmed -> preparing and sets courier_id
    // in one update). These orders were previously surfaced NOWHERE — they left
    // the pending tab on confirm and only reappeared once a courier accepted.
    app.get("/api/get-confirmed-orders", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false });
        const outlet = await outletFor(session.user.id, "activeOrders", request);
        if (!outlet)
            return reply.status(403).send({ success: false, error: "Not an owner" });
        // No courier reaches this outlet, so no courier-delivered order can
        // ever land here. Reported explicitly rather than as an empty list:
        // the client uses it to stop polling and explain the blank screen.
        if (!outlet.courier_reachable) {
            return { success: true, orders: [], courierReachable: false };
        }
        return { success: true, orders: await lobbyOrdersByStatus(outlet.id, "confirmed"), courierReachable: true };
    });
    app.get("/api/get-ready-orders", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false });
        const outlet = await outletFor(session.user.id, "activeOrders", request);
        if (!outlet)
            return reply.status(403).send({ success: false, error: "Not an owner" });
        // No courier reaches this outlet, so no courier-delivered order can
        // ever land here. Reported explicitly rather than as an empty list:
        // the client uses it to stop polling and explain the blank screen.
        if (!outlet.courier_reachable) {
            return { success: true, orders: [], courierReachable: false };
        }
        return { success: true, orders: await lobbyOrdersByStatus(outlet.id, "ready"), courierReachable: true };
    });
    app.get("/api/get-outlet-order-detail", async (request, reply) => {
        try {
            const { order_id } = request.query;
            if (!order_id)
                return reply.status(400).send({ success: false, error: "Missing order_id" });
            const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
            if (!session?.user)
                return reply.status(401).send({ success: false });
            const outlet = await outletFor(session.user.id, "activeOrders", request);
            if (!outlet)
                return reply.status(403).send({ success: false, error: "Not an owner" });
            // Order header + customer (user) info, scoped to this owner's outlet.
            const [order] = await db_1.db
                .select({
                status: schema_1.ordersTable.status,
                note: schema_1.ordersTable.note,
                discountAmount: schema_1.ordersTable.discount_amount,
                deliveryFee: schema_1.ordersTable.delivery_fee,
                createdAt: schema_1.ordersTable.createdAt,
                customerName: schema_1.usersTable.name,
                customerEmail: schema_1.usersTable.email,
                customerPhone: schema_1.usersTable.phone,
            })
                .from(schema_1.ordersTable)
                .leftJoin(schema_1.customersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, schema_1.customersTable.id))
                .leftJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, schema_1.usersTable.id))
                .where((0, drizzle_orm_1.and)(order_scope_1.orderNotDeleted, (0, drizzle_orm_1.eq)(schema_1.ordersTable.id, order_id), (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, outlet.id)))
                .limit(1);
            if (!order)
                return reply.status(404).send({ success: false, error: "Order not found" });
            const rows = await db_1.db
                .select({
                detailId: schema_1.orderDetailsTable.id,
                quantity: schema_1.orderDetailsTable.quantity,
                note: schema_1.orderDetailsTable.note_product,
                summaryPrice: schema_1.orderDetailsTable.summary_price,
                createdAt: schema_1.orderDetailsTable.created_at,
                productId: schema_1.productsTable.id,
                productName: schema_1.productsTable.product_name,
                price: schema_1.productsTable.price,
                category: schema_1.productsTable.category,
                unit: schema_1.productsTable.unit,
                image: schema_1.productsTable.image,
            })
                .from(schema_1.orderDetailsTable)
                .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, schema_1.productsTable.id))
                .where((0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, order_id))
                .orderBy((0, drizzle_orm_1.desc)(schema_1.orderDetailsTable.created_at));
            const isOfflineOrder = order.customerEmail === OFFLINE_CUSTOMER_EMAIL;
            return {
                success: true,
                // Address/phone/avatar are here for the reprint slip, which rebuilds the
                // same receipt the cashier printed at checkout and needs the full header.
                outlet: {
                    id: String(outlet.id),
                    name: outlet.name,
                    address: outlet.address,
                    phone: outlet.phone,
                    avatar: outlet.avatar,
                },
                // Whoever is reprinting, not whoever originally rang it up: the order
                // rows don't record a cashier, and the slip's "Kasir" line is only ever
                // read as "who handed me this paper".
                cashierName: session.user.name ?? "",
                order: {
                    createdAt: order.createdAt,
                    discountAmount: order.discountAmount,
                    deliveryFee: order.deliveryFee,
                },
                items: rows.map((i) => ({
                    ...i,
                    detailId: String(i.detailId),
                    status: order.status,
                    image: i.image || "not-found.webp",
                })),
                customer: isOfflineOrder
                    ? null
                    : {
                        name: order.customerName ?? null,
                        email: order.customerEmail ?? null,
                        phone: order.customerPhone ?? null,
                        address: null,
                    },
                isOfflineOrder,
                offlineNote: isOfflineOrder ? order.note : null,
            };
        }
        catch (error) {
            return reply.status(500).send({ success: false, error: String(error) });
        }
    });
    app.get("/api/get-data-order", async (request, reply) => {
        try {
            const { search = "", dateFrom = "", dateTo = "" } = request.query;
            const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
            if (!session?.user)
                return reply.status(401).send({ success: false });
            const outlet = await outletFor(session.user.id, "reports", request);
            if (!outlet)
                return reply.status(403).send({ success: false, error: "Not an owner" });
            const dateStart = dateFrom ? new Date(dateFrom) : undefined;
            const dateEnd = dateTo ? new Date(`${dateTo}T23:59:59.999Z`) : undefined;
            const rows = await db_1.db
                .select({
                product_name: schema_1.productsTable.product_name,
                order_id: schema_1.orderDetailsTable.order_id,
                quantity: schema_1.orderDetailsTable.quantity,
                summary_price: schema_1.orderDetailsTable.summary_price,
                note_product: schema_1.orderDetailsTable.note_product,
                status: schema_1.ordersTable.status,
            })
                .from(schema_1.orderDetailsTable)
                .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, schema_1.productsTable.id))
                .innerJoin(schema_1.ordersTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, schema_1.ordersTable.id))
                .where((0, drizzle_orm_1.and)(order_scope_1.orderNotDeleted, (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, outlet.id), search ? (0, drizzle_orm_1.ilike)(schema_1.productsTable.product_name, `%${search}%`) : undefined, dateStart ? (0, drizzle_orm_1.gte)(schema_1.orderDetailsTable.created_at, dateStart) : undefined, dateEnd ? (0, drizzle_orm_1.lte)(schema_1.orderDetailsTable.created_at, dateEnd) : undefined, (0, drizzle_orm_1.notInArray)(schema_1.ordersTable.status, ["cancelled"])))
                .orderBy((0, drizzle_orm_1.desc)(schema_1.orderDetailsTable.created_at));
            return { success: true, data: rows };
        }
        catch (error) {
            return reply.status(500).send({ success: false, error: String(error) });
        }
    });
    app.get("/api/get-owner-ratings", async (request, reply) => {
        try {
            const { page = "1", filter = "all" } = request.query;
            const pageNum = Math.max(1, Number(page) || 1);
            const PAGE_SIZE = 20;
            const offset = (pageNum - 1) * PAGE_SIZE;
            const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
            if (!session?.user)
                return reply.status(401).send({ error: "Unauthorized" });
            const outlet = await (0, outlet_id_1.getOutletByUserId)(session.user.id);
            if (!outlet)
                return reply.status(401).send({ error: "Unauthorized" });
            const filterCond = filter === "all" ? undefined : (0, drizzle_orm_1.eq)(schema_1.ratingsTable.reciepent_as, filter);
            const outletScope = (0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.ratingsTable.outlet_id, outlet.id), (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, outlet.id));
            const [rows, summaryRows, countRows] = await Promise.all([
                db_1.db
                    .select({
                    id: schema_1.ratingsTable.id,
                    rating: schema_1.ratingsTable.ratings,
                    comment: schema_1.ratingsTable.comment,
                    reciepent_as: schema_1.ratingsTable.reciepent_as,
                    created_at: schema_1.ratingsTable.createdAt,
                    reviewer_name: schema_1.usersTable.name,
                    product_name: schema_1.productsTable.product_name,
                })
                    .from(schema_1.ratingsTable)
                    .leftJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.ratingsTable.reviewer, schema_1.usersTable.id))
                    .leftJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.ratingsTable.product_id, schema_1.productsTable.id))
                    .where((0, drizzle_orm_1.and)(outletScope, filterCond))
                    .orderBy((0, drizzle_orm_1.desc)(schema_1.ratingsTable.createdAt))
                    .limit(PAGE_SIZE)
                    .offset(offset),
                // Summary is split per recipient (outlet vs product) and ignores the tab
                // filter, so the two summary cards always reflect totals across all ratings.
                db_1.db
                    .select({ reciepent_as: schema_1.ratingsTable.reciepent_as, rating: schema_1.ratingsTable.ratings, count: (0, drizzle_orm_1.count)() })
                    .from(schema_1.ratingsTable)
                    .leftJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.ratingsTable.product_id, schema_1.productsTable.id))
                    .where(outletScope)
                    .groupBy(schema_1.ratingsTable.reciepent_as, schema_1.ratingsTable.ratings),
                db_1.db
                    .select({ count: (0, drizzle_orm_1.count)() })
                    .from(schema_1.ratingsTable)
                    .leftJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.ratingsTable.product_id, schema_1.productsTable.id))
                    .where((0, drizzle_orm_1.and)(outletScope, filterCond)),
            ]);
            const buildSection = (kind) => {
                const dist = [5, 4, 3, 2, 1].map((star) => ({
                    star,
                    count: summaryRows
                        .filter((r) => r.reciepent_as === kind && Math.round(Number(r.rating)) === star)
                        .reduce((a, r) => a + Number(r.count), 0),
                }));
                const sectionCount = dist.reduce((a, d) => a + d.count, 0);
                const avg = sectionCount > 0 ? dist.reduce((a, d) => a + d.star * d.count, 0) / sectionCount : 0;
                return { avg: Number(avg.toFixed(2)), count: sectionCount, dist };
            };
            const totalCount = countRows[0]?.count ?? 0;
            return {
                success: true,
                data: (rows || []).map((r) => ({
                    id: r.id,
                    rating: Number(r.rating) || 5,
                    comment: r.comment ?? "",
                    type: r.product_name ? "product" : "outlet",
                    created_at: r.created_at,
                    reviewer_name: r.reviewer_name ?? "Anonim",
                    product_name: r.product_name ?? null,
                })),
                summary: { outlet: buildSection("outlet"), product: buildSection("product") },
                total: totalCount,
                page: pageNum,
                totalPages: Math.ceil(totalCount / PAGE_SIZE),
            };
        }
        catch (error) {
            return reply.status(500).send({ success: false, error: String(error) });
        }
    });
    app.get("/api/get-data-chart", async (request, reply) => {
        try {
            const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
            if (!session?.user)
                return reply.status(401).send({ error: "Unauthorized" });
            const outlet = await outletFor(session.user.id, "reports", request);
            if (!outlet)
                return reply.status(401).send({ error: "Unauthorized" });
            // Month edges must be local midnight, not the container's. new Date(y, m, 1)
            // reads the process zone — UTC in the deployed image — which shifts every
            // boundary 7 hours and misfiles orders placed late on the last of the month.
            const { timezone = "Asia/Jakarta" } = request.query;
            function getLast6Months() {
                const months = [];
                const todayLocal = new Intl.DateTimeFormat("en-CA", {
                    timeZone: timezone,
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                }).format(new Date());
                const [localYear, localMonth] = todayLocal.split("-").map(Number);
                for (let i = 5; i >= 0; i--) {
                    // UTC arithmetic here is just a calendar cursor; the helper turns each
                    // year-month into the real UTC instant that local midnight falls on.
                    const cursor = new Date(Date.UTC(localYear, localMonth - 1 - i, 1));
                    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
                    const { startUTC: start, endUTC: end } = (0, timezone_1.getUTCRangeFromLocalMonth)(key, timezone);
                    months.push({
                        start,
                        end,
                        month: cursor.toLocaleString("default", { month: "short", timeZone: "UTC" }),
                    });
                }
                return months;
            }
            const months = getLast6Months();
            const data = await Promise.all(months.map(async ({ start, end, month }) => {
                const [result] = await db_1.db
                    .select({ total: (0, drizzle_orm_1.sql) `coalesce(sum(${money(schema_1.orderDetailsTable.summary_price)}), 0)` })
                    .from(schema_1.orderDetailsTable)
                    .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, schema_1.productsTable.id))
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, outlet.id), (0, drizzle_orm_1.gte)(schema_1.orderDetailsTable.created_at, start), (0, drizzle_orm_1.lt)(schema_1.orderDetailsTable.created_at, end)));
                return { month, total: Number(result?.total ?? 0) };
            }));
            return { success: true, data };
        }
        catch (error) {
            return reply.status(500).send({ success: false, error: String(error) });
        }
    });
    app.get("/api/get-hourly-orders", async (request, reply) => {
        try {
            const { date = "", timezone = "Asia/Jakarta" } = request.query;
            const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
            if (!session?.user)
                return reply.status(401).send({ success: false });
            const outlet = await outletFor(session.user.id, "reports", request);
            if (!outlet)
                return reply.status(401).send({ success: false, error: "Not an owner" });
            if (!date)
                return reply.status(400).send({ success: false, error: "Missing 'date' parameter" });
            const { startUTC, endUTC } = (0, timezone_1.getUTCRangeFromLocalDate)(date, timezone);
            const rows = await db_1.db
                .select({
                hour: (0, drizzle_orm_1.sql) `extract(hour from ${schema_1.orderDetailsTable.created_at} at time zone ${timezone})::int`,
                count: (0, drizzle_orm_1.sql) `count(distinct ${schema_1.orderDetailsTable.order_id})`,
                total: (0, drizzle_orm_1.sql) `coalesce(sum(${money(schema_1.orderDetailsTable.summary_price)}), 0)`,
            })
                .from(schema_1.orderDetailsTable)
                .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, schema_1.productsTable.id))
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, outlet.id), (0, drizzle_orm_1.gte)(schema_1.orderDetailsTable.created_at, startUTC), (0, drizzle_orm_1.lt)(schema_1.orderDetailsTable.created_at, endUTC)))
                // Group/order by the SELECT's first output column (the hour expression).
                // Repeating the expression would emit a separate $-param for the timezone
                // each time, so Postgres wouldn't treat them as the same grouped expression
                // ("must appear in the GROUP BY clause").
                .groupBy((0, drizzle_orm_1.sql) `1`)
                .orderBy((0, drizzle_orm_1.sql) `1`);
            const hourlyData = Array.from({ length: 24 }, (_, i) => ({
                hour: i,
                count: 0,
                total: 0,
            }));
            rows.forEach((row) => {
                const idx = row.hour ?? 0;
                if (idx >= 0 && idx < 24) {
                    hourlyData[idx] = { hour: idx, count: row.count, total: Number(row.total) };
                }
            });
            return { success: true, data: hourlyData };
        }
        catch (error) {
            return reply.status(500).send({ success: false, error: String(error) });
        }
    });
    // Owner reports summary for a period: KPIs (revenue, HPP/cogs, profit, orders,
    // AOV) with previous-period comparison, daily sales trend, top products by
    // revenue/profit, and hourly distribution. Sales = non-cancelled, non-pending
    // orders (matches the dashboard's realized-sales definition).
    app.get("/api/reports/summary", async (request, reply) => {
        try {
            const { period = "30d", timezone = "Asia/Jakarta" } = request.query;
            const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
            if (!session?.user)
                return reply.status(401).send({ success: false });
            const outlet = await outletFor(session.user.id, "reports", request);
            if (!outlet)
                return reply.status(403).send({ success: false, error: "Not an owner" });
            // Local "today" (YYYY-MM-DD) in the outlet's timezone.
            const now = new Date();
            const localDateStr = (d) => {
                const p = {};
                new Intl.DateTimeFormat("en-CA", {
                    timeZone: timezone,
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                })
                    .formatToParts(d)
                    .forEach((x) => (p[x.type] = x.value));
                return `${p.year}-${p.month}-${p.day}`;
            };
            const today = localDateStr(now);
            let from;
            const to = now;
            if (period === "today") {
                from = (0, timezone_1.getUTCRangeFromLocalDate)(today, timezone).startUTC;
            }
            else if (period === "7d") {
                from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            }
            else if (period === "month") {
                from = (0, timezone_1.getUTCRangeFromLocalDate)(`${today.slice(0, 7)}-01`, timezone).startUTC;
            }
            else {
                from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            }
            // Previous window of equal length, immediately before `from`.
            const spanMs = to.getTime() - from.getTime();
            const prevFrom = new Date(from.getTime() - spanMs);
            const prevTo = from;
            const scope = (start, end) => (0, drizzle_orm_1.and)(order_scope_1.orderNotDeleted, (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, outlet.id), (0, drizzle_orm_1.gte)(schema_1.orderDetailsTable.created_at, start), (0, drizzle_orm_1.lt)(schema_1.orderDetailsTable.created_at, end), (0, drizzle_orm_1.notInArray)(schema_1.ordersTable.status, ["cancelled", "pending"]));
            const kpiSelect = {
                revenue: (0, drizzle_orm_1.sql) `coalesce(sum(${money(schema_1.orderDetailsTable.summary_price)}), 0)`.mapWith(Number),
                cogs: (0, drizzle_orm_1.sql) `coalesce(sum(${money(schema_1.productsTable.buying_price)} * ${schema_1.orderDetailsTable.quantity}), 0)`.mapWith(Number),
                orders: (0, drizzle_orm_1.sql) `count(distinct ${schema_1.orderDetailsTable.order_id})`.mapWith(Number),
            };
            const [cur, prev, trendRows, topRows, hourRows] = await Promise.all([
                db_1.db
                    .select(kpiSelect)
                    .from(schema_1.orderDetailsTable)
                    .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, schema_1.productsTable.id))
                    .innerJoin(schema_1.ordersTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, schema_1.ordersTable.id))
                    .where(scope(from, to)),
                db_1.db
                    .select(kpiSelect)
                    .from(schema_1.orderDetailsTable)
                    .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, schema_1.productsTable.id))
                    .innerJoin(schema_1.ordersTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, schema_1.ordersTable.id))
                    .where(scope(prevFrom, prevTo)),
                db_1.db
                    .select({
                    day: (0, drizzle_orm_1.sql) `(${schema_1.orderDetailsTable.created_at} at time zone ${timezone})::date`,
                    revenue: (0, drizzle_orm_1.sql) `coalesce(sum(${money(schema_1.orderDetailsTable.summary_price)}), 0)`.mapWith(Number),
                })
                    .from(schema_1.orderDetailsTable)
                    .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, schema_1.productsTable.id))
                    .innerJoin(schema_1.ordersTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, schema_1.ordersTable.id))
                    .where(scope(from, to))
                    .groupBy((0, drizzle_orm_1.sql) `1`)
                    .orderBy((0, drizzle_orm_1.sql) `1`),
                db_1.db
                    .select({
                    name: schema_1.productsTable.product_name,
                    qty: (0, drizzle_orm_1.sql) `coalesce(sum(${schema_1.orderDetailsTable.quantity}), 0)`.mapWith(Number),
                    revenue: (0, drizzle_orm_1.sql) `coalesce(sum(${money(schema_1.orderDetailsTable.summary_price)}), 0)`.mapWith(Number),
                    profit: (0, drizzle_orm_1.sql) `coalesce(sum(${money(schema_1.orderDetailsTable.summary_price)} - ${money(schema_1.productsTable.buying_price)} * ${schema_1.orderDetailsTable.quantity}), 0)`.mapWith(Number),
                })
                    .from(schema_1.orderDetailsTable)
                    .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, schema_1.productsTable.id))
                    .innerJoin(schema_1.ordersTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, schema_1.ordersTable.id))
                    .where(scope(from, to))
                    .groupBy(schema_1.productsTable.id)
                    .orderBy((0, drizzle_orm_1.desc)((0, drizzle_orm_1.sql) `coalesce(sum(${money(schema_1.orderDetailsTable.summary_price)}), 0)`))
                    .limit(8),
                db_1.db
                    .select({
                    hour: (0, drizzle_orm_1.sql) `extract(hour from (${schema_1.orderDetailsTable.created_at} at time zone ${timezone}))::int`,
                    orders: (0, drizzle_orm_1.sql) `count(distinct ${schema_1.orderDetailsTable.order_id})`.mapWith(Number),
                    revenue: (0, drizzle_orm_1.sql) `coalesce(sum(${money(schema_1.orderDetailsTable.summary_price)}), 0)`.mapWith(Number),
                })
                    .from(schema_1.orderDetailsTable)
                    .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, schema_1.productsTable.id))
                    .innerJoin(schema_1.ordersTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, schema_1.ordersTable.id))
                    .where(scope(from, to))
                    .groupBy((0, drizzle_orm_1.sql) `1`)
                    .orderBy((0, drizzle_orm_1.sql) `1`),
            ]);
            const c = cur[0] ?? { revenue: 0, cogs: 0, orders: 0 };
            const p = prev[0] ?? { revenue: 0, cogs: 0, orders: 0 };
            const pct = (a, b) => (b > 0 ? ((a - b) / b) * 100 : a > 0 ? 100 : 0);
            const hourly = Array.from({ length: 24 }, (_, i) => ({ hour: i, orders: 0, revenue: 0 }));
            hourRows.forEach((r) => {
                const h = r.hour ?? 0;
                if (h >= 0 && h < 24)
                    hourly[h] = { hour: h, orders: r.orders, revenue: Number(r.revenue) };
            });
            return {
                success: true,
                period,
                kpis: {
                    revenue: c.revenue,
                    cogs: c.cogs,
                    profit: c.revenue - c.cogs,
                    orders: c.orders,
                    aov: c.orders > 0 ? Math.round(c.revenue / c.orders) : 0,
                    revenueDeltaPct: Number(pct(c.revenue, p.revenue).toFixed(1)),
                    profitDeltaPct: Number(pct(c.revenue - c.cogs, p.revenue - p.cogs).toFixed(1)),
                    ordersDeltaPct: Number(pct(c.orders, p.orders).toFixed(1)),
                },
                trend: trendRows.map((r) => ({ day: String(r.day), revenue: Number(r.revenue) })),
                topProducts: topRows.map((r) => ({
                    name: r.name,
                    qty: r.qty,
                    revenue: Number(r.revenue),
                    profit: Number(r.profit),
                })),
                hourly,
            };
        }
        catch (error) {
            return reply.status(500).send({ success: false, error: String(error) });
        }
    });
    app.get("/api/cashflow", async (request, reply) => {
        try {
            const { month, timezone = "Asia/Jakarta" } = request.query;
            const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
            if (!session?.user)
                return reply.status(401).send({ success: false });
            const outlet = await outletFor(session.user.id, "cashflow", request);
            if (!outlet)
                return reply.status(401).send({ success: false });
            if (!month)
                return reply.status(400).send({ error: "Missing 'month' parameter" });
            const { startUTC, endUTC } = (0, timezone_1.getUTCRangeFromLocalMonth)(month, timezone);
            const rows = await db_1.db
                .select({
                id: schema_1.cashFlows.id,
                in_detail_id: schema_1.cashFlows.cash_in_detail_id,
                out_detail_id: schema_1.cashFlows.cash_out_detail_id,
                in_category: schema_1.cashInCategoryTable.category,
                in_amount: schema_1.cashInDetailTable.money_amount,
                in_date: schema_1.cashInDetailTable.created_at,
                out_category: schema_1.cashOutCategoryTable.category,
                out_amount: schema_1.cashOutDetailTable.money_amount,
                out_date: schema_1.cashOutDetailTable.created_at,
                invoice_number: schema_1.invoicesTable.number,
            })
                .from(schema_1.cashFlows)
                .leftJoin(schema_1.cashInDetailTable, (0, drizzle_orm_1.eq)(schema_1.cashFlows.cash_in_detail_id, schema_1.cashInDetailTable.id))
                .leftJoin(schema_1.cashInCategoryTable, (0, drizzle_orm_1.eq)(schema_1.cashInDetailTable.category_id, schema_1.cashInCategoryTable.id))
                .leftJoin(schema_1.cashOutDetailTable, (0, drizzle_orm_1.eq)(schema_1.cashFlows.cash_out_detail_id, schema_1.cashOutDetailTable.id))
                .leftJoin(schema_1.cashOutCategoryTable, (0, drizzle_orm_1.eq)(schema_1.cashOutDetailTable.category_id, schema_1.cashOutCategoryTable.id))
                // Invoice payments link back to their invoice via invoice_payments —
                // sales cash-ins through cash_in_detail_id, purchase cash-outs through
                // cash_out_detail_id. Surface the invoice number as the row note so each
                // payment is traceable to its invoice.
                .leftJoin(schema_1.invoicePaymentsTable, (0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.invoicePaymentsTable.cash_in_detail_id, schema_1.cashInDetailTable.id), (0, drizzle_orm_1.eq)(schema_1.invoicePaymentsTable.cash_out_detail_id, schema_1.cashOutDetailTable.id)))
                .leftJoin(schema_1.invoicesTable, (0, drizzle_orm_1.eq)(schema_1.invoicesTable.id, schema_1.invoicePaymentsTable.invoice_id))
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cashFlows.outlet_id, outlet.id), (0, drizzle_orm_1.or)((0, drizzle_orm_1.and)((0, drizzle_orm_1.gte)(schema_1.cashInDetailTable.created_at, startUTC), (0, drizzle_orm_1.lt)(schema_1.cashInDetailTable.created_at, endUTC)), (0, drizzle_orm_1.and)((0, drizzle_orm_1.gte)(schema_1.cashOutDetailTable.created_at, startUTC), (0, drizzle_orm_1.lt)(schema_1.cashOutDetailTable.created_at, endUTC)))));
            const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
            const timeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false });
            const data = rows.map((row) => {
                const date = row.in_date ?? row.out_date;
                return {
                    id: String(row.id),
                    type: (row.in_detail_id !== null ? "IN" : "OUT"),
                    category: (row.in_category ?? row.out_category) ?? "",
                    amount: Number(row.in_amount ?? row.out_amount ?? "0"),
                    date: dateFormatter.format(date),
                    time: timeFormatter.format(date),
                    note: row.invoice_number ?? "",
                };
            });
            return { data };
        }
        catch (error) {
            return reply.status(500).send({ message: String(error) });
        }
    });
    app.post("/api/cashflow", async (request, reply) => {
        try {
            const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
            if (!session?.user)
                return reply.status(401).send({ success: false });
            const outlet = await outletFor(session.user.id, "cashflow", request);
            if (!outlet)
                return reply.status(401).send({ success: false });
            const { type, category, amount, date, timezone = "Asia/Jakarta" } = request.body;
            if (!type || !category || !amount || !date)
                return reply.status(400).send({ error: "Missing required fields" });
            if (isNaN(Number(amount)) || Number(amount) <= 0)
                return reply.status(400).send({ error: "Invalid amount" });
            const { startUTC, endUTC } = (0, timezone_1.getUTCRangeFromLocalDate)(date, timezone);
            const now = new Date();
            const created_at = now >= startUTC && now <= endUTC ? now : startUTC;
            const timeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false });
            if (type === "IN") {
                const [cat] = await db_1.db
                    .select({ id: schema_1.cashInCategoryTable.id })
                    .from(schema_1.cashInCategoryTable)
                    .where((0, drizzle_orm_1.eq)(schema_1.cashInCategoryTable.category, category))
                    .limit(1);
                if (!cat)
                    return reply.status(400).send({ error: "Unknown category" });
                const [detail] = await db_1.db.insert(schema_1.cashInDetailTable).values({ category_id: cat.id, money_amount: String(amount), type: "cash", created_at }).returning();
                const [cf] = await db_1.db.insert(schema_1.cashFlows).values({ outlet_id: outlet.id, cash_in_detail_id: detail.id }).returning();
                return { data: { id: String(cf.id), type: "IN", category, amount: Number(amount), date, time: timeFormatter.format(detail.created_at), note: "" } };
            }
            if (type === "OUT") {
                const [cat] = await db_1.db
                    .select({ id: schema_1.cashOutCategoryTable.id })
                    .from(schema_1.cashOutCategoryTable)
                    .where((0, drizzle_orm_1.eq)(schema_1.cashOutCategoryTable.category, category))
                    .limit(1);
                if (!cat)
                    return reply.status(400).send({ error: "Unknown category" });
                const [detail] = await db_1.db.insert(schema_1.cashOutDetailTable).values({ category_id: cat.id, money_amount: String(amount), type: "cash", created_at }).returning();
                const [cf] = await db_1.db.insert(schema_1.cashFlows).values({ outlet_id: outlet.id, cash_out_detail_id: detail.id }).returning();
                return { data: { id: String(cf.id), type: "OUT", category, amount: Number(amount), date, time: timeFormatter.format(detail.created_at), note: "" } };
            }
            return reply.status(400).send({ error: "Invalid type" });
        }
        catch (error) {
            return reply.status(500).send({ message: String(error) });
        }
    });
    app.delete("/api/cashflow", async (request, reply) => {
        try {
            const { id } = request.query;
            const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
            if (!session?.user)
                return reply.status(401).send({ success: false });
            const outlet = await outletFor(session.user.id, "cashflow", request);
            if (!outlet)
                return reply.status(401).send({ success: false });
            if (!id || isNaN(Number(id)))
                return reply.status(400).send({ error: "Missing or invalid 'id' parameter" });
            const [cf] = await db_1.db
                .select()
                .from(schema_1.cashFlows)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cashFlows.id, Number(id)), (0, drizzle_orm_1.eq)(schema_1.cashFlows.outlet_id, outlet.id)))
                .limit(1);
            if (!cf)
                return reply.status(404).send({ error: "Not found" });
            const inDetailId = cf.cash_in_detail_id;
            const outDetailId = cf.cash_out_detail_id;
            await db_1.db.delete(schema_1.cashFlows).where((0, drizzle_orm_1.eq)(schema_1.cashFlows.id, Number(id)));
            if (inDetailId)
                await db_1.db.delete(schema_1.cashInDetailTable).where((0, drizzle_orm_1.eq)(schema_1.cashInDetailTable.id, inDetailId));
            if (outDetailId)
                await db_1.db.delete(schema_1.cashOutDetailTable).where((0, drizzle_orm_1.eq)(schema_1.cashOutDetailTable.id, outDetailId));
            return { success: true };
        }
        catch (error) {
            return reply.status(500).send({ message: String(error) });
        }
    });
    app.get("/api/get-pos-cashin", async (request, reply) => {
        try {
            const { timezone = "Asia/Jakarta", date } = request.query;
            const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
            if (!session?.user)
                return reply.status(401).send({ success: false });
            const outlet = await outletFor(session.user.id, "reports", request);
            if (!outlet)
                return reply.status(401).send({ success: false });
            if (!date)
                return reply.status(400).send({ success: false, error: "Missing 'date' parameter" });
            const { startUTC, endUTC } = (0, timezone_1.getUTCRangeFromLocalDate)(date, timezone);
            const rows = await db_1.db
                .select({
                id: schema_1.cashInDetailTable.id,
                category: schema_1.cashInCategoryTable.category,
                money_amount: (0, drizzle_orm_1.sql) `cast(${schema_1.cashInDetailTable.money_amount} as text)`,
                created_at: schema_1.cashInDetailTable.created_at,
            })
                .from(schema_1.cashInDetailTable)
                .innerJoin(schema_1.cashInCategoryTable, (0, drizzle_orm_1.eq)(schema_1.cashInDetailTable.category_id, schema_1.cashInCategoryTable.id))
                .innerJoin(schema_1.cashFlows, (0, drizzle_orm_1.eq)(schema_1.cashFlows.cash_in_detail_id, schema_1.cashInDetailTable.id))
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cashFlows.outlet_id, outlet.id), (0, drizzle_orm_1.gte)(schema_1.cashInDetailTable.created_at, startUTC), (0, drizzle_orm_1.lt)(schema_1.cashInDetailTable.created_at, endUTC)))
                .orderBy((0, drizzle_orm_1.desc)(schema_1.cashInDetailTable.created_at));
            const total = rows.reduce((sum, r) => sum + Number(r.money_amount), 0);
            return {
                success: true,
                // Formatted server-side, so it needs an explicit zone — a bare
                // toLocaleTimeString() reads the process TZ and prints UTC.
                data: rows.map((r) => ({
                    id: r.id,
                    category: r.category,
                    amount: Number(r.money_amount),
                    time: new Date(r.created_at).toLocaleTimeString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: timezone_1.APP_TIMEZONE,
                    }),
                })),
                total,
            };
        }
        catch (error) {
            return reply.status(500).send({ success: false, error: String(error) });
        }
    });
    app.get("/api/get-pos-summary", async (request, reply) => {
        try {
            const { date = "", month = "", timeZone = "Asia/Jakarta" } = request.query;
            const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
            if (!session?.user)
                return reply.status(401).send({ success: false });
            const outlet = await outletFor(session.user.id, "reports", request);
            if (!outlet)
                return reply.status(401).send({ success: false });
            let startUTC, endUTC;
            if (date) {
                ({ startUTC, endUTC } = (0, timezone_1.getUTCRangeFromLocalDate)(date, timeZone));
            }
            else if (month) {
                ({ startUTC, endUTC } = (0, timezone_1.getUTCRangeFromLocalMonth)(month, timeZone));
            }
            else {
                return reply.status(400).send({ success: false, error: "Missing 'date' or 'month' parameter" });
            }
            const [salesResult] = await db_1.db
                .select({
                total: (0, drizzle_orm_1.sql) `coalesce(sum(${money(schema_1.orderDetailsTable.summary_price)}), 0)`,
                count: (0, drizzle_orm_1.sql) `count(distinct ${schema_1.orderDetailsTable.order_id})`,
            })
                .from(schema_1.orderDetailsTable)
                .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, schema_1.productsTable.id))
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, outlet.id), (0, drizzle_orm_1.gte)(schema_1.orderDetailsTable.created_at, startUTC), (0, drizzle_orm_1.lt)(schema_1.orderDetailsTable.created_at, endUTC)));
            const [cashInResult] = await db_1.db
                .select({ total: (0, drizzle_orm_1.sql) `coalesce(sum(cast(${schema_1.cashInDetailTable.money_amount} as numeric)), 0)` })
                .from(schema_1.cashInDetailTable)
                .innerJoin(schema_1.cashFlows, (0, drizzle_orm_1.eq)(schema_1.cashFlows.cash_in_detail_id, schema_1.cashInDetailTable.id))
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cashFlows.outlet_id, outlet.id), (0, drizzle_orm_1.gte)(schema_1.cashInDetailTable.created_at, startUTC), (0, drizzle_orm_1.lt)(schema_1.cashInDetailTable.created_at, endUTC)));
            const [cashOutResult] = await db_1.db
                .select({ total: (0, drizzle_orm_1.sql) `coalesce(sum(cast(${schema_1.cashOutDetailTable.money_amount} as numeric)), 0)` })
                .from(schema_1.cashOutDetailTable)
                .innerJoin(schema_1.cashFlows, (0, drizzle_orm_1.eq)(schema_1.cashFlows.cash_out_detail_id, schema_1.cashOutDetailTable.id))
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cashFlows.outlet_id, outlet.id), (0, drizzle_orm_1.gte)(schema_1.cashOutDetailTable.created_at, startUTC), (0, drizzle_orm_1.lt)(schema_1.cashOutDetailTable.created_at, endUTC)));
            return {
                success: true,
                sales: Number(salesResult?.total ?? 0),
                salesCount: Number(salesResult?.count ?? 0),
                cashIn: Number(cashInResult?.total ?? 0),
                cashOut: Number(cashOutResult?.total ?? 0),
                balance: Number(salesResult?.total ?? 0) + Number(cashInResult?.total ?? 0) - Number(cashOutResult?.total ?? 0),
            };
        }
        catch (error) {
            return reply.status(500).send({ success: false, error: String(error) });
        }
    });
}
