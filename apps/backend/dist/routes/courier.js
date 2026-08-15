"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.courierRoutes = courierRoutes;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const sharp_1 = __importDefault(require("sharp"));
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../auth");
const web_headers_1 = require("../lib/web-headers");
const courier_availability_1 = require("../lib/utils/courier-availability");
const coords_1 = require("../lib/utils/coords");
const courier_documents_1 = require("../lib/courier-documents");
const dispatch_1 = require("../lib/dispatch");
const courier_device_1 = require("../lib/courier-device");
const DOCUMENT_DIR = node_path_1.default.join(process.cwd(), "uploads", "couriers");
const DOCUMENT_URL_PREFIX = "/uploads/couriers/";
async function getCourierId(userId) {
    const [courier] = await db_1.db
        .select({ id: schema_1.couriersTable.id })
        .from(schema_1.couriersTable)
        .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, userId))
        .limit(1);
    return courier?.id ?? null;
}
async function getCourierRow(userId) {
    const [courier] = await db_1.db
        .select({
        id: schema_1.couriersTable.id,
        status: schema_1.couriersTable.verification_status,
        note: schema_1.couriersTable.verification_note,
        verifiedAt: schema_1.couriersTable.verified_at,
    })
        .from(schema_1.couriersTable)
        .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, userId))
        .limit(1);
    return courier ?? null;
}
// Wording is shared by go-online and accept-order: whichever the courier tries
// first, they get the same reason and the same place to fix it.
const NOT_APPROVED_MESSAGE = "Akun kurir pian belum diverifikasi admin. Lengkapi dokumen di halaman Verifikasi Kurir dulu.";
async function closeOpenSessions(courierId) {
    await db_1.db
        .update(schema_1.courierSessionsTable)
        // Capped, not plain now(): go-online closes any dangling session, so a
        // courier who forgot to go offline a week ago would otherwise have that
        // abandoned session stamped with today's date and recorded as a week-long
        // shift. This is how a real 665-hour row got created.
        .set({ ended_at: courier_availability_1.cappedShiftEnd })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.courierSessionsTable.courier_id, courierId), (0, drizzle_orm_1.isNull)(schema_1.courierSessionsTable.ended_at)));
}
async function courierRoutes(app) {
    app.post("/api/courier/go-online", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        const courier = await getCourierRow(session.user.id);
        if (!courier)
            return reply.status(403).send({ success: false, error: "Not a courier" });
        // The gate lives here rather than only in the UI: going online is what makes
        // a courier eligible for orders, so an unverified account must not be able
        // to reach it by calling the endpoint directly.
        if (courier.status !== "approved") {
            return reply
                .status(403)
                .send({ success: false, error: NOT_APPROVED_MESSAGE, verificationStatus: courier.status });
        }
        const courierId = courier.id;
        // Close any dangling open session first, then open a new one
        await closeOpenSessions(courierId);
        await db_1.db.insert(schema_1.courierSessionsTable).values({ courier_id: courierId });
        return reply.send({ success: true });
    });
    app.post("/api/courier/go-offline", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        const courierId = await getCourierId(session.user.id);
        if (!courierId)
            return reply.status(403).send({ success: false, error: "Not a courier" });
        // A courier holding an order cannot clock out of it. Going offline clears
        // their reported position and ends the shift, which would leave a customer
        // watching a delivery nobody is on shift for — the order has to be finished
        // (or cancelled) first. Enforced here, not just in the UI, because the
        // button is one fetch call away from being bypassed.
        const availability = await (0, courier_availability_1.getCourierAvailability)(courierId);
        if (availability.hasActiveOrder) {
            return reply.status(409).send({
                success: false,
                error: "Pian masih punya pesanan berjalan. Selesaikan dulu pengantarannya sebelum offline.",
                hasActiveOrder: true,
            });
        }
        await closeOpenSessions(courierId);
        // Off shift means no deliveries in flight, so the stored position has no
        // remaining purpose. Clearing it here rather than trusting the client to
        // call /location/clear: a courier who closes the app or loses signal never
        // sends that request, and their last position would sit in the row.
        await db_1.db
            .update(schema_1.couriersTable)
            .set({ last_lat: null, last_lon: null, last_location_at: null })
            .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.id, courierId));
        return reply.send({ success: true });
    });
    app.post("/api/courier/accept-order", async (request, reply) => {
        // Session OR device token: the offer notification's Terima button fires
        // from the lock screen, with no WebView and no cookie in the picture.
        const identity = await (0, courier_device_1.resolveCourier)(request);
        if (!identity)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        // Belt and braces with the go-online gate: an approval can be revoked while
        // a courier is already online, and that must stop the next order being
        // claimed rather than waiting for them to go offline.
        if (identity.verificationStatus !== "approved") {
            return reply.status(403).send({
                success: false,
                error: NOT_APPROVED_MESSAGE,
                verificationStatus: identity.verificationStatus,
            });
        }
        const courierId = identity.courierId;
        const { orderId } = request.body ?? {};
        if (!orderId)
            return reply.status(400).send({ success: false, error: "orderId wajib diisi" });
        const availability = await (0, courier_availability_1.getCourierAvailability)(courierId);
        if (!availability.isOnline) {
            return reply.status(400).send({ success: false, error: "Kamu harus online untuk menerima order" });
        }
        if (availability.hasActiveOrder) {
            return reply
                .status(400)
                .send({ success: false, error: "Selesaikan pesanan aktif kamu sebelum menerima order baru" });
        }
        // Dispatch gate. Either this courier holds the live offer, or the order has
        // fallen through to the open pool where the old first-come rule still
        // applies. Without this, a courier could accept an order that was offered to
        // someone else by calling the endpoint directly — which is the race this
        // whole change removes.
        if (!(await (0, dispatch_1.mayAcceptOrder)(courierId, orderId))) {
            return reply
                .status(409)
                .send({ success: false, error: "Order ini sedang ditawarkan ke kurir lain" });
        }
        const updated = await db_1.db
            .update(schema_1.ordersTable)
            .set({ courier_id: courierId, status: "preparing", updatedAt: new Date() })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ordersTable.id, orderId), (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "confirmed"), (0, drizzle_orm_1.isNull)(schema_1.ordersTable.courier_id), 
        // Service and materials orders are courier-less by design; a courier
        // must never claim one. Positive filter, so new lanes stay excluded
        // unless someone deliberately adds them.
        (0, drizzle_orm_1.eq)(schema_1.ordersTable.fulfillment, "delivery")))
            .returning({ id: schema_1.ordersTable.id });
        if (updated.length === 0) {
            return reply.status(409).send({ success: false, error: "Order sudah diambil kurir lain" });
        }
        // Close their offer, then retire anyone else's. The second call matters for
        // the open-pool case, where several couriers can be looking at the same
        // order and only one of them just won it.
        await (0, dispatch_1.respondToOffer)(courierId, orderId, "accepted");
        await (0, dispatch_1.supersedeOffers)(orderId);
        return reply.send({ success: true });
    });
    /**
     * Courier turns down the order they were offered.
     *
     * Declining is a first-class answer, not a timeout: it passes the order on
     * immediately instead of making the customer wait out a clock nobody is
     * watching, and it keeps "said no" distinguishable from "never looked" in the
     * courier's record.
     */
    app.post("/api/courier/decline-order", async (request, reply) => {
        // Same reason as accept-order: Tolak is a notification action button.
        const identity = await (0, courier_device_1.resolveCourier)(request);
        if (!identity)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        const courierId = identity.courierId;
        const { orderId } = request.body ?? {};
        if (!orderId)
            return reply.status(400).send({ success: false, error: "orderId wajib diisi" });
        const ok = await (0, dispatch_1.respondToOffer)(courierId, orderId, "declined");
        if (!ok) {
            return reply
                .status(409)
                .send({ success: false, error: "Tawaran ini sudah tidak berlaku" });
        }
        return reply.send({ success: true });
    });
    /**
     * The applicant's own view of their application: verdict, admin note, which
     * of the ten slots are filled, and which are still missing.
     */
    app.get("/api/courier/verification", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        const courier = await getCourierRow(session.user.id);
        if (!courier)
            return reply.status(403).send({ success: false, error: "Not a courier" });
        const { documents, missing, complete } = await (0, courier_documents_1.getCourierDocuments)(courier.id);
        return reply.send({
            success: true,
            status: courier.status,
            note: courier.note,
            verifiedAt: courier.verifiedAt,
            documents,
            missing,
            complete,
            groups: courier_documents_1.COURIER_DOCUMENT_GROUPS,
        });
    });
    /**
     * Upload (or replace) one document slot.
     *
     * One slot per request rather than all ten at once: these are phone-camera
     * photos on a mobile connection, and a single failed 20MB submission that
     * loses nine good pictures is how an applicant gives up.
     */
    app.post("/api/courier/documents", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        const courier = await getCourierRow(session.user.id);
        if (!courier)
            return reply.status(403).send({ success: false, error: "Not a courier" });
        // An approved courier re-uploading would silently re-open their own
        // application, so the door is shut once the verdict is yes.
        if (courier.status === "approved") {
            return reply
                .status(409)
                .send({ success: false, error: "Akun pian sudah diverifikasi, dokumen tidak bisa diubah." });
        }
        const file = await request.file();
        if (!file)
            return reply.status(400).send({ success: false, error: "Foto wajib diunggah" });
        const kindField = file.fields?.kind;
        const kind = typeof kindField?.value === "string" ? kindField.value : "";
        if (!(0, courier_documents_1.isCourierDocumentKind)(kind)) {
            return reply.status(400).send({ success: false, error: "Jenis dokumen tidak dikenal" });
        }
        const buffer = await file.toBuffer();
        const filename = `courier-${courier.id}-${kind}-${Date.now()}.webp`;
        await promises_1.default.mkdir(DOCUMENT_DIR, { recursive: true });
        // Bounded but still legible: an admin has to read a plate number and match a
        // face against a licence, so this keeps more resolution than a thumbnail.
        await (0, sharp_1.default)(buffer)
            .rotate()
            .resize(1400, 1400, { fit: "inside", withoutEnlargement: true })
            .webp({ quality: 82 })
            .toFile(node_path_1.default.join(DOCUMENT_DIR, filename));
        const image = `${DOCUMENT_URL_PREFIX}${filename}`;
        const [previous] = await db_1.db
            .select({ image: schema_1.courierDocumentsTable.image })
            .from(schema_1.courierDocumentsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.courierDocumentsTable.courier_id, courier.id), (0, drizzle_orm_1.eq)(schema_1.courierDocumentsTable.kind, kind)))
            .limit(1);
        await db_1.db
            .insert(schema_1.courierDocumentsTable)
            .values({ courier_id: courier.id, kind, image })
            .onConflictDoUpdate({
            target: [schema_1.courierDocumentsTable.courier_id, schema_1.courierDocumentsTable.kind],
            set: { image, updatedAt: new Date() },
        });
        // The replaced photo is deleted rather than left behind. Every one of these
        // is a picture of a face or a driving licence, and an orphan nobody can
        // reach through the app is still a copy sitting on the volume. Skipped when
        // the old file is doing double duty as the courier's avatar (an admin can
        // point the avatar at a document), since that reference is still live.
        if (previous && previous.image !== image) {
            const [row] = await db_1.db
                .select({ avatar: schema_1.couriersTable.avatar })
                .from(schema_1.couriersTable)
                .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.id, courier.id))
                .limit(1);
            if (row?.avatar !== previous.image) {
                await promises_1.default
                    .rm(node_path_1.default.join(process.cwd(), previous.image.replace(/^\//, "")), { force: true })
                    // Best effort: a file that's already gone, or a permissions problem on
                    // the volume, must not fail an upload that otherwise succeeded.
                    .catch(() => { });
            }
        }
        // A rejected application that gets a corrected photo goes back in the queue
        // by itself. Making the applicant find a separate "submit again" button
        // after fixing exactly what they were told to fix is a step that only
        // creates stuck applications.
        //
        // The note is deliberately KEPT. A rejection usually lists more than one
        // problem ("foto kiri masih pakai topi, STNK buram"), and clearing it the
        // moment the first photo is replaced deletes the instructions while the
        // applicant is still working through them. It stays readable until an admin
        // approves, which is the point where it stops being true.
        const status = courier.status === "rejected" ? "pending" : courier.status;
        if (courier.status === "rejected") {
            await db_1.db
                .update(schema_1.couriersTable)
                .set({ verification_status: "pending" })
                .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.id, courier.id));
        }
        const { documents, missing, complete } = await (0, courier_documents_1.getCourierDocuments)(courier.id);
        // status/note ride back so the page's banner reflects the new state without
        // a reload — otherwise it keeps saying "Ditolak" after the resubmit that
        // already moved the application back into the queue.
        return reply.send({
            success: true,
            image,
            status,
            note: courier.note,
            documents,
            missing,
            complete,
        });
    });
    /**
     * Register this install: swap an FCM token for a device token.
     *
     * Session-authenticated, because this is the one moment the WebView is
     * definitely alive and holding a cookie. Everything the native side does
     * afterwards rides on the token minted here.
     */
    app.post("/api/courier/device", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        const courier = await getCourierRow(session.user.id);
        if (!courier)
            return reply.status(403).send({ success: false, error: "Not a courier" });
        const { fcmToken, platform, appVersion } = request.body ?? {};
        if (typeof fcmToken !== "string" || fcmToken.length < 20) {
            return reply.status(400).send({ success: false, error: "fcmToken tidak valid" });
        }
        const deviceToken = await (0, courier_device_1.registerCourierDevice)({
            courierId: courier.id,
            fcmToken,
            platform,
            appVersion,
        });
        // The plaintext is returned exactly once — only its hash is stored, so a
        // lost token is replaced by re-registering, never recovered.
        return reply.send({ success: true, deviceToken });
    });
    /**
     * Sign this install out — or every install, when the WebView logs out and no
     * longer knows which device token it minted.
     */
    app.post("/api/courier/device/revoke", async (request, reply) => {
        const identity = await (0, courier_device_1.resolveCourier)(request);
        if (!identity)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        const { deviceToken } = request.body ?? {};
        if (typeof deviceToken === "string" && deviceToken.length > 0) {
            await (0, courier_device_1.revokeCourierDevice)(deviceToken);
        }
        else {
            await (0, courier_device_1.revokeAllCourierDevices)(identity.courierId);
        }
        return reply.send({ success: true });
    });
    /**
     * Courier reports where they are, so the customer's ETA reflects reality.
     *
     * Overwrites in place — this is "where are they now", never a movement trail.
     * The courier app only calls it while an order is actually in flight, and
     * clear-on-finish below wipes the point when the delivery ends, so the stored
     * data never outlives the reason for collecting it.
     */
    app.post("/api/courier/location", async (request, reply) => {
        // The reason the device token exists: this is posted by a foreground
        // service that keeps running after the WebView is gone.
        const identity = await (0, courier_device_1.resolveCourier)(request);
        if (!identity)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        const courierId = identity.courierId;
        const { lat, lon } = request.body ?? {};
        const coords = (0, coords_1.parseCoordPair)(lat, lon);
        if (!coords) {
            return reply.status(400).send({ success: false, error: "Koordinat tidak valid" });
        }
        await db_1.db
            .update(schema_1.couriersTable)
            .set({
            last_lat: String(coords.lat),
            last_lon: String(coords.lon),
            last_location_at: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.id, courierId));
        return reply.send({ success: true });
    });
    /**
     * Drop the stored position.
     *
     * Called when the courier goes offline or finishes their last delivery. The
     * position exists to answer a live question; once there is no delivery in
     * flight there is no reason to keep knowing where this person is.
     */
    app.post("/api/courier/location/clear", async (request, reply) => {
        // Paired with /location, so it takes the same credentials: the service that
        // reported the position is the one that should be able to erase it.
        const identity = await (0, courier_device_1.resolveCourier)(request);
        if (!identity)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        await db_1.db
            .update(schema_1.couriersTable)
            .set({ last_lat: null, last_lon: null, last_location_at: null })
            .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.id, identity.courierId));
        return reply.send({ success: true });
    });
}
