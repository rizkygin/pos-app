"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATEGORY_FEATURE = exports.FEATURE_CATEGORY = exports.notInternalCategory = exports.INTERNAL_CATEGORIES = void 0;
exports.recalcOutletFeatures = recalcOutletFeatures;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
/**
 * Categories that exist only inside the owner's own dashboard: kitchen stock,
 * raw ingredients, add-on options. They are inventory, not merchandise.
 *
 * `products.is_for_sale` defaults to true, so an owner adding a sack of flour
 * as "bahan" gets it published on the public menu unless something stops it —
 * which is exactly how internal stock ended up on /menu/12. Public queries gate
 * on this list as well as on is_for_sale, so the default can never leak.
 *
 *   bahan      raw ingredients, consumed through recipes.
 *   tambahan   add-on options ("Extra Keju", "Upsize Large"). Each is a real
 *              product so it can carry stock, a recipe and a cost of its own
 *              (migration 0069), but it only ever reaches an order as a CHILD
 *              line hanging off the dish it was added to — never on its own.
 *              It therefore has no business in browse, and no business
 *              borrowing "minuman"/"makanan" to get there: an extra shot is
 *              not a drink the customer can order.
 *
 * Note "bahan" (ingredients) is NOT "bahan bangunan" (building materials, a
 * real browsable feature) — only the exact category string is internal.
 */
exports.INTERNAL_CATEGORIES = ["bahan", "tambahan"];
/** Drizzle predicate: exclude internal-only categories from a public listing. */
const notInternalCategory = () => (0, drizzle_orm_1.notInArray)(schema_1.productsTable.category, exports.INTERNAL_CATEGORIES);
exports.notInternalCategory = notInternalCategory;
// Order feature slug <-> product category. Mirrors frontend lib/order-features.ts.
//
// Keep every ORDER_FEATURES entry here, including ones with isAvailable:false —
// an outlet that already sells into a not-yet-launched category should still be
// tagged correctly the moment it launches. A category missing from this map
// silently loses its browse listing, which is exactly what happened to
// "bahan bangunan" before it was added.
exports.FEATURE_CATEGORY = {
    food: "makanan",
    drink: "minuman",
    service: "jasa",
    mart: "mart",
    delivery: "antar",
    beauty: "kecantikan",
    ride: "sewa kendaraan",
    entertainment: "hiburan",
    "building-materials": "bahan bangunan",
};
exports.CATEGORY_FEATURE = Object.fromEntries(Object.entries(exports.FEATURE_CATEGORY).map(([slug, category]) => [category, slug]));
/**
 * Recompute outlets.features from the outlet's actual products.
 *
 * `features` used to be a checklist the owner ticked by hand in the outlet
 * settings page, which meant it drifted from reality in both directions: an
 * outlet could advertise "service" long after it stopped selling any (customers
 * tapped in to an empty outlet), or sell food while untagged (its products never
 * appeared in browse at all, silently). Browse gates outlets on this array but
 * gates products on `products.category`, so the two must be derived from the
 * same thing to agree.
 *
 * Deliberately ignores `isAvailable`: that toggle means "sold out right now",
 * and letting it drop a feature would make outlets flicker in and out of the
 * marketplace as stock changes through the day. `is_open` already covers the
 * "closed today" case.
 *
 * Categories with no feature mapping (the internal ones above — kitchen stock
 * and add-on options) contribute nothing: they are never browsable, so they
 * must never tag an outlet into a browse feature either.
 */
async function recalcOutletFeatures(outletId) {
    const rows = await db_1.db
        .selectDistinct({ category: schema_1.productsTable.category })
        .from(schema_1.productsTable)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, outletId), (0, drizzle_orm_1.eq)(schema_1.productsTable.is_for_sale, true), (0, drizzle_orm_1.isNull)(schema_1.productsTable.deletedAt)));
    const features = [
        ...new Set(rows
            .map((r) => exports.CATEGORY_FEATURE[r.category])
            .filter((slug) => Boolean(slug))),
    ].sort();
    await db_1.db.update(schema_1.outletsTable).set({ features }).where((0, drizzle_orm_1.eq)(schema_1.outletsTable.id, outletId));
    return features;
}
