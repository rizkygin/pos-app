import crypto from "node:crypto";
import { getCourierFcmTokens, pruneFcmTokens } from "./courier-device";
import type { OfferDetails } from "./offer-details";

/**
 * Firebase Cloud Messaging (HTTP v1) for the courier app.
 *
 * Web push (lib/push.ts) stays where it is — it serves owners in a browser.
 * This is the other channel: a courier's phone, where an offer has to ring
 * through Doze and put Terima/Tolak on the lock screen.
 *
 * Deliberately dependency-free. The OAuth2 exchange is a signed JWT and one
 * POST, which is less code than the wiring needed to pull in a Google SDK, and
 * it keeps the backend image small.
 *
 * Disabled gracefully when unconfigured, exactly like VAPID: no service
 * account means no push, logged once, and dispatch continues to work. A courier
 * with the lobby open still sees offers; they simply don't ring.
 */

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
    // Railway env vars flatten newlines; restore them or the key won't parse.
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    return parsed;
  } catch {
    return null;
  }
}

const serviceAccount = loadServiceAccount();

if (!serviceAccount) {
  console.warn(
    "[fcm] FIREBASE_SERVICE_ACCOUNT not set — courier push is disabled. " +
      "Offers still dispatch; they just won't ring on anyone's phone.",
  );
}

export function isFcmConfigured(): boolean {
  return serviceAccount !== null;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/** Google access token via the self-signed-JWT flow, cached until it expires. */
async function getAccessToken(account: ServiceAccount): Promise<string> {
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

  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64(header)}.${b64(claims)}`;
  const signature = crypto
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

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.value;
}

export type OfferPush = {
  orderId: string;
  outletName: string;
  /** The real deadline, as a timestamp. */
  expiresAt: Date;
  deliveryFee: string | null;
  itemCount?: number;
  pickupLat: number | null;
  pickupLon: number | null;
  /**
   * Everything the incoming-offer screen shows beyond "an order exists" —
   * customer identity, the address to drop at, and how past couriers rated
   * this customer. Optional because getOfferDetails can come back empty (a
   * customer row that vanished mid-dispatch); the screen degrades to showing
   * less rather than the push failing to send at all.
   */
  details?: OfferDetails;
};

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
export async function sendOfferPush(courierId: number, offer: OfferPush): Promise<void> {
  if (!serviceAccount) return;

  const tokens = await getCourierFcmTokens(courierId);
  if (tokens.length === 0) return;

  const accessToken = await getAccessToken(serviceAccount);
  const url = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;
  const dead: string[] = [];

  await Promise.all(
    tokens.map(async (token) => {
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
            // One JSON string rather than three indexed fields — the app
            // parses it once into an array, and adding a fourth prior rating
            // later needs no new field name on either side.
            priorRatings: JSON.stringify(offer.details?.priorRatings ?? []),
          },
          android: {
            // Wakes a dozing device. Reserved for things a person is waiting
            // on — which an offer with a 30-second clock is.
            priority: "HIGH" as const,
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

      if (res.ok) return;

      const body = await res.text();
      // The app was uninstalled or the token rotated. Keeping it means retrying
      // a dead phone forever, and — worse — believing that courier was reached.
      if (res.status === 404 || body.includes("UNREGISTERED") || body.includes("INVALID_ARGUMENT")) {
        dead.push(token);
        return;
      }
      console.error(`[fcm] send failed (${res.status}): ${body}`);
    }),
  );

  if (dead.length > 0) await pruneFcmTokens(dead);
}
