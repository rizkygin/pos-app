import { and, eq, inArray, isNull, max, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  productsTable,
  stockMovementsTable,
  stockOpnameLinesTable,
  stockOpnameSessionsTable,
} from "../db/schema";
import { postMovement } from "./cost";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Q = typeof db | Tx;

/**
 * How far back a count may be dated. Long enough for "we counted on paper
 * over the weekend", short enough that nobody reconciles against a stock
 * nobody remembers.
 */
export const MAX_BACKDATE_DAYS = 7;

/**
 * When a difference stops being a rounding annoyance and becomes something
 * somebody has to explain. Either test is enough: a big rupiah hole in a
 * cheap-per-unit product, or a big proportion of a small shelf.
 *
 * Mirrored in the page (opname-session.tsx) so a row can be classified while
 * it is still being typed. Both read from here when the count is saved, which
 * is the number that actually gates the finish.
 */
export const TOLERANCE_RP = 100_000;
export const TOLERANCE_PCT = 0.05;

/** Why a count differs. The page shows the label; the row stores the key. */
export const REASON_CODES: Record<string, string> = {
  busuk: "Barang busuk / rusak",
  terpakai: "Terpakai tanpa dicatat",
  salah_satuan: "Salah satuan saat input",
  faktur_ganda: "Tercatat ganda di faktur",
  hilang: "Hilang / belum diketahui",
};

/**
 * How a counted line reads:
 *   ok     the count matches the system
 *   minor  it differs, but within tolerance — a reason is optional
 *   major  over tolerance — finishing is blocked until a reason is given
 * A line nobody has answered yet is "pending" and lives outside this.
 */
export type VarianceTone = "ok" | "minor" | "major";

export function classify(delta: number, systemQty: number, unitCost: number): VarianceTone {
  if (delta === 0) return "ok";
  const impact = Math.abs(delta * unitCost);
  const share = systemQty > 0 ? Math.abs(delta) / systemQty : 0;
  return impact >= TOLERANCE_RP || share > TOLERANCE_PCT ? "major" : "minor";
}

/**
 * What one unit is worth for the variance arithmetic: the ledger's running
 * average, falling back to the hand-typed buying price only when the ledger
 * has never priced the product. Same rule as the Stok page, so the rupiah on
 * the count screen matches the rupiah in the stock value above it.
 */
export const unitCostOf = (avgCost: unknown, buyingPrice: unknown, typed?: unknown) => {
  const avg = Number(avgCost) || 0;
  if (avg > 0) return avg;
  const t = Number(typed) || 0;
  if (t > 0) return t;
  return Number(buyingPrice) || 0;
};

/**
 * Sum of a product's movements AFTER a moment, as a correlated subquery.
 *
 * Stock at time T = products.stock − this. It holds because every stock change
 * goes through postMovement (lib/cost.ts), so the ledger after T is exactly
 * what moved the cached balance since T. Read in the SAME statement as
 * products.stock: a sale committing between two separate reads would move one
 * number and not the other.
 *
 * The outer column is passed table-qualified on purpose: drizzle renders a
 * column unqualified in a single-table select, and a bare "id" inside this
 * subquery would resolve to the MOVEMENT's id.
 */
const movedAfter = (productId: SQL, at: SQL) => sql<string>`coalesce((
  select sum(m.qty_change) from ${stockMovementsTable} m
  where m.product_id = ${productId} and m.created_at > ${at}
), 0)`;
const col = (table: string, column: string) => sql`${sql.identifier(table)}.${sql.identifier(column)}`;

/** System stock of each tracked product of the outlet at `at`. */
export async function stockAt(q: Q, outletId: number, at: Date): Promise<Record<string, number>> {
  const rows = await q
    .select({
      id: productsTable.id,
      stock: productsTable.stock,
      after: movedAfter(col("products", "id"), sql`${at.toISOString()}::timestamptz`),
    })
    .from(productsTable)
    .where(
      and(
        eq(productsTable.outlet_id, outletId),
        eq(productsTable.track_stock, true),
        isNull(productsTable.deletedAt),
      ),
    );
  return Object.fromEntries(rows.map((r) => [r.id, round3(Number(r.stock) - Number(r.after))]));
}

/**
 * The last time each product was COUNTED: its newest adjustment movement, or
 * the newest line of a finished session (a line that matched the system posts
 * no movement, but it is still a count).
 *
 * A new count dated before this would be reconciled against a stock that a
 * later count already corrected, and book the same difference twice.
 */
export async function lastCountedAt(q: Q, productIds: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (productIds.length === 0) return out;
  const keep = (id: string, at: Date | null) => {
    if (!at) return;
    const d = new Date(at);
    const prev = out.get(id);
    if (!prev || d > prev) out.set(id, d);
  };

  const moved = await q
    .select({ id: stockMovementsTable.product_id, at: max(stockMovementsTable.created_at) })
    .from(stockMovementsTable)
    .where(
      and(
        inArray(stockMovementsTable.product_id, productIds),
        eq(stockMovementsTable.reason, "adjustment"),
      ),
    )
    .groupBy(stockMovementsTable.product_id);
  for (const r of moved) keep(r.id, r.at);

  const counted = await q
    .select({ id: stockOpnameLinesTable.product_id, at: max(stockOpnameLinesTable.counted_at) })
    .from(stockOpnameLinesTable)
    .innerJoin(stockOpnameSessionsTable, eq(stockOpnameSessionsTable.id, stockOpnameLinesTable.session_id))
    .where(
      and(
        inArray(stockOpnameLinesTable.product_id, productIds),
        eq(stockOpnameSessionsTable.status, "finished"),
        // A SKIPPED line answered "nobody could count this", which corrected
        // nothing — it must not block a later count from being dated before it.
        eq(stockOpnameLinesTable.skipped, false),
      ),
    )
    .groupBy(stockOpnameLinesTable.product_id);
  for (const r of counted) keep(r.id, r.at);

  return out;
}

/** An open session's lines, each with the system stock at its counted_at. */
export async function linesWithSystem(q: Q, sessionId: number) {
  return q
    .select({
      product_id: stockOpnameLinesTable.product_id,
      counted: stockOpnameLinesTable.counted,
      skipped: stockOpnameLinesTable.skipped,
      reason: stockOpnameLinesTable.reason,
      counted_at: stockOpnameLinesTable.counted_at,
      counted_by: stockOpnameLinesTable.counted_by,
      unit_cost: stockOpnameLinesTable.unit_cost,
      system_qty: stockOpnameLinesTable.system_qty,
      delta: stockOpnameLinesTable.delta,
      product_name: productsTable.product_name,
      barcode: productsTable.barcode,
      buying_price: productsTable.buying_price,
      unit: productsTable.unit,
      track_stock: productsTable.track_stock,
      deleted_at: productsTable.deletedAt,
      stock: productsTable.stock,
      avg_cost: productsTable.avg_cost,
      after: movedAfter(
        col("stock_opname_lines", "product_id"),
        col("stock_opname_lines", "counted_at"),
      ),
    })
    .from(stockOpnameLinesTable)
    .innerJoin(productsTable, eq(productsTable.id, stockOpnameLinesTable.product_id))
    .where(eq(stockOpnameLinesTable.session_id, sessionId))
    .orderBy(productsTable.product_name);
}

export const round3 = (n: number) => +n.toFixed(3);

/**
 * Book one counted difference. Shared by the one-shot opname and a session's
 * finish, so the HPP rules cannot drift between them.
 *
 * `delta` is counted − system stock AT THE TIME OF THE COUNT; the caller works
 * that out. Everything about cost is decided against the product as it stands
 * now, because that is what postMovement applies the quantity and the average
 * to.
 *
 * `typedCost` is honoured only while the running average is still 0 — stock
 * that never came in through an invoice, so the ledger has nothing to value it
 * at. It can never overwrite an average the ledger computed itself.
 *
 * Returns whether anything was written.
 */
export async function postCount(
  tx: Tx,
  args: {
    outletId: number;
    product: { id: string; stock: string | number; avg_cost: string | number | null; unit: string };
    delta: number;
    typedCost?: number | null;
    note: string;
    createdAt?: Date;
  },
): Promise<boolean> {
  const { outletId, product, delta, note, createdAt } = args;
  const onHand = Number(product.stock) || 0;
  const avg = Number(product.avg_cost) || 0;
  const typed = Number(args.typedCost);
  const setsCost = avg === 0 && Number.isFinite(typed) && typed > 0;
  let touched = false;

  // Stock already on the shelf, valued at nothing. Say what it is worth
  // FIRST, so the count difference below is then valued at that same number
  // instead of at zero.
  if (setsCost && onHand > 0) {
    await postMovement(tx, {
      outletId,
      productId: product.id,
      qtyChange: 0,
      unitCost: typed,
      reason: "adjustment",
      note: `${note} · HPP awal ${Math.round(typed)}/${product.unit}`,
      createdAt,
    });
    touched = true;
  }

  // Valued at the running average in both directions: shrinkage is stock
  // worth what the rest of the shelf is worth, and a surplus found during a
  // count is stock that was always there, not a purchase. This posts the
  // DELTA rather than setting the count absolutely — same resulting quantity,
  // but it goes through the one ledger writer.
  //
  // The one exception is a surplus onto an EMPTY shelf priced at 0: the
  // revaluation above had nothing to revalue, so the incoming quantity has to
  // carry the cost itself.
  if (delta !== 0) {
    await postMovement(tx, {
      outletId,
      productId: product.id,
      qtyChange: delta,
      ...(setsCost && onHand <= 0 && delta > 0 ? { unitCost: typed } : {}),
      reason: "adjustment",
      note,
      createdAt,
    });
    touched = true;
  }

  return touched;
}
