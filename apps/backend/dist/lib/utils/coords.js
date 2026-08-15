"use strict";
// Server-side coordinate validation — the last line of defence before a
// coordinate reaches the database.
//
// lat/lon are `varchar` columns (see schema.ts). `notNull()` does not stop an
// empty string, so '' and the literal text "NaN" were both storable, and both
// came back out of `parseFloat` as NaN and crashed the map picker. No route may
// write a coordinate that has not been through here.
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidLon = exports.isValidLat = exports.DEFAULT_COORDS = void 0;
exports.parseCoord = parseCoord;
exports.parseCoordPair = parseCoordPair;
/**
 * Where the app lands when it has no coordinate to work with.
 *
 * Pangkalan Bun — the town these outlets actually serve. It used to be
 * Banjarmasin (-3.3199, 114.5907), 350 km east, which is a strange place to
 * drop someone who is about to pick their shop's location, and worse than
 * strange as seed data: a seeded outlet sat outside the courier delivery cap
 * AND outside the routing graph's bbox, so a fresh database could not exercise
 * road distance at all.
 *
 * Used for fallbacks only. A real coordinate always wins; this is what stands
 * in when the browser refused to locate, the form sent nothing, or a stored
 * value turned out to be junk (see parseCoordPair below).
 */
exports.DEFAULT_COORDS = { lat: -2.6847, lon: 111.6236 };
const isValidLat = (v) => typeof v === "number" && Number.isFinite(v) && v >= -90 && v <= 90;
exports.isValidLat = isValidLat;
const isValidLon = (v) => typeof v === "number" && Number.isFinite(v) && v >= -180 && v <= 180;
exports.isValidLon = isValidLon;
/**
 * Coerce an untrusted coordinate to a number, or null when it isn't one.
 * Stricter than parseFloat, which accepts '' -> NaN and truncates "12abc" -> 12.
 */
function parseCoord(value) {
    if (value === null || value === undefined)
        return null;
    const raw = typeof value === "number" ? value : String(value).trim();
    if (raw === "")
        return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}
/** Parse a lat/lon pair, returning null unless BOTH are valid coordinates. */
function parseCoordPair(lat, lon) {
    const parsedLat = parseCoord(lat);
    const parsedLon = parseCoord(lon);
    if (!(0, exports.isValidLat)(parsedLat) || !(0, exports.isValidLon)(parsedLon))
        return null;
    return { lat: parsedLat, lon: parsedLon };
}
