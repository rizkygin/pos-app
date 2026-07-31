import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { outletsTable, productsTable } from "../db/schema";

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
 * Categories with no feature mapping (notably "bahan", the kitchen-stock
 * ingredient category) contribute nothing — they are internal, never browsable.
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
