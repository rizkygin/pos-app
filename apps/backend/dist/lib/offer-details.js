"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOfferDetails = getOfferDetails;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const order_items_1 = require("./utils/order-items");
function parseDropoff(note) {
    const dropOff = note?.location?.drop_off;
    const lat = dropOff?.lat ? Number(dropOff.lat) : NaN;
    const lon = dropOff?.long ? Number(dropOff.long) : NaN;
    return {
        label: dropOff?.label ?? null,
        lat: Number.isFinite(lat) ? lat : null,
        lon: Number.isFinite(lon) ? lon : null,
    };
}
function parseCustomerNote(note) {
    const raw = note?.customer_note;
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
async function getOfferDetails(orderId) {
    const [row] = await db_1.db
        .select({
        customerName: schema_1.usersTable.name,
        customerUserId: schema_1.usersTable.id,
        customerPhone: schema_1.usersTable.phone,
        customerRating: schema_1.customersTable.ratings,
        customerReviewCount: schema_1.customersTable.review_count,
        note: schema_1.ordersTable.note,
        outletAddress: schema_1.outletsTable.address,
        createdAt: schema_1.ordersTable.createdAt,
    })
        .from(schema_1.ordersTable)
        .innerJoin(schema_1.customersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, schema_1.customersTable.id))
        .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, schema_1.usersTable.id))
        .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, schema_1.outletsTable.id))
        .where((0, drizzle_orm_1.eq)(schema_1.ordersTable.id, orderId))
        .limit(1);
    if (!row)
        return null;
    const [priorRatingRows, [withItems]] = await Promise.all([
        db_1.db
            .select({
            stars: schema_1.ratingsTable.ratings,
            comment: schema_1.ratingsTable.comment,
            at: schema_1.ratingsTable.createdAt,
        })
            .from(schema_1.ratingsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ratingsTable.reciepent, row.customerUserId), (0, drizzle_orm_1.eq)(schema_1.ratingsTable.reciepent_as, "customer")))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.ratingsTable.createdAt))
            .limit(PRIOR_RATINGS_LIMIT),
        // Same helper the web lobby's own card uses (lib/utils/order-items) — one
        // source of truth for "what's in this order" and "what it totals to", so
        // the app and the web dashboard can never show two different answers for
        // the same order. Called with a single-order batch of one.
        (0, order_items_1.attachOrderItems)([{ orderId }]),
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
