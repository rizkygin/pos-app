"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushConfigured = void 0;
exports.getPublicKey = getPublicKey;
exports.sendPushToUser = sendPushToUser;
const web_push_1 = __importDefault(require("web-push"));
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
// VAPID identifies THIS server to the push services (FCM/Mozilla/Apple). The
// key pair must be stable: rotating it invalidates every stored subscription,
// so the keys live in env and are shared across deploys, not generated at boot.
const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT ?? "mailto:noreply@ulunpesan.com";
exports.pushConfigured = Boolean(publicKey && privateKey);
if (exports.pushConfigured) {
    web_push_1.default.setVapidDetails(subject, publicKey, privateKey);
}
else {
    console.warn("[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — web push is disabled.");
}
function getPublicKey() {
    return publicKey ?? null;
}
/**
 * Fan a notification out to every device the user has subscribed.
 *
 * Never throws: a failed push must not take down whatever business action
 * triggered it (an order still counts even if the owner's phone is
 * unreachable). Subscriptions the push service reports as dead are deleted —
 * they are gone for good, and retrying them forever is what turns a push table
 * into a graveyard.
 */
async function sendPushToUser(userId, payload) {
    if (!exports.pushConfigured)
        return { sent: 0, pruned: 0 };
    const subs = await db_1.db
        .select()
        .from(schema_1.pushSubscriptionsTable)
        .where((0, drizzle_orm_1.eq)(schema_1.pushSubscriptionsTable.user_id, userId));
    if (subs.length === 0)
        return { sent: 0, pruned: 0 };
    const body = JSON.stringify(payload);
    const dead = [];
    let sent = 0;
    await Promise.all(subs.map(async (sub) => {
        try {
            await web_push_1.default.sendNotification({
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
            }, body, 
            // Hold the message for 6h if the device is offline — an owner whose
            // phone was in a dead zone still learns about the order, and stale
            // ones expire instead of arriving the next morning.
            { TTL: 60 * 60 * 6, urgency: "high" });
            sent++;
        }
        catch (err) {
            const status = err.statusCode;
            // 404/410: the browser dropped the subscription (uninstalled, cleared
            // site data, permission revoked). Anything else is transient.
            if (status === 404 || status === 410)
                dead.push(sub.endpoint);
            else
                console.error("[push] send failed", status, err.message);
        }
    }));
    if (dead.length > 0) {
        await db_1.db
            .delete(schema_1.pushSubscriptionsTable)
            .where((0, drizzle_orm_1.inArray)(schema_1.pushSubscriptionsTable.endpoint, dead));
    }
    return { sent, pruned: dead.length };
}
