import { db } from '@/src/db';
import { courierSessionsTable, couriersTable, ordersTable, ratingsTable } from '@/src/db/schema';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

const ACTIVE_ORDER_STATUSES = ['preparing', 'ready', 'on_delivery'] as const;

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
      ? recentRatings.reduce((sum, r) => sum + Number(r.ratings ?? 5), 0) / recentRatings.length
      : 5;

  const delaySeconds = getProbationDelaySeconds(rating);

  return {
    rating,
    ratingStatus: delaySeconds > 0 ? ('probation' as RatingStatus) : ('good_standing' as RatingStatus),
    delaySeconds,
  };
}

export async function getCourierAvailability(courierId: number) {
  const [openSession] = await db
    .select({ id: courierSessionsTable.id })
    .from(courierSessionsTable)
    .where(
      and(
        eq(courierSessionsTable.courier_id, courierId),
        isNull(courierSessionsTable.ended_at),
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

  const isOnline = !!openSession;
  const hasActiveOrder = !!activeOrder;
  const ratingInfo = await getCourierRatingInfo(courierId);

  return {
    isOnline,
    hasActiveOrder,
    ...ratingInfo,
    canReceiveOrder: isOnline && !hasActiveOrder,
  };
}
