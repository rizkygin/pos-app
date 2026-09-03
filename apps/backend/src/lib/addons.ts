import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  addonGroupOptionsTable,
  addonGroupsTable,
  orderDetailsTable,
  productAddonGroupsTable,
  productsTable,
} from "../db/schema";

/**
 * Add-on resolution for the sale path.
 *
 * An add-on is a child order line (see migration 0069), so almost nothing about
 * selling one is special. What IS special is deciding what the customer pays,
 * and this file exists to make that decision the same way every caller does.
 *
 * TWO RULES, and both are about staleness rather than correctness-in-the-moment:
 *
 * 1. THE PRICE COMES FROM THE CLIENT, falling back to the option row.
 *
 *    Not because the client is trusted, but because routes/mutations.ts already
 *    takes the PARENT line's price from the payload. Sourcing the add-on from
 *    live config while the dish comes from a possibly-stale cart produces one
 *    order priced from two different moments: a tab parked at 14:00 and paid at
 *    15:00 would charge yesterday's nasi goreng beside today's telur. Being
 *    coherently stale beats being incoherently fresh, and the cashier can
 *    already type any discount they like — there is no tampering this would
 *    prevent that the discount field doesn't already allow.
 *
 * 2. A MISSING OPTION IS NOT AN ERROR.
 *
 *    Held tabs live in a cashier's localStorage for days. If the owner removes
 *    "Telur" from a group at 15:00, a tab parked at 14:00 still references it,
 *    and refusing to settle that sale would strand a customer at the counter
 *    holding cash. So options are soft-deleted and looked up WITHOUT filtering
 *    deleted_at — the archived row still prices the line it is already in.
 *
 *    This is the same principle as a sale being allowed with no open shift: the
 *    counter must never be blocked by a settings page.
 *
 * Group rules (min_select/max_select) are deliberately NOT enforced here. They
 * govern what the picker lets a cashier COMPOSE, not what checkout will settle;
 * tightening a rule must not make an already-parked tab unpayable.
 */

/**
 * "A line the customer ordered", as opposed to an add-on hanging off one.
 *
 * THE READER RULE, in one place so it can be grepped:
 *
 *   summing MONEY   (order total, revenue, COGS) -> every row, no filter.
 *                   Each row's summary_price is what THAT product sold for, so
 *                   the plain sum is still the order total.
 *   counting ITEMS  ("3 item", a receipt tally, a preview strip) -> this filter.
 *                   Otherwise one nasi goreng with two toppings reads as 3.
 *
 * Getting it backwards is silent both ways — inflated item counts, or revenue
 * quietly missing every add-on ever sold.
 *
 * On a LEFT JOIN this belongs in an aggregate's FILTER clause, never in WHERE:
 * moving it to WHERE turns the join inner and drops orders that have no lines
 * at all. Several dashboard queries count items and sum money in the same pass,
 * which is exactly why FILTER is the tool rather than a join condition.
 */
export const parentLinesOnly = isNull(orderDetailsTable.parent_detail_id);

/** One add-on as the client sends it, attached to a parent cart line. */
export type IncomingAddon = {
  product_id: string;
  /** The catalogue row it came from, when the client knows it. */
  option_id?: number | null;
  /**
   * How many per ONE unit of the parent line, almost always 1. The absolute
   * quantity written to the order is this times the parent's quantity, and that
   * multiplication happens server-side precisely so no client can get it wrong
   * — orderDetails.quantity is absolute for every line, add-ons included.
   */
  quantity?: number | null;
  /** What the cashier's screen showed. See rule 1 above. */
  price?: number | string | null;
};

export type ResolvedAddon = {
  product_id: string;
  /** Absolute, already multiplied by the parent line's quantity. */
  quantity: number;
  /** Per-unit rupiah, >= 0. */
  price: number;
  /** Total for the child line: price * quantity. */
  summary_price: number;
};

const toMoney = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Price and size a parent line's add-ons.
 *
 * `outletId` scopes the product lookup: an add-on must be a product of the
 * outlet ringing up the sale, or a client could attach someone else's item and
 * draw down their stock. Anything that fails that check is DROPPED rather than
 * throwing, for the same reason a missing option is tolerated — a malformed
 * line must not cost the sale. It is the one case worth logging.
 */
export async function resolveAddons(
  outletId: number,
  parentQuantity: number,
  addons: IncomingAddon[] | null | undefined,
): Promise<{ resolved: ResolvedAddon[]; dropped: string[] }> {
  if (!Array.isArray(addons) || addons.length === 0) {
    return { resolved: [], dropped: [] };
  }

  const productIds = [...new Set(addons.map((a) => a?.product_id).filter(Boolean) as string[])];
  if (productIds.length === 0) return { resolved: [], dropped: [] };

  // Which of these are really this outlet's products. deletedAt is NOT filtered:
  // a product archived after being sold is still a legitimate add-on on a tab
  // parked before the archive (products.delete soft-deletes anything with
  // history — see routes/products.ts).
  const owned = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(and(eq(productsTable.outlet_id, outletId), inArray(productsTable.id, productIds)));
  const ownedIds = new Set(owned.map((p) => p.id));

  // Catalogue prices, as a fallback for a client that sent none. Soft-deleted
  // options are included on purpose — see rule 2 above.
  const options = await db
    .select({
      product_id: addonGroupOptionsTable.product_id,
      price: addonGroupOptionsTable.price,
    })
    .from(addonGroupOptionsTable)
    .innerJoin(addonGroupsTable, eq(addonGroupsTable.id, addonGroupOptionsTable.group_id))
    .where(
      and(
        eq(addonGroupsTable.outlet_id, outletId),
        inArray(addonGroupOptionsTable.product_id, productIds),
      ),
    );
  // A product can be an option in more than one group at different prices; the
  // fallback takes the first, which is only ever reached when the client sent
  // nothing at all. The client's own price is what settles a real sale.
  const fallbackPrice = new Map<string, number>();
  for (const o of options) {
    if (!fallbackPrice.has(o.product_id)) fallbackPrice.set(o.product_id, Number(o.price) || 0);
  }

  const resolved: ResolvedAddon[] = [];
  const dropped: string[] = [];

  for (const a of addons) {
    if (!a?.product_id || !ownedIds.has(a.product_id)) {
      if (a?.product_id) dropped.push(a.product_id);
      continue;
    }

    const perUnit = Math.floor(Number(a.quantity ?? 1));
    if (!Number.isFinite(perUnit) || perUnit <= 0) continue;

    // Absolute: two nasi goreng with an egg each is a child line of quantity 2.
    // Storing "1 per portion" here would under-deduct stock and under-cost the
    // sale by the parent's multiplier, silently and forever.
    const quantity = perUnit * parentQuantity;

    const sent = toMoney(a.price);
    // Negative is the one number never accepted: a discount belongs in the
    // order's discount field, where the reports can see it.
    const price = sent !== null && sent >= 0 ? sent : (fallbackPrice.get(a.product_id) ?? 0);

    resolved.push({
      product_id: a.product_id,
      quantity,
      price,
      summary_price: price * quantity,
    });
  }

  return { resolved, dropped };
}

/**
 * The add-on catalogue for a set of products, shaped for the POS.
 *
 * Only LIVE rows: this feeds the picker, which is composition, and composition
 * follows the menu as it stands right now. (Settlement is the other half and
 * reads archived rows — see resolveAddons above.)
 */
export async function addonGroupsForProducts(
  outletId: number,
  productIds: string[],
): Promise<Map<string, AddonGroupView[]>> {
  const byProduct = new Map<string, AddonGroupView[]>();
  if (productIds.length === 0) return byProduct;

  const rows = await db
    .select({
      product_id: productAddonGroupsTable.product_id,
      attach_sort: productAddonGroupsTable.sort_order,
      group_id: addonGroupsTable.id,
      group_name: addonGroupsTable.name,
      min_select: addonGroupsTable.min_select,
      max_select: addonGroupsTable.max_select,
      group_sort: addonGroupsTable.sort_order,
      option_id: addonGroupOptionsTable.id,
      option_product_id: addonGroupOptionsTable.product_id,
      option_price: addonGroupOptionsTable.price,
      option_sort: addonGroupOptionsTable.sort_order,
      option_name: productsTable.product_name,
      option_available: productsTable.isAvailable,
    })
    .from(productAddonGroupsTable)
    .innerJoin(addonGroupsTable, eq(addonGroupsTable.id, productAddonGroupsTable.group_id))
    .leftJoin(
      addonGroupOptionsTable,
      and(
        eq(addonGroupOptionsTable.group_id, addonGroupsTable.id),
        isNull(addonGroupOptionsTable.deletedAt),
      ),
    )
    .leftJoin(productsTable, eq(productsTable.id, addonGroupOptionsTable.product_id))
    .where(
      and(
        eq(addonGroupsTable.outlet_id, outletId),
        inArray(productAddonGroupsTable.product_id, productIds),
        isNull(productAddonGroupsTable.deleted_at),
        isNull(addonGroupsTable.deletedAt),
      ),
    )
    .orderBy(
      productAddonGroupsTable.sort_order,
      addonGroupsTable.sort_order,
      addonGroupOptionsTable.sort_order,
    );

  for (const r of rows) {
    let groups = byProduct.get(r.product_id);
    if (!groups) {
      groups = [];
      byProduct.set(r.product_id, groups);
    }
    let group = groups.find((g) => g.id === r.group_id);
    if (!group) {
      group = {
        id: r.group_id,
        name: r.group_name,
        min_select: r.min_select,
        max_select: r.max_select,
        options: [],
      };
      groups.push(group);
    }
    // leftJoin: a group with no options yet yields one row of nulls.
    if (r.option_id !== null && r.option_product_id !== null) {
      group.options.push({
        id: r.option_id,
        product_id: r.option_product_id,
        name: r.option_name ?? "",
        price: Number(r.option_price) || 0,
        // A sold-out add-on stays listed but unpickable, so the cashier can see
        // it exists and tell the customer, rather than it silently vanishing.
        available: r.option_available !== false,
      });
    }
  }

  return byProduct;
}

export type AddonOptionView = {
  id: number;
  product_id: string;
  name: string;
  price: number;
  available: boolean;
};

export type AddonGroupView = {
  id: number;
  name: string;
  min_select: number;
  max_select: number | null;
  options: AddonOptionView[];
};
