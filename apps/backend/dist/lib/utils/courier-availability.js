"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROBATION_MIN_DELAY_SECONDS = exports.PROBATION_MAX_DELAY_SECONDS = exports.PROBATION_ROLLING_WINDOW = exports.PROBATION_MIN_REVIEWS = exports.PROBATION_RATING_THRESHOLD = exports.cappedShiftEnd = exports.MAX_SHIFT_HOURS = void 0;
exports.staleShiftCutoff = staleShiftCutoff;
exports.closeStaleCourierSessions = closeStaleCourierSessions;
exports.getProbationDelaySeconds = getProbationDelaySeconds;
exports.getCourierRatingInfo = getCourierRatingInfo;
exports.getCourierAvailability = getCourierAvailability;
const db_1 = require("../../db");
const schema_1 = require("../../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const ACTIVE_ORDER_STATUSES = ['preparing', 'ready', 'on_delivery'];
// The errand equivalent. 'pending' counts as busy even though no job has been
// agreed yet: a pending errand holds the courier exclusively while he decides,
// which is the whole point of errand_orders_courier_pending_uq. Leaving it out
// would let a courier be offered other work in the gap between being asked and
// answering — and then accept both.
const ACTIVE_ERRAND_STATUSES = ['pending', 'on_delivery'];
// Hard ceiling on one shift. Nothing closes a session when a courier simply
// walks away — it stays open until their *next* go-online — so without a cap a
// courier reads as online indefinitely and keeps being offered orders. Real
// data contained a single 665-hour "shift" (1 Jul -> 29 Jul).
exports.MAX_SHIFT_HOURS = 12;
/** Open sessions that started before this are over, whatever the row says. */
function staleShiftCutoff() {
    return new Date(Date.now() - exports.MAX_SHIFT_HOURS * 60 * 60 * 1000);
}
/** SQL expression capping a shift's end at started_at + MAX_SHIFT_HOURS. */
exports.cappedShiftEnd = (0, drizzle_orm_1.sql) `least(coalesce(${schema_1.courierSessionsTable.ended_at}, now()), ${schema_1.courierSessionsTable.started_at} + make_interval(hours => ${exports.MAX_SHIFT_HOURS}))`;
/**
 * Stamps ended_at on shifts that overran the cap.
 *
 * The end is set to started_at + 12h, NOT now(): the courier did not work up
 * to this moment, and stamping now() is precisely what turned an abandoned
 * session into a 665-hour record. Safe to call repeatedly — it only matches
 * rows that are still open and already past the cap.
 */
async function closeStaleCourierSessions() {
    await db_1.db
        .update(schema_1.courierSessionsTable)
        .set({
        ended_at: (0, drizzle_orm_1.sql) `${schema_1.courierSessionsTable.started_at} + make_interval(hours => ${exports.MAX_SHIFT_HOURS})`,
    })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.isNull)(schema_1.courierSessionsTable.ended_at), (0, drizzle_orm_1.lt)(schema_1.courierSessionsTable.started_at, staleShiftCutoff())));
}
// Couriers whose recent ratings drop below the threshold go on probation:
// they can still receive orders, but new orders are shown to them after a
// short delay so good-standing couriers get first pick.
exports.PROBATION_RATING_THRESHOLD = 3.0;
exports.PROBATION_MIN_REVIEWS = 10;
exports.PROBATION_ROLLING_WINDOW = 10;
exports.PROBATION_MAX_DELAY_SECONDS = 60;
exports.PROBATION_MIN_DELAY_SECONDS = 10;
function getProbationDelaySeconds(rating) {
    if (rating >= exports.PROBATION_RATING_THRESHOLD)
        return 0;
    const scaledDelay = (exports.PROBATION_RATING_THRESHOLD - rating) * 60;
    return Math.min(Math.max(scaledDelay, exports.PROBATION_MIN_DELAY_SECONDS), exports.PROBATION_MAX_DELAY_SECONDS);
}
async function getCourierRatingInfo(courierId) {
    const [courier] = await db_1.db
        .select({
        user_id: schema_1.couriersTable.user_id,
        review_count: schema_1.couriersTable.review_count,
    })
        .from(schema_1.couriersTable)
        .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.id, courierId))
        .limit(1);
    if (!courier || courier.review_count < exports.PROBATION_MIN_REVIEWS) {
        return { rating: 5, ratingStatus: 'good_standing', delaySeconds: 0 };
    }
    const recentRatings = await db_1.db
        .select({ ratings: schema_1.ratingsTable.ratings })
        .from(schema_1.ratingsTable)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ratingsTable.reciepent, courier.user_id), (0, drizzle_orm_1.eq)(schema_1.ratingsTable.reciepent_as, 'courier')))
        .orderBy((0, drizzle_orm_1.desc)(schema_1.ratingsTable.createdAt))
        .limit(exports.PROBATION_ROLLING_WINDOW);
    const rating = recentRatings.length > 0
        ? recentRatings.reduce((sum, r) => sum + Number(r.ratings ?? 5), 0) / recentRatings.length
        : 5;
    const delaySeconds = getProbationDelaySeconds(rating);
    return {
        rating,
        ratingStatus: delaySeconds > 0 ? 'probation' : 'good_standing',
        delaySeconds,
    };
}
async function getCourierAvailability(courierId) {
    // A session past the cap doesn't count as online. Filtered on read rather
    // than closed here: this runs on every order-offer check, and a write on a
    // hot read path isn't worth it — closeStaleCourierSessions() does the tidying.
    const [openSession] = await db_1.db
        .select({ id: schema_1.courierSessionsTable.id })
        .from(schema_1.courierSessionsTable)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.courierSessionsTable.courier_id, courierId), (0, drizzle_orm_1.isNull)(schema_1.courierSessionsTable.ended_at), (0, drizzle_orm_1.gte)(schema_1.courierSessionsTable.started_at, staleShiftCutoff())))
        .limit(1);
    const [activeOrder] = await db_1.db
        .select({ id: schema_1.ordersTable.id })
        .from(schema_1.ordersTable)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ordersTable.courier_id, courierId), (0, drizzle_orm_1.inArray)(schema_1.ordersTable.status, ACTIVE_ORDER_STATUSES)))
        .limit(1);
    // Errands live in their own table and are invisible to the query above, so a
    // courier mid-errand would otherwise read as free. Checked here rather than
    // at the call sites: this function is the single answer to "can this courier
    // take work", and a second copy of the rule is a copy that drifts.
    const [activeErrand] = await db_1.db
        .select({ id: schema_1.errandOrdersTable.id })
        .from(schema_1.errandOrdersTable)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.courier_id, courierId), (0, drizzle_orm_1.inArray)(schema_1.errandOrdersTable.status, ACTIVE_ERRAND_STATUSES)))
        .limit(1);
    const [courier] = await db_1.db
        .select({ status: schema_1.couriersTable.verification_status })
        .from(schema_1.couriersTable)
        .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.id, courierId))
        .limit(1);
    const isOnline = !!openSession;
    const hasActiveOrder = !!activeOrder || !!activeErrand;
    const isApproved = courier?.status === 'approved';
    const ratingInfo = await getCourierRatingInfo(courierId);
    return {
        isOnline,
        hasActiveOrder,
        isApproved,
        ...ratingInfo,
        // Approval belongs in the same expression as online/busy because this is
        // the one place every "should this courier be offered work" question is
        // answered. A separate check somewhere else is a check someone forgets.
        canReceiveOrder: isApproved && isOnline && !hasActiveOrder,
    };
}
