import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { locationsTable } from "../../db/schema";
import { parseCoordPair } from "./coords";
import { roadRoute } from "./road-distance";

/**
 * How long a courier's reported position stays believable.
 *
 * A phone that lost signal ten minutes ago is not telling you where its owner is
 * now. Past this the estimate falls back to the outlet-based one rather than
 * quietly presenting a stale point as live — an ETA counting down from the wrong
 * place is worse than an honest approximation.
 */
const POSITION_FRESH_MS = 5 * 60 * 1000;

/** Baseline preparation allowance before anyone is on the road. */
const PREP_MINUTES = 15;

export type EtaSource = "courier" | "outlet" | null;

export type DeliveryEta = {
  /** Minutes until arrival, or null when there is nothing honest to say. */
  etaMinutes: number | null;
  /**
   * 'courier' — measured from where the courier actually is, and will move as
   *             they do.
   * 'outlet'  — measured from the shop; the courier hasn't reported a fresh
   *             position, so this is the remaining journey, not their progress.
   * null      — no coordinates to work from at all.
   */
  etaSource: EtaSource;
  /**
   * Where to draw the courier. Populated ONLY when the position is fresh and
   * the order is actually out for delivery — the same test the ETA uses, so the
   * map and the number can never disagree about whether the rider is live.
   * Null the rest of the time, and the map simply isn't shown.
   */
  courierPosition: { lat: number; lon: number } | null;
  /** The drop-off, so the map has something to point at. */
  destination: { lat: number; lon: number } | null;
};

const NO_ETA: DeliveryEta = {
  etaMinutes: null,
  etaSource: null,
  courierPosition: null,
  destination: null,
};

/**
 * Arrival estimate for a customer's in-flight order.
 *
 * Prefers routing from the courier's live position, which is the only version
 * that shrinks as they approach. Falls back to outlet → door whenever that
 * position is missing or stale, and adds a prep allowance for the statuses where
 * nothing has left the shop yet.
 *
 * Returns null rather than a guess for terminal and pre-acceptance states: a
 * pending order has no delivery underway to estimate, and printing a number
 * there would be invention.
 */
export async function deliveryEta(input: {
  status: string;
  customerUserId: string;
  outlet: { lat: number; lon: number } | null;
  courier: { lat: number; lon: number } | null;
  courierSeenAt: Date | null;
}): Promise<DeliveryEta> {
  const { status, customerUserId, outlet, courier, courierSeenAt } = input;

  // Nothing is moving before the owner accepts, and nothing is coming after it
  // has arrived or been cancelled.
  if (!["confirmed", "preparing", "ready", "on_delivery"].includes(status)) return NO_ETA;

  const [loc] = await db
    .select({ lat: locationsTable.lat, lon: locationsTable.lon })
    .from(locationsTable)
    .where(and(eq(locationsTable.user_id, customerUserId), eq(locationsTable.is_default, true)))
    .limit(1);

  const destination = loc ? parseCoordPair(loc.lat, loc.lon) : null;
  if (!destination) return NO_ETA;

  const positionIsFresh =
    courier !== null &&
    courierSeenAt !== null &&
    Date.now() - courierSeenAt.getTime() <= POSITION_FRESH_MS;

  // Live: route from the courier. Only meaningful once they're actually en
  // route — before that they may be nowhere near the pickup, and measuring from
  // their position would flatter the estimate.
  if (positionIsFresh && status === "on_delivery") {
    const route = await roadRoute(courier!, destination);
    if (route.minutes !== null) {
      return {
        etaMinutes: Math.max(1, Math.round(route.minutes)),
        etaSource: "courier",
        courierPosition: courier,
        destination,
      };
    }
  }

  if (!outlet) return { ...NO_ETA, destination };

  const route = await roadRoute(outlet, destination);
  if (route.minutes === null) return { ...NO_ETA, destination };

  // Prep only counts while the food is still being made. Once it's on the road,
  // the remaining journey is all that's left.
  const prep = status === "on_delivery" ? 0 : PREP_MINUTES;
  return {
    etaMinutes: Math.max(1, Math.round(prep + route.minutes)),
    etaSource: "outlet",
    courierPosition: null,
    destination,
  };
}
