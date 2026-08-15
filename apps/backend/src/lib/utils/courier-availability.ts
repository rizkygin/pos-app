import { db } from '../../db';
import {
  courierSessionsTable,
  couriersTable,
  errandOrdersTable,
  ordersTable,
  ratingsTable,
} from '../../db/schema';
import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';

const ACTIVE_ORDER_STATUSES = ['preparing', 'ready', 'on_delivery'] as const;

// The errand equivalent. 'pending' counts as busy even though no job has been
// agreed yet: a pending errand holds the courier exclusively while he decides,
// which is the whole point of errand_orders_courier_pending_uq. Leaving it out
// would let a courier be offered other work in the gap between being asked and
// answering — and then accept both.
const ACTIVE_ERRAND_STATUSES = ['pending', 'on_delivery'] as const;

// Hard ceiling on one shift. Nothing closes a session when a courier simply
// walks away — it stays open until their *next* go-online — so without a cap a
// courier reads as online indefinitely and keeps being offered orders. Real
// data contained a single 665-hour "shift" (1 Jul -> 29 Jul).
export const MAX_SHIFT_HOURS = 12;

/** Open sessions that started before this are over, whatever the row says. */
export function staleShiftCutoff() {
  return new Date(Date.now() - MAX_SHIFT_HOURS * 60 * 60 * 1000);
}

/** SQL expression capping a shift's end at started_at + MAX_SHIFT_HOURS. */
export const cappedShiftEnd = sql`least(coalesce(${courierSessionsTable.ended_at}, now()), ${courierSessionsTable.started_at} + make_interval(hours => ${MAX_SHIFT_HOURS}))`;

/**
 * Stamps ended_at on shifts that overran the cap.
 *
 * The end is set to started_at + 12h, NOT now(): the courier did not work up
 * to this moment, and stamping now() is precisely what turned an abandoned
 * session into a 665-hour record. Safe to call repeatedly — it only matches
 * rows that are still open and already past the cap.
 */
export async function closeStaleCourierSessions() {
  await db
    .update(courierSessionsTable)
    .set({
      ended_at: sql`${courierSessionsTable.started_at} + make_interval(hours => ${MAX_SHIFT_HOURS})`,
    })
    .where(
      and(
        isNull(courierSessionsTable.ended_at),
        lt(courierSessionsTable.started_at, staleShiftCutoff()),
      ),
    );
}

// Couriers whose recent ratings drop below the threshold go on probation:
// they can still receive orders, but new orders are shown to them after a
// short delay so good-standing couriers get first pick.
export const PROBATION_RATING_THRESHOLD = 3.0;
export const PROBATION_MIN_REVIEWS = 10;
export const PROBATION_ROLLING_WINDOW = 10;
export const PROBATION_MAX_DELAY_SECONDS = 60;
export const PROBATION_MIN_DELAY_SECONDS = 10;

export type RatingStatus = 'good_standing' | 'probation';

export function getProbationDelaySeconds(rating: number): number {
  if (rating >= PROBATION_RATING_THRESHOLD) return 0;
  const scaledDelay = (PROBATION_RATING_THRESHOLD - rating) * 60;
  return Math.min(Math.max(scaledDelay, PROBATION_MIN_DELAY_SECONDS), PROBATION_MAX_DELAY_SECONDS);
}

export async function getCourierRatingInfo(courierId: number) {
  const [courier] = await db
    .select({
      user_id: couriersTable.user_id,
      review_count: couriersTable.review_count,
    })
    .from(couriersTable)
    .where(eq(couriersTable.id, courierId))
    .limit(1);

  if (!courier || courier.review_count < PROBATION_MIN_REVIEWS) {
    return { rating: 5, ratingStatus: 'good_standing' as RatingStatus, delaySeconds: 0 };
  }

  const recentRatings = await db
    .select({ ratings: ratingsTable.ratings })
    .from(ratingsTable)
    .where(
      and(
        eq(ratingsTable.reciepent, courier.user_id),
        eq(ratingsTable.reciepent_as, 'courier'),
      ),
    )
    .orderBy(desc(ratingsTable.createdAt))
    .limit(PROBATION_ROLLING_WINDOW);

  const rating =
    recentRatings.length > 0
      ? recentRatings.reduce((sum: number, r: { ratings: string | null }) => sum + Number(r.ratings ?? 5), 0) / recentRatings.length
      : 5;

  const delaySeconds = getProbationDelaySeconds(rating);

  return {
    rating,
    ratingStatus: delaySeconds > 0 ? ('probation' as RatingStatus) : ('good_standing' as RatingStatus),
    delaySeconds,
  };
}

export async function getCourierAvailability(courierId: number) {
  // A session past the cap doesn't count as online. Filtered on read rather
  // than closed here: this runs on every order-offer check, and a write on a
  // hot read path isn't worth it — closeStaleCourierSessions() does the tidying.
  const [openSession] = await db
    .select({ id: courierSessionsTable.id })
    .from(courierSessionsTable)
    .where(
      and(
        eq(courierSessionsTable.courier_id, courierId),
        isNull(courierSessionsTable.ended_at),
        gte(courierSessionsTable.started_at, staleShiftCutoff()),
      ),
    )
    .limit(1);

  const [activeOrder] = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.courier_id, courierId),
        inArray(ordersTable.status, ACTIVE_ORDER_STATUSES),
      ),
    )
    .limit(1);

  // Errands live in their own table and are invisible to the query above, so a
  // courier mid-errand would otherwise read as free. Checked here rather than
  // at the call sites: this function is the single answer to "can this courier
  // take work", and a second copy of the rule is a copy that drifts.
  const [activeErrand] = await db
    .select({ id: errandOrdersTable.id })
    .from(errandOrdersTable)
    .where(
      and(
        eq(errandOrdersTable.courier_id, courierId),
        inArray(errandOrdersTable.status, ACTIVE_ERRAND_STATUSES),
      ),
    )
    .limit(1);

  const [courier] = await db
    .select({ status: couriersTable.verification_status })
    .from(couriersTable)
    .where(eq(couriersTable.id, courierId))
    .limit(1);

  const isOnline = !!openSession;
  const hasActiveOrder = !!activeOrder || !!activeErrand;
  const isApproved = courier?.status === 'approved';
  const ratingInfo = await getCourierRatingInfo(courierId);

  return {
    isOnline,
    hasActiveOrder,
    isApproved,
    ...ratingInfo,
    // Approval belongs in the same expression as online/busy because this is
    // the one place every "should this courier be offered work" question is
    // answered. A separate check somewhere else is a check someone forgets.
    canReceiveOrder: isApproved && isOnline && !hasActiveOrder,
  };
}
