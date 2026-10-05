import { and, count, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  cashFlows,
  cashInDetailTable,
  cashOutDetailTable,
  cashierShiftsTable,
  diningTablesTable,
  invoiceItemsTable,
  invoicePaymentsTable,
  invoicesTable,
  kitchenTicketsTable,
  memberPointMovementsTable,
  orderDetailsTable,
  orderOffersTable,
  ordersTable,
  outletPromoUsesTable,
  outletPromosTable,
  outletsMembersTable,
  outletsTable,
  printLogsTable,
  productsTable,
  ratingsTable,
  recipeItemsTable,
  selfOrdersTable,
  stockMovementsTable,
  stockOpnameLinesTable,
  stockOpnameSessionsTable,
  tableReservationsTable,
  tableSessionLinesTable,
  tableSessionsTable,
  tableWaitlistTable,
} from "../db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Q = typeof db | Tx;

/**
 * Admin "Reset Data" for ONE outlet — built for trial outlets that played with
 * the app and want to start for real. The owner cannot do this himself:
 * order-linked Buku Kas rows are undeletable, a cancelled order is only soft
 * deleted, and posted invoices have already moved stock.
 *
 * Wipes every TRANSACTION of the outlet and keeps every piece of SETUP.
 *   wiped: orders (+lines, courier offers, ratings), stock movements, invoices
 *          (+items, payments), Buku Kas (+its in/out detail rows), cashier
 *          shifts, stock opname sessions, kitchen tickets, table bills, self
 *          orders, print logs, member point movements, promo uses
 *   kept:  products, recipes, add-ons, variants, menu groups, members, promos,
 *          dining tables/zones, reservations, waitlist, employees, settings,
 *          subscription
 *
 * Caches that summed the wiped rows go back to their "never sold" value:
 * products.stock and avg_cost to 0 (the ledger they cache is now empty; the
 * owner re-enters stock with an opname or a purchase invoice), product and
 * outlet ratings, member points/spend/visits (tier back to silver unless it
 * was set by hand), promo used_count. buying_price is the owner's own input
 * and stays.
 */

export type OutletResetCounts = {
  orders: number;
  stockMovements: number;
  invoices: number;
  cashflows: number;
  shifts: number;
  opnameSessions: number;
  kitchenTickets: number;
  tableBills: number;
  selfOrders: number;
  printLogs: number;
  pointMovements: number;
  promoUses: number;
  ratings: number;
  stockedProducts: number;
};

// The id sets everything else hangs off. Built as subqueries, so each one is
// re-evaluated where it is used — which is why the wipe deletes children
// before the parents these read from.
function scope(q: Q, outletId: number) {
  const orderIds = q
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(eq(ordersTable.outlet_id, outletId));
  return {
    orderIds,
    detailIds: q
      .select({ id: orderDetailsTable.id })
      .from(orderDetailsTable)
      .where(inArray(orderDetailsTable.order_id, orderIds)),
    invoiceIds: q
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(eq(invoicesTable.outlet_id, outletId)),
    shiftIds: q
      .select({ id: cashierShiftsTable.id })
      .from(cashierShiftsTable)
      .where(eq(cashierShiftsTable.outlet_id, outletId)),
    sessionIds: q
      .select({ id: tableSessionsTable.id })
      .from(tableSessionsTable)
      .where(eq(tableSessionsTable.outlet_id, outletId)),
    opnameIds: q
      .select({ id: stockOpnameSessionsTable.id })
      .from(stockOpnameSessionsTable)
      .where(eq(stockOpnameSessionsTable.outlet_id, outletId)),
    promoIds: q
      .select({ id: outletPromosTable.id })
      .from(outletPromosTable)
      .where(eq(outletPromosTable.outlet_id, outletId)),
  };
}

function hasStockOrCost(outletId: number) {
  return and(
    eq(productsTable.outlet_id, outletId),
    or(ne(productsTable.stock, "0"), ne(productsTable.avg_cost, "0")),
  );
}

/** What a reset would delete right now — shown in the confirm dialog. */
export async function countOutletData(outletId: number): Promise<OutletResetCounts> {
  const s = scope(db, outletId);
  const n = (rows: { n: number }[]) => Number(rows[0]?.n ?? 0);
  const [
    orders,
    stockMovements,
    invoices,
    cashflows,
    shifts,
    opnameSessions,
    kitchenTickets,
    tableBills,
    selfOrders,
    printLogs,
    pointMovements,
    promoUses,
    ratings,
    stockedProducts,
  ] = await Promise.all([
    db.select({ n: count() }).from(ordersTable).where(eq(ordersTable.outlet_id, outletId)),
    db.select({ n: count() }).from(stockMovementsTable).where(eq(stockMovementsTable.outlet_id, outletId)),
    db.select({ n: count() }).from(invoicesTable).where(eq(invoicesTable.outlet_id, outletId)),
    db.select({ n: count() }).from(cashFlows).where(eq(cashFlows.outlet_id, outletId)),
    db.select({ n: count() }).from(cashierShiftsTable).where(eq(cashierShiftsTable.outlet_id, outletId)),
    db.select({ n: count() }).from(stockOpnameSessionsTable).where(eq(stockOpnameSessionsTable.outlet_id, outletId)),
    db.select({ n: count() }).from(kitchenTicketsTable).where(eq(kitchenTicketsTable.outlet_id, outletId)),
    db.select({ n: count() }).from(tableSessionsTable).where(eq(tableSessionsTable.outlet_id, outletId)),
    db.select({ n: count() }).from(selfOrdersTable).where(eq(selfOrdersTable.outlet_id, outletId)),
    db.select({ n: count() }).from(printLogsTable).where(eq(printLogsTable.outlet_id, outletId)),
    db.select({ n: count() }).from(memberPointMovementsTable).where(eq(memberPointMovementsTable.outlet_id, outletId)),
    db.select({ n: count() }).from(outletPromoUsesTable).where(inArray(outletPromoUsesTable.promo_id, s.promoIds)),
    db.select({ n: count() }).from(ratingsTable).where(inArray(ratingsTable.order_details_id, s.detailIds)),
    db.select({ n: count() }).from(productsTable).where(hasStockOrCost(outletId)),
  ]);
  return {
    orders: n(orders),
    stockMovements: n(stockMovements),
    invoices: n(invoices),
    cashflows: n(cashflows),
    shifts: n(shifts),
    opnameSessions: n(opnameSessions),
    kitchenTickets: n(kitchenTickets),
    tableBills: n(tableBills),
    selfOrders: n(selfOrders),
    printLogs: n(printLogs),
    pointMovements: n(pointMovements),
    promoUses: n(promoUses),
    ratings: n(ratings),
    stockedProducts: n(stockedProducts),
  };
}

// pg caps a statement at 65535 bind params.
const CHUNK = 5000;

async function deleteByIds(
  tx: Tx,
  table: typeof cashInDetailTable | typeof cashOutDetailTable,
  ids: number[],
) {
  for (let i = 0; i < ids.length; i += CHUNK) {
    await tx.delete(table).where(inArray(table.id, ids.slice(i, i + CHUNK)));
  }
}

/**
 * The wipe. Run it inside a transaction: a failure halfway must leave the
 * outlet exactly as it was. Order matters — every delete runs before the
 * rows its foreign keys point at.
 */
export async function wipeOutletData(tx: Tx, outletId: number): Promise<OutletResetCounts> {
  const s = scope(tx, outletId);
  const rows = (r: { rowCount: number | null }) => r.rowCount ?? 0;

  // Buku Kas detail rows carry no outlet_id: collect them through everything
  // that points at them while those rows still exist.
  const cashIn = new Set<number>();
  const cashOut = new Set<number>();
  const collect = (list: { i: number | null; o: number | null }[]) => {
    for (const r of list) {
      if (r.i != null) cashIn.add(r.i);
      if (r.o != null) cashOut.add(r.o);
    }
  };
  collect(
    await tx
      .select({ i: cashFlows.cash_in_detail_id, o: cashFlows.cash_out_detail_id })
      .from(cashFlows)
      .where(eq(cashFlows.outlet_id, outletId)),
  );
  collect(
    await tx
      .select({ i: invoicesTable.cash_in_detail_id, o: invoicesTable.cash_out_detail_id })
      .from(invoicesTable)
      .where(eq(invoicesTable.outlet_id, outletId)),
  );
  collect(
    await tx
      .select({ i: invoicePaymentsTable.cash_in_detail_id, o: invoicePaymentsTable.cash_out_detail_id })
      .from(invoicePaymentsTable)
      .where(inArray(invoicePaymentsTable.invoice_id, s.invoiceIds)),
  );

  // ── Everything that points at orders / order lines / invoices ──────────
  const ratings = rows(
    await tx.delete(ratingsTable).where(inArray(ratingsTable.order_details_id, s.detailIds)),
  );
  const stockMovements = rows(
    await tx
      .delete(stockMovementsTable)
      .where(
        or(
          eq(stockMovementsTable.outlet_id, outletId),
          inArray(stockMovementsTable.order_id, s.orderIds),
          inArray(stockMovementsTable.invoice_id, s.invoiceIds),
        ),
      ),
  );
  await tx.delete(stockOpnameLinesTable).where(inArray(stockOpnameLinesTable.session_id, s.opnameIds));
  const opnameSessions = rows(
    await tx.delete(stockOpnameSessionsTable).where(eq(stockOpnameSessionsTable.outlet_id, outletId)),
  );
  const pointMovements = rows(
    await tx
      .delete(memberPointMovementsTable)
      .where(
        or(
          eq(memberPointMovementsTable.outlet_id, outletId),
          inArray(memberPointMovementsTable.order_id, s.orderIds),
        ),
      ),
  );
  const promoUses = rows(
    await tx
      .delete(outletPromoUsesTable)
      .where(
        or(
          inArray(outletPromoUsesTable.promo_id, s.promoIds),
          inArray(outletPromoUsesTable.order_id, s.orderIds),
        ),
      ),
  );

  // ── Floor: kitchen, self orders, struk logs, table bills ───────────────
  const kitchenTickets = rows(
    await tx.delete(kitchenTicketsTable).where(eq(kitchenTicketsTable.outlet_id, outletId)),
  );
  const printLogs = rows(
    await tx.delete(printLogsTable).where(eq(printLogsTable.outlet_id, outletId)),
  );
  const selfOrders = rows(
    await tx.delete(selfOrdersTable).where(eq(selfOrdersTable.outlet_id, outletId)),
  );
  await tx
    .delete(tableSessionLinesTable)
    .where(
      or(
        inArray(tableSessionLinesTable.session_id, s.sessionIds),
        inArray(tableSessionLinesTable.order_id, s.orderIds),
      ),
    );
  // Tables, reservations and the waitlist are setup and stay; only their link
  // to a bill goes. A seated table comes back free.
  await tx
    .update(diningTablesTable)
    .set({ session_id: null })
    .where(eq(diningTablesTable.outlet_id, outletId));
  await tx
    .update(tableReservationsTable)
    .set({ session_id: null })
    .where(inArray(tableReservationsTable.session_id, s.sessionIds));
  await tx
    .update(tableWaitlistTable)
    .set({ session_id: null })
    .where(inArray(tableWaitlistTable.session_id, s.sessionIds));
  await tx
    .update(tableSessionsTable)
    .set({ merged_into: null })
    .where(eq(tableSessionsTable.outlet_id, outletId));
  const tableBills = rows(
    await tx.delete(tableSessionsTable).where(eq(tableSessionsTable.outlet_id, outletId)),
  );

  // ── Money: Buku Kas, invoices ──────────────────────────────────────────
  const cashflows = rows(
    await tx
      .delete(cashFlows)
      .where(
        or(
          eq(cashFlows.outlet_id, outletId),
          inArray(cashFlows.order_id, s.orderIds),
          inArray(cashFlows.shift_id, s.shiftIds),
        ),
      ),
  );
  await tx.delete(invoicePaymentsTable).where(inArray(invoicePaymentsTable.invoice_id, s.invoiceIds));
  await tx.delete(invoiceItemsTable).where(inArray(invoiceItemsTable.invoice_id, s.invoiceIds));
  const invoices = rows(
    await tx.delete(invoicesTable).where(eq(invoicesTable.outlet_id, outletId)),
  );
  await deleteByIds(tx, cashInDetailTable, [...cashIn]);
  await deleteByIds(tx, cashOutDetailTable, [...cashOut]);

  // ── Orders, then the shifts they were rung up in ──────────────────────
  await tx.delete(orderOffersTable).where(inArray(orderOffersTable.order_id, s.orderIds));
  // Add-on lines point at their parent line: children first.
  await tx
    .delete(orderDetailsTable)
    .where(
      and(
        inArray(orderDetailsTable.order_id, s.orderIds),
        isNotNull(orderDetailsTable.parent_detail_id),
      ),
    );
  await tx.delete(orderDetailsTable).where(inArray(orderDetailsTable.order_id, s.orderIds));
  const orders = rows(await tx.delete(ordersTable).where(eq(ordersTable.outlet_id, outletId)));
  const shifts = rows(
    await tx.delete(cashierShiftsTable).where(eq(cashierShiftsTable.outlet_id, outletId)),
  );

  // ── Caches back to "never sold" ────────────────────────────────────────
  const stockedProducts = rows(
    await tx
      .update(productsTable)
      .set({ stock: "0", avg_cost: "0" })
      .where(hasStockOrCost(outletId)),
  );
  await tx
    .update(productsTable)
    .set({ ratings: "5", review_count: 0 })
    .where(eq(productsTable.outlet_id, outletId));
  await tx
    .update(outletsTable)
    .set({ ratings: "5", review_count: 0, stock_reset_at: new Date() })
    .where(eq(outletsTable.id, outletId));
  await tx
    .update(outletsMembersTable)
    .set({
      points_balance: 0,
      lifetime_spend: "0",
      visit_count: 0,
      // An earned tier came from lifetime_spend, which is now 0.
      tier: sql`CASE WHEN ${outletsMembersTable.tier_manual} THEN ${outletsMembersTable.tier} ELSE 'silver' END`,
    })
    .where(eq(outletsMembersTable.outlet_id, outletId));
  await tx
    .update(outletPromosTable)
    .set({ used_count: 0 })
    .where(eq(outletPromosTable.outlet_id, outletId));

  return {
    orders,
    stockMovements,
    invoices,
    cashflows,
    shifts,
    opnameSessions,
    kitchenTickets,
    tableBills,
    selfOrders,
    printLogs,
    pointMovements,
    promoUses,
    ratings,
    stockedProducts,
  };
}

// ── Reset Alur Stok: the stock ledger only ──────────────────────────────────
//
// For a LIVE outlet whose stock history went wrong — outlet 33 bought Galon Air
// per galon against an ml unit, every Americano then booked Rp 4,56 jt of HPP
// and the month's laba kotor went to minus sixty million. Sales, invoices and
// Buku Kas are real and stay; only the ledger that priced them goes.
//
//   deleted: every stock_movements row of the outlet (purchases, sales,
//            production batches, opname adjustments, voids)
//   reset:   products.stock -> 0, products.avg_cost -> see planStockHpp,
//            outlets.stock_reset_at -> now
//   kept:    orders, invoices, Buku Kas, shifts, opname session records,
//            recipes, products
//
// Laba kotor for the orders left behind falls back by itself: with no tagged
// movement an order reads lib/cogs.ts allLinesFallback, the buying price frozen
// on each line at sale time (kept on purpose — editing harga modal never
// rewrites a past sale). A real HPP (not 0) is what keeps NEW sales costed
// straight away: a sale consumes at avg_cost, so 0 would read as a 100% margin
// until the owner counted every product again. The owner re-enters quantities
// with a stock opname.
//
// stock_reset_at is what stops a later cancel of a pre-reset order from
// handing stock back (routes/mutations.ts): its stock left with the reset.

// Same acceptance rule as money() in lib/money-sql.ts, so a harga modal that
// the reports read as a number is the one read as a number here.
const MONEY_RE = /^\s*-?[0-9]+(\.[0-9]+)?\s*$/;
const typedPrice = (v: string | null) => (v && MONEY_RE.test(v) ? Number(v) : 0);

export type HppSource = "harga modal" | "resep" | "kosong";
export type HppPlanRow = {
  id: string;
  name: string;
  unit: string;
  trackStock: boolean;
  archived: boolean;
  /** avg_cost now, and what the reset writes. */
  from: number;
  to: number;
  source: HppSource;
  /** Selling price (the discounted one when set), and whether it is on sale. */
  price: number;
  sellable: boolean;
  /** What selling ONE unit costs, now and after the reset — see saleCost. */
  saleCostNow: number;
  saleCostAfter: number;
};

/**
 * What each product's HPP becomes after the reset:
 *   1. its harga modal, when the owner filled one in;
 *   2. otherwise its RECIPE cost — sum of qty x each ingredient's NEW HPP,
 *      applying these same rules to the ingredient (so prep made from prep
 *      works). This is what in-house prep needs: nobody buys Espresso Blend on
 *      a faktur, so it has no harga modal, and its HPP is the only cost it has;
 *   3. otherwise 0.
 * recipe_items.qty is "per one output unit" for every product (lib/stock.ts),
 * so the sum is already a unit cost.
 *
 * One function feeds both the dialog's preview and the reset itself, so the
 * admin is shown exactly what gets written.
 */
export async function planStockHpp(q: Q, outletId: number): Promise<HppPlanRow[]> {
  const outletProducts = q
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.outlet_id, outletId));
  const [products, recipe] = await Promise.all([
    q
      .select({
        id: productsTable.id,
        name: productsTable.product_name,
        unit: productsTable.unit,
        buying_price: productsTable.buying_price,
        avg_cost: productsTable.avg_cost,
        track_stock: productsTable.track_stock,
        price: productsTable.price,
        price_mark_down: productsTable.price_mark_down,
        is_for_sale: productsTable.is_for_sale,
        deletedAt: productsTable.deletedAt,
      })
      .from(productsTable)
      .where(eq(productsTable.outlet_id, outletId)),
    // Scoped through the products, not recipe_items.outlet_id, which older
    // rows may not carry.
    q
      .select({
        product_id: recipeItemsTable.product_id,
        ingredient_id: recipeItemsTable.ingredient_id,
        qty: recipeItemsTable.qty,
      })
      .from(recipeItemsTable)
      .where(inArray(recipeItemsTable.product_id, outletProducts)),
  ]);

  const typed = new Map(products.map((p) => [p.id, typedPrice(p.buying_price)]));
  const kids = new Map<string, { ingredient_id: string; qty: number }[]>();
  for (const r of recipe) {
    if (!r.product_id || !r.ingredient_id) continue;
    const list = kids.get(r.product_id) ?? [];
    list.push({ ingredient_id: r.ingredient_id, qty: Number(r.qty) || 0 });
    kids.set(r.product_id, list);
  }

  const memo = new Map<string, number>();
  const costOf = (id: string, path: string[]): number => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    const t = typed.get(id) ?? 0;
    if (t > 0) {
      memo.set(id, t);
      return t;
    }
    // A recipe that eats itself is refused at write time (findRecipeCycle), so
    // only legacy rows reach this; stop rather than spin.
    if (path.includes(id)) return 0;
    const v = (kids.get(id) ?? []).reduce(
      (sum, k) => sum + k.qty * costOf(k.ingredient_id, [...path, id]),
      0,
    );
    memo.set(id, v);
    return v;
  };

  // What selling one unit costs, the way a sale books it (lib/stock.ts): a
  // stocked product is a leaf consumed at its avg_cost; anything else expands
  // its recipe; a product with neither moves nothing and is costed at its
  // harga modal. Run with today's avg_cost and with the planned one, this is
  // the check that catches a unit slip before it reaches laba kotor — Galon
  // Air bought per galon on an ml unit, or a shot's 18 g typed against 1 ml.
  const byId = new Map(products.map((p) => [p.id, p]));
  const saleCost = (hpp: (id: string) => number) => {
    const m = new Map<string, number>();
    const walk = (id: string, path: string[]): number => {
      const hit = m.get(id);
      if (hit !== undefined) return hit;
      const p = byId.get(id);
      if (!p || path.includes(id)) return 0;
      const v = p.track_stock
        ? hpp(id)
        : kids.has(id)
          ? kids.get(id)!.reduce((sum, k) => sum + k.qty * walk(k.ingredient_id, [...path, id]), 0)
          : (typed.get(id) ?? 0);
      m.set(id, v);
      return v;
    };
    return (id: string) => walk(id, []);
  };
  const costNow = saleCost((id) => Number(byId.get(id)?.avg_cost) || 0);
  const costAfter = saleCost((id) => costOf(id, []));

  return products.map((p) => {
    const t = typed.get(p.id) ?? 0;
    const discounted = typedPrice(p.price_mark_down);
    return {
      id: p.id,
      name: p.name,
      unit: p.unit,
      trackStock: p.track_stock,
      archived: !!p.deletedAt,
      from: Number(p.avg_cost) || 0,
      to: Number(costOf(p.id, []).toFixed(4)),
      source: t > 0 ? "harga modal" : kids.has(p.id) ? "resep" : "kosong",
      price: discounted > 0 ? discounted : typedPrice(p.price),
      sellable: p.is_for_sale && !p.deletedAt,
      saleCostNow: Math.round(costNow(p.id)),
      saleCostAfter: Math.round(costAfter(p.id)),
    };
  });
}

export type StockFlowCounts = {
  movements: number;
  stockedProducts: number;
  openOpname: number;
  stockResetAt: Date | null;
  // Stocked products only: those are the ones a sale costs from avg_cost.
  // Changed rows plus every row that would end at 0.
  hpp: HppPlanRow[];
  // Products on sale that would cost more to make than they sell for.
  overPrice: HppPlanRow[];
};

export async function countStockFlow(outletId: number): Promise<StockFlowCounts> {
  const [[movements], [stockedProducts], [openOpname], [outlet], plan] = await Promise.all([
    db.select({ n: count() }).from(stockMovementsTable).where(eq(stockMovementsTable.outlet_id, outletId)),
    db
      .select({ n: count() })
      .from(productsTable)
      .where(and(eq(productsTable.outlet_id, outletId), ne(productsTable.stock, "0"))),
    db
      .select({ n: count() })
      .from(stockOpnameSessionsTable)
      .where(and(eq(stockOpnameSessionsTable.outlet_id, outletId), eq(stockOpnameSessionsTable.status, "open"))),
    db.select({ at: outletsTable.stock_reset_at }).from(outletsTable).where(eq(outletsTable.id, outletId)),
    planStockHpp(db, outletId),
  ]);
  return {
    movements: Number(movements?.n ?? 0),
    stockedProducts: Number(stockedProducts?.n ?? 0),
    openOpname: Number(openOpname?.n ?? 0),
    stockResetAt: outlet?.at ?? null,
    hpp: plan.filter((r) => r.trackStock && (Math.abs(r.to - r.from) >= 0.0001 || r.to === 0)),
    overPrice: plan
      .filter((r) => r.sellable && r.price > 0 && r.saleCostAfter > r.price)
      .sort((a, b) => b.saleCostAfter / b.price - a.saleCostAfter / a.price),
  };
}

/** The wipe. Run inside a transaction, after checking there is no open opname. */
export async function wipeStockFlow(tx: Tx, outletId: number) {
  const rows = (r: { rowCount: number | null }) => r.rowCount ?? 0;
  // Planned before anything moves; it reads harga modal and recipes only.
  const plan = await planStockHpp(tx, outletId);
  const movements = rows(
    await tx.delete(stockMovementsTable).where(eq(stockMovementsTable.outlet_id, outletId)),
  );
  const stockedProducts = rows(
    await tx
      .update(productsTable)
      .set({ stock: "0" })
      .where(and(eq(productsTable.outlet_id, outletId), ne(productsTable.stock, "0"))),
  );
  const changes = plan.filter((r) => Math.abs(r.to - r.from) >= 0.0001);
  for (let i = 0; i < changes.length; i += 500) {
    const values = sql.join(
      changes.slice(i, i + 500).map((c) => sql`(${c.id}::text, ${c.to.toFixed(4)}::numeric)`),
      sql`, `,
    );
    await tx.execute(
      sql`update ${productsTable} set avg_cost = v.cost from (values ${values}) as v(id, cost) where ${productsTable.id} = v.id`,
    );
  }
  await tx
    .update(outletsTable)
    .set({ stock_reset_at: new Date() })
    .where(eq(outletsTable.id, outletId));
  return { movements, stockedProducts, hppChanged: changes.length };
}
