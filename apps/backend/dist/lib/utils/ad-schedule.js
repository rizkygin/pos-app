"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentAdSlot = getCurrentAdSlot;
const timezone_1 = require("../timezone");
const DAY_NAMES = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
];
function getCurrentAdSlot(timezone = 'Asia/Jakarta') {
    const now = (0, timezone_1.getUTCTime)(timezone);
    return {
        now,
        day: DAY_NAMES[now.getUTCDay()],
        hour: String(now.getUTCHours() + 1).padStart(2, '0'),
    };
}
