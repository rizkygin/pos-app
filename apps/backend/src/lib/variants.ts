import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { productsTable, recipeItemsTable } from "../db/schema";

// Drizzle's transaction client exposes the same query builder as `db`.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Product variants: the composition rules that are NOT expressible as columns.
 *
 * Everything about SELLING a variant is already handled, because a variant is
 * an ordinary products row (migration 0071). What lives here is the small set
 * of decisions about CREATING one, which is where a variant differs from a
 * product the owner types out by hand.
 *
 * The distinction this feature exists to draw:
 *
 *   add-on    adds a line.      Nasi goreng + telur: two rows, two prices.
 *   variant   changes the line. Large IS the product being sold, not the
 *                               Reguler plus an "upsize" the reports can't read.
 */

/** The question, when the owner hasn't named one. */
export const DEFAULT_VARIANT_LABEL = "Varian";

/** The base's own option label, when the owner hasn't named one. */
export const DEFAULT_BASE_VARIANT_NAME = "Reguler";

/** Owner-facing cap. Beyond this a picker stops being a picker. */
export const MAX_VARIANTS_PER_PRODUCT = 20;

/**
 * The full product name of a variant: "Kopi Susu" + "Large" -> "Kopi Susu (Large)".
 *
 * Derived rather than typed because product_name is what every receipt, kitchen
 * ticket, stock row and sales report prints, and those have no base product to
 * read context from — a variant row named just "Large" is unreadable in all of
 * them. The owner can still rename the row afterwards through the ordinary
 * product form; this is the default, not a constraint.
 */
export function variantProductName(baseName: string, variantName: string): string {
  const label = variantName.trim();
  if (!label) return baseName;
  // Don't build "Kopi Susu Large (Large)" when the owner already said it.
  if (baseName.toLowerCase().includes(label.toLowerCase())) return baseName;
  return `${baseName} (${label})`;
}

export type VariantInput = {
  variant_name: string;
  price: string;
  price_mark_down?: string;
  buying_price?: string;
  barcode?: string | null;
  variant_sort?: number;
};

type BaseRow = typeof productsTable.$inferSelect;

/**
 * What a new variant inherits from its base.
 *
 * A variant is the same MERCHANDISE as its base — same shelf, same picture,
 * same menu section, same answer to "can a courier carry it" — differing only
 * in size/flavour and what that costs. Inheriting those is not a convenience:
 * a variant filed under a different category would sort into a different POS
 * tab from the product it belongs to, and one with is_for_sale flipped would
 * be a variant nobody can pick.
 *
 * What it does NOT inherit:
 *   price / buying_price   the entire point of being a separate row.
 *   barcode                unique per outlet; a shared one is a scan that could
 *                          mean either size.
 *   stock / avg_cost       start at zero and are earned through the ledger,
 *                          which is the only thing allowed to write them.
 *   is_recommended,        marketing and social proof belong to the product the
 *   ratings, review_count  customer actually reviewed, not to each size of it.
 */
export function buildVariantRow(base: BaseRow, id: string, input: VariantInput) {
  return {
    id,
    product_name: variantProductName(base.product_name, input.variant_name),
    price: input.price,
    // "0" is this schema's no-discount sentinel, NOT a free product: every
    // reader takes price_mark_down only when it is set and non-zero. Mirroring
    // `price` into it instead would mark each variant as its own promo — a
    // strikethrough of the price it is being sold at, in the POS grid and on
    // the customer's menu alike.
    price_mark_down: input.price_mark_down ?? "0",
    buying_price: input.buying_price ?? base.buying_price,
    outlet_id: base.outlet_id,
    category: base.category,
    menu_group_id: base.menu_group_id,
    description: base.description ?? "",
    unit: base.unit,
    image: base.image,
    features: base.features,
    is_for_sale: base.is_for_sale,
    track_stock: base.track_stock,
    courier_deliverable: base.courier_deliverable,
    // A ranged (jasa / materials) product is priced by negotiation, so a fixed
    // per-variant price would contradict its own pricing model. The variant
    // editor refuses those upstream; this is belt and braces.
    lowest_price: null,
    highest_price: null,
    barcode: input.barcode ?? null,
    variant_of: base.id,
    variant_name: input.variant_name.trim(),
    variant_sort: input.variant_sort ?? 0,
    yield_qty: base.yield_qty,
  };
}

/**
 * Copy the base's composition onto a new variant.
 *
 * THE DEFAULT MUST BE "same recipe", never "no recipe". A Large created empty
 * would sell without consuming anything: no stock movement, no COGS, and a
 * margin report that quietly improves every time the bigger size sells. That
 * failure is invisible — nothing errors, the numbers just get better — which is
 * exactly the kind this codebase pays a copy to avoid.
 *
 * Starting identical to the base is also the honest starting point: the owner's
 * next move is to raise the milk, not to author the drink again.
 *
 * Runs inside the caller's transaction. qty is per ONE unit of output, so the
 * rows transfer unscaled — a Large that uses more is the owner's edit to make,
 * and guessing a multiplier from the price ratio would be a stock error dressed
 * up as a convenience.
 */
export async function copyRecipe(
  tx: Tx | typeof db,
  outletId: number,
  fromProductId: string,
  toProductId: string,
): Promise<number> {
  const rows = await tx
    .select({
      ingredient_id: recipeItemsTable.ingredient_id,
      qty: recipeItemsTable.qty,
    })
    .from(recipeItemsTable)
    .where(
      and(
        eq(recipeItemsTable.product_id, fromProductId),
        eq(recipeItemsTable.outlet_id, outletId),
      ),
    );
  if (rows.length === 0) return 0;

  await tx.insert(recipeItemsTable).values(
    rows.map((r) => ({
      outlet_id: outletId,
      product_id: toProductId,
      ingredient_id: r.ingredient_id,
      qty: r.qty,
    })),
  );
  return rows.length;
}

/**
 * The live variants of a base, in menu order.
 *
 * Live only: this drives COMPOSITION (a picker, an editor), and composition
 * follows the menu as it stands right now. Settlement never needs this function
 * at all — by then the variant is just the product on the line, and an archived
 * product still prices and names the order it is already in. That is the same
 * split add-ons make (lib/addons.ts), arrived at from the other direction.
 */
export async function liveVariantsOf(outletId: number, baseId: string) {
  return db
    .select()
    .from(productsTable)
    .where(
      and(
        eq(productsTable.outlet_id, outletId),
        eq(productsTable.variant_of, baseId),
        isNull(productsTable.deletedAt),
      ),
    )
    .orderBy(productsTable.variant_sort, productsTable.product_name);
}

/**
 * Why this product may not take variants, or null if it may.
 *
 * ONE LEVEL DEEP is the rule the database can't state. A variant of a variant
 * has no meaning — the picker renders exactly one question — and it would make
 * "hide variants from the grid" a recursive walk instead of a NULL check.
 */
export function variantRejection(base: BaseRow): string | null {
  if (base.variant_of) {
    return "Produk ini sudah jadi varian dari produk lain, jadi tidak bisa punya varian sendiri.";
  }
  if (base.lowest_price && base.lowest_price !== "0") {
    return "Produk dengan harga rentang (jasa / bahan bangunan) harganya dinego per order, jadi tidak pakai varian.";
  }
  return null;
}

/** Count of a base's live variants, for the cap. */
export async function countVariants(baseId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(productsTable)
    .where(and(eq(productsTable.variant_of, baseId), isNull(productsTable.deletedAt)));
  return row?.n ?? 0;
}
