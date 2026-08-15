"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getServiceArea = getServiceArea;
exports.isWithinServiceArea = isWithinServiceArea;
exports.recomputeCourierReachable = recomputeCourierReachable;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const geo_1 = require("./utils/geo");
const coords_1 = require("./utils/coords");
/**
 * The configured courier coverage area, or null when an admin hasn't set one.
 *
 * Newest row wins. Changes append rather than overwrite, so moving the centre
 * leaves a record of who moved it and when — a business boundary that quietly
 * shifts with no history is hard to reason about later.
 */
async function getServiceArea() {
    const [row] = await db_1.db
        .select({
        lat: schema_1.serviceAreaTable.center_lat,
        lon: schema_1.serviceAreaTable.center_lon,
        radius: schema_1.serviceAreaTable.radius_km,
    })
        .from(schema_1.serviceAreaTable)
        .orderBy((0, drizzle_orm_1.desc)(schema_1.serviceAreaTable.id))
        .limit(1);
    if (!row)
        return null;
    const centerLat = Number(row.lat);
    const centerLon = Number(row.lon);
    if (!Number.isFinite(centerLat) || !Number.isFinite(centerLon))
        return null;
    return { centerLat, centerLon, radiusKm: row.radius };
}
/**
 * Is this point inside the coverage area?
 *
 * Returns true when no area is configured. "Not set up yet" must not read as
 * "nowhere is covered" — otherwise deploying this feature would silently lock
 * out every new owner until an admin happened to open the map page.
 *
 * Straight-line distance, matching how the circle is drawn. An admin who places
 * a 50 km circle on a map means the circle they can see, not a road-network
 * isochrone they can't.
 */
async function isWithinServiceArea(lat, lon) {
    const area = await getServiceArea();
    if (!area)
        return { covered: true, area: null, distanceKm: null };
    const distanceKm = (0, geo_1.haversineKm)(lat, lon, area.centerLat, area.centerLon);
    return { covered: distanceKm <= area.radiusKm, area, distanceKm };
}
/**
 * Recompute outlets.courier_reachable from the current coverage circle.
 *
 * Pass an outletId to re-evaluate one outlet (it moved), or omit it to
 * re-evaluate every outlet (the circle moved). Both paths go through here so a
 * single outlet saving its location and an admin redrawing the area can never
 * apply different rules.
 *
 * Returns the number of rows whose value actually CHANGED, not the number
 * examined — an admin nudging the centre 200 m wants to hear "3 outlets
 * affected", not "27 outlets processed".
 *
 * With no area configured every outlet is marked reachable, which is how a
 * platform with no coverage rules behaves and how it must behave again if an
 * admin ever clears one.
 */
async function recomputeCourierReachable(outletId) {
    const area = await getServiceArea();
    const rows = await db_1.db
        .select({
        id: schema_1.outletsTable.id,
        lat: schema_1.outletsTable.lat,
        lon: schema_1.outletsTable.lon,
        current: schema_1.outletsTable.courier_reachable,
    })
        .from(schema_1.outletsTable)
        .where(outletId === undefined
        ? (0, drizzle_orm_1.isNull)(schema_1.outletsTable.deletedAt)
        : (0, drizzle_orm_1.and)((0, drizzle_orm_1.isNull)(schema_1.outletsTable.deletedAt), (0, drizzle_orm_1.eq)(schema_1.outletsTable.id, outletId)));
    let changed = 0;
    for (const row of rows) {
        const coords = (0, coords_1.parseCoordPair)(row.lat, row.lon);
        // No area, or coordinates we can't read: treat as reachable. An outlet
        // whose position is unknown must not be silently cut off from orders
        // because of a data problem it can't see — 11 production outlets sit on a
        // fallback coordinate they never chose.
        const reachable = !area || !coords
            ? true
            : (0, geo_1.haversineKm)(coords.lat, coords.lon, area.centerLat, area.centerLon) <= area.radiusKm;
        if (reachable === row.current)
            continue;
        await db_1.db
            .update(schema_1.outletsTable)
            .set({ courier_reachable: reachable })
            .where((0, drizzle_orm_1.eq)(schema_1.outletsTable.id, row.id));
        changed += 1;
    }
    return changed;
}
