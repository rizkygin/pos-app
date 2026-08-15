"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isFcmConfigured = isFcmConfigured;
exports.sendErrandPush = sendErrandPush;
exports.sendOfferPush = sendOfferPush;
const node_crypto_1 = __importDefault(require("node:crypto"));
const courier_device_1 = require("./courier-device");
function loadServiceAccount() {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed.project_id || !parsed.client_email || !parsed.private_key)
            return null;
        // Railway env vars flatten newlines; restore them or the key won't parse.
        parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
        return parsed;
    }
    catch {
        return null;
    }
}
const serviceAccount = loadServiceAccount();
if (!serviceAccount) {
    console.warn("[fcm] FIREBASE_SERVICE_ACCOUNT not set — courier push is disabled. " +
        "Offers still dispatch; they just won't ring on anyone's phone.");
}
function isFcmConfigured() {
    return serviceAccount !== null;
}
let cachedToken = null;
/** Google access token via the self-signed-JWT flow, cached until it expires. */
async function getAccessToken(account) {
    // 60s of slack: a token that expires mid-flight costs a retry, and this is on
    // the path of an offer somebody is waiting for.
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
        return cachedToken.value;
    }
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const claims = {
        iss: account.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
    };
    const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const unsigned = `${b64(header)}.${b64(claims)}`;
    const signature = node_crypto_1.default
        .createSign("RSA-SHA256")
        .update(unsigned)
        .sign(account.private_key, "base64url");
    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion: `${unsigned}.${signature}`,
        }),
    });
    if (!res.ok) {
        throw new Error(`[fcm] token exchange failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json());
    cachedToken = {
        value: json.access_token,
        expiresAt: Date.now() + json.expires_in * 1000,
    };
    return cachedToken.value;
}
/**
 * Ring one courier about a direct hire ("Suruh Kurir").
 *
 * Deliberately NOT an offer push, despite the overlap. An offer carries a
 * countdown the app renders as a full-screen intent with two buttons, and it
 * expires — dispatch moves on to the next courier. An errand has no clock and
 * no next courier: it was aimed at this one person and waits until they answer.
 * Reusing type:"offer" would put it on a screen built to expire, and the app
 * would discard a request that is still perfectly live.
 *
 * No TTL for the same reason. A request the courier sees an hour late is still
 * actionable — the customer is the only one who can end the wait, and only
 * after the five-minute floor.
 */
async function sendErrandPush(courierId, errand) {
    if (!serviceAccount)
        return;
    const tokens = await (0, courier_device_1.getCourierFcmTokens)(courierId);
    if (tokens.length === 0)
        return;
    const accessToken = await getAccessToken(serviceAccount);
    const url = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;
    const dead = [];
    await Promise.all(tokens.map(async (token) => {
        const message = {
            message: {
                token,
                data: {
                    type: "errand",
                    errandId: errand.errandId,
                    customerName: errand.customerName,
                    customerPhone: errand.customerPhone,
                    customerRating: String(errand.customerRating),
                    customerReviewCount: String(errand.customerReviewCount),
                    note: errand.note,
                    pickupAddress: errand.pickupAddress,
                    pickupLat: errand.pickupLat !== null ? String(errand.pickupLat) : "",
                    pickupLon: errand.pickupLon !== null ? String(errand.pickupLon) : "",
                },
                android: {
                    priority: "HIGH",
                },
            },
        };
        const res = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(message),
        });
        if (res.ok)
            return;
        const body = await res.text();
        if (res.status === 404 || body.includes("UNREGISTERED") || body.includes("INVALID_ARGUMENT")) {
            dead.push(token);
            return;
        }
        console.error(`[fcm] errand send failed (${res.status}): ${body}`);
    }));
    if (dead.length > 0)
        await (0, courier_device_1.pruneFcmTokens)(dead);
}
/**
 * Ring one courier about one offer.
 *
 * A DATA message, not a notification message: Android must not draw this
 * itself. The app builds a full-screen intent with a countdown and two action
 * buttons, and a system-drawn notification would silently replace all of that
 * with a line of text.
 *
 * `expiresAt` is sent as an absolute timestamp rather than "30 seconds",
 * because the seconds FCM spends in transit come out of the courier's window.
 * The phone counts down to the real deadline and shows an honest number.
 */
async function sendOfferPush(courierId, offer) {
    if (!serviceAccount)
        return;
    const tokens = await (0, courier_device_1.getCourierFcmTokens)(courierId);
    if (tokens.length === 0)
        return;
    const accessToken = await getAccessToken(serviceAccount);
    const url = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;
    const dead = [];
    await Promise.all(tokens.map(async (token) => {
        const message = {
            message: {
                token,
                // FCM data values must all be strings. Everything numeric or
                // nullable is stringified here rather than left for the app to
                // guess a serialization for, so there is exactly one place that
                // decides how "no drop-off address on this order" is spelled.
                data: {
                    type: "offer",
                    orderId: offer.orderId,
                    outletName: offer.outletName,
                    expiresAt: offer.expiresAt.toISOString(),
                    deliveryFee: offer.deliveryFee ?? "",
                    itemCount: String(offer.itemCount ?? 0),
                    pickupLat: offer.pickupLat !== null ? String(offer.pickupLat) : "",
                    pickupLon: offer.pickupLon !== null ? String(offer.pickupLon) : "",
                    customerName: offer.details?.customerName ?? "",
                    customerRating: offer.details ? String(offer.details.customerRating) : "",
                    customerReviewCount: offer.details ? String(offer.details.customerReviewCount) : "",
                    dropoffLabel: offer.details?.dropoffLabel ?? "",
                    dropoffLat: offer.details?.dropoffLat !== null && offer.details?.dropoffLat !== undefined
                        ? String(offer.details.dropoffLat)
                        : "",
                    dropoffLon: offer.details?.dropoffLon !== null && offer.details?.dropoffLon !== undefined
                        ? String(offer.details.dropoffLon)
                        : "",
                    customerPhone: offer.details?.customerPhone ?? "",
                    customerNote: offer.details?.customerNote ?? "",
                    outletAddress: offer.details?.outletAddress ?? "",
                    totalAmount: offer.details ? String(offer.details.totalAmount) : "",
                    createdAt: offer.details?.createdAt ?? "",
                    // One JSON string rather than N indexed fields, for both lists —
                    // the app parses each once into an array, and a bigger cart or a
                    // fourth prior rating later needs no new field name on either side.
                    items: JSON.stringify(offer.details?.items ?? []),
                    priorRatings: JSON.stringify(offer.details?.priorRatings ?? []),
                },
                android: {
                    // Wakes a dozing device. Reserved for things a person is waiting
                    // on — which an offer with a 30-second clock is.
                    priority: "HIGH",
                    // Pointless to deliver after the clock has run out; a courier
                    // tapping a dead offer is worse than never seeing it.
                    ttl: "45s",
                },
            },
        };
        const res = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(message),
        });
        if (res.ok)
            return;
        const body = await res.text();
        // The app was uninstalled or the token rotated. Keeping it means retrying
        // a dead phone forever, and — worse — believing that courier was reached.
        if (res.status === 404 || body.includes("UNREGISTERED") || body.includes("INVALID_ARGUMENT")) {
            dead.push(token);
            return;
        }
        console.error(`[fcm] send failed (${res.status}): ${body}`);
    }));
    if (dead.length > 0)
        await (0, courier_device_1.pruneFcmTokens)(dead);
}
