import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { customersTable, ordersTable, outletsTable, ratingsTable, usersTable } from "../db/schema";
import { attachOrderItems } from "./utils/order-items";

/**
 * The rich detail an offer notification shows a courier before they decide —
 * everything the web lobby's own Order card shows, on the lock screen.
 *
 * Deliberately computed server-side from real tables, not from orders.note,
 * for the identity/ratings numbers: orders.note is client-supplied at
 * checkout — a customer's own browser writes it, unvalidated — acceptable for
 * a "leave at gate" instruction but not for a number a courier is trusting to
 * judge who they're about to meet. Rating and review count come straight from
 * customers.ratings, the same column every other rating display here treats
 * as the source of truth.
 *
 * Two exceptions read from order.note anyway, because it is the only place
 * the information exists at all: the drop-off point (a customer can have
 * several saved addresses, and the one used for THIS order has to be the one
 * shown, not whatever is their default today) and the customer's own delivery
 * note ("titip di pagar", floor number, etc — there is no other column for
 * it). Both parsed best-effort; a missing or malformed note yields nulls, not
 * a thrown error.
 */

export type PriorRating = {
  stars: number;
  comment: string | null;
  /** ISO timestamp; the client decides how to phrase "how long ago". */
  at: string;
};

export type OfferItem = {
  productName: string;
  quantity: number;
  noteProduct: string | null;
};

export type OfferDetails = {
  customerName: string;
  customerPhone: string | null;
  customerRating: number;
  customerReviewCount: number;
  customerNote: string | null;
  outletAddress: string;
  dropoffLabel: string | null;
  dropoffLat: number | null;
  dropoffLon: number | null;
  items: OfferItem[];
  /** Goods total — distinct from the delivery fee, which the caller already has. */
  totalAmount: number;
  createdAt: string;
  /** Most recent first, oldest last. Empty when this customer has no history yet. */
  priorRatings: PriorRating[];
};

type OrderNoteShape = {
  location?: {
    drop_off?: { lat?: string; long?: string; label?: string };
  };
  customer_note?: string;
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

function parseCustomerNote(note: unknown): string | null {
  const raw = (note as OrderNoteShape | null)?.customer_note;
  return raw && raw.trim() ? raw.trim() : null;
}

/** How many prior ratings to surface — enough to read a pattern, not a dossier. */
const PRIOR_RATINGS_LIMIT = 3;
/** FCM data values are strings with a real size budget; free text can run long. */
const COMMENT_MAX_CHARS = 120;
const NOTE_MAX_CHARS = 160;
const ITEM_NAME_MAX_CHARS = 60;
// Deliberately smaller than NOTE_MAX_CHARS: that cap is for the ONE
// customer-level delivery note, this one multiplies by however many line
// items are in the cart. At the 12-item ceiling below, 160 chars each would
// alone approach FCM's ~4KB data budget before anything else in the payload
// is counted; a per-item note is realistically "pedas" or "tanpa es", not an
// essay, so 40 costs nothing real while keeping the worst case bounded.
const ITEM_NOTE_MAX_CHARS = 40;
/** Guards against a genuinely huge cart blowing the ~4KB FCM data budget. */
const ITEMS_MAX_COUNT = 12;

export async function getOfferDetails(orderId: string): Promise<OfferDetails | null> {
  const [row] = await db
    .select({
      customerName: usersTable.name,
      customerUserId: usersTable.id,
      customerPhone: usersTable.phone,
      customerRating: customersTable.ratings,
      customerReviewCount: customersTable.review_count,
      note: ordersTable.note,
      outletAddress: outletsTable.address,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
    .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
    .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
    .where(eq(ordersTable.id, orderId))
    .limit(1);

  if (!row) return null;

  const [priorRatingRows, [withItems]] = await Promise.all([
    db
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
      .limit(PRIOR_RATINGS_LIMIT),
    // Same helper the web lobby's own card uses (lib/utils/order-items) — one
    // source of truth for "what's in this order" and "what it totals to", so
    // the app and the web dashboard can never show two different answers for
    // the same order. Called with a single-order batch of one.
    attachOrderItems([{ orderId }]),
  ]);

  const dropoff = parseDropoff(row.note);

  return {
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    customerRating: Number(row.customerRating ?? 5),
    customerReviewCount: row.customerReviewCount,
    customerNote: parseCustomerNote(row.note)?.slice(0, NOTE_MAX_CHARS) ?? null,
    outletAddress: row.outletAddress,
    dropoffLabel: dropoff.label,
    dropoffLat: dropoff.lat,
    dropoffLon: dropoff.lon,
    items: (withItems?.items ?? []).slice(0, ITEMS_MAX_COUNT).map((item) => ({
      productName: item.productName.slice(0, ITEM_NAME_MAX_CHARS),
      quantity: item.quantity,
      noteProduct: item.noteProduct ? item.noteProduct.slice(0, ITEM_NOTE_MAX_CHARS) : null,
    })),
    totalAmount: withItems?.totalAmount ?? 0,
    createdAt: row.createdAt.toISOString(),
    priorRatings: priorRatingRows.map((r) => ({
      stars: Number(r.stars ?? 5),
      comment: r.comment ? r.comment.slice(0, COMMENT_MAX_CHARS) : null,
      at: r.at.toISOString(),
    })),
  };
}
