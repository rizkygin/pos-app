import { and, eq, isNull, notInArray } from "drizzle-orm";
import { db } from "../db";
import { outletsTable, productsTable } from "../db/schema";

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
export const INTERNAL_CATEGORIES = ["bahan", "tambahan"];

/** Drizzle predicate: exclude internal-only categories from a public listing. */
export const notInternalCategory = () =>
  notInArray(productsTable.category, INTERNAL_CATEGORIES);

// Order feature slug <-> product category. Mirrors frontend lib/order-features.ts.
//
// Keep every ORDER_FEATURES entry here, including ones with isAvailable:false —
// an outlet that already sells into a not-yet-launched category should still be
// tagged correctly the moment it launches. A category missing from this map
// silently loses its browse listing, which is exactly what happened to
// "bahan bangunan" before it was added.
export const FEATURE_CATEGORY: Record<string, string> = {
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

export const CATEGORY_FEATURE: Record<string, string> = Object.fromEntries(
  Object.entries(FEATURE_CATEGORY).map(([slug, category]) => [category, slug]),
);

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
export async function recalcOutletFeatures(outletId: number): Promise<string[]> {
  const rows = await db
    .selectDistinct({ category: productsTable.category })
    .from(productsTable)
    .where(
      and(
        eq(productsTable.outlet_id, outletId),
        eq(productsTable.is_for_sale, true),
        isNull(productsTable.deletedAt),
      ),
    );

  const features = [
    ...new Set(
      rows
        .map((r) => CATEGORY_FEATURE[r.category])
        .filter((slug): slug is string => Boolean(slug)),
    ),
  ].sort();

  await db.update(outletsTable).set({ features }).where(eq(outletsTable.id, outletId));
  return features;
}
