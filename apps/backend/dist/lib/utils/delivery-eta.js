"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deliveryEta = deliveryEta;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../../db");
const schema_1 = require("../../db/schema");
const coords_1 = require("./coords");
const road_distance_1 = require("./road-distance");
/**
 * How long a courier's reported position stays believable.
 *
 * A phone that lost signal ten minutes ago is not telling you where its owner is
 * now. Past this the estimate falls back to the outlet-based one rather than
 * quietly presenting a stale point as live — an ETA counting down from the wrong
 * place is worse than an honest approximation.
 */
const POSITION_FRESH_MS = 5 * 60 * 1000;
/** Baseline preparation allowance before anyone is on the road. */
const PREP_MINUTES = 15;
const NO_ETA = {
    etaMinutes: null,
    etaSource: null,
    courierPosition: null,
    destination: null,
};
/**
 * Arrival estimate for a customer's in-flight order.
 *
 * Prefers routing from the courier's live position, which is the only version
 * that shrinks as they approach. Falls back to outlet → door whenever that
 * position is missing or stale, and adds a prep allowance for the statuses where
 * nothing has left the shop yet.
 *
 * Returns null rather than a guess for terminal and pre-acceptance states: a
 * pending order has no delivery underway to estimate, and printing a number
 * there would be invention.
 */
async function deliveryEta(input) {
    const { status, customerUserId, outlet, courier, courierSeenAt } = input;
    // Nothing is moving before the owner accepts, and nothing is coming after it
    // has arrived or been cancelled.
    if (!["confirmed", "preparing", "ready", "on_delivery"].includes(status))
        return NO_ETA;
    const [loc] = await db_1.db
        .select({ lat: schema_1.locationsTable.lat, lon: schema_1.locationsTable.lon })
        .from(schema_1.locationsTable)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.locationsTable.user_id, customerUserId), (0, drizzle_orm_1.eq)(schema_1.locationsTable.is_default, true)))
        .limit(1);
    const destination = loc ? (0, coords_1.parseCoordPair)(loc.lat, loc.lon) : null;
    if (!destination)
        return NO_ETA;
    const positionIsFresh = courier !== null &&
        courierSeenAt !== null &&
        Date.now() - courierSeenAt.getTime() <= POSITION_FRESH_MS;
    // Live: route from the courier. Only meaningful once they're actually en
    // route — before that they may be nowhere near the pickup, and measuring from
    // their position would flatter the estimate.
    if (positionIsFresh && status === "on_delivery") {
        const route = await (0, road_distance_1.roadRoute)(courier, destination);
        if (route.minutes !== null) {
            return {
                etaMinutes: Math.max(1, Math.round(route.minutes)),
                etaSource: "courier",
                courierPosition: courier,
                destination,
            };
        }
    }
    if (!outlet)
        return { ...NO_ETA, destination };
    const route = await (0, road_distance_1.roadRoute)(outlet, destination);
    if (route.minutes === null)
        return { ...NO_ETA, destination };
    // Prep only counts while the food is still being made. Once it's on the road,
    // the remaining journey is all that's left.
    const prep = status === "on_delivery" ? 0 : PREP_MINUTES;
    return {
        etaMinutes: Math.max(1, Math.round(prep + route.minutes)),
        etaSource: "outlet",
        courierPosition: null,
        destination,
    };
}
