import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { productsTable, stockMovementsTable } from "../db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type MovementReason = "purchase" | "sales" | "adjustment" | "void" | "production";

export type PostMovementArgs = {
  outletId: number;
  productId: string;
  // Signed, in the product's stock unit. Positive = in, negative = out.
  qtyChange: number;
  reason: MovementReason;
  // What one unit is worth for THIS movement.
  //
  // Required for stock coming IN from outside the system (a purchase's landed
  // price, a production batch's computed cost) — that price is the whole input
  // to the running average and cannot be derived.
  //
  // For stock going OUT, leave it undefined: the ledger values the outflow at
  // the current weighted average, which is the entire point of keeping one.
  // Pass it explicitly only to REVERSE a specific earlier movement at the cost
  // it actually carried (see the void paths), so a reversal returns the value it
  // took rather than today's average.
  unitCost?: number | null;
  invoiceId?: number | null;
  orderId?: string | null;
  // WHICH order line caused this. For a composition the movement is against an
  // INGREDIENT, so the product on the row is not the product that was sold —
  // this is the only link back to the line. lib/cogs.ts reads it to tell the
  // lines the ledger covers from the lines it structurally cannot, without
  // re-deriving that from product config that may have changed since.
  orderDetailId?: number | null;
  note?: string;
};

// The single writer for stock_movements. Every movement in the system goes
// through here — purchases, sales, opname, voids, production — so that the
// quantity ledger, the money ledger and both cached balances on `products` can
// never be updated by one caller and forgotten by another.
//
// Weighted average, maintained on the way IN:
//
//   new_avg = (on_hand * old_avg + qty_in * unit_cost) / (on_hand + qty_in)
//
// Outflows do not move the average, they consume at it. That is what makes a
// sale's recorded cost independent of every later price change: the number is
// resolved here, written to the row, and never recomputed.
//
// Returns what was actually booked, which the production path needs in order to
// price the batch it is about to create.
export async function postMovement(
  tx: Tx,
  args: PostMovementArgs,
): Promise<{ unitCost: number; costChange: number }> {
  const { outletId, productId, qtyChange, reason, invoiceId, orderId, orderDetailId, note } = args;

  // FOR UPDATE because avg_cost is a read-modify-write, unlike `stock`, which is
  // a self-referencing SQL increment and safe without a lock. Two concurrent
  // sales of the same product would otherwise both read the pre-sale average and
  // one would overwrite the other's blend. The lock is per product row and held
  // only for the rest of the caller's transaction.
  const [p] = await tx
    .select({ stock: productsTable.stock, avg_cost: productsTable.avg_cost })
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1)
    .for("update");
  if (!p) return { unitCost: 0, costChange: 0 };

  const onHand = Number(p.stock) || 0;
  const oldAvg = Number(p.avg_cost) || 0;

  // Explicit cost wins (a purchase price, a batch cost, a reversal at the
  // original cost). Otherwise the movement is valued at the running average.
  const effUnit =
    args.unitCost != null && Number.isFinite(Number(args.unitCost))
      ? Number(args.unitCost)
      : oldAvg;

  let newAvg = oldAvg;
  let reblend = false;
  if (qtyChange > 0) {
    // Stock coming in blends into the average. Weight by on-hand quantity,
    // floored at zero: a product oversold into negative stock has no value on
    // the shelf to average against, and a negative weight would produce a
    // nonsense (possibly negative) cost.
    const weight = Math.max(onHand, 0);
    const denom = weight + qtyChange;
    newAvg = denom > 0 ? (weight * oldAvg + qtyChange * effUnit) / denom : effUnit;
    reblend = true;
  } else if (qtyChange < 0 && args.unitCost != null) {
    // An outflow at an EXPLICIT cost is a reversal — undoing a specific earlier
    // movement at the price it carried. It has to pull that value back out of
    // the average too, or the average keeps value belonging to stock that is no
    // longer there: void a purchase of 10 @ 40.000 that landed on 3.000 units
    // worth nothing, and without this the shelf stays valued at 132/unit while
    // the ledger correctly nets to zero.
    //
    // An ordinary sale takes NO explicit cost, consumes at the average, and
    // leaves it untouched — which is already exactly consistent, since removing
    // stock at the average cannot change the average.
    const remaining = onHand + qtyChange; // qtyChange is negative
    newAvg = remaining > 0 ? (onHand * oldAvg + qtyChange * effUnit) / remaining : 0;
    if (newAvg < 0) newAvg = 0; // never let rounding drive the shelf negative
    reblend = true;
  }

  const costChange = Number((qtyChange * effUnit).toFixed(2));

  await tx.insert(stockMovementsTable).values({
    outlet_id: outletId,
    product_id: productId,
    qty_change: String(qtyChange),
    reason,
    invoice_id: invoiceId ?? null,
    order_id: orderId ?? null,
    order_detail_id: orderDetailId ?? null,
    note: note ?? "",
    unit_cost: effUnit.toFixed(4),
    cost_change: costChange.toFixed(2),
  });

  await tx
    .update(productsTable)
    .set({
      stock: sql`${productsTable.stock} + ${qtyChange}::numeric`,
      ...(reblend ? { avg_cost: newAvg.toFixed(4) } : {}),
    })
    .where(eq(productsTable.id, productId));

  return { unitCost: effUnit, costChange };
}

// The cost one unit of a product currently carries. Used to value an outflow
// before it is written — the production path needs it to total up what a batch
// consumed, and it is the same number postMovement would apply itself.
export async function currentUnitCost(tx: Tx, productId: string): Promise<number> {
  const [p] = await tx
    .select({ avg_cost: productsTable.avg_cost })
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);
  return Number(p?.avg_cost) || 0;
}
