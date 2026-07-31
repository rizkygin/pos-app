// Coordinate parsing/validation shared by every map + location form.
//
// Why this exists: lat/lon are stored as `varchar` (see schema.ts), and
// `notNull()` on a varchar does NOT stop an empty string. A failed geolocation
// left `''` in the column, `parseFloat('')` turned that into NaN on the way
// back out, and Leaflet threw "Invalid LatLng object: (NaN, NaN)". Worse,
// `String(NaN)` writes the literal text "NaN" back, so a bad row re-saved
// itself and stayed bad. Everything that reads or writes a coordinate goes
// through here so neither can happen again.

export const isValidLat = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;

export const isValidLon = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;

export const isValidCoord = (lat: unknown, lon: unknown): boolean =>
  isValidLat(lat) && isValidLon(lon);

/**
 * Turn a stored coordinate into a number, or null when it isn't one.
 *
 * Deliberately stricter than `parseFloat`, which happily returns NaN for '',
 * null and the string "NaN", and silently truncates junk like "12abc" to 12.
 */
export function parseCoord(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === 'number' ? value : value.trim();
  if (raw === '') return null;
  const n = Number(raw); // Number('12abc') is NaN, parseFloat('12abc') is 12.
  return Number.isFinite(n) ? n : null;
}

/** Parse a lat/lon pair, returning null unless BOTH are valid coordinates. */
export function parseCoordPair(
  lat: string | number | null | undefined,
  lon: string | number | null | undefined,
): { lat: number; lon: number } | null {
  const parsedLat = parseCoord(lat);
  const parsedLon = parseCoord(lon);
  if (!isValidLat(parsedLat) || !isValidLon(parsedLon)) return null;
  return { lat: parsedLat, lon: parsedLon };
}
