"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ROUNDS = exports.OFFER_TTL_SECONDS = void 0;
exports.expireStaleOffers = expireStaleOffers;
exports.supersedeOffers = supersedeOffers;
exports.getLiveOfferForCourier = getLiveOfferForCourier;
exports.dispatchNextOffer = dispatchNextOffer;
exports.tickDispatch = tickDispatch;
exports.respondToOffer = respondToOffer;
exports.mayAcceptOrder = mayAcceptOrder;
exports.visibleOrderIdsFor = visibleOrderIdsFor;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const courier_availability_1 = require("./utils/courier-availability");
const geo_1 = require("./utils/geo");
const coords_1 = require("./utils/coords");
const fcm_1 = require("./fcm");
const offer_details_1 = require("./offer-details");
/**
 * Sequential dispatch: one order, offered to one courier at a time, on a clock.
 *
 * What this replaces is first-come-first-served — every online courier saw every
 * confirmed order and the fastest tap won. That rule paid attention rather than
 * work: the way to earn was to sit watching the lobby, which is precisely the
 * behaviour that puts a phone in someone's hand in traffic.
 *
 * The clock is driven by a real scheduler (startDispatchScheduler, wired up in
 * server.ts), not by whoever happens to poll. An offer therefore expires on
 * time whether or not any courier has the lobby open, and an order confirmed
 * while nobody was on shift starts moving the moment somebody goes online.
 * Read paths still call tickDispatch as a cheap backstop — every operation here
 * is idempotent and guarded by the partial unique index, so an extra tick is
 * harmless.
 */
/** How long a courier has to answer before the order moves on. */
exports.OFFER_TTL_SECONDS = 30;
/**
 * How many times the whole courier list is asked before the order goes to the
 * open pool. Two passes is enough to cover someone who was mid-junction the
 * first time; a third mostly delays the customer.
 */
exports.MAX_ROUNDS = 2;
/**
 * A position older than this can't be trusted to rank anyone by distance.
 *
 * Couriers report every 30s while on shift, so anything this stale means the
 * phone lost signal or the app was killed. Those candidates fall to the back
 * rather than being ranked on a position they may have left long ago.
 */
const FRESH_LOCATION_MS = 5 * 60 * 1000;
/**
 * Distances are bucketed before they decide anything.
 *
 * Raw distance would hand every order near a busy junction to whoever happens to
 * sit closest to it, permanently. Within a bucket the tie goes to whoever has
 * waited longest, so "near the outlet" wins the order while "nearest by 80
 * metres" does not win every order.
 */
const DISTANCE_BUCKET_KM = 0.5;
/**
 * Expire offers whose clock has run out.
 *
 * Returns the orders that just lost their offer, so the caller can move each one
 * to the next courier. Safe to call from anywhere, as often as you like.
 */
async function expireStaleOffers() {
    const expired = await db_1.db
        .update(schema_1.orderOffersTable)
        .set({ state: "expired", responded_at: (0, drizzle_orm_1.sql) `now()` })
        // now(), not the Node clock. Every other check in this file asks Postgres
        // what time it is, and the backend and the database are separate containers
        // in production — a courier's 30 seconds must not depend on two machines
        // agreeing about the current time.
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orderOffersTable.state, "offered"), (0, drizzle_orm_1.sql) `${schema_1.orderOffersTable.expires_at} < now()`))
        .returning({ orderId: schema_1.orderOffersTable.order_id });
    return expired.map((row) => row.orderId);
}
/**
 * Cancel any live offer on an order — it was taken, cancelled or rejected.
 *
 * 'superseded' rather than 'expired': the courier did nothing wrong, and their
 * record shouldn't read as if they ignored an order that no longer existed.
 */
async function supersedeOffers(orderId) {
    await db_1.db
        .update(schema_1.orderOffersTable)
        .set({ state: "superseded", responded_at: (0, drizzle_orm_1.sql) `now()` })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orderOffersTable.order_id, orderId), (0, drizzle_orm_1.eq)(schema_1.orderOffersTable.state, "offered")));
}
/**
 * The offer this courier is currently being asked to answer, if any.
 *
 * `remainingMs` is computed by Postgres rather than handed to the client as a
 * deadline to subtract from its own clock. A courier's phone can be minutes out
 * — and a countdown that disagrees with the server is worse than no countdown,
 * because it either promises time that has already gone or expires an offer
 * that is still live. The client ticks this number down locally and re-syncs on
 * every poll.
 */
async function getLiveOfferForCourier(courierId) {
    const [offer] = await db_1.db
        .select({
        id: schema_1.orderOffersTable.id,
        orderId: schema_1.orderOffersTable.order_id,
        expiresAt: schema_1.orderOffersTable.expires_at,
        offeredAt: schema_1.orderOffersTable.offered_at,
        remainingMs: (0, drizzle_orm_1.sql) `GREATEST(0, EXTRACT(EPOCH FROM (${schema_1.orderOffersTable.expires_at} - now())) * 1000)::int`,
    })
        .from(schema_1.orderOffersTable)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orderOffersTable.courier_id, courierId), (0, drizzle_orm_1.eq)(schema_1.orderOffersTable.state, "offered"), (0, drizzle_orm_1.sql) `${schema_1.orderOffersTable.expires_at} > now()`))
        .limit(1);
    return offer ?? null;
}
/**
 * Couriers who could take this order right now, best first.
 *
 * Eligibility is the same bar the old lobby used — approved, on shift, not
 * already carrying an order — plus two dispatch-specific rules: nobody is asked
 * two things at once, and nobody is asked the same order twice in one round.
 */
async function findCandidates(orderId, round) {
    const rows = await db_1.db
        .select({
        id: schema_1.couriersTable.id,
        lat: schema_1.couriersTable.last_lat,
        lon: schema_1.couriersTable.last_lon,
        locationAt: schema_1.couriersTable.last_location_at,
        // Table names written out rather than interpolated. Drizzle qualifies
        // column references inside a WHERE clause ("order_offers"."courier_id" =
        // "couriers"."id") but NOT inside a projection, where the same fragment
        // renders as `WHERE "courier_id" = "id"` — order_offers has an `id` of its
        // own, so that silently compared a courier id against an offer's primary
        // key and returned NULL for everybody. Every candidate then tied on
        // fairness and ranking fell back to whatever order the rows arrived in.
        lastOfferedAt: (0, drizzle_orm_1.sql) `(
        SELECT MAX(oo.offered_at) FROM order_offers oo
        WHERE oo.courier_id = couriers.id
      )`,
    })
        .from(schema_1.couriersTable)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.isNull)(schema_1.couriersTable.deletedAt), (0, drizzle_orm_1.eq)(schema_1.couriersTable.verification_status, "approved"), 
    // On shift: an open session that hasn't blown past the 12h cap.
    (0, drizzle_orm_1.sql) `EXISTS (
          SELECT 1 FROM ${schema_1.courierSessionsTable}
          WHERE ${schema_1.courierSessionsTable.courier_id} = ${schema_1.couriersTable.id}
            AND ${schema_1.courierSessionsTable.ended_at} IS NULL
            AND ${schema_1.courierSessionsTable.started_at} >= ${(0, courier_availability_1.staleShiftCutoff)()}
        )`, 
    // Not already carrying something.
    (0, drizzle_orm_1.sql) `NOT EXISTS (
          SELECT 1 FROM ${schema_1.ordersTable}
          WHERE ${schema_1.ordersTable.courier_id} = ${schema_1.couriersTable.id}
            AND ${schema_1.ordersTable.status} IN ('preparing', 'ready', 'on_delivery')
        )`, 
    // ...nor carrying an errand ("Suruh Kurir"), which lives in a separate
    // table entirely and is therefore invisible to the clause above. A
    // pending errand counts: the courier is being asked and is holding that
    // question exclusively, exactly like the live-offer rule below.
    //
    // This duplicates getCourierAvailability()'s rule rather than calling
    // it, because dispatch needs the predicate as SQL to filter candidates
    // in one query instead of N round-trips. The two must be changed
    // together — a courier readable as free here but busy there gets offered
    // work he can never accept.
    (0, drizzle_orm_1.sql) `NOT EXISTS (
          SELECT 1 FROM ${schema_1.errandOrdersTable}
          WHERE ${schema_1.errandOrdersTable.courier_id} = ${schema_1.couriersTable.id}
            AND ${schema_1.errandOrdersTable.status} IN ('pending', 'on_delivery')
        )`, 
    // Not mid-decision on another order. One question at a time, or a
    // courier ends up holding two offers and losing one of them by timeout
    // through no fault of their own.
    (0, drizzle_orm_1.sql) `NOT EXISTS (
          SELECT 1 FROM ${schema_1.orderOffersTable}
          WHERE ${schema_1.orderOffersTable.courier_id} = ${schema_1.couriersTable.id}
            AND ${schema_1.orderOffersTable.state} = 'offered'
            AND ${schema_1.orderOffersTable.expires_at} > now()
        )`, 
    // Already asked about THIS order in THIS round.
    (0, drizzle_orm_1.sql) `NOT EXISTS (
          SELECT 1 FROM ${schema_1.orderOffersTable}
          WHERE ${schema_1.orderOffersTable.courier_id} = ${schema_1.couriersTable.id}
            AND ${schema_1.orderOffersTable.order_id} = ${orderId}
            AND ${schema_1.orderOffersTable.round} = ${round}
        )`));
    return rows.map((r) => ({
        ...r,
        lastOfferedAt: r.lastOfferedAt ? new Date(r.lastOfferedAt) : null,
    }));
}
/**
 * Rank candidates: nearest to the outlet first, ties broken by who has waited
 * longest.
 *
 * Distance is what a customer actually feels — a courier two streets away
 * collects the food while it is still hot — so it leads. It is bucketed rather
 * than exact (see DISTANCE_BUCKET_KM) precisely so it can't become a proxy for
 * "whoever parks nearest the busiest outlet gets everything".
 *
 * Couriers whose position is missing or stale rank last, on fairness alone.
 * They are still offered work — a dead GPS should cost you the good orders, not
 * your shift.
 */
function rankCandidates(candidates, outlet) {
    const now = Date.now();
    const withDistance = candidates.map((c) => {
        const coords = (0, coords_1.parseCoordPair)(c.lat, c.lon);
        const fresh = coords &&
            outlet &&
            c.locationAt &&
            now - new Date(c.locationAt).getTime() <= FRESH_LOCATION_MS;
        const distanceKm = fresh ? (0, geo_1.haversineKm)(outlet.lat, outlet.lon, coords.lat, coords.lon) : null;
        return {
            candidate: c,
            distanceKm,
            bucket: distanceKm === null ? null : Math.floor(distanceKm / DISTANCE_BUCKET_KM),
        };
    });
    return withDistance
        .sort((a, b) => {
        // Known position beats unknown, whatever the numbers say.
        if (a.bucket !== null && b.bucket === null)
            return -1;
        if (a.bucket === null && b.bucket !== null)
            return 1;
        if (a.bucket !== null && b.bucket !== null && a.bucket !== b.bucket) {
            return a.bucket - b.bucket;
        }
        // Same bucket (or both unknown): never-offered first, then longest-waiting.
        const at = a.candidate.lastOfferedAt?.getTime() ?? 0;
        const bt = b.candidate.lastOfferedAt?.getTime() ?? 0;
        return at - bt;
    })
        .map((x) => x.candidate);
}
/**
 * Give this order to the next courier in line.
 *
 * Called when an order is confirmed, when an offer is declined or expires, and
 * whenever a read path notices an order with nobody holding it.
 */
async function dispatchNextOffer(orderId) {
    const [order] = await db_1.db
        .select({
        id: schema_1.ordersTable.id,
        status: schema_1.ordersTable.status,
        courierId: schema_1.ordersTable.courier_id,
        fulfillment: schema_1.ordersTable.fulfillment,
        poolOpenedAt: schema_1.ordersTable.offer_pool_opened_at,
        deliveryFee: schema_1.ordersTable.delivery_fee,
        outletName: schema_1.outletsTable.name,
        outletLat: schema_1.outletsTable.lat,
        outletLon: schema_1.outletsTable.lon,
    })
        .from(schema_1.ordersTable)
        .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, schema_1.outletsTable.id))
        .where((0, drizzle_orm_1.eq)(schema_1.ordersTable.id, orderId))
        .limit(1);
    // Only an unclaimed, confirmed, courier-delivered order is dispatchable.
    // Service and materials move on the outlet's own wheels and must never enter
    // the courier queue.
    if (!order ||
        order.status !== "confirmed" ||
        order.courierId !== null ||
        order.fulfillment !== "delivery") {
        return { outcome: "not_dispatchable" };
    }
    // Already in someone's hands — leave them their clock.
    const [live] = await db_1.db
        .select({ id: schema_1.orderOffersTable.id })
        .from(schema_1.orderOffersTable)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orderOffersTable.order_id, orderId), (0, drizzle_orm_1.eq)(schema_1.orderOffersTable.state, "offered"), (0, drizzle_orm_1.sql) `${schema_1.orderOffersTable.expires_at} > now()`))
        .limit(1);
    if (live)
        return { outcome: "already_offered" };
    // Once the pool is open the order belongs to everyone; re-entering sequential
    // dispatch would take it back off the couriers who can currently see it.
    if (order.poolOpenedAt)
        return { outcome: "open_pool" };
    const [{ maxRound }] = await db_1.db
        .select({ maxRound: (0, drizzle_orm_1.sql) `COALESCE(MAX(${schema_1.orderOffersTable.round}), 1)::int` })
        .from(schema_1.orderOffersTable)
        .where((0, drizzle_orm_1.eq)(schema_1.orderOffersTable.order_id, orderId));
    const outletCoords = (0, coords_1.parseCoordPair)(order.outletLat, order.outletLon);
    for (let round = maxRound; round <= exports.MAX_ROUNDS; round++) {
        const candidates = rankCandidates(await findCandidates(orderId, round), outletCoords);
        if (candidates.length === 0)
            continue;
        const chosen = candidates[0];
        let expiresAt;
        try {
            // The deadline is set by the database clock for the same reason expiry
            // reads it: one clock, one answer.
            const [inserted] = await db_1.db
                .insert(schema_1.orderOffersTable)
                .values({
                order_id: orderId,
                courier_id: chosen.id,
                round,
                expires_at: (0, drizzle_orm_1.sql) `now() + make_interval(secs => ${exports.OFFER_TTL_SECONDS})`,
            })
                .returning({ expiresAt: schema_1.orderOffersTable.expires_at });
            expiresAt = inserted.expiresAt;
        }
        catch (err) {
            // Two callers dispatched the same order at once and the partial unique
            // index caught it. The other one won; that is exactly what the index is
            // for, so this is a success, not an error.
            const code = err?.code ?? err?.cause?.code;
            if (code === "23505")
                return { outcome: "already_offered" };
            throw err;
        }
        // The customer/ratings enrichment IS awaited, unlike the push send below —
        // it's two cheap indexed queries, run once per offer rather than per poll,
        // and getting it wrong silently (a stale closure value) is worse than the
        // few extra milliseconds. A failure here degrades to an offer with less
        // detail, not a failed dispatch — never let it throw dispatchNextOffer.
        const details = await (0, offer_details_1.getOfferDetails)(orderId)
            .then((d) => d ?? undefined)
            .catch((err) => {
            console.error("[dispatch] offer enrichment failed", { orderId, err });
            return undefined;
        });
        // Ring the phone. Deliberately not awaited into the result: a courier
        // watching the lobby already has the offer, and a failed push must never
        // undo a valid dispatch.
        void (0, fcm_1.sendOfferPush)(chosen.id, {
            orderId,
            outletName: order.outletName,
            expiresAt,
            deliveryFee: order.deliveryFee,
            pickupLat: outletCoords?.lat ?? null,
            pickupLon: outletCoords?.lon ?? null,
            details,
        }).catch((err) => {
            console.error("[dispatch] offer push failed", { orderId, courierId: chosen.id, err });
        });
        return { outcome: "offered", courierId: chosen.id, expiresAt, round };
    }
    // Everyone has been asked, twice. Rather than let the order sit in silence,
    // hand it to the old free-for-all lobby: slower to place is better than never
    // placed, and the customer is still waiting.
    await db_1.db
        .update(schema_1.ordersTable)
        .set({ offer_pool_opened_at: (0, drizzle_orm_1.sql) `now()` })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ordersTable.id, orderId), (0, drizzle_orm_1.isNull)(schema_1.ordersTable.offer_pool_opened_at)));
    return { outcome: "open_pool" };
}
/**
 * Expire what's due, then re-dispatch everything that just came free.
 *
 * The single entry point for read paths — the courier lobby and the owner's
 * "Mencari Kurir" lane both call this before they answer, which is what keeps
 * the queue moving without a scheduler.
 */
async function tickDispatch() {
    const freed = await expireStaleOffers();
    for (const orderId of freed) {
        await dispatchNextOffer(orderId);
    }
    // Orders confirmed while nobody was on shift never got a first offer. Catch
    // them here so going online is enough to start receiving work, rather than
    // needing the owner to re-confirm something they already confirmed.
    const stranded = await db_1.db
        .select({ id: schema_1.ordersTable.id })
        .from(schema_1.ordersTable)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "confirmed"), (0, drizzle_orm_1.eq)(schema_1.ordersTable.fulfillment, "delivery"), (0, drizzle_orm_1.isNull)(schema_1.ordersTable.courier_id), (0, drizzle_orm_1.isNull)(schema_1.ordersTable.offer_pool_opened_at), (0, drizzle_orm_1.sql) `NOT EXISTS (
          SELECT 1 FROM ${schema_1.orderOffersTable}
          WHERE ${schema_1.orderOffersTable.order_id} = ${schema_1.ordersTable.id}
            AND ${schema_1.orderOffersTable.state} = 'offered'
            AND ${schema_1.orderOffersTable.expires_at} > now()
        )`))
        .limit(20);
    for (const order of stranded) {
        await dispatchNextOffer(order.id);
    }
}
/**
 * Record a courier's answer to their live offer.
 *
 * Accepting is claimed by the caller (accept-order does the order update in the
 * same breath); this only closes the offer row. Declining moves the order on
 * immediately rather than making the next courier wait out a clock nobody is
 * watching.
 */
async function respondToOffer(courierId, orderId, response) {
    const updated = await db_1.db
        .update(schema_1.orderOffersTable)
        .set({ state: response, responded_at: (0, drizzle_orm_1.sql) `now()` })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orderOffersTable.order_id, orderId), (0, drizzle_orm_1.eq)(schema_1.orderOffersTable.courier_id, courierId), (0, drizzle_orm_1.eq)(schema_1.orderOffersTable.state, "offered")))
        .returning({ id: schema_1.orderOffersTable.id });
    if (updated.length === 0)
        return false;
    if (response === "declined")
        await dispatchNextOffer(orderId);
    return true;
}
/**
 * May this courier take this order?
 *
 * Two legitimate routes: they hold the live offer, or the order has fallen
 * through to the open pool where the old first-come rule still applies.
 */
async function mayAcceptOrder(courierId, orderId) {
    const [row] = await db_1.db
        .select({ poolOpenedAt: schema_1.ordersTable.offer_pool_opened_at })
        .from(schema_1.ordersTable)
        .where((0, drizzle_orm_1.eq)(schema_1.ordersTable.id, orderId))
        .limit(1);
    if (!row)
        return false;
    if (row.poolOpenedAt)
        return true;
    const [offer] = await db_1.db
        .select({ id: schema_1.orderOffersTable.id })
        .from(schema_1.orderOffersTable)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orderOffersTable.order_id, orderId), (0, drizzle_orm_1.eq)(schema_1.orderOffersTable.courier_id, courierId), (0, drizzle_orm_1.eq)(schema_1.orderOffersTable.state, "offered"), (0, drizzle_orm_1.sql) `${schema_1.orderOffersTable.expires_at} > now()`))
        .limit(1);
    return !!offer;
}
/** Orders a courier may see right now: their live offer, plus the open pool. */
async function visibleOrderIdsFor(courierId) {
    const offer = await getLiveOfferForCourier(courierId);
    const pool = await db_1.db
        .select({ id: schema_1.ordersTable.id })
        .from(schema_1.ordersTable)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "confirmed"), (0, drizzle_orm_1.eq)(schema_1.ordersTable.fulfillment, "delivery"), (0, drizzle_orm_1.isNull)(schema_1.ordersTable.courier_id), (0, drizzle_orm_1.sql) `${schema_1.ordersTable.offer_pool_opened_at} IS NOT NULL`))
        .orderBy((0, drizzle_orm_1.asc)(schema_1.ordersTable.createdAt));
    return {
        offeredOrderId: offer?.orderId ?? null,
        offerExpiresAt: offer?.expiresAt ?? null,
        offerRemainingMs: offer?.remainingMs ?? null,
        openPoolOrderIds: pool.map((p) => p.id),
    };
}
