"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUTCRangeFromLocalDate = getUTCRangeFromLocalDate;
exports.getUTCRangeFromLocalMonth = getUTCRangeFromLocalMonth;
exports.getUTCTime = getUTCTime;
function getUTCRangeFromLocalDate(dateStr, timezone = "Asia/Jakarta") {
    try {
        // 1. Buat objek Date UTC untuk tanggal tersebut (tengah malam UTC)
        // input: "2026-05-11" -> UTC: 2026-05-11 00:00:00Z
        const utcDate = new Date(`${dateStr}T00:00:00Z`);
        if (isNaN(utcDate.getTime())) {
            throw new Error("Invalid date string provided");
        }
        // 2. Gunakan Intl.DateTimeFormat untuk mencari tahu jam berapa di timezone tersebut
        // saat waktu di UTC adalah tengah malam.
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
            hour12: false
        });
        const parts = formatter.formatToParts(utcDate);
        const p = {};
        parts.forEach(part => p[part.type] = part.value);
        // Buat representasi "lokal" dari waktu UTC tersebut
        const localFromUTC = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
        // Hitung offset (selisih) antara UTC dan Timezone tersebut
        const offset = utcDate.getTime() - localFromUTC.getTime();
        // 3. Tentukan awal hari UTC yang sebenarnya untuk tanggal lokal tersebut
        const startUTC = new Date(utcDate.getTime() + offset);
        const endUTC = new Date(startUTC.getTime() + 24 * 60 * 60 * 1000 - 1);
        return { startUTC, endUTC, };
    }
    catch (e) {
        console.error("Timezone Helper Error:", e);
        // Fallback paling aman: gunakan UTC murni
        const start = new Date(`${dateStr}T00:00:00Z`);
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
        const current = new Date(dateStr);
        return { startUTC: start, endUTC: end, currentUTC: current };
    }
}
function getUTCRangeFromLocalMonth(monthStr, timezone = "Asia/Jakarta") {
    const [year, month] = monthStr.split('-').map(Number);
    const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const firstDayNextMonth = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
    const { startUTC } = getUTCRangeFromLocalDate(firstDay, timezone);
    const { startUTC: endUTC } = getUTCRangeFromLocalDate(firstDayNextMonth, timezone);
    return { startUTC, endUTC };
}
function getUTCTime(timezone = "Asia/Jakarta") {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
    });
    const parts = formatter.formatToParts(now);
    const p = {};
    parts.forEach(part => p[part.type] = part.value);
    const currentUTC = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
    return currentUTC;
}
