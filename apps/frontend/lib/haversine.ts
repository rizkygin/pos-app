/**
 * Great-circle distance in km. Mirrors the backend's lib/utils/geo.ts.
 *
 * Duplicated rather than shared because the two apps have no common package,
 * and the alternative — a round-trip per outlet to compute which pins fall
 * inside a circle the admin is dragging — would make the map unusable.
 */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
