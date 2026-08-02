import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { customersTable, ordersTable, ratingsTable, usersTable } from "../db/schema";

/**
 * The rich detail an offer notification shows a courier before they decide.
 *
 * Deliberately computed server-side from real tables, not from orders.note.
 * orders.note is client-supplied at checkout — a customer's own browser writes
 * it, unvalidated — which is acceptable for the lobby card's "leave at gate"
 * instructions but not for a number a courier is trusting to judge who they're
 * about to meet. Rating and review count come straight from customers.ratings,
 * the same column every other rating display in this codebase treats as the
 * source of truth.
 *
 * The drop-off point is the one exception: there is no per-order stored
 * address other than what the customer's browser attached at checkout, since a
 * customer can have several saved addresses and the one used for THIS order
 * has to be the one shown, not whatever is their default today. So it is read
 * from order.note, best-effort, and simply omitted if that shape is missing —
 * an older order or a different creation path (POS, admin tools) not carrying
 * it is not an error.
 */

export type PriorRating = {
  stars: number;
  comment: string | null;
  /** ISO timestamp; the client decides how to phrase "how long ago". */
  at: string;
};

export type OfferDetails = {
  customerName: string;
  customerRating: number;
  customerReviewCount: number;
  dropoffLabel: string | null;
  dropoffLat: number | null;
  dropoffLon: number | null;
  /** Most recent first, oldest last. Empty when this customer has no history yet. */
  priorRatings: PriorRating[];
};

type OrderNoteShape = {
  location?: {
    drop_off?: { lat?: string; long?: string; label?: string };
  };
};

function parseDropoff(note: unknown): {
  label: string | null;
  lat: number | null;
  lon: number | null;
} {
  const dropOff = (note as OrderNoteShape | null)?.location?.drop_off;
  const lat = dropOff?.lat ? Number(dropOff.lat) : NaN;
  const lon = dropOff?.long ? Number(dropOff.long) : NaN;

  return {
    label: dropOff?.label ?? null,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
  };
}

/** How many prior ratings to surface — enough to read a pattern, not a dossier. */
const PRIOR_RATINGS_LIMIT = 3;
/** FCM data values are strings with a real size budget; a review can run long. */
const COMMENT_MAX_CHARS = 120;

export async function getOfferDetails(orderId: string): Promise<OfferDetails | null> {
  const [row] = await db
    .select({
      customerName: usersTable.name,
      customerUserId: usersTable.id,
      customerRating: customersTable.ratings,
      customerReviewCount: customersTable.review_count,
      note: ordersTable.note,
    })
    .from(ordersTable)
    .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
    .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
    .where(eq(ordersTable.id, orderId))
    .limit(1);

  if (!row) return null;

  const priorRatingRows = await db
    .select({
      stars: ratingsTable.ratings,
      comment: ratingsTable.comment,
      at: ratingsTable.createdAt,
    })
    .from(ratingsTable)
    .where(
      and(eq(ratingsTable.reciepent, row.customerUserId), eq(ratingsTable.reciepent_as, "customer")),
    )
    .orderBy(desc(ratingsTable.createdAt))
    .limit(PRIOR_RATINGS_LIMIT);

  const dropoff = parseDropoff(row.note);

  return {
    customerName: row.customerName,
    customerRating: Number(row.customerRating ?? 5),
    customerReviewCount: row.customerReviewCount,
    dropoffLabel: dropoff.label,
    dropoffLat: dropoff.lat,
    dropoffLon: dropoff.lon,
    priorRatings: priorRatingRows.map((r) => ({
      stars: Number(r.stars ?? 5),
      comment: r.comment ? r.comment.slice(0, COMMENT_MAX_CHARS) : null,
      at: r.at.toISOString(),
    })),
  };
}
