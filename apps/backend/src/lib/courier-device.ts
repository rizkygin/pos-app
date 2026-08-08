import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { courierDevicesTable, couriersTable } from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "./web-headers";

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

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Mints a new device token, returning the plaintext once and storing only its hash. */
export async function registerCourierDevice(params: {
  courierId: number;
  fcmToken: string;
  platform?: string;
  appVersion?: string;
}): Promise<string> {
  const deviceToken = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  const hash = hashToken(deviceToken);

  // Conflict on fcm_token, not on courier: the row follows the PHONE. A device
  // handed to another courier re-registers and moves, rather than leaving its
  // previous owner subscribed to offers they can no longer act on.
  await db
    .insert(courierDevicesTable)
    .values({
      courier_id: params.courierId,
      fcm_token: params.fcmToken,
      device_token_hash: hash,
      platform: params.platform ?? "android",
      app_version: params.appVersion ?? null,
      last_seen_at: sql`now()`,
    })
    .onConflictDoUpdate({
      target: courierDevicesTable.fcm_token,
      set: {
        courier_id: params.courierId,
        device_token_hash: hash,
        platform: params.platform ?? "android",
        app_version: params.appVersion ?? null,
        last_seen_at: sql`now()`,
        // Re-registering revives a device that had been signed out.
        revoked_at: null,
        updatedAt: new Date(),
      },
    });

  return deviceToken;
}

/** Signs one install out. Idempotent: an unknown token is already revoked. */
export async function revokeCourierDevice(deviceToken: string): Promise<void> {
  await db
    .update(courierDevicesTable)
    .set({ revoked_at: sql`now()` })
    .where(eq(courierDevicesTable.device_token_hash, hashToken(deviceToken)));
}

/** Revokes every install belonging to a courier — used when the WebView logs out. */
export async function revokeAllCourierDevices(courierId: number): Promise<void> {
  await db
    .update(courierDevicesTable)
    .set({ revoked_at: sql`now()` })
    .where(
      and(
        eq(courierDevicesTable.courier_id, courierId),
        isNull(courierDevicesTable.revoked_at),
      ),
    );
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

export type CourierIdentity = {
  courierId: number;
  verificationStatus: "pending" | "approved" | "rejected";
  /** How they proved it — useful when deciding what a caller may do. */
  via: "session" | "device";
};

/**
 * Resolve the calling courier from either credential.
 *
 * Session first, because the browser and the WebView are the common case and a
 * cookie is already parsed by the time we get here. The device token is the
 * fallback for the native services.
 */
export async function resolveCourier(
  request: FastifyRequest,
): Promise<CourierIdentity | null> {
  const session = await auth.api
    .getSession({ headers: toWebHeaders(request.headers) })
    .catch(() => null);

  if (session?.user) {
    const [courier] = await db
      .select({
        id: couriersTable.id,
        status: couriersTable.verification_status,
      })
      .from(couriersTable)
      .where(
        and(
          eq(couriersTable.user_id, session.user.id),
          isNull(couriersTable.deletedAt),
        ),
      )
      .limit(1);

    if (courier) {
      return { courierId: courier.id, verificationStatus: courier.status, via: "session" };
    }
  }

  const token = bearerToken(request);
  if (!token) return null;

  const [row] = await db
    .select({
      deviceId: courierDevicesTable.id,
      courierId: couriersTable.id,
      status: couriersTable.verification_status,
    })
    .from(courierDevicesTable)
    .innerJoin(couriersTable, eq(courierDevicesTable.courier_id, couriersTable.id))
    .where(
      and(
        eq(courierDevicesTable.device_token_hash, hashToken(token)),
        isNull(courierDevicesTable.revoked_at),
        isNull(couriersTable.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return null;

  // Doubles as the "is this install still alive" signal — a device that stops
  // reporting is how you tell a dead phone from a courier ignoring offers.
  await db
    .update(courierDevicesTable)
    .set({ last_seen_at: sql`now()` })
    .where(eq(courierDevicesTable.id, row.deviceId));

  return { courierId: row.courierId, verificationStatus: row.status, via: "device" };
}

/** Active install tokens for a courier, for the push sender. */
export async function getCourierFcmTokens(courierId: number): Promise<string[]> {
  const rows = await db
    .select({ token: courierDevicesTable.fcm_token })
    .from(courierDevicesTable)
    .where(
      and(
        eq(courierDevicesTable.courier_id, courierId),
        isNull(courierDevicesTable.revoked_at),
      ),
    );

  return rows.map((r) => r.token);
}

/** Drops tokens FCM has told us are dead, so they stop being retried forever. */
export async function pruneFcmTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await db
    .update(courierDevicesTable)
    .set({ revoked_at: sql`now()` })
    .where(sql`${courierDevicesTable.fcm_token} = ANY(${tokens})`);
}
