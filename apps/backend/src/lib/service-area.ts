import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { serviceAreaTable, outletsTable } from "../db/schema";
import { haversineKm } from "./utils/geo";
import { parseCoordPair } from "./utils/coords";

export type ServiceArea = {
  centerLat: number;
  centerLon: number;
  radiusKm: number;
};

/**
 * The configured courier coverage area, or null when an admin hasn't set one.
 *
 * Newest row wins. Changes append rather than overwrite, so moving the centre
 * leaves a record of who moved it and when — a business boundary that quietly
 * shifts with no history is hard to reason about later.
 */
export async function getServiceArea(): Promise<ServiceArea | null> {
  const [row] = await db
    .select({
      lat: serviceAreaTable.center_lat,
      lon: serviceAreaTable.center_lon,
      radius: serviceAreaTable.radius_km,
    })
    .from(serviceAreaTable)
    .orderBy(desc(serviceAreaTable.id))
    .limit(1);

  if (!row) return null;

  const centerLat = Number(row.lat);
  const centerLon = Number(row.lon);
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLon)) return null;

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
export async function isWithinServiceArea(
  lat: number,
  lon: number,
): Promise<{ covered: boolean; area: ServiceArea | null; distanceKm: number | null }> {
  const area = await getServiceArea();
  if (!area) return { covered: true, area: null, distanceKm: null };

  const distanceKm = haversineKm(lat, lon, area.centerLat, area.centerLon);
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
export async function recomputeCourierReachable(outletId?: number): Promise<number> {
  const area = await getServiceArea();

  const rows = await db
    .select({
      id: outletsTable.id,
      lat: outletsTable.lat,
      lon: outletsTable.lon,
      current: outletsTable.courier_reachable,
    })
    .from(outletsTable)
    .where(
      outletId === undefined
        ? isNull(outletsTable.deletedAt)
        : and(isNull(outletsTable.deletedAt), eq(outletsTable.id, outletId)),
    );

  let changed = 0;

  for (const row of rows) {
    const coords = parseCoordPair(row.lat, row.lon);

    // No area, or coordinates we can't read: treat as reachable. An outlet
    // whose position is unknown must not be silently cut off from orders
    // because of a data problem it can't see — 11 production outlets sit on a
    // fallback coordinate they never chose.
    const reachable =
      !area || !coords
        ? true
        : haversineKm(coords.lat, coords.lon, area.centerLat, area.centerLon) <= area.radiusKm;

    if (reachable === row.current) continue;

    await db
      .update(outletsTable)
      .set({ courier_reachable: reachable })
      .where(eq(outletsTable.id, row.id));
    changed += 1;
  }

  return changed;
}
