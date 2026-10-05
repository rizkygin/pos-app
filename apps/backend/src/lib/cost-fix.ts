import { and, count, eq, gte, inArray, isNotNull, lt, notInArray, sql } from "drizzle-orm";
import { db } from "../db";
import { orderDetailsTable, ordersTable, productsTable, stockMovementsTable } from "../db/schema";
import { orderCogsSql, type CogsBasis } from "./cogs";
import { postMovement } from "./cost";
import { netLineRevenue } from "./money-sql";
import { orderNotDeleted } from "./order-scope";
import { getUTCRangeFromLocalMonth } from "./timezone";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Admin "Koreksi HPP": re-cost the sales of ONE product that were booked at a
 * wrong unit cost, and nothing else.
 *
 * A sale's cost is frozen on its stock movement when it happens (lib/cost.ts).
 * That is right until the cost it froze was wrong — outlet 33 bought Galon Air
 * per galon against an ml unit, so 24 sales froze Rp 38.000/ml and booked
 * Rp 114 jt of HPP for water. Fixing the product's HPP afterwards stops the
 * next sale from repeating it, but cannot reach the ones already written.
 *
 * This rewrites unit_cost and cost_change on exactly the movements that carry
 * the wrong cost: one product, reason sales/void, unit_cost = the wrong value.
 * Voids are included so a cancelled sale and its reversal still net to zero.
 * Quantities, stock, other products and every other movement stay as they
 * are, so no opname is needed. lib/cogs.ts reads cost_change, so laba kotor
 * follows immediately.
 *
 * What it cannot reach: a wrong cost that flowed into a PRODUCED item first
 * (a batch priced from it) and was sold through that item. Those sales carry
 * the batch's cost, not this product's, and show up as their own group.
 */

const TZ = "Asia/Jakarta";
const REASONS = ["sales", "void"] as const;
const isMoney = /^\s*-?[0-9]+(\.[0-9]+)?\s*$/;
const typedPrice = (v: string | null) => (v && isMoney.test(v) ? Number(v) : 0);

// A recorded cost this many times the product's own reference cost is the
// shape of a unit slip (a pack price on a per-ml unit), not a price rise.
const SUSPICIOUS_RATIO = 10;

// The other direction: goods sold at a cost of exactly 0. That is what a sale
// books while the product has no HPP yet (never bought on a faktur, never
// produced, cost not set) — outlet 33 sold 15.780 ml of Espresso (B) at 0 and
// its September laba kotor read millions too high. Always worth a look.

export type CostGroup = {
  productId: string;
  name: string;
  unit: string;
  unitCost: number;
  rows: number;
  qty: number;
  cost: number;
  first: string;
  last: string;
  hppNow: number;
  hargaModal: number;
  suspicious: boolean;
  /** Why it is flagged: a cost far above the product's own, or a cost of 0. */
  flag: "tinggi" | "nol" | null;
};

/** Every (product, recorded cost) the outlet's sales were booked at. */
export async function costGroups(outletId: number): Promise<CostGroup[]> {
  const rows = await db
    .select({
      productId: stockMovementsTable.product_id,
      name: productsTable.product_name,
      unit: productsTable.unit,
      hppNow: productsTable.avg_cost,
      hargaModal: productsTable.buying_price,
      unitCost: stockMovementsTable.unit_cost,
      rows: count(),
      qty: sql<string>`-sum(${stockMovementsTable.qty_change})`,
      cost: sql<string>`-sum(${stockMovementsTable.cost_change})`,
      first: sql<string>`min(${stockMovementsTable.created_at})`,
      last: sql<string>`max(${stockMovementsTable.created_at})`,
    })
    .from(stockMovementsTable)
    .innerJoin(productsTable, eq(productsTable.id, stockMovementsTable.product_id))
    .where(
      and(
        eq(stockMovementsTable.outlet_id, outletId),
        inArray(stockMovementsTable.reason, [...REASONS]),
        isNotNull(stockMovementsTable.unit_cost),
      ),
    )
    .groupBy(
      stockMovementsTable.product_id,
      productsTable.product_name,
      productsTable.unit,
      productsTable.avg_cost,
      productsTable.buying_price,
      stockMovementsTable.unit_cost,
    );

  return rows
    .map((r) => {
      const unitCost = Number(r.unitCost) || 0;
      const hppNow = Number(r.hppNow) || 0;
      const hargaModal = typedPrice(r.hargaModal);
      const reference = hppNow > 0 ? hppNow : hargaModal;
      const qty = Number(r.qty) || 0;
      const flag =
        unitCost === 0 && qty > 0
          ? ("nol" as const)
          : reference > 0 && unitCost >= reference * SUSPICIOUS_RATIO
            ? ("tinggi" as const)
            : null;
      return {
        productId: r.productId,
        name: r.name,
        unit: r.unit,
        unitCost,
        rows: Number(r.rows),
        qty,
        cost: Number(r.cost) || 0,
        first: String(r.first),
        last: String(r.last),
        hppNow,
        hargaModal,
        suspicious: flag !== null,
        flag,
      };
    })
    // A group that nets to nothing (sold and voided) has nothing to correct;
    // a cost-0 group is kept on purpose, it is the under-costing case.
    .filter((g) => Math.abs(g.cost) >= 1 || g.flag === "nol")
    // Flagged first; among the zeros, the most quantity sold first.
    .sort(
      (a, b) =>
        Number(b.suspicious) - Number(a.suspicious) ||
        b.cost - a.cost ||
        b.qty - a.qty,
    )
    .slice(0, 50);
}

const matching = (outletId: number, productId: string, fromCost: number) =>
  and(
    eq(stockMovementsTable.outlet_id, outletId),
    eq(stockMovementsTable.product_id, productId),
    inArray(stockMovementsTable.reason, [...REASONS]),
    sql`${stockMovementsTable.unit_cost} = ${fromCost}::numeric`,
  );

export type CostFixPreview = {
  rows: number;
  invoiceRows: number;
  oldCost: number;
  newCost: number;
  months: { month: string; omzet: number; labaNow: number; labaAfter: number }[];
};

/**
 * What the correction would change. Laba kotor per month is computed the way
 * the owner dashboard computes it (routes/owner.ts /api/reports/summary):
 * omzet net of discounts, minus orderCogsSql over the month's orders — and the
 * "after" figure is that minus exactly the cost these rows would lose.
 */
export async function previewCostFix(
  outletId: number,
  productId: string,
  fromCost: number,
  toCost: number,
  basis: CogsBasis,
): Promise<CostFixPreview> {
  // COGS change per row = -(qty * to - qty * from). Bucketed by the ORDER's
  // month, which is the window orderCogsSql is summed over.
  const delta = sql<string>`-sum(${stockMovementsTable.qty_change} * (${toCost}::numeric - ${fromCost}::numeric))`;
  const [totals] = await db
    .select({
      rows: count(),
      invoiceRows: sql<number>`count(${stockMovementsTable.invoice_id})`.mapWith(Number),
      oldCost: sql<string>`-sum(${stockMovementsTable.cost_change})`,
      newCost: sql<string>`-sum(${stockMovementsTable.qty_change} * ${toCost}::numeric)`,
    })
    .from(stockMovementsTable)
    .where(matching(outletId, productId, fromCost));

  const byMonth = await db
    .select({
      month: sql<string>`to_char(${ordersTable.createdAt} at time zone ${TZ}, 'YYYY-MM')`,
      delta,
    })
    .from(stockMovementsTable)
    .innerJoin(ordersTable, eq(ordersTable.id, stockMovementsTable.order_id))
    .where(matching(outletId, productId, fromCost))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const NET_LINE = netLineRevenue(orderDetailsTable.summary_price, orderDetailsTable.order_id, sql`${ordersTable}`);
  const months = [];
  for (const m of byMonth) {
    const { startUTC, endUTC } = getUTCRangeFromLocalMonth(m.month, TZ);
    const [rev] = await db
      .select({ omzet: sql<number>`coalesce(sum(${NET_LINE}), 0)`.mapWith(Number) })
      .from(orderDetailsTable)
      .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
      .innerJoin(ordersTable, eq(orderDetailsTable.order_id, ordersTable.id))
      .where(
        and(
          orderNotDeleted,
          eq(productsTable.outlet_id, outletId),
          gte(orderDetailsTable.created_at, startUTC),
          lt(orderDetailsTable.created_at, endUTC),
          notInArray(ordersTable.status, ["cancelled", "pending"]),
        ),
      );
    const cogsRes = await db.execute(sql`
      select coalesce(sum(c.cogs), 0)::float8 as cogs
      from (
        select ${orderCogsSql(sql`o.id`, basis)} as cogs
        from orders o
        where o.outlet_id = ${outletId}
          and o.deleted_at is null
          and o.status not in ('cancelled', 'pending')
          and o.created_at >= ${startUTC}
          and o.created_at < ${endUTC}
      ) c
    `);
    const cogs = Number((cogsRes.rows[0] as { cogs: number } | undefined)?.cogs ?? 0);
    const omzet = rev?.omzet ?? 0;
    // An outlet that does not cost from the ledger never reads these rows,
    // so its laba kotor does not move.
    const change = basis.ledger ? Number(m.delta) || 0 : 0;
    months.push({ month: m.month, omzet, labaNow: omzet - cogs, labaAfter: omzet - (cogs + change) });
  }

  return {
    rows: Number(totals?.rows ?? 0),
    invoiceRows: Number(totals?.invoiceRows ?? 0),
    oldCost: Number(totals?.oldCost) || 0,
    newCost: Number(totals?.newCost) || 0,
    months,
  };
}

/**
 * The correction. With setHpp, the product's running HPP is set to the
 * correct cost too, through the ledger's own revaluation (qty 0 + explicit
 * cost, lib/cost.ts), so the NEXT sale does not book the wrong cost again.
 */
export async function applyCostFix(
  tx: Tx,
  args: { outletId: number; productId: string; fromCost: number; toCost: number; setHpp: boolean; note: string },
) {
  const { outletId, productId, fromCost, toCost } = args;
  const updated = await tx
    .update(stockMovementsTable)
    .set({
      unit_cost: toCost.toFixed(4),
      cost_change: sql`round(${stockMovementsTable.qty_change} * ${toCost}::numeric, 2)`,
    })
    .where(matching(outletId, productId, fromCost));

  let revalued = false;
  if (args.setHpp) {
    const [p] = await tx
      .select({ avg: productsTable.avg_cost })
      .from(productsTable)
      .where(eq(productsTable.id, productId))
      .limit(1);
    if (p && Math.abs((Number(p.avg) || 0) - toCost) >= 0.0001) {
      await postMovement(tx, {
        outletId,
        productId,
        qtyChange: 0,
        unitCost: toCost,
        reason: "adjustment",
        note: args.note,
      });
      revalued = true;
    }
  }
  return { updated: updated.rowCount ?? 0, revalued };
}
