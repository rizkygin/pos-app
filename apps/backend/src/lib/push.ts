import webpush from "web-push";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { pushSubscriptionsTable } from "../db/schema";

// VAPID identifies THIS server to the push services (FCM/Mozilla/Apple). The
// key pair must be stable: rotating it invalidates every stored subscription,
// so the keys live in env and are shared across deploys, not generated at boot.
const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT ?? "mailto:noreply@ulunpesan.com";

export const pushConfigured = Boolean(publicKey && privateKey);

if (pushConfigured) {
  webpush.setVapidDetails(subject, publicKey!, privateKey!);
} else {
  console.warn(
    "[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — web push is disabled.",
  );
}

export function getPublicKey() {
  return publicKey ?? null;
}

export type PushPayload = {
  title: string;
  body: string;
  // Where notificationclick should take the user.
  url?: string;
  // Notifications sharing a tag replace each other instead of stacking, so a
  // burst of orders leaves one live notification rather than a wall of them.
  tag?: string;
};

/**
 * Fan a notification out to every device the user has subscribed.
 *
 * Never throws: a failed push must not take down whatever business action
 * triggered it (an order still counts even if the owner's phone is
 * unreachable). Subscriptions the push service reports as dead are deleted —
 * they are gone for good, and retrying them forever is what turns a push table
 * into a graveyard.
 */
export async function sendPushToUser(userId: string, payload: PushPayload) {
  if (!pushConfigured) return { sent: 0, pruned: 0 };

  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.user_id, userId));

  if (subs.length === 0) return { sent: 0, pruned: 0 };

  const body = JSON.stringify(payload);
  const dead: string[] = [];
  let sent = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          // Hold the message for 6h if the device is offline — an owner whose
          // phone was in a dead zone still learns about the order, and stale
          // ones expire instead of arriving the next morning.
          { TTL: 60 * 60 * 6, urgency: "high" },
        );
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410: the browser dropped the subscription (uninstalled, cleared
        // site data, permission revoked). Anything else is transient.
        if (status === 404 || status === 410) dead.push(sub.endpoint);
        else console.error("[push] send failed", status, (err as Error).message);
      }
    }),
  );

  if (dead.length > 0) {
    await db
      .delete(pushSubscriptionsTable)
      .where(inArray(pushSubscriptionsTable.endpoint, dead));
  }

  return { sent, pruned: dead.length };
}
