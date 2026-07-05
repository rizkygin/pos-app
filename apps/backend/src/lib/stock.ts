import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { productsTable, recipeItemsTable, stockMovementsTable } from "../db/schema";

// Transaction client type (drizzle's tx has the same query builder as `db`).
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type SaleLine = {
  outletId: number;
  productId: string;
  qty: number;
  // The invoice that caused the movement; null for POS orders.
  invoiceId?: number;
  // Ledger note, e.g. "POS <orderId>". Recipe rows get the menu-item context
  // appended so the opname history explains why an ingredient dropped.
  note?: string;
};

// Record the stock OUT for one sold line, inside an open transaction.
// - track_stock products decrement their own stock (one 'sales' movement).
// - track_stock=false products with recipe rows decrement each ingredient by
//   recipe qty × sold qty instead (one movement per ingredient).
// - track_stock=false products without a recipe move nothing — recipes are
//   strictly opt-in; menu items without one are a valid permanent state.
// Overselling is allowed; returns "name: stok X, terjual Y" warnings so
// invoice posting can surface them without failing the sale.
export async function applySaleStockOut(tx: Tx, line: SaleLine): Promise<string[]> {
  const { outletId, productId, qty, invoiceId, note } = line;
  const warnings: string[] = [];

  const [p] = await tx
    .select({
      stock: productsTable.stock,
      name: productsTable.product_name,
      track_stock: productsTable.track_stock,
    })
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);
  if (!p) return warnings;

  if (p.track_stock) {
    if (Number(p.stock) < qty) warnings.push(`${p.name}: stok ${p.stock}, terjual ${qty}`);
    await tx.insert(stockMovementsTable).values({
      outlet_id: outletId,
      product_id: productId,
      qty_change: String(-qty), // negative = stock out
      reason: "sales",
      invoice_id: invoiceId ?? null,
      note: note ?? "",
    });
    await tx
      .update(productsTable)
      .set({ stock: sql`${productsTable.stock} - ${qty}::numeric` })
      .where(eq(productsTable.id, productId));
    return warnings;
  }

  // Menu item: expand its recipe (if any) into ingredient movements.
  const recipe = await tx
    .select({
      ingredient_id: recipeItemsTable.ingredient_id,
      per_unit: recipeItemsTable.qty,
      stock: productsTable.stock,
      name: productsTable.product_name,
    })
    .from(recipeItemsTable)
    .innerJoin(productsTable, eq(productsTable.id, recipeItemsTable.ingredient_id))
    .where(eq(recipeItemsTable.product_id, productId));

  for (const r of recipe) {
    // toFixed(3) matches the ledger's numeric scale and kills float noise
    // from e.g. 0.005 * 3.
    const consumed = (Number(r.per_unit) * qty).toFixed(3);
    if (Number(consumed) <= 0) continue;
    if (Number(r.stock) < Number(consumed)) {
      warnings.push(`${r.name}: stok ${r.stock}, terpakai ${consumed}`);
    }
    await tx.insert(stockMovementsTable).values({
      outlet_id: outletId,
      product_id: r.ingredient_id,
      qty_change: `-${consumed}`,
      reason: "sales",
      invoice_id: invoiceId ?? null,
      note: `${note ? `${note} · ` : ""}Resep: ${p.name} ×${qty}`.slice(0, 255),
    });
    await tx
      .update(productsTable)
      .set({ stock: sql`${productsTable.stock} - ${consumed}::numeric` })
      .where(eq(productsTable.id, r.ingredient_id));
  }
  return warnings;
}
