"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errandRoutes = errandRoutes;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../auth");
const web_headers_1 = require("../lib/web-headers");
const courier_availability_1 = require("../lib/utils/courier-availability");
const geo_1 = require("../lib/utils/geo");
const phone_1 = require("../lib/utils/phone");
const update_ratings_1 = require("../lib/update-ratings");
const fcm_1 = require("../lib/fcm");
/**
 * "Suruh Kurir" — hiring one courier directly, with no outlet and no products.
 *
 * The negotiation happens on WhatsApp, outside the app entirely. These
 * endpoints only record the outcome: the customer names a courier, the courier
 * accepts with his own price or declines, and the job ends when he marks it
 * delivered. Nothing here computes a fee, and nothing books money — errands
 * are outside the platform's accounting by design.
 */
/**
 * How long a customer must wait before pulling out of a request.
 *
 * A floor, not a timeout: nothing expires an errand on its own. The courier is
 * held exclusively until he answers, and this is the only thing that can end
 * that wait from the other side. Short enough that a customer isn't trapped by
 * a courier who put his phone down, long enough that "he hasn't replied in
 * four seconds" doesn't burn a courier's exclusivity for nothing.
 */
const CANCEL_FLOOR_MS = 5 * 60 * 1000;
/**
 * And how long they must then wait before hiring again.
 *
 * Applies only to backing out of a job the courier already ACCEPTED — the
 * courier has committed and possibly started moving. Deliberately not applied
 * to a courier's own rejection: the customer did nothing wrong there, and
 * making them wait for someone else's decision would be a penalty for being
 * turned down.
 */
const COOLDOWN_MS = 5 * 60 * 1000;
/**
 * How close the courier must be to the customer's pin to close the job.
 *
 * "Tandai Sudah Sampai" was previously an unguarded button: a courier could end
 * the errand from anywhere, including his own house, and the customer had no
 * say in it — the job simply became `delivered`. This is the check that makes
 * the button mean what it says.
 */
const ARRIVAL_RADIUS_M = 20;
/**
 * And how imprecise a fix may be before we refuse to judge it.
 *
 * A phone reporting ±200m cannot prove anything about a 20m circle, so a
 * reading that loose is rejected as unusable rather than silently treated as
 * "too far" — the courier standing in the right place deserves "tunggu sinyal
 * membaik", not "you are not here".
 */
const MAX_ACCURACY_M = 75;
const NO_ADDRESS_MESSAGE = "Atur alamat utama pian dulu di halaman Alamat sebelum suruh kurir.";
const NO_PHONE_MESSAGE = "Nomor HP pian belum diatur. Kurir perlu nomor buat menghubungi lewat WhatsApp.";
/**
 * Session or a sent 401. Callers return immediately on null — the reply has
 * already gone out by then.
 */
async function requireUser(request, reply) {
    const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
    if (!session?.user) {
        reply.status(401).send({ success: false, error: "Unauthorized" });
        return null;
    }
    return session.user;
}
/** "820 m" / "80 m" — metres while they still mean something to a rider. */
function formatDistance(metres) {
    return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} meter`;
}
async function getCourierId(userId) {
    const [courier] = await db_1.db
        .select({ id: schema_1.couriersTable.id })
        .from(schema_1.couriersTable)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, userId), (0, drizzle_orm_1.isNull)(schema_1.couriersTable.deletedAt)))
        .limit(1);
    return courier?.id ?? null;
}
/**
 * The customer's default saved address, snapshotted into the errand.
 *
 * Falls back to the most recently added location when nothing is flagged
 * default — a customer with exactly one unflagged address should not be told
 * they have none.
 */
async function getDefaultLocation(userId) {
    const [loc] = await db_1.db
        .select({
        address: schema_1.locationsTable.address,
        lat: schema_1.locationsTable.lat,
        lon: schema_1.locationsTable.lon,
    })
        .from(schema_1.locationsTable)
        .where((0, drizzle_orm_1.eq)(schema_1.locationsTable.user_id, userId))
        .orderBy((0, drizzle_orm_1.desc)(schema_1.locationsTable.is_default), (0, drizzle_orm_1.desc)(schema_1.locationsTable.createdAt))
        .limit(1);
    return loc ?? null;
}
/**
 * How past couriers have rated this customer.
 *
 * Not every user has a customers row — a courier can hire another courier —
 * so an absent row means "no history", which reads as a clean 5 rather than as
 * an error. Same default the ratings columns themselves carry.
 */
async function getCustomerReputation(userId) {
    const [row] = await db_1.db
        .select({
        ratings: schema_1.customersTable.ratings,
        reviewCount: schema_1.customersTable.review_count,
    })
        .from(schema_1.customersTable)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, userId), (0, drizzle_orm_1.isNull)(schema_1.customersTable.deletedAt)))
        .limit(1);
    return {
        rating: Number(row?.ratings ?? 5),
        reviewCount: row?.reviewCount ?? 0,
    };
}
async function errandRoutes(app) {
    // ------------------------------------------------------------------
    // Customer side
    // ------------------------------------------------------------------
    /**
     * Couriers the customer can hire right now, nearest first.
     *
     * Distance is measured from the customer's SAVED address, not their phone's
     * live position: the errand is usually "bring this to my house", and a
     * customer ordering from the office would otherwise be shown couriers near
     * the wrong end of the trip.
     *
     * The availability rules are the same three that govern dispatch — approved,
     * on an uncapped shift, and not already carrying anything (order or errand).
     * Expressed as SQL rather than by calling getCourierAvailability per courier,
     * which would be one round trip per row.
     */
    app.get("/api/errands/couriers", async (request, reply) => {
        const user = await requireUser(request, reply);
        if (!user)
            return;
        const location = await getDefaultLocation(user.id);
        if (!location) {
            // A distinct code, not an empty list. "No couriers available" and "you
            // have no address" look identical in a UI that only gets rows back, and
            // the second one is the customer's to fix.
            return reply
                .status(409)
                .send({ success: false, error: NO_ADDRESS_MESSAGE, code: "no_address" });
        }
        const rows = await db_1.db
            .select({
            id: schema_1.couriersTable.id,
            name: schema_1.usersTable.name,
            avatar: schema_1.couriersTable.avatar,
            vehicleType: schema_1.couriersTable.vehicle_type,
            vehiclePlate: schema_1.couriersTable.vehicle_plate,
            ratings: schema_1.couriersTable.ratings,
            reviewCount: schema_1.couriersTable.review_count,
            lastLat: schema_1.couriersTable.last_lat,
            lastLon: schema_1.couriersTable.last_lon,
        })
            .from(schema_1.couriersTable)
            .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, schema_1.usersTable.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.isNull)(schema_1.couriersTable.deletedAt), (0, drizzle_orm_1.eq)(schema_1.couriersTable.verification_status, "approved"), 
        // A courier cannot hire himself.
        (0, drizzle_orm_1.ne)(schema_1.couriersTable.user_id, user.id), (0, drizzle_orm_1.sql) `EXISTS (
            SELECT 1 FROM ${schema_1.courierSessionsTable}
            WHERE ${schema_1.courierSessionsTable.courier_id} = ${schema_1.couriersTable.id}
              AND ${schema_1.courierSessionsTable.ended_at} IS NULL
              AND ${schema_1.courierSessionsTable.started_at} >= ${(0, courier_availability_1.staleShiftCutoff)()}
          )`, (0, drizzle_orm_1.sql) `NOT EXISTS (
            SELECT 1 FROM orders
            WHERE orders.courier_id = ${schema_1.couriersTable.id}
              AND orders.status IN ('preparing', 'ready', 'on_delivery')
          )`, (0, drizzle_orm_1.sql) `NOT EXISTS (
            SELECT 1 FROM ${schema_1.errandOrdersTable}
            WHERE ${schema_1.errandOrdersTable.courier_id} = ${schema_1.couriersTable.id}
              AND ${schema_1.errandOrdersTable.status} IN ('pending', 'on_delivery')
          )`));
        const originLat = Number(location.lat);
        const originLon = Number(location.lon);
        const originValid = Number.isFinite(originLat) && Number.isFinite(originLon);
        const couriers = rows
            .map((c) => {
            const lat = c.lastLat !== null ? Number(c.lastLat) : null;
            const lon = c.lastLon !== null ? Number(c.lastLon) : null;
            const hasPosition = lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon);
            return {
                id: c.id,
                name: c.name,
                avatar: c.avatar,
                vehicleType: c.vehicleType,
                vehiclePlate: c.vehiclePlate,
                rating: Number(c.ratings ?? 5),
                reviewCount: c.reviewCount,
                distanceKm: originValid && hasPosition
                    ? (0, geo_1.haversineKm)(originLat, originLon, lat, lon)
                    : null,
            };
        })
            // Couriers who have never reported a position sort last rather than
            // dropping out. They are genuinely available; the list just cannot say
            // how far away they are, and hiding them would shrink the pool for a
            // missing GPS ping.
            .sort((a, b) => {
            if (a.distanceKm === null)
                return b.distanceKm === null ? 0 : 1;
            if (b.distanceKm === null)
                return -1;
            return a.distanceKm - b.distanceKm;
        });
        return reply.send({ success: true, couriers, origin: { address: location.address } });
    });
    /** Hire one courier. */
    app.post("/api/errands", async (request, reply) => {
        const user = await requireUser(request, reply);
        if (!user)
            return;
        const body = (request.body ?? {});
        const courierId = Number(body.courierId);
        if (!Number.isInteger(courierId)) {
            return reply.status(400).send({ success: false, error: "courierId required" });
        }
        const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
        // The courier reaches the customer on WhatsApp and nowhere else, so a
        // request from someone unreachable is one nobody can act on. Checked here
        // rather than left to fail in the chat step.
        const [me] = await db_1.db
            .select({ name: schema_1.usersTable.name, phone: schema_1.usersTable.phone })
            .from(schema_1.usersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.usersTable.id, user.id))
            .limit(1);
        if (!me?.phone) {
            return reply
                .status(409)
                .send({ success: false, error: NO_PHONE_MESSAGE, code: "no_phone" });
        }
        const location = await getDefaultLocation(user.id);
        if (!location) {
            return reply
                .status(409)
                .send({ success: false, error: NO_ADDRESS_MESSAGE, code: "no_address" });
        }
        // One live errand per customer. Without this a customer could hold several
        // couriers hostage at once, each blocked from other work.
        const [existing] = await db_1.db
            .select({ id: schema_1.errandOrdersTable.id })
            .from(schema_1.errandOrdersTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.user_id, user.id), (0, drizzle_orm_1.inArray)(schema_1.errandOrdersTable.status, ["pending", "on_delivery"])))
            .limit(1);
        if (existing) {
            return reply.status(409).send({
                success: false,
                error: "Pian masih punya pesanan kurir yang berjalan.",
                code: "already_active",
                errandId: existing.id,
            });
        }
        // Cooldown after abandoning an accepted job — see COOLDOWN_MS.
        const [recentCancel] = await db_1.db
            .select({ cancelledAt: schema_1.errandOrdersTable.updatedAt })
            .from(schema_1.errandOrdersTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.user_id, user.id), (0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.status, "cancelled_by_customer"), (0, drizzle_orm_1.gte)(schema_1.errandOrdersTable.updatedAt, new Date(Date.now() - COOLDOWN_MS))))
            .limit(1);
        if (recentCancel?.cancelledAt) {
            const secondsLeft = Math.ceil((COOLDOWN_MS - (Date.now() - new Date(recentCancel.cancelledAt).getTime())) / 1000);
            return reply.status(429).send({
                success: false,
                error: "Pian baru saja membatalkan pesanan. Coba lagi sebentar.",
                code: "cooldown",
                secondsLeft,
            });
        }
        const id = crypto.randomUUID();
        try {
            await db_1.db.insert(schema_1.errandOrdersTable).values({
                id,
                user_id: user.id,
                courier_id: courierId,
                note: note || null,
                pickup_address: location.address,
                pickup_lat: location.lat,
                pickup_lon: location.lon,
            });
        }
        catch (err) {
            // errand_orders_courier_pending_uq. Two customers tapped the same courier
            // at the same moment and this one lost — which is the index doing its
            // job, not a fault. Reported as "already taken", not as a server error.
            if (String(err).includes("errand_orders_courier_pending_uq")) {
                return reply.status(409).send({
                    success: false,
                    error: "Kurir ini baru saja dapat pesanan lain. Pilih kurir lain ya.",
                    code: "courier_taken",
                });
            }
            throw err;
        }
        const reputation = await getCustomerReputation(user.id);
        // Push failures must not fail the request: the errand exists, and the
        // courier can still find it in his list. Losing the row because a phone was
        // unreachable would be the worse outcome.
        void (0, fcm_1.sendErrandPush)(courierId, {
            errandId: id,
            customerName: me.name,
            customerPhone: me.phone,
            customerRating: reputation.rating,
            customerReviewCount: reputation.reviewCount,
            note,
            pickupAddress: location.address,
            pickupLat: Number(location.lat),
            pickupLon: Number(location.lon),
        }).catch((err) => console.error("[errand] push failed", err));
        return reply.send({ success: true, errandId: id });
    });
    /** The customer's live errand, for the activeorder screen. */
    app.get("/api/errands/active", async (request, reply) => {
        const user = await requireUser(request, reply);
        if (!user)
            return;
        const [row] = await db_1.db
            .select({
            id: schema_1.errandOrdersTable.id,
            status: schema_1.errandOrdersTable.status,
            note: schema_1.errandOrdersTable.note,
            price: schema_1.errandOrdersTable.price,
            pickupAddress: schema_1.errandOrdersTable.pickup_address,
            pickupLat: schema_1.errandOrdersTable.pickup_lat,
            pickupLon: schema_1.errandOrdersTable.pickup_lon,
            createdAt: schema_1.errandOrdersTable.createdAt,
            acceptedAt: schema_1.errandOrdersTable.accepted_at,
            courierId: schema_1.couriersTable.id,
            courierName: schema_1.usersTable.name,
            courierPhone: schema_1.usersTable.phone,
            courierAvatar: schema_1.couriersTable.avatar,
            courierPlate: schema_1.couriersTable.vehicle_plate,
            courierRating: schema_1.couriersTable.ratings,
            courierLat: schema_1.couriersTable.last_lat,
            courierLon: schema_1.couriersTable.last_lon,
            courierPositionAt: schema_1.couriersTable.last_location_at,
        })
            .from(schema_1.errandOrdersTable)
            .innerJoin(schema_1.couriersTable, (0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.courier_id, schema_1.couriersTable.id))
            .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, schema_1.usersTable.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.user_id, user.id), (0, drizzle_orm_1.inArray)(schema_1.errandOrdersTable.status, ["pending", "on_delivery"])))
            .limit(1);
        if (!row)
            return reply.send({ success: true, errand: null });
        const createdMs = row.createdAt ? new Date(row.createdAt).getTime() : Date.now();
        const cancellableInMs = Math.max(0, CANCEL_FLOOR_MS - (Date.now() - createdMs));
        return reply.send({
            success: true,
            errand: {
                ...row,
                // The screen needs a countdown, not a rule it has to re-derive. One
                // place decides when cancelling opens, and the button reads it.
                cancellableInSeconds: Math.ceil(cancellableInMs / 1000),
                canCancel: cancellableInMs === 0,
            },
        });
    });
    /** Customer backs out. Allowed from pending or on_delivery, after the floor. */
    app.post("/api/errands/:id/cancel", async (request, reply) => {
        const user = await requireUser(request, reply);
        if (!user)
            return;
        const { id } = request.params;
        const [errand] = await db_1.db
            .select({ status: schema_1.errandOrdersTable.status, createdAt: schema_1.errandOrdersTable.createdAt })
            .from(schema_1.errandOrdersTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.id, id), (0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.user_id, user.id)))
            .limit(1);
        if (!errand)
            return reply.status(404).send({ success: false, error: "Not found" });
        if (errand.status !== "pending" && errand.status !== "on_delivery") {
            return reply.status(409).send({ success: false, error: "Pesanan sudah selesai." });
        }
        const elapsed = Date.now() - new Date(errand.createdAt).getTime();
        if (elapsed < CANCEL_FLOOR_MS) {
            return reply.status(409).send({
                success: false,
                error: "Tunggu 5 menit dulu sebelum membatalkan.",
                code: "too_soon",
                secondsLeft: Math.ceil((CANCEL_FLOOR_MS - elapsed) / 1000),
            });
        }
        // Conditional update, matching how orders.ts guards its transitions: the
        // courier may be accepting in the same instant, and whoever loses that race
        // must be told rather than silently overwriting the other's result.
        const updated = await db_1.db
            .update(schema_1.errandOrdersTable)
            .set({ status: "cancelled_by_customer", updatedAt: new Date() })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.id, id), (0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.user_id, user.id), (0, drizzle_orm_1.inArray)(schema_1.errandOrdersTable.status, ["pending", "on_delivery"])))
            .returning({ id: schema_1.errandOrdersTable.id });
        if (updated.length === 0) {
            return reply.status(409).send({ success: false, error: "Status pesanan sudah berubah." });
        }
        return reply.send({ success: true });
    });
    /**
     * Customer turns down the price the courier quoted. on_delivery -> rejected.
     *
     * Separate from cancelling, and deliberately free of both waits. The floor
     * exists to give the courier time to answer, and he has answered; the
     * cooldown punishes abandoning a job under way, and refusing a price is not
     * that. Either wait here would leave a customer stuck with a quote they never
     * agreed to, which is the whole point of the negotiation happening first.
     */
    app.post("/api/errands/:id/reject-price", async (request, reply) => {
        const user = await requireUser(request, reply);
        if (!user)
            return;
        const { id } = request.params;
        const updated = await db_1.db
            .update(schema_1.errandOrdersTable)
            .set({ status: "rejected_by_customer", updatedAt: new Date() })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.id, id), (0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.user_id, user.id), 
        // Only once a price exists — before that there is nothing to refuse,
        // and the same conditional-update guard as cancel keeps this from
        // overwriting a courier who marked delivered in the same instant.
        (0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.status, "on_delivery"), (0, drizzle_orm_1.isNotNull)(schema_1.errandOrdersTable.price)))
            .returning({ id: schema_1.errandOrdersTable.id });
        if (updated.length === 0) {
            return reply.status(409).send({ success: false, error: "Status pesanan sudah berubah." });
        }
        return reply.send({ success: true });
    });
    // ------------------------------------------------------------------
    // Courier side
    // ------------------------------------------------------------------
    /** The request waiting for this courier, if any. */
    app.get("/api/courier/errands/pending", async (request, reply) => {
        const user = await requireUser(request, reply);
        if (!user)
            return;
        const courierId = await getCourierId(user.id);
        if (!courierId)
            return reply.status(403).send({ success: false, error: "Not a courier" });
        const [row] = await db_1.db
            .select({
            id: schema_1.errandOrdersTable.id,
            status: schema_1.errandOrdersTable.status,
            note: schema_1.errandOrdersTable.note,
            price: schema_1.errandOrdersTable.price,
            pickupAddress: schema_1.errandOrdersTable.pickup_address,
            pickupLat: schema_1.errandOrdersTable.pickup_lat,
            pickupLon: schema_1.errandOrdersTable.pickup_lon,
            createdAt: schema_1.errandOrdersTable.createdAt,
            customerUserId: schema_1.usersTable.id,
            customerName: schema_1.usersTable.name,
            customerPhone: schema_1.usersTable.phone,
        })
            .from(schema_1.errandOrdersTable)
            .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.user_id, schema_1.usersTable.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.courier_id, courierId), (0, drizzle_orm_1.inArray)(schema_1.errandOrdersTable.status, ["pending", "on_delivery"])))
            .limit(1);
        if (!row)
            return reply.send({ success: true, errand: null });
        const reputation = await getCustomerReputation(row.customerUserId);
        // The radius travels with the errand so the button's copy and the server's
        // rule can never disagree — one constant, quoted in both places.
        return reply.send({
            success: true,
            errand: { ...row, customer: reputation, arrivalRadiusM: ARRIVAL_RADIUS_M },
        });
    });
    /**
     * Look a customer up by phone number.
     *
     * Step 3 of the flow: before agreeing to anything the courier wants to know
     * who he is dealing with. Returns reputation only — name, rating, how many
     * people have rated them — and never an address, an order history or an
     * email. This endpoint takes a phone number and is available to any courier,
     * so it must not become a way to look up where someone lives.
     */
    app.get("/api/courier/errands/lookup", async (request, reply) => {
        const user = await requireUser(request, reply);
        if (!user)
            return;
        const courierId = await getCourierId(user.id);
        if (!courierId)
            return reply.status(403).send({ success: false, error: "Not a courier" });
        const raw = request.query?.phone;
        const phone = (0, phone_1.normalizeIndonesianPhone)(raw);
        if (!phone)
            return reply.status(400).send({ success: false, error: "Nomor tidak valid" });
        const [target] = await db_1.db
            .select({ id: schema_1.usersTable.id, name: schema_1.usersTable.name })
            .from(schema_1.usersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.usersTable.phone, phone))
            .limit(1);
        if (!target)
            return reply.send({ success: true, customer: null });
        const reputation = await getCustomerReputation(target.id);
        const recent = await db_1.db
            .select({
            stars: schema_1.ratingsTable.ratings,
            comment: schema_1.ratingsTable.comment,
            at: schema_1.ratingsTable.createdAt,
        })
            .from(schema_1.ratingsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ratingsTable.reciepent, target.id), (0, drizzle_orm_1.eq)(schema_1.ratingsTable.reciepent_as, "customer")))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.ratingsTable.createdAt))
            .limit(5);
        return reply.send({
            success: true,
            customer: { name: target.name, ...reputation, recent },
        });
    });
    /** Courier accepts, naming his own price. pending -> on_delivery. */
    app.post("/api/courier/errands/:id/accept", async (request, reply) => {
        const user = await requireUser(request, reply);
        if (!user)
            return;
        const courierId = await getCourierId(user.id);
        if (!courierId)
            return reply.status(403).send({ success: false, error: "Not a courier" });
        const { id } = request.params;
        const body = (request.body ?? {});
        const price = Number(body.price);
        if (!Number.isFinite(price) || price < 0) {
            return reply.status(400).send({ success: false, error: "Harga tidak valid" });
        }
        const updated = await db_1.db
            .update(schema_1.errandOrdersTable)
            .set({
            status: "on_delivery",
            price: String(Math.round(price)),
            accepted_at: new Date(),
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.id, id), (0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.courier_id, courierId), 
        // Guards both double-accept and accept-after-cancel: the customer may
        // have pulled out while this request was in flight.
        (0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.status, "pending")))
            .returning({ id: schema_1.errandOrdersTable.id });
        if (updated.length === 0) {
            return reply
                .status(409)
                .send({ success: false, error: "Pesanan sudah tidak berlaku.", code: "gone" });
        }
        return reply.send({ success: true });
    });
    /** Courier declines. pending -> rejected_by_courier. No cooldown follows. */
    app.post("/api/courier/errands/:id/reject", async (request, reply) => {
        const user = await requireUser(request, reply);
        if (!user)
            return;
        const courierId = await getCourierId(user.id);
        if (!courierId)
            return reply.status(403).send({ success: false, error: "Not a courier" });
        const { id } = request.params;
        const body = (request.body ?? {});
        const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 255) || null : null;
        const updated = await db_1.db
            .update(schema_1.errandOrdersTable)
            .set({ status: "rejected_by_courier", rejected_reason: reason, updatedAt: new Date() })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.id, id), (0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.courier_id, courierId), (0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.status, "pending")))
            .returning({ id: schema_1.errandOrdersTable.id });
        if (updated.length === 0) {
            return reply
                .status(409)
                .send({ success: false, error: "Pesanan sudah tidak berlaku.", code: "gone" });
        }
        return reply.send({ success: true });
    });
    /**
     * Job done. on_delivery -> delivered, which is also what frees the courier.
     *
     * Gated on the courier actually being at the customer's pin. The position is
     * taken from the request body — the device's live fix at the moment of the
     * press — and never from couriers.last_lat, which is a background ping that
     * may be minutes stale and is written by the same client anyway. Neither is
     * proof against a determined faker (any browser can be told to report any
     * coordinate); this stops the ordinary case of ending a job early, which is
     * what actually happens.
     */
    app.post("/api/courier/errands/:id/delivered", async (request, reply) => {
        const user = await requireUser(request, reply);
        if (!user)
            return;
        const courierId = await getCourierId(user.id);
        if (!courierId)
            return reply.status(403).send({ success: false, error: "Not a courier" });
        const { id } = request.params;
        const body = (request.body ?? {});
        const lat = Number(body.lat);
        const lon = Number(body.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            return reply.status(400).send({
                success: false,
                error: "Lokasi pian belum terbaca. Aktifkan GPS lalu coba lagi.",
                code: "no_position",
            });
        }
        const accuracy = Number(body.accuracy);
        if (Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_M) {
            return reply.status(409).send({
                success: false,
                error: `Sinyal GPS pian masih meleset ±${Math.round(accuracy)}m. Tunggu sebentar sampai lebih akurat.`,
                code: "weak_gps",
            });
        }
        // Read before write: the distance check needs the pin, and reporting the
        // real distance back is what lets the courier tell "I am at the wrong
        // house" apart from "the button is broken".
        const [errand] = await db_1.db
            .select({
            status: schema_1.errandOrdersTable.status,
            pickupLat: schema_1.errandOrdersTable.pickup_lat,
            pickupLon: schema_1.errandOrdersTable.pickup_lon,
        })
            .from(schema_1.errandOrdersTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.id, id), (0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.courier_id, courierId)))
            .limit(1);
        if (!errand)
            return reply.status(404).send({ success: false, error: "Pesanan tidak ada." });
        const pinLat = Number(errand.pickupLat);
        const pinLon = Number(errand.pickupLon);
        // An errand without a usable pin cannot be geofenced. Rather than block the
        // courier out of a job he may well have finished, the check is skipped —
        // every errand created through /api/errands snapshots a real address, so
        // this is a guard against bad data, not a supported path.
        if (Number.isFinite(pinLat) && Number.isFinite(pinLon)) {
            const distanceM = (0, geo_1.haversineKm)(lat, lon, pinLat, pinLon) * 1000;
            if (distanceM > ARRIVAL_RADIUS_M) {
                return reply.status(409).send({
                    success: false,
                    error: `Pian masih ${formatDistance(distanceM)} dari lokasi pelanggan. Dekati dulu sampai ${ARRIVAL_RADIUS_M} meter.`,
                    code: "too_far",
                    distanceM: Math.round(distanceM),
                    radiusM: ARRIVAL_RADIUS_M,
                });
            }
        }
        const updated = await db_1.db
            .update(schema_1.errandOrdersTable)
            .set({ status: "delivered", delivered_at: new Date(), updatedAt: new Date() })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.id, id), (0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.courier_id, courierId), (0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.status, "on_delivery")))
            .returning({ id: schema_1.errandOrdersTable.id });
        if (updated.length === 0) {
            return reply.status(409).send({ success: false, error: "Pesanan sudah tidak berlaku." });
        }
        // No cash-in, no outlet ledger, nothing booked. The courier collected his
        // own money; the platform takes none of it and records none of it.
        return reply.send({ success: true });
    });
    // ------------------------------------------------------------------
    // Ratings — both directions
    // ------------------------------------------------------------------
    /**
     * Rate the other party on a finished errand.
     *
     * One endpoint for both directions because the rules are identical and only
     * the roles swap: the customer rates the courier, the courier rates the
     * customer. Which one you are is derived from the errand, never taken from
     * the request — otherwise a customer could post a rating "as" the courier.
     *
     * The courier shares this as a link over WhatsApp, so it is reachable by
     * anyone who has the URL; that is why it requires a session and checks that
     * the caller is actually party to this errand. The link identifies the job,
     * the login identifies the rater.
     */
    app.post("/api/errands/:id/rate", async (request, reply) => {
        const user = await requireUser(request, reply);
        if (!user)
            return;
        const { id } = request.params;
        const body = (request.body ?? {});
        const stars = Number(body.rating);
        if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
            return reply.status(400).send({ success: false, error: "Rating 1-5" });
        }
        const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 500) || null : null;
        const [errand] = await db_1.db
            .select({
            id: schema_1.errandOrdersTable.id,
            status: schema_1.errandOrdersTable.status,
            customerUserId: schema_1.errandOrdersTable.user_id,
            courierId: schema_1.couriersTable.id,
            courierUserId: schema_1.couriersTable.user_id,
            courierRating: schema_1.couriersTable.ratings,
            courierReviewCount: schema_1.couriersTable.review_count,
        })
            .from(schema_1.errandOrdersTable)
            .innerJoin(schema_1.couriersTable, (0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.courier_id, schema_1.couriersTable.id))
            .where((0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.id, id))
            .limit(1);
        if (!errand)
            return reply.status(404).send({ success: false, error: "Not found" });
        if (errand.status !== "delivered") {
            return reply
                .status(409)
                .send({ success: false, error: "Pesanan belum selesai." });
        }
        const isCustomer = errand.customerUserId === user.id;
        const isCourier = errand.courierUserId === user.id;
        if (!isCustomer && !isCourier) {
            // Party to the errand or nobody. A shared link must not let a stranger
            // move someone's rating.
            return reply.status(403).send({ success: false, error: "Bukan pesanan pian" });
        }
        const recipientUserId = isCustomer ? errand.courierUserId : errand.customerUserId;
        const recipientAs = isCustomer ? "courier" : "customer";
        const [existing] = await db_1.db
            .select({ id: schema_1.ratingsTable.id })
            .from(schema_1.ratingsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ratingsTable.errand_order_id, id), (0, drizzle_orm_1.eq)(schema_1.ratingsTable.reviewer, user.id)))
            .limit(1);
        if (existing) {
            return reply
                .status(409)
                .send({ success: false, error: "Pian sudah memberi rating.", code: "already_rated" });
        }
        await db_1.db.transaction(async (tx) => {
            await tx.insert(schema_1.ratingsTable).values({
                id: crypto.randomUUID(),
                // No order_details_id: there are no products. The CHECK constraint
                // requires exactly one target, and this is the errand branch.
                errand_order_id: id,
                ratings: String(stars),
                comment,
                reviewer: user.id,
                reciepent: recipientUserId,
                reciepent_as: recipientAs,
            });
            if (isCustomer) {
                const next = (0, update_ratings_1.updateRatings)({
                    oldRating: Number(errand.courierRating ?? 5),
                    reviewCount: errand.courierReviewCount,
                    newRating: stars,
                });
                await tx
                    .update(schema_1.couriersTable)
                    .set({ ratings: String(next.newAverage), review_count: next.newReviewCount })
                    .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.id, errand.courierId));
            }
            else {
                // Mirror on the customer side. Absent customers row = a user who has
                // never ordered through an outlet; nothing to update, and the rating
                // row itself still stands as the record.
                const [customer] = await tx
                    .select({
                    id: schema_1.customersTable.id,
                    ratings: schema_1.customersTable.ratings,
                    reviewCount: schema_1.customersTable.review_count,
                })
                    .from(schema_1.customersTable)
                    .where((0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, errand.customerUserId))
                    .limit(1);
                if (customer) {
                    const next = (0, update_ratings_1.updateRatings)({
                        oldRating: Number(customer.ratings ?? 5),
                        reviewCount: customer.reviewCount,
                        newRating: stars,
                    });
                    await tx
                        .update(schema_1.customersTable)
                        .set({ ratings: String(next.newAverage), review_count: next.newReviewCount })
                        .where((0, drizzle_orm_1.eq)(schema_1.customersTable.id, customer.id));
                }
            }
        });
        return reply.send({ success: true });
    });
}
