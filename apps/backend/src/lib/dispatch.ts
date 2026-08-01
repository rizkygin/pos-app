import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import {
  couriersTable,
  courierSessionsTable,
  orderOffersTable,
  ordersTable,
  outletsTable,
} from "../db/schema";
import { staleShiftCutoff } from "./utils/courier-availability";
import { haversineKm } from "./utils/geo";
import { parseCoordPair } from "./utils/coords";

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
export const OFFER_TTL_SECONDS = 30;

/**
 * How many times the whole courier list is asked before the order goes to the
 * open pool. Two passes is enough to cover someone who was mid-junction the
 * first time; a third mostly delays the customer.
 */
export const MAX_ROUNDS = 2;

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

type Candidate = {
  id: number;
  lat: string | null;
  lon: string | null;
  locationAt: Date | null;
  /** Last time this courier was offered anything; null = never. */
  lastOfferedAt: Date | null;
};

/**
 * Expire offers whose clock has run out.
 *
 * Returns the orders that just lost their offer, so the caller can move each one
 * to the next courier. Safe to call from anywhere, as often as you like.
 */
export async function expireStaleOffers(): Promise<string[]> {
  const expired = await db
    .update(orderOffersTable)
    .set({ state: "expired", responded_at: sql`now()` })
    // now(), not the Node clock. Every other check in this file asks Postgres
    // what time it is, and the backend and the database are separate containers
    // in production — a courier's 30 seconds must not depend on two machines
    // agreeing about the current time.
    .where(
      and(eq(orderOffersTable.state, "offered"), sql`${orderOffersTable.expires_at} < now()`),
    )
    .returning({ orderId: orderOffersTable.order_id });

  return expired.map((row) => row.orderId);
}

/**
 * Cancel any live offer on an order — it was taken, cancelled or rejected.
 *
 * 'superseded' rather than 'expired': the courier did nothing wrong, and their
 * record shouldn't read as if they ignored an order that no longer existed.
 */
export async function supersedeOffers(orderId: string): Promise<void> {
  await db
    .update(orderOffersTable)
    .set({ state: "superseded", responded_at: sql`now()` })
    .where(
      and(eq(orderOffersTable.order_id, orderId), eq(orderOffersTable.state, "offered")),
    );
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
export async function getLiveOfferForCourier(courierId: number) {
  const [offer] = await db
    .select({
      id: orderOffersTable.id,
      orderId: orderOffersTable.order_id,
      expiresAt: orderOffersTable.expires_at,
      offeredAt: orderOffersTable.offered_at,
      remainingMs: sql<number>`GREATEST(0, EXTRACT(EPOCH FROM (${orderOffersTable.expires_at} - now())) * 1000)::int`,
    })
    .from(orderOffersTable)
    .where(
      and(
        eq(orderOffersTable.courier_id, courierId),
        eq(orderOffersTable.state, "offered"),
        sql`${orderOffersTable.expires_at} > now()`,
      ),
    )
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
async function findCandidates(orderId: string, round: number): Promise<Candidate[]> {
  const rows = await db
    .select({
      id: couriersTable.id,
      lat: couriersTable.last_lat,
      lon: couriersTable.last_lon,
      locationAt: couriersTable.last_location_at,
      // Table names written out rather than interpolated. Drizzle qualifies
      // column references inside a WHERE clause ("order_offers"."courier_id" =
      // "couriers"."id") but NOT inside a projection, where the same fragment
      // renders as `WHERE "courier_id" = "id"` — order_offers has an `id` of its
      // own, so that silently compared a courier id against an offer's primary
      // key and returned NULL for everybody. Every candidate then tied on
      // fairness and ranking fell back to whatever order the rows arrived in.
      lastOfferedAt: sql<Date | null>`(
        SELECT MAX(oo.offered_at) FROM order_offers oo
        WHERE oo.courier_id = couriers.id
      )`,
    })
    .from(couriersTable)
    .where(
      and(
        isNull(couriersTable.deletedAt),
        eq(couriersTable.verification_status, "approved"),
        // On shift: an open session that hasn't blown past the 12h cap.
        sql`EXISTS (
          SELECT 1 FROM ${courierSessionsTable}
          WHERE ${courierSessionsTable.courier_id} = ${couriersTable.id}
            AND ${courierSessionsTable.ended_at} IS NULL
            AND ${courierSessionsTable.started_at} >= ${staleShiftCutoff()}
        )`,
        // Not already carrying something.
        sql`NOT EXISTS (
          SELECT 1 FROM ${ordersTable}
          WHERE ${ordersTable.courier_id} = ${couriersTable.id}
            AND ${ordersTable.status} IN ('preparing', 'ready', 'on_delivery')
        )`,
        // Not mid-decision on another order. One question at a time, or a
        // courier ends up holding two offers and losing one of them by timeout
        // through no fault of their own.
        sql`NOT EXISTS (
          SELECT 1 FROM ${orderOffersTable}
          WHERE ${orderOffersTable.courier_id} = ${couriersTable.id}
            AND ${orderOffersTable.state} = 'offered'
            AND ${orderOffersTable.expires_at} > now()
        )`,
        // Already asked about THIS order in THIS round.
        sql`NOT EXISTS (
          SELECT 1 FROM ${orderOffersTable}
          WHERE ${orderOffersTable.courier_id} = ${couriersTable.id}
            AND ${orderOffersTable.order_id} = ${orderId}
            AND ${orderOffersTable.round} = ${round}
        )`,
      ),
    );

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
function rankCandidates(candidates: Candidate[], outlet: { lat: number; lon: number } | null) {
  const now = Date.now();

  const withDistance = candidates.map((c) => {
    const coords = parseCoordPair(c.lat, c.lon);
    const fresh =
      coords &&
      outlet &&
      c.locationAt &&
      now - new Date(c.locationAt).getTime() <= FRESH_LOCATION_MS;

    const distanceKm = fresh ? haversineKm(outlet.lat, outlet.lon, coords.lat, coords.lon) : null;

    return {
      candidate: c,
      distanceKm,
      bucket: distanceKm === null ? null : Math.floor(distanceKm / DISTANCE_BUCKET_KM),
    };
  });

  return withDistance
    .sort((a, b) => {
      // Known position beats unknown, whatever the numbers say.
      if (a.bucket !== null && b.bucket === null) return -1;
      if (a.bucket === null && b.bucket !== null) return 1;
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

export type DispatchResult =
  | { outcome: "offered"; courierId: number; expiresAt: Date; round: number }
  | { outcome: "open_pool" }
  | { outcome: "not_dispatchable" }
  | { outcome: "already_offered" };

/**
 * Give this order to the next courier in line.
 *
 * Called when an order is confirmed, when an offer is declined or expires, and
 * whenever a read path notices an order with nobody holding it.
 */
export async function dispatchNextOffer(orderId: string): Promise<DispatchResult> {
  const [order] = await db
    .select({
      id: ordersTable.id,
      status: ordersTable.status,
      courierId: ordersTable.courier_id,
      fulfillment: ordersTable.fulfillment,
      poolOpenedAt: ordersTable.offer_pool_opened_at,
      outletLat: outletsTable.lat,
      outletLon: outletsTable.lon,
    })
    .from(ordersTable)
    .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
    .where(eq(ordersTable.id, orderId))
    .limit(1);

  // Only an unclaimed, confirmed, courier-delivered order is dispatchable.
  // Service and materials move on the outlet's own wheels and must never enter
  // the courier queue.
  if (
    !order ||
    order.status !== "confirmed" ||
    order.courierId !== null ||
    order.fulfillment !== "delivery"
  ) {
    return { outcome: "not_dispatchable" };
  }

  // Already in someone's hands — leave them their clock.
  const [live] = await db
    .select({ id: orderOffersTable.id })
    .from(orderOffersTable)
    .where(
      and(
        eq(orderOffersTable.order_id, orderId),
        eq(orderOffersTable.state, "offered"),
        sql`${orderOffersTable.expires_at} > now()`,
      ),
    )
    .limit(1);
  if (live) return { outcome: "already_offered" };

  // Once the pool is open the order belongs to everyone; re-entering sequential
  // dispatch would take it back off the couriers who can currently see it.
  if (order.poolOpenedAt) return { outcome: "open_pool" };

  const [{ maxRound }] = await db
    .select({ maxRound: sql<number>`COALESCE(MAX(${orderOffersTable.round}), 1)::int` })
    .from(orderOffersTable)
    .where(eq(orderOffersTable.order_id, orderId));

  const outletCoords = parseCoordPair(order.outletLat, order.outletLon);

  for (let round = maxRound; round <= MAX_ROUNDS; round++) {
    const candidates = rankCandidates(await findCandidates(orderId, round), outletCoords);
    if (candidates.length === 0) continue;

    const chosen = candidates[0];

    let expiresAt: Date;
    try {
      // The deadline is set by the database clock for the same reason expiry
      // reads it: one clock, one answer.
      const [inserted] = await db
        .insert(orderOffersTable)
        .values({
          order_id: orderId,
          courier_id: chosen.id,
          round,
          expires_at: sql`now() + make_interval(secs => ${OFFER_TTL_SECONDS})`,
        })
        .returning({ expiresAt: orderOffersTable.expires_at });
      expiresAt = inserted.expiresAt;
    } catch (err: any) {
      // Two callers dispatched the same order at once and the partial unique
      // index caught it. The other one won; that is exactly what the index is
      // for, so this is a success, not an error.
      const code = err?.code ?? err?.cause?.code;
      if (code === "23505") return { outcome: "already_offered" };
      throw err;
    }

    return { outcome: "offered", courierId: chosen.id, expiresAt, round };
  }

  // Everyone has been asked, twice. Rather than let the order sit in silence,
  // hand it to the old free-for-all lobby: slower to place is better than never
  // placed, and the customer is still waiting.
  await db
    .update(ordersTable)
    .set({ offer_pool_opened_at: sql`now()` })
    .where(and(eq(ordersTable.id, orderId), isNull(ordersTable.offer_pool_opened_at)));

  return { outcome: "open_pool" };
}

/**
 * Expire what's due, then re-dispatch everything that just came free.
 *
 * The single entry point for read paths — the courier lobby and the owner's
 * "Mencari Kurir" lane both call this before they answer, which is what keeps
 * the queue moving without a scheduler.
 */
export async function tickDispatch(): Promise<void> {
  const freed = await expireStaleOffers();
  for (const orderId of freed) {
    await dispatchNextOffer(orderId);
  }

  // Orders confirmed while nobody was on shift never got a first offer. Catch
  // them here so going online is enough to start receiving work, rather than
  // needing the owner to re-confirm something they already confirmed.
  const stranded = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.status, "confirmed"),
        eq(ordersTable.fulfillment, "delivery"),
        isNull(ordersTable.courier_id),
        isNull(ordersTable.offer_pool_opened_at),
        sql`NOT EXISTS (
          SELECT 1 FROM ${orderOffersTable}
          WHERE ${orderOffersTable.order_id} = ${ordersTable.id}
            AND ${orderOffersTable.state} = 'offered'
            AND ${orderOffersTable.expires_at} > now()
        )`,
      ),
    )
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
export async function respondToOffer(
  courierId: number,
  orderId: string,
  response: "accepted" | "declined",
): Promise<boolean> {
  const updated = await db
    .update(orderOffersTable)
    .set({ state: response, responded_at: sql`now()` })
    .where(
      and(
        eq(orderOffersTable.order_id, orderId),
        eq(orderOffersTable.courier_id, courierId),
        eq(orderOffersTable.state, "offered"),
      ),
    )
    .returning({ id: orderOffersTable.id });

  if (updated.length === 0) return false;

  if (response === "declined") await dispatchNextOffer(orderId);
  return true;
}

/**
 * May this courier take this order?
 *
 * Two legitimate routes: they hold the live offer, or the order has fallen
 * through to the open pool where the old first-come rule still applies.
 */
export async function mayAcceptOrder(courierId: number, orderId: string): Promise<boolean> {
  const [row] = await db
    .select({ poolOpenedAt: ordersTable.offer_pool_opened_at })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .limit(1);

  if (!row) return false;
  if (row.poolOpenedAt) return true;

  const [offer] = await db
    .select({ id: orderOffersTable.id })
    .from(orderOffersTable)
    .where(
      and(
        eq(orderOffersTable.order_id, orderId),
        eq(orderOffersTable.courier_id, courierId),
        eq(orderOffersTable.state, "offered"),
        sql`${orderOffersTable.expires_at} > now()`,
      ),
    )
    .limit(1);

  return !!offer;
}

/** Orders a courier may see right now: their live offer, plus the open pool. */
export async function visibleOrderIdsFor(courierId: number): Promise<{
  offeredOrderId: string | null;
  offerExpiresAt: Date | null;
  offerRemainingMs: number | null;
  openPoolOrderIds: string[];
}> {
  const offer = await getLiveOfferForCourier(courierId);

  const pool = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.status, "confirmed"),
        eq(ordersTable.fulfillment, "delivery"),
        isNull(ordersTable.courier_id),
        sql`${ordersTable.offer_pool_opened_at} IS NOT NULL`,
      ),
    )
    .orderBy(asc(ordersTable.createdAt));

  return {
    offeredOrderId: offer?.orderId ?? null,
    offerExpiresAt: offer?.expiresAt ?? null,
    offerRemainingMs: offer?.remainingMs ?? null,
    openPoolOrderIds: pool.map((p) => p.id),
  };
}
