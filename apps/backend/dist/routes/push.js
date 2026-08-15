"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushRoutes = pushRoutes;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../auth");
const web_headers_1 = require("../lib/web-headers");
const push_1 = require("../lib/push");
async function pushRoutes(app) {
    // Served rather than baked into the frontend bundle as a NEXT_PUBLIC_ var:
    // the key can then be rotated (or configured per environment) without a
    // frontend rebuild.
    app.get("/api/push/public-key", async () => ({
        success: push_1.pushConfigured,
        publicKey: (0, push_1.getPublicKey)(),
    }));
    app.post("/api/push/subscribe", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false });
        const body = (request.body ?? {});
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
        await db_1.db
            .insert(schema_1.pushSubscriptionsTable)
            .values({
            user_id: session.user.id,
            endpoint,
            p256dh,
            auth: authKey,
            user_agent: userAgent,
        })
            .onConflictDoUpdate({
            target: schema_1.pushSubscriptionsTable.endpoint,
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
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false });
        const { endpoint } = (request.body ?? {});
        if (!endpoint)
            return reply.status(400).send({ success: false, error: "endpoint wajib diisi" });
        // Scoped to the caller so one user can't delete another's subscription by
        // guessing an endpoint.
        await db_1.db
            .delete(schema_1.pushSubscriptionsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.pushSubscriptionsTable.endpoint, endpoint), (0, drizzle_orm_1.eq)(schema_1.pushSubscriptionsTable.user_id, session.user.id)));
        return { success: true };
    });
    // Lets the owner confirm the whole chain works (permission, service worker,
    // VAPID keys, and the push service itself) without waiting for a real order.
    app.post("/api/push/test", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false });
        const result = await (0, push_1.sendPushToUser)(session.user.id, {
            title: "Notifikasi aktif ✅",
            body: "Pesanan baru akan muncul di sini walaupun aplikasi ditutup.",
            url: "/dashboard/activeorder",
            tag: "push-test",
        });
        return { success: true, ...result };
    });
}
