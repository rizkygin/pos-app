import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { staffDevicesTable } from "../db/schema";

/**
 * The till app's phones, for Pesan Mandiri's push (staffDevicesTable). The
 * session cookie is the credential here: the app registers while signed in, so
 * unlike courier_devices there is no device token to mint.
 */

/** This phone rings for this outlet now. Moves the row if the phone was someone else's. */
export async function registerStaffDevice(params: {
  userId: string;
  outletId: number;
  fcmToken: string;
  platform?: string;
  appVersion?: string;
}): Promise<void> {
  const platform = params.platform?.slice(0, 20) || "android";
  const appVersion = params.appVersion?.slice(0, 30) || null;
  await db
    .insert(staffDevicesTable)
    .values({
      user_id: params.userId,
      outlet_id: params.outletId,
      fcm_token: params.fcmToken,
      platform,
      app_version: appVersion,
      last_seen_at: sql`now()`,
    })
    .onConflictDoUpdate({
      target: staffDevicesTable.fcm_token,
      set: {
        user_id: params.userId,
        outlet_id: params.outletId,
        platform,
        app_version: appVersion,
        last_seen_at: sql`now()`,
        // Registering again revives a phone that had been signed out.
        revoked_at: null,
        updatedAt: new Date(),
      },
    });
}

/** This phone stops ringing. Only its own user may say so; an unknown token is already quiet. */
export async function revokeStaffDevice(userId: string, fcmToken: string): Promise<void> {
  await db
    .update(staffDevicesTable)
    .set({ revoked_at: sql`now()`, updatedAt: new Date() })
    .where(
      and(
        eq(staffDevicesTable.fcm_token, fcmToken),
        eq(staffDevicesTable.user_id, userId),
        isNull(staffDevicesTable.revoked_at),
      ),
    );
}

/**
 * The phones to ring for a new self order at this outlet: registered for it,
 * not revoked, and still in the hands of someone who works the inbox — the
 * owner, or an active employee with `cashier` or `tables` (the inbox's own
 * STAFF rule). Checked here rather than at registration, so a dismissed
 * employee's phone goes quiet by itself.
 */
export async function getSelfOrderFcmTokens(outletId: number): Promise<string[]> {
  const rows = await db.execute<{ token: string }>(sql`
    select d.fcm_token as token
    from staff_devices d
    join outlets o on o.id = d.outlet_id
    left join employees e
      on e.user_id = d.user_id
     and e.outlet_id = d.outlet_id
     and e.is_active = true
    where d.outlet_id = ${outletId}
      and d.revoked_at is null
      and (
        o.user_id = d.user_id
        or (e.id is not null and (e.permissions->>'cashier' = 'true' or e.permissions->>'tables' = 'true'))
      )
  `);
  return rows.rows.map((r) => r.token);
}

/** Drops tokens FCM has told us are dead, so they stop being retried forever. */
export async function pruneStaffFcmTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await db
    .update(staffDevicesTable)
    .set({ revoked_at: sql`now()` })
    .where(sql`${staffDevicesTable.fcm_token} = ANY(${tokens})`);
}
