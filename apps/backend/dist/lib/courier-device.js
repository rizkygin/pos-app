"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCourierDevice = registerCourierDevice;
exports.revokeCourierDevice = revokeCourierDevice;
exports.revokeAllCourierDevices = revokeAllCourierDevices;
exports.resolveCourier = resolveCourier;
exports.getCourierFcmTokens = getCourierFcmTokens;
exports.pruneFcmTokens = pruneFcmTokens;
const node_crypto_1 = __importDefault(require("node:crypto"));
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../auth");
const web_headers_1 = require("./web-headers");
/**
 * Authentication for the courier app.
 *
 * The native side calls three endpoints without the WebView in the picture: the
 * location service posts while the WebView may be dead, and the offer
 * notification's Terima/Tolak buttons fire from the lock screen. None of those
 * can use the session cookie the WebView owns, so they carry a device token
 * instead.
 *
 * Scope is deliberately tiny. This token cannot read earnings, cannot see the
 * document photos, cannot change a profile — it can report a position and
 * answer an offer. It sits in app storage on a phone that gets lost, and the
 * blast radius should match that.
 */
const TOKEN_BYTES = 32;
function hashToken(token) {
    return node_crypto_1.default.createHash("sha256").update(token).digest("hex");
}
/** Mints a new device token, returning the plaintext once and storing only its hash. */
async function registerCourierDevice(params) {
    const deviceToken = node_crypto_1.default.randomBytes(TOKEN_BYTES).toString("base64url");
    const hash = hashToken(deviceToken);
    // Conflict on fcm_token, not on courier: the row follows the PHONE. A device
    // handed to another courier re-registers and moves, rather than leaving its
    // previous owner subscribed to offers they can no longer act on.
    await db_1.db
        .insert(schema_1.courierDevicesTable)
        .values({
        courier_id: params.courierId,
        fcm_token: params.fcmToken,
        device_token_hash: hash,
        platform: params.platform ?? "android",
        app_version: params.appVersion ?? null,
        last_seen_at: (0, drizzle_orm_1.sql) `now()`,
    })
        .onConflictDoUpdate({
        target: schema_1.courierDevicesTable.fcm_token,
        set: {
            courier_id: params.courierId,
            device_token_hash: hash,
            platform: params.platform ?? "android",
            app_version: params.appVersion ?? null,
            last_seen_at: (0, drizzle_orm_1.sql) `now()`,
            // Re-registering revives a device that had been signed out.
            revoked_at: null,
            updatedAt: new Date(),
        },
    });
    return deviceToken;
}
/** Signs one install out. Idempotent: an unknown token is already revoked. */
async function revokeCourierDevice(deviceToken) {
    await db_1.db
        .update(schema_1.courierDevicesTable)
        .set({ revoked_at: (0, drizzle_orm_1.sql) `now()` })
        .where((0, drizzle_orm_1.eq)(schema_1.courierDevicesTable.device_token_hash, hashToken(deviceToken)));
}
/** Revokes every install belonging to a courier — used when the WebView logs out. */
async function revokeAllCourierDevices(courierId) {
    await db_1.db
        .update(schema_1.courierDevicesTable)
        .set({ revoked_at: (0, drizzle_orm_1.sql) `now()` })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.courierDevicesTable.courier_id, courierId), (0, drizzle_orm_1.isNull)(schema_1.courierDevicesTable.revoked_at)));
}
function bearerToken(request) {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer "))
        return null;
    const token = header.slice(7).trim();
    return token.length > 0 ? token : null;
}
/**
 * Resolve the calling courier from either credential.
 *
 * Session first, because the browser and the WebView are the common case and a
 * cookie is already parsed by the time we get here. The device token is the
 * fallback for the native services.
 */
async function resolveCourier(request) {
    const session = await auth_1.auth.api
        .getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) })
        .catch(() => null);
    if (session?.user) {
        const [courier] = await db_1.db
            .select({
            id: schema_1.couriersTable.id,
            status: schema_1.couriersTable.verification_status,
        })
            .from(schema_1.couriersTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, session.user.id), (0, drizzle_orm_1.isNull)(schema_1.couriersTable.deletedAt)))
            .limit(1);
        if (courier) {
            return { courierId: courier.id, verificationStatus: courier.status, via: "session" };
        }
    }
    const token = bearerToken(request);
    if (!token)
        return null;
    const [row] = await db_1.db
        .select({
        deviceId: schema_1.courierDevicesTable.id,
        courierId: schema_1.couriersTable.id,
        status: schema_1.couriersTable.verification_status,
    })
        .from(schema_1.courierDevicesTable)
        .innerJoin(schema_1.couriersTable, (0, drizzle_orm_1.eq)(schema_1.courierDevicesTable.courier_id, schema_1.couriersTable.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.courierDevicesTable.device_token_hash, hashToken(token)), (0, drizzle_orm_1.isNull)(schema_1.courierDevicesTable.revoked_at), (0, drizzle_orm_1.isNull)(schema_1.couriersTable.deletedAt)))
        .limit(1);
    if (!row)
        return null;
    // Doubles as the "is this install still alive" signal — a device that stops
    // reporting is how you tell a dead phone from a courier ignoring offers.
    await db_1.db
        .update(schema_1.courierDevicesTable)
        .set({ last_seen_at: (0, drizzle_orm_1.sql) `now()` })
        .where((0, drizzle_orm_1.eq)(schema_1.courierDevicesTable.id, row.deviceId));
    return { courierId: row.courierId, verificationStatus: row.status, via: "device" };
}
/** Active install tokens for a courier, for the push sender. */
async function getCourierFcmTokens(courierId) {
    const rows = await db_1.db
        .select({ token: schema_1.courierDevicesTable.fcm_token })
        .from(schema_1.courierDevicesTable)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.courierDevicesTable.courier_id, courierId), (0, drizzle_orm_1.isNull)(schema_1.courierDevicesTable.revoked_at)));
    return rows.map((r) => r.token);
}
/** Drops tokens FCM has told us are dead, so they stop being retried forever. */
async function pruneFcmTokens(tokens) {
    if (tokens.length === 0)
        return;
    await db_1.db
        .update(schema_1.courierDevicesTable)
        .set({ revoked_at: (0, drizzle_orm_1.sql) `now()` })
        .where((0, drizzle_orm_1.sql) `${schema_1.courierDevicesTable.fcm_token} = ANY(${tokens})`);
}
