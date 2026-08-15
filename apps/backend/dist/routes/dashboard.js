"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashboardRoutes = dashboardRoutes;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../auth");
const web_headers_1 = require("../lib/web-headers");
const outlet_features_1 = require("../lib/outlet-features");
const outlet_access_1 = require("../lib/outlet-access");
const timezone_1 = require("../lib/timezone");
const ad_schedule_1 = require("../lib/utils/ad-schedule");
const courier_availability_1 = require("../lib/utils/courier-availability");
const format_1 = require("../lib/utils/format");
const geo_1 = require("../lib/utils/geo");
const phone_1 = require("../lib/utils/phone");
const coords_1 = require("../lib/utils/coords");
// Role-specific dashboard payloads, composed server-side (was direct DB access
// in the frontend dashboard/page.tsx). Each endpoint returns exactly the props
// its dashboard component consumes.
async function dashboardRoutes(app) {
    app.get("/api/dashboard/owner", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ ok: false });
        const access = await (0, outlet_access_1.getOutletAccess)(session.user.id, (0, outlet_access_1.parseActiveOutletId)(request));
        const outlet = access && (0, outlet_access_1.hasPermission)(access, "reports") ? access.outlet : null;
        if (!outlet)
            return reply.send({ ok: false });
        const outletId = outlet.id;
        const since = new Date((0, timezone_1.getUTCTime)().getTime() - 24 * 60 * 60 * 1000);
        const rawOrders = await db_1.db
            .select({
            orderId: schema_1.ordersTable.id,
            status: schema_1.ordersTable.status,
            itemCount: (0, drizzle_orm_1.sum)(schema_1.orderDetailsTable.quantity).mapWith(Number),
            totalAmount: (0, drizzle_orm_1.sum)((0, drizzle_orm_1.sql) `CAST(${schema_1.orderDetailsTable.summary_price} AS NUMERIC)`).mapWith(Number),
        })
            .from(schema_1.ordersTable)
            .leftJoin(schema_1.orderDetailsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, schema_1.ordersTable.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, outletId), (0, drizzle_orm_1.gte)(schema_1.ordersTable.createdAt, since)))
            .groupBy(schema_1.ordersTable.id);
        const recentOrders = rawOrders.map((o) => ({
            orderId: o.orderId,
            itemCount: o.itemCount ?? 0,
            totalAmount: o.totalAmount ?? 0,
            status: o.status === "delivered"
                ? "checkout"
                : ["confirmed", "preparing", "ready", "on_delivery"].includes(o.status)
                    ? "addToChart"
                    : null,
        }));
        const activeOrdersCount = rawOrders.filter((o) => !["delivered", "cancelled"].includes(o.status)).length;
        const now = new Date();
        const currentPeriodStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
        const previousPeriodStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        const validOrderDetails = (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, outletId), (0, drizzle_orm_1.notInArray)(schema_1.ordersTable.status, ["cancelled", "pending"]));
        const [[currentPeriod], [previousPeriod], [topProductRow]] = await Promise.all([
            db_1.db
                .select({
                total: (0, drizzle_orm_1.sql) `coalesce(sum(cast(${schema_1.orderDetailsTable.summary_price} as numeric)), 0)`.mapWith(Number),
            })
                .from(schema_1.orderDetailsTable)
                .innerJoin(schema_1.ordersTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, schema_1.ordersTable.id))
                .where((0, drizzle_orm_1.and)(validOrderDetails, (0, drizzle_orm_1.gte)(schema_1.orderDetailsTable.created_at, currentPeriodStart))),
            db_1.db
                .select({
                total: (0, drizzle_orm_1.sql) `coalesce(sum(cast(${schema_1.orderDetailsTable.summary_price} as numeric)), 0)`.mapWith(Number),
            })
                .from(schema_1.orderDetailsTable)
                .innerJoin(schema_1.ordersTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, schema_1.ordersTable.id))
                .where((0, drizzle_orm_1.and)(validOrderDetails, (0, drizzle_orm_1.gte)(schema_1.orderDetailsTable.created_at, previousPeriodStart), (0, drizzle_orm_1.lt)(schema_1.orderDetailsTable.created_at, currentPeriodStart))),
            db_1.db
                .select({
                name: schema_1.productsTable.product_name,
                category: schema_1.productsTable.category,
                totalSold: (0, drizzle_orm_1.sum)(schema_1.orderDetailsTable.quantity).mapWith(Number),
            })
                .from(schema_1.orderDetailsTable)
                .innerJoin(schema_1.ordersTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, schema_1.ordersTable.id))
                .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, schema_1.productsTable.id))
                .where((0, drizzle_orm_1.and)(validOrderDetails, (0, drizzle_orm_1.gte)(schema_1.orderDetailsTable.created_at, currentPeriodStart)))
                .groupBy(schema_1.productsTable.id)
                .orderBy((0, drizzle_orm_1.desc)((0, drizzle_orm_1.sum)(schema_1.orderDetailsTable.quantity)))
                .limit(1),
        ]);
        const currentSales = currentPeriod?.total ?? 0;
        const previousSales = previousPeriod?.total ?? 0;
        const total6monthsSales = {
            totalSales: currentSales,
            percentage: previousSales > 0
                ? ((currentSales - previousSales) / previousSales) * 100
                : currentSales > 0
                    ? 100
                    : 0,
        };
        return reply.send({
            ok: true,
            activeOrdersCount,
            recentOrders,
            total6monthsSales,
            topProduct: topProductRow ?? null,
        });
    });
    app.get("/api/dashboard/courier", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ ok: false });
        const [courier] = await db_1.db
            .select({
            id: schema_1.couriersTable.id,
            verificationStatus: schema_1.couriersTable.verification_status,
            verificationNote: schema_1.couriersTable.verification_note,
        })
            .from(schema_1.couriersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, session.user.id))
            .limit(1);
        if (!courier)
            return reply.send({ ok: false });
        let initialIsOnline = false;
        let todayOnlineSeconds = 0;
        const [openSession] = await db_1.db
            .select({ started_at: schema_1.courierSessionsTable.started_at })
            .from(schema_1.courierSessionsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.courierSessionsTable.courier_id, courier.id), (0, drizzle_orm_1.isNull)(schema_1.courierSessionsTable.ended_at), 
        // Past the 12h cap the shift is over, so the courier's own dashboard
        // shouldn't still show them on duty.
        (0, drizzle_orm_1.gte)(schema_1.courierSessionsTable.started_at, (0, courier_availability_1.staleShiftCutoff)())))
            .limit(1);
        initialIsOnline = !!openSession;
        // "Today" means the courier's local day (WIB), not the server's. Railway
        // runs the container in UTC, so `new Date().setHours(0,0,0,0)` marked
        // midnight UTC = 07:00 WIB — every morning before 7am the figure still
        // carried most of the previous day's hours.
        const todayLocal = (0, timezone_1.getUTCTime)().toISOString().slice(0, 10);
        const { startUTC: dayStart, endUTC: dayEnd } = (0, timezone_1.getUTCRangeFromLocalDate)(todayLocal);
        const [onlineResult] = await db_1.db
            .select({
            // Sum the part of each shift that falls INSIDE today, rather than the
            // whole shift: a 22:00->02:00 run belongs to two different days, and
            // counting it wholly against either one is wrong. Three clamps:
            //   - LEAST(...)  end of the overlap: shift end, the 12h cap, or midnight
            //   - GREATEST(started_at, dayStart)  start of the overlap
            //   - GREATEST(0, ...)  a shift entirely outside today contributes 0
            totalSeconds: (0, drizzle_orm_1.sql) `
          COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (
            LEAST(
              COALESCE(${schema_1.courierSessionsTable.ended_at}, NOW()),
              ${schema_1.courierSessionsTable.started_at} + make_interval(hours => ${courier_availability_1.MAX_SHIFT_HOURS}),
              ${dayEnd}::timestamptz
            )
            - GREATEST(${schema_1.courierSessionsTable.started_at}, ${dayStart}::timestamptz)
          )))), 0)
        `,
        })
            .from(schema_1.courierSessionsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.courierSessionsTable.courier_id, courier.id), 
        // Any shift overlapping today, including one that began yesterday.
        (0, drizzle_orm_1.lte)(schema_1.courierSessionsTable.started_at, dayEnd), (0, drizzle_orm_1.sql) `least(coalesce(${schema_1.courierSessionsTable.ended_at}, now()), ${schema_1.courierSessionsTable.started_at} + make_interval(hours => ${courier_availability_1.MAX_SHIFT_HOURS})) >= ${dayStart}::timestamptz`));
        todayOnlineSeconds = Math.floor(onlineResult?.totalSeconds ?? 0);
        const [{ completion, sum: earningToday }] = await db_1.db
            .select({
            completion: (0, drizzle_orm_1.count)(schema_1.ordersTable.id),
            sum: (0, drizzle_orm_1.sql) `SUM(CAST(orders.delivery_fee as NUMERIC))`,
        })
            .from(schema_1.ordersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.ordersTable.courier_id, courier.id));
        const [{ totalCancel: cancelOrderByCourier }] = await db_1.db
            .select({ totalCancel: (0, drizzle_orm_1.count)(schema_1.ordersTable.id) })
            .from(schema_1.ordersTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ordersTable.courier_id, courier.id), (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "cancelled"), (0, drizzle_orm_1.eq)(schema_1.ordersTable.rejected_by, "courier")));
        const [{ rating }] = await db_1.db
            .select({ rating: schema_1.couriersTable.ratings })
            .from(schema_1.couriersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.id, courier.id));
        const dashboardValue = {
            earningToday: (0, format_1.formatCurrency)(earningToday || 0),
            rating: String(rating),
            completion: (completion === 0 ? 100 : Math.round((1 - cancelOrderByCourier / completion) * 100)) + "%",
        };
        const { ratingStatus, delaySeconds } = await (0, courier_availability_1.getCourierRatingInfo)(courier.id);
        const courierNow = (0, timezone_1.getUTCTime)();
        const daysSinceMonday = (courierNow.getUTCDay() + 6) % 7;
        const thisWeekStart = new Date(courierNow);
        thisWeekStart.setUTCDate(courierNow.getUTCDate() - daysSinceMonday);
        thisWeekStart.setUTCHours(0, 0, 0, 0);
        const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
        const [[thisWeekStats], [lastWeekStats]] = await Promise.all([
            db_1.db
                .select({
                total: (0, drizzle_orm_1.sql) `coalesce(sum(cast(${schema_1.ordersTable.delivery_fee} as numeric)), 0)`.mapWith(Number),
                orders: (0, drizzle_orm_1.count)(schema_1.ordersTable.id),
            })
                .from(schema_1.ordersTable)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ordersTable.courier_id, courier.id), (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "delivered"), (0, drizzle_orm_1.gte)(schema_1.ordersTable.createdAt, thisWeekStart))),
            db_1.db
                .select({
                total: (0, drizzle_orm_1.sql) `coalesce(sum(cast(${schema_1.ordersTable.delivery_fee} as numeric)), 0)`.mapWith(Number),
            })
                .from(schema_1.ordersTable)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ordersTable.courier_id, courier.id), (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "delivered"), (0, drizzle_orm_1.gte)(schema_1.ordersTable.createdAt, lastWeekStart), (0, drizzle_orm_1.lt)(schema_1.ordersTable.createdAt, thisWeekStart))),
        ]);
        const thisWeekEarnings = thisWeekStats?.total ?? 0;
        const lastWeekEarnings = lastWeekStats?.total ?? 0;
        const thisWeekOrders = thisWeekStats?.orders ?? 0;
        // Per-day earnings for the sparkline on the courier's weekly card. Bucketed
        // in JS rather than with date_trunc: the week boundaries above come from
        // getUTCTime()'s shifted clock, and grouping raw created_at in Postgres
        // would slice the days on a different edge than the totals they sit under.
        const weekOrders = await db_1.db
            .select({ createdAt: schema_1.ordersTable.createdAt, fee: schema_1.ordersTable.delivery_fee })
            .from(schema_1.ordersTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ordersTable.courier_id, courier.id), (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "delivered"), (0, drizzle_orm_1.gte)(schema_1.ordersTable.createdAt, thisWeekStart)));
        const DAY_LABELS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
        const dailyTotals = new Array(7).fill(0);
        for (const order of weekOrders) {
            if (!order.createdAt)
                continue;
            const dayIndex = Math.floor((order.createdAt.getTime() - thisWeekStart.getTime()) / 86_400_000);
            if (dayIndex >= 0 && dayIndex < 7)
                dailyTotals[dayIndex] += Number(order.fee ?? 0);
        }
        const daily = DAY_LABELS.map((label, i) => ({ label, amount: dailyTotals[i] }));
        const weeklyPerformance = {
            daily,
            totalEarnings: (0, format_1.formatCurrency)(thisWeekEarnings),
            percentageChange: lastWeekEarnings > 0
                ? ((thisWeekEarnings - lastWeekEarnings) / lastWeekEarnings) * 100
                : thisWeekEarnings > 0
                    ? 100
                    : 0,
            orders: thisWeekOrders,
            avgPerOrder: (0, format_1.formatCurrency)(thisWeekOrders > 0 ? thisWeekEarnings / thisWeekOrders : 0),
        };
        const [activeOrder] = await db_1.db
            .select({
            id: schema_1.ordersTable.id,
            name_customer: schema_1.usersTable.name,
            customer_phone: schema_1.usersTable.phone,
            pickup: schema_1.outletsTable.name,
            dropoff: schema_1.locationsTable.address,
            dropoffLat: schema_1.locationsTable.lat,
            dropoffLon: schema_1.locationsTable.lon,
            delivery_fee: schema_1.ordersTable.delivery_fee,
            status: schema_1.ordersTable.status,
        })
            .from(schema_1.ordersTable)
            .innerJoin(schema_1.customersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, schema_1.customersTable.id))
            .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, schema_1.usersTable.id))
            .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, schema_1.outletsTable.id))
            .leftJoin(schema_1.locationsTable, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.locationsTable.user_id, schema_1.usersTable.id), (0, drizzle_orm_1.eq)(schema_1.locationsTable.is_default, true)))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ordersTable.courier_id, courier.id), (0, drizzle_orm_1.inArray)(schema_1.ordersTable.status, ["confirmed", "preparing", "ready", "on_delivery"])))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.ordersTable.createdAt))
            .limit(1);
        let currentPickUpItems = 0;
        if (activeOrder) {
            const [{ itemCount }] = await db_1.db
                .select({ itemCount: (0, drizzle_orm_1.count)(schema_1.orderDetailsTable.id) })
                .from(schema_1.orderDetailsTable)
                .where((0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, activeOrder.id));
            currentPickUpItems = itemCount;
        }
        const currentPickUp = activeOrder
            ? {
                id: activeOrder.id,
                name_customer: activeOrder.name_customer,
                // Canonical 628… so the courier UI can drop it straight into a wa.me
                // link. Null when the stored number is unusable — the UI hides the
                // contact buttons rather than opening a chat with a bad number.
                customer_phone: (0, phone_1.normalizeIndonesianPhone)(activeOrder.customer_phone),
                pickup: activeOrder.pickup,
                dropoff: activeOrder.dropoff ?? "-",
                // Drop-off point for the courier's "Lihat Peta" link. Null when the
                // stored pair is junk ('' / 'NaN' both fit the varchar column), so the
                // UI can fall back to searching the address text instead of routing
                // the rider to 0,0.
                dropoffCoords: (0, coords_1.parseCoordPair)(activeOrder.dropoffLat, activeOrder.dropoffLon),
                items: currentPickUpItems,
                amount: (0, format_1.formatCurrency)(parseFloat(activeOrder.delivery_fee ?? "0")),
                status: activeOrder.status,
            }
            : null;
        return reply.send({
            ok: true,
            currentPickUp,
            dashboardValue,
            weeklyPerformance,
            initialIsOnline,
            todayOnlineSeconds,
            ratingStatus,
            delaySeconds,
            // Drives the dashboard's gate. Sent on every load rather than cached in a
            // cookie or the session: an admin can approve or revoke at any moment, and
            // the courier finding out on their next refresh is the whole point.
            verificationStatus: courier.verificationStatus,
            verificationNote: courier.verificationNote,
        });
    });
    app.get("/api/dashboard/customer", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ ok: false });
        const [customer] = await db_1.db
            .select({ id: schema_1.customersTable.id })
            .from(schema_1.customersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, session.user.id))
            .limit(1);
        const lastOrders = [];
        if (customer) {
            const rawLastOrders = await db_1.db
                .select({
                orderId: schema_1.ordersTable.id,
                outletId: schema_1.outletsTable.id,
                outletName: schema_1.outletsTable.name,
                // The ordered product's own features drive "Order Lagi" routing — the
                // outlet may offer several features, but we want the one that was
                // actually ordered.
                productFeature: (0, drizzle_orm_1.sql) `(
            SELECT ${schema_1.productsTable.features}
            FROM ${schema_1.orderDetailsTable}
            JOIN ${schema_1.productsTable} ON ${schema_1.productsTable.id} = ${schema_1.orderDetailsTable.product_id}
            WHERE ${schema_1.orderDetailsTable.order_id} = ${schema_1.ordersTable.id}
            ORDER BY ${schema_1.orderDetailsTable.id}
            LIMIT 1
          )`,
                outletAvatar: schema_1.outletsTable.avatar,
                itemCount: (0, drizzle_orm_1.sum)(schema_1.orderDetailsTable.quantity).mapWith(Number),
                totalAmount: (0, drizzle_orm_1.sum)((0, drizzle_orm_1.sql) `CAST(${schema_1.orderDetailsTable.summary_price} AS NUMERIC)`).mapWith(Number),
                itemNames: (0, drizzle_orm_1.sql) `array_agg(${schema_1.productsTable.product_name})`,
            })
                .from(schema_1.ordersTable)
                .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, schema_1.outletsTable.id))
                .leftJoin(schema_1.orderDetailsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, schema_1.ordersTable.id))
                .leftJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, schema_1.productsTable.id))
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, customer.id), (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "delivered")))
                .groupBy(schema_1.ordersTable.id, schema_1.outletsTable.id)
                .orderBy((0, drizzle_orm_1.desc)(schema_1.ordersTable.createdAt))
                .limit(3);
            rawLastOrders.forEach((o) => {
                lastOrders.push({
                    orderId: o.orderId,
                    outletId: o.outletId,
                    outletName: o.outletName,
                    productFeature: o.productFeature ?? [],
                    outletAvatar: o.outletAvatar,
                    itemCount: o.itemCount ?? 0,
                    totalAmount: o.totalAmount ?? 0,
                    itemsSummary: (o.itemNames ?? []).filter(Boolean).join(", "),
                });
            });
        }
        const recommendedMenus = await db_1.db
            .select({
            outletId: schema_1.outletsTable.id,
            outletFeature: schema_1.productsTable.features,
            name: schema_1.productsTable.product_name,
            lat: schema_1.outletsTable.lat,
            lon: schema_1.outletsTable.lon,
            address: schema_1.outletsTable.address,
            rating: schema_1.productsTable.ratings,
            image: schema_1.productsTable.image,
        })
            .from(schema_1.productsTable)
            .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, schema_1.outletsTable.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.is_recommended, true), (0, drizzle_orm_1.eq)(schema_1.productsTable.isAvailable, true), (0, drizzle_orm_1.eq)(schema_1.productsTable.is_for_sale, true), (0, outlet_features_1.notInternalCategory)(), (0, drizzle_orm_1.isNull)(schema_1.productsTable.deletedAt), (0, drizzle_orm_1.eq)(schema_1.outletsTable.is_open, true)))
            .groupBy(schema_1.outletsTable.id, schema_1.productsTable.id)
            .orderBy((0, drizzle_orm_1.desc)(schema_1.productsTable.review_count))
            .limit(3);
        // label/address ride along for the dashboard's delivery-address header —
        // same default-address row the distances below are measured from, so what
        // the customer reads at the top is what everything under it is relative to.
        const [userLocation] = await db_1.db
            .select({
            id: schema_1.locationsTable.id,
            label: schema_1.locationsTable.label,
            address: schema_1.locationsTable.address,
            lat: schema_1.locationsTable.lat,
            lon: schema_1.locationsTable.lon,
        })
            .from(schema_1.locationsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.locationsTable.user_id, session.user.id), (0, drizzle_orm_1.eq)(schema_1.locationsTable.is_default, true)))
            .limit(1);
        const recommend = recommendedMenus.map((r) => {
            const distance = userLocation
                ? `${(0, geo_1.haversineKm)(parseFloat(userLocation.lat), parseFloat(userLocation.lon), parseFloat(r.lat), parseFloat(r.lon)).toFixed(1)} km`
                : "-";
            return {
                outletId: r.outletId,
                outletFeature: r.outletFeature[0] ?? "food",
                menuName: r.name,
                rating: r.rating ?? "5.00",
                distance,
                image: r.image,
            };
        });
        const { now: adNow, day: adDay, hour: adHour } = (0, ad_schedule_1.getCurrentAdSlot)();
        const adRows = await db_1.db
            .select({
            id: schema_1.productAdsTable.id,
            title: schema_1.productAdsTable.title,
            description: schema_1.productAdsTable.description,
            bannerImage: schema_1.productAdsTable.banner_image,
            outletId: schema_1.outletsTable.id,
            outletFeatures: schema_1.outletsTable.features,
            productName: schema_1.productsTable.product_name,
        })
            .from(schema_1.productAdsTable)
            .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.productAdsTable.outlet_id, schema_1.outletsTable.id))
            .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.productAdsTable.product_id, schema_1.productsTable.id))
            .innerJoin(schema_1.productAdsSchedule, (0, drizzle_orm_1.eq)(schema_1.productAdsSchedule.productAdsSchedule_id, schema_1.productAdsTable.id))
            .innerJoin(schema_1.scheduleProductAdsTable, (0, drizzle_orm_1.eq)(schema_1.scheduleProductAdsTable.id, schema_1.productAdsSchedule.scheduleProductAdsTable_id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productAdsTable.status, "approved"), (0, drizzle_orm_1.eq)(schema_1.productAdsTable.is_active, true), (0, drizzle_orm_1.lte)(schema_1.productAdsTable.starts_at, adNow), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.productAdsTable.ends_at), (0, drizzle_orm_1.gte)(schema_1.productAdsTable.ends_at, adNow)), (0, drizzle_orm_1.sql) `${schema_1.scheduleProductAdsTable.time}->>'day' = ${adDay}`, (0, drizzle_orm_1.sql) `${schema_1.scheduleProductAdsTable.time}->>'hour' = ${adHour}`))
            .orderBy((0, drizzle_orm_1.sql) `RANDOM()`)
            .limit(10);
        const ads = adRows.map((ad) => ({
            id: ad.id,
            title: ad.title,
            description: ad.description ?? "",
            bannerImage: ad.bannerImage,
            outletId: ad.outletId,
            outletFeature: ad.outletFeatures[0] ?? "food",
            productName: ad.productName,
        }));
        return reply.send({
            ok: true,
            lastOrders,
            recommend,
            ads,
            hasLocation: !!userLocation,
            location: userLocation
                ? { id: userLocation.id, label: userLocation.label, address: userLocation.address }
                : null,
        });
    });
}
