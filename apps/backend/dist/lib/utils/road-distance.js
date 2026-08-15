"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DETOUR_FACTOR = void 0;
exports.billableKm = billableKm;
exports.roadTable = roadTable;
exports.roadRoute = roadRoute;
exports.roadDistance = roadDistance;
const geo_1 = require("./geo");
// Real driving distance via OSRM, with a straight-line fallback.
//
// Why bother: around the outlets this app serves, road distance runs ~1.75x the
// straight line (4.7 km apart as the crow flies, 8.4 km of actual road). Pricing
// a haul off the straight line under-reads by nearly half, which is a lot of
// diesel for the owner to absorb.
//
// NOTE ON THE SERVER: the OSRM *software* is free and BSD-licensed — self-host
// it and this costs nothing forever. router.project-osrm.org is a different
// thing: the project's public DEMO instance, running on hardware they pay for.
// Their usage policy is explicit that access "shall be withdrawn at any time and
// without giving a reason", that it is "supplied on best effort basis" with no
// quality guarantees, and that excessive use gets you blocked. Commercial use is
// allowed but conditioned on the service being publicly accessible with proper
// OSRM + ODbL attribution.
//
// That's survivable here only because every failure falls back to haversine.
// Point OSRM_BASE_URL at your own instance before this becomes load-bearing.
const OSRM_BASE_URL = process.env.OSRM_BASE_URL ?? "https://router.project-osrm.org";
// Required by the demo server's usage policy — it blocks unidentified or faked
// agents. Kept honest: real app, real contact point.
const USER_AGENT = "UlunPesan/1.0 (+https://ulunpesan.com)";
// Kept short on purpose: this sits in front of an owner waiting to quote a job.
// A slow answer is worth less than an instant approximate one.
const OSRM_TIMEOUT_MS = 3_000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
/**
 * How much longer a real road trip is than the straight line, around the area
 * these outlets serve.
 *
 * Measured against OSRM over 8 sample pairs near the outlets (111.6E, 2.7S):
 * median 1.70x, mean 1.67x, range 1.12x–2.45x. Roads here follow rivers and
 * detour heavily, so the straight line reads far shorter than it does in a
 * gridded city.
 *
 * Used ONLY when routing is unavailable. It removes the systematic bias — the
 * part that consistently underpays couriers — but it cannot fix per-order error,
 * because the real ratio swings between 1.1x and 2.5x depending on which way the
 * road happens to go. Re-measure this if the service area moves.
 */
exports.DETOUR_FACTOR = 1.7;
/**
 * The distance to charge money against.
 *
 * A real routed distance is used as-is. A straight-line fallback is scaled by
 * DETOUR_FACTOR first — billing the raw straight line would quietly restore the
 * ~40% courier shortfall the whole exercise was meant to remove, and it would do
 * so precisely when nobody is watching (an outage).
 *
 * Distinct from `DistanceResult.km`, which stays the honest measurement. Display
 * surfaces should keep showing that, labelled; only pricing goes through here.
 */
function billableKm(d) {
    return d.source === "road" ? d.km : d.km * exports.DETOUR_FACTOR;
}
/**
 * Road distance/duration from ONE origin to many destinations, in one request.
 *
 * The point of the /table service: ranking 25 outlets by road distance is a
 * single call, not 25. Doing it one-by-one would be 25x the latency and 25x the
 * load on a rate-limited server.
 *
 * Returns an array aligned to `destinations`. Like roadDistance(), it never
 * throws — on any failure every entry degrades to its straight-line distance,
 * flagged via `source`. Individual unreachable destinations (OSRM returns null
 * for those) degrade the same way while their neighbours keep real routing.
 *
 * Not cached: the origin is a specific customer address and the destination set
 * varies per query, so hit rates would be near zero.
 */
async function roadTable(origin, destinations) {
    const straight = () => destinations.map((d) => ({
        km: (0, geo_1.haversineKm)(origin.lat, origin.lon, d.lat, d.lon),
        minutes: null,
        source: "straight",
    }));
    if (destinations.length === 0)
        return [];
    try {
        // lon,lat order — see roadDistance(). sources=0 pins the origin as the only
        // row, so the response is one row of N columns rather than an N+1 square.
        const coords = [origin, ...destinations].map((c) => `${c.lon},${c.lat}`).join(";");
        const res = await fetch(`${OSRM_BASE_URL}/table/v1/driving/${coords}?sources=0&annotations=distance,duration`, { signal: AbortSignal.timeout(OSRM_TIMEOUT_MS), headers: { "User-Agent": USER_AGENT } });
        if (!res.ok)
            return straight();
        const json = (await res.json());
        if (json.code !== "Ok" || !json.distances?.[0])
            return straight();
        const dist = json.distances[0];
        const dur = json.durations?.[0];
        // Column 0 is the origin against itself; destinations start at index 1.
        return destinations.map((d, i) => {
            const metres = dist[i + 1];
            if (typeof metres !== "number") {
                return {
                    km: (0, geo_1.haversineKm)(origin.lat, origin.lon, d.lat, d.lon),
                    minutes: null,
                    source: "straight",
                };
            }
            const seconds = dur?.[i + 1];
            return {
                km: metres / 1000,
                minutes: typeof seconds === "number" ? seconds / 60 : null,
                source: "road",
            };
        });
    }
    catch {
        return straight();
    }
}
/**
 * A route WITH its drawn geometry, for maps.
 *
 * Separate from roadDistance() because the payload is far heavier — a full
 * overview polyline is thousands of coordinates — and it must never end up in
 * the distance cache that pricing reads.
 *
 * Returns [lat, lon] pairs, already flipped from OSRM's [lon, lat]. Doing the
 * swap once here rather than in every caller removes the single easiest way to
 * silently draw a route through the wrong hemisphere.
 *
 * Falls back to a two-point straight line, so a map always has something to draw.
 */
async function roadRoute(from, to) {
    const straight = () => ({
        km: (0, geo_1.haversineKm)(from.lat, from.lon, to.lat, to.lon),
        minutes: null,
        source: "straight",
        geometry: [
            [from.lat, from.lon],
            [to.lat, to.lon],
        ],
    });
    try {
        const path = `${from.lon},${from.lat};${to.lon},${to.lat}`;
        const res = await fetch(`${OSRM_BASE_URL}/route/v1/driving/${path}?geometries=geojson&overview=full`, { signal: AbortSignal.timeout(OSRM_TIMEOUT_MS), headers: { "User-Agent": USER_AGENT } });
        if (!res.ok)
            return straight();
        const json = (await res.json());
        const route = json.code === "Ok" ? json.routes?.[0] : undefined;
        const coords = route?.geometry?.coordinates;
        if (!route || typeof route.distance !== "number" || !coords?.length)
            return straight();
        return {
            km: route.distance / 1000,
            minutes: typeof route.duration === "number" ? route.duration / 60 : null,
            source: "road",
            geometry: coords.map(([lon, lat]) => [lat, lon]),
        };
    }
    catch {
        return straight();
    }
}
const cache = new Map();
// 4 decimal places is ~11 m — far finer than any delivery decision, and it means
// repeated quotes on the same order reuse one answer instead of re-hitting a
// rate-limited public server.
const cacheKey = (from, to) => `${from.lat.toFixed(4)},${from.lon.toFixed(4)};${to.lat.toFixed(4)},${to.lon.toFixed(4)}`;
/**
 * Driving distance between two points.
 *
 * Never throws and never hangs: any OSRM failure, timeout, or malformed response
 * degrades to the haversine straight line, flagged via `source` so callers can
 * tell the user which number they're looking at.
 */
async function roadDistance(from, to) {
    const straight = {
        km: (0, geo_1.haversineKm)(from.lat, from.lon, to.lat, to.lon),
        minutes: null,
        source: "straight",
    };
    const key = cacheKey(from, to);
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now())
        return hit.value;
    try {
        // OSRM takes lon,lat — the reverse of how coordinates are written
        // everywhere else in this codebase. Getting this backwards silently returns
        // a route between two entirely different places rather than an error.
        const path = `${from.lon},${from.lat};${to.lon},${to.lat}`;
        const res = await fetch(`${OSRM_BASE_URL}/route/v1/driving/${path}?overview=false`, {
            signal: AbortSignal.timeout(OSRM_TIMEOUT_MS),
            headers: { "User-Agent": USER_AGENT },
        });
        if (!res.ok)
            return straight;
        const json = (await res.json());
        const route = json.code === "Ok" ? json.routes?.[0] : undefined;
        if (!route || typeof route.distance !== "number")
            return straight;
        const value = {
            km: route.distance / 1000,
            minutes: typeof route.duration === "number" ? route.duration / 60 : null,
            source: "road",
        };
        // Only successful lookups are cached. Caching a fallback would pin the
        // straight-line answer in place for an hour after a momentary blip.
        if (cache.size >= CACHE_MAX_ENTRIES)
            cache.clear();
        cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
        return value;
    }
    catch {
        // Timeout, DNS, rate limit, or no route between these points at all —
        // an owner still needs a number to price against.
        return straight;
    }
}
