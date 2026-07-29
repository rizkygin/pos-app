import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { pushSubscriptionsTable } from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { getPublicKey, pushConfigured, sendPushToUser } from "../lib/push";

type SubscribeBody = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

export async function pushRoutes(app: FastifyInstance) {
  // Served rather than baked into the frontend bundle as a NEXT_PUBLIC_ var:
  // the key can then be rotated (or configured per environment) without a
  // frontend rebuild.
  app.get("/api/push/public-key", async () => ({
    success: pushConfigured,
    publicKey: getPublicKey(),
  }));

  app.post("/api/push/subscribe", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const body = (request.body ?? {}) as SubscribeBody;
    const endpoint = body.endpoint;
    const p256dh = body.keys?.p256dh;
    const authKey = body.keys?.auth;

    if (!endpoint || !p256dh || !authKey) {
      return reply.status(400).send({ success: false, error: "Subscription tidak lengkap" });
    }

    const userAgent = String(request.headers["user-agent"] ?? "").slice(0, 500);

    // The same endpoint can come back under a different user (shared device, or
    // the owner signing in as someone else), so reassign on conflict rather
    // than inserting a duplicate — the unique index would reject it anyway.
    await db
      .insert(pushSubscriptionsTable)
      .values({
        user_id: session.user.id,
        endpoint,
        p256dh,
        auth: authKey,
        user_agent: userAgent,
      })
      .onConflictDoUpdate({
        target: pushSubscriptionsTable.endpoint,
        set: {
          user_id: session.user.id,
          p256dh,
          auth: authKey,
          user_agent: userAgent,
        },
      });

    return { success: true };
  });

  app.post("/api/push/unsubscribe", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const { endpoint } = (request.body ?? {}) as { endpoint?: string };
    if (!endpoint) return reply.status(400).send({ success: false, error: "endpoint wajib diisi" });

    // Scoped to the caller so one user can't delete another's subscription by
    // guessing an endpoint.
    await db
      .delete(pushSubscriptionsTable)
      .where(
        and(
          eq(pushSubscriptionsTable.endpoint, endpoint),
          eq(pushSubscriptionsTable.user_id, session.user.id),
        ),
      );

    return { success: true };
  });

  // Lets the owner confirm the whole chain works (permission, service worker,
  // VAPID keys, and the push service itself) without waiting for a real order.
  app.post("/api/push/test", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const result = await sendPushToUser(session.user.id, {
      title: "Notifikasi aktif ✅",
      body: "Pesanan baru akan muncul di sini walaupun aplikasi ditutup.",
      url: "/dashboard/activeorder",
      tag: "push-test",
    });

    return { success: true, ...result };
  });
}
