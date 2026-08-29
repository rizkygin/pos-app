import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { productsTable, recipeItemsTable, stockMovementsTable } from "../db/schema";
import { currentUnitCost, postMovement } from "./cost";

// Transaction client type (drizzle's tx has the same query builder as `db`).
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type SaleLine = {
  outletId: number;
  productId: string;
  qty: number;
  // The invoice that caused the movement; null for POS orders.
  invoiceId?: number;
  // The POS order that caused it; null for invoices. Recorded so a cancellation
  // can replay these exact rows instead of re-deriving them.
  orderId?: string;
  // Ledger note, e.g. "POS <orderId>". Recipe rows get the menu-item context
  // appended so the opname history explains why an ingredient dropped.
  note?: string;
};

// How deep a recipe may nest. Recipes are rejected at write time above this
// (routes/products.ts), so hitting it here means the data is already bad.
const MAX_RECIPE_DEPTH = 5;

// Thrown by findRecipeCycle's caller to roll a recipe save back with a message
// the product form can show as-is.
export class RecipeGraphError extends Error {}

// Validate the recipe graph reachable from `productId`, and describe the first
// problem found — a cycle, or nesting deeper than MAX_RECIPE_DEPTH.
//
// Meant to run INSIDE the transaction that just wrote the rows, so it sees the
// graph as it would actually be committed. Returns null when the graph is fine.
//
// One recursive CTE rather than a walk in JS: the recursion is the database's
// job, it is a single round trip regardless of depth, and it cannot disagree
// with itself the way two hand-written traversals eventually would.
export async function findRecipeCycle(tx: Tx, productId: string): Promise<string | null> {
  const res = await tx.execute(sql`
    WITH RECURSIVE walk AS (
      SELECT
        ri.ingredient_id                     AS node,
        ARRAY[ri.product_id, ri.ingredient_id] AS path,
        1                                    AS depth,
        ri.ingredient_id = ${productId}      AS looped
      FROM recipe_items ri
      WHERE ri.product_id = ${productId}

      UNION ALL

      SELECT
        ri.ingredient_id,
        w.path || ri.ingredient_id,
        w.depth + 1,
        ri.ingredient_id = ANY(w.path)
      FROM recipe_items ri
      JOIN walk w ON ri.product_id = w.node
      -- Stop descending a branch the moment it repeats a node, otherwise the
      -- CTE would loop forever on exactly the data we are here to detect.
      WHERE NOT w.looped AND w.depth < ${MAX_RECIPE_DEPTH + 1}
    )
    SELECT w.looped, w.depth, (
      SELECT string_agg(p.product_name, ' → ' ORDER BY i.ord)
      FROM unnest(w.path) WITH ORDINALITY AS i(id, ord)
      JOIN products p ON p.id = i.id
    ) AS trail
    FROM walk w
    WHERE w.looped OR w.depth > ${MAX_RECIPE_DEPTH}
    LIMIT 1
  `);

  const row = (res as unknown as { rows?: Record<string, unknown>[] }).rows?.[0]
    ?? (Array.isArray(res) ? (res[0] as Record<string, unknown>) : undefined);
  if (!row) return null;

  const trail = String(row.trail ?? "");
  return row.looped
    ? `Resep berputar: ${trail}. Sebuah bahan tidak boleh memakai produk yang memakainya.`
    : `Resep terlalu dalam (maksimal ${MAX_RECIPE_DEPTH} tingkat): ${trail}.`;
}

// One resolved leaf of an expanded recipe: a product that tracks its own stock
// and therefore actually moves.
type Leaf = {
  product_id: string;
  name: string;
  stock: string;
  // Total consumed for the whole expansion, already multiplied out.
  qty: number;
  // Human trail of the composites passed through to reach this leaf, nearest
  // first — e.g. ["Sambal", "Bumbu Dasar"]. Empty for a direct ingredient.
  via: string[];
};

// Walk a product's recipe down to the products that actually hold stock.
//
// The rule at every edge is the same, and it is the whole design: an ingredient
// that TRACKS ITS OWN STOCK is a leaf — decrement it and stop, because someone
// counts that thing and its own ingredients left stock when it was produced. An
// ingredient that does not track stock is a pass-through, so recurse into it.
//
// Returns leaves AGGREGATED by product id. Two branches that both reach garlic
// must come out as one row: otherwise the same product would take two UPDATEs
// (and two row locks) in one transaction, and the shortfall warning would
// compare each half against the full on-hand quantity and under-report.
//
// Quantities multiply along the path in float and are rounded ONCE, by the
// caller, at write time. Rounding at every level compounds badly at the
// 0.005-per-portion scale these recipes are actually written in.
async function expandRecipe(
  tx: Tx,
  productId: string,
  qty: number,
  // Product ids on the current path, used to refuse cycles.
  path: string[] = [],
  // Display names of the composites walked through, nearest-first.
  via: string[] = [],
  into: Map<string, Leaf> = new Map(),
): Promise<Leaf[]> {
  if (path.includes(productId)) {
    throw new Error(`RECIPE_CYCLE: ${[...path, productId].join(" -> ")}`);
  }
  if (path.length >= MAX_RECIPE_DEPTH) {
    throw new Error(`RECIPE_TOO_DEEP: ${[...path, productId].join(" -> ")}`);
  }

  const ingredient = productsTable;
  const rows = await tx
    .select({
      ingredient_id: recipeItemsTable.ingredient_id,
      per_unit: recipeItemsTable.qty,
      stock: ingredient.stock,
      name: ingredient.product_name,
      track_stock: ingredient.track_stock,
    })
    .from(recipeItemsTable)
    .innerJoin(ingredient, eq(ingredient.id, recipeItemsTable.ingredient_id))
    .where(eq(recipeItemsTable.product_id, productId));

  for (const r of rows) {
    const consumed = Number(r.per_unit) * qty;
    if (!Number.isFinite(consumed) || consumed <= 0) continue;

    if (!r.track_stock) {
      // Pass-through composite: it holds no stock of its own, so nothing moves
      // here — keep walking down to the things that do.
      await expandRecipe(
        tx,
        r.ingredient_id,
        consumed,
        [...path, productId],
        [...via, r.name],
        into,
      );
      continue;
    }

    const existing = into.get(r.ingredient_id);
    if (existing) {
      existing.qty += consumed;
    } else {
      into.set(r.ingredient_id, {
        product_id: r.ingredient_id,
        name: r.name,
        stock: r.stock,
        qty: consumed,
        via,
      });
    }
  }

  return [...into.values()];
}

// Build the ledger note for one leaf: what was sold, and what it came through.
function leafNote(note: string | undefined, rootName: string, qty: number, via: string[]): string {
  const trail = via.length ? ` (via ${via.join(" › ")})` : "";
  return `${note ? `${note} · ` : ""}Resep: ${rootName} ×${qty}${trail}`.slice(0, 255);
}

// Record the stock OUT for one sold line, inside an open transaction.
// - track_stock products decrement their own stock (one 'sales' movement).
//   This includes an in-house intermediate: selling it draws the batch down,
//   it does not re-consume the batch's ingredients.
// - track_stock=false products expand their recipe (see expandRecipe) and
//   decrement each resolved leaf instead, one movement per leaf.
// - track_stock=false products without a recipe move nothing — recipes are
//   strictly opt-in; menu items without one are a valid permanent state.
// Overselling is allowed; returns "name: stok X, terjual Y" warnings so
// invoice posting can surface them without failing the sale.
export async function applySaleStockOut(tx: Tx, line: SaleLine): Promise<string[]> {
  const { outletId, productId, qty, invoiceId, orderId, note } = line;
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
    // No unitCost: a sale is valued at the running average (see lib/cost.ts).
    await postMovement(tx, {
      outletId,
      productId,
      qtyChange: -qty, // negative = stock out
      reason: "sales",
      invoiceId,
      orderId,
      note: note ?? "",
    });
    return warnings;
  }

  // Menu item: expand its recipe (if any) into leaf movements.
  const leaves = await expandRecipe(tx, productId, qty);

  for (const leaf of leaves) {
    // toFixed(3) matches the ledger's numeric scale and kills float noise from
    // e.g. 0.005 * 3. Done once, on the fully multiplied-out total.
    const consumed = leaf.qty.toFixed(3);
    if (Number(consumed) <= 0) continue;
    if (Number(leaf.stock) < Number(consumed)) {
      warnings.push(`${leaf.name}: stok ${leaf.stock}, terpakai ${consumed}`);
    }
    await postMovement(tx, {
      outletId,
      productId: leaf.product_id,
      qtyChange: -Number(consumed),
      reason: "sales",
      invoiceId,
      orderId,
      note: leafNote(note, p.name, qty, leaf.via),
    });
  }
  return warnings;
}

// Undo the stock OUT of a whole cancelled POS order by REPLAYING ITS LEDGER:
// read back the 'sales' movements the order actually wrote and flip each one.
//
// Exact by construction — it returns what left, not what a recipe says would
// leave today. That distinction is minor for a flat recipe and serious for a
// nested one, where an edit three levels down would otherwise silently change
// how much a cancellation puts back. It mirrors how invoice void already works
// (routes/invoices.ts), and it is order-scoped rather than line-scoped because a
// menu item's movements are written against its INGREDIENTS, not against
// itself: there is no reliable way to attribute one such row back to one line.
//
// Returns false when the order has no replayable movements — i.e. it was placed
// before migration 0062 added stock_movements.order_id. The caller then falls
// back to per-line applySaleStockReturn.
//
// The movements are added, never deleted. A cancelled sale is a thing that
// happened — the ledger should read "sold 3, then voided 3", because the stock
// physically left the shelf and came back, and an opname done between the two
// would have counted it gone. Deleting the original row would make the ledger
// disagree with anyone who counted.
export async function applyOrderStockReturn(
  tx: Tx,
  args: { outletId: number; orderId: string; note?: string },
): Promise<boolean> {
  const { outletId, orderId, note } = args;

  const moves = await tx
    .select({
      product_id: stockMovementsTable.product_id,
      qty_change: stockMovementsTable.qty_change,
      unit_cost: stockMovementsTable.unit_cost,
      note: stockMovementsTable.note,
    })
    .from(stockMovementsTable)
    .where(
      and(
        eq(stockMovementsTable.order_id, orderId),
        eq(stockMovementsTable.reason, "sales"),
      ),
    );
  if (!moves.length) return false;

  for (const m of moves) {
    await postMovement(tx, {
      outletId,
      productId: m.product_id,
      qtyChange: -Number(m.qty_change), // reverse the OUT (back IN)
      reason: "void",
      orderId,
      // Return the value the sale actually took, not today's average — the same
      // reason this path replays quantities instead of re-deriving them. Null on
      // pre-0063 rows, where postMovement falls back to the average.
      unitCost: m.unit_cost != null ? Number(m.unit_cost) : null,
      // Keep the sale's own trail ("Resep: Nasi Goreng ×2 (via Sambal)") so the
      // opname history still explains which dish put this back.
      note: `${note ? `${note} · ` : ""}${m.note ?? ""}`.slice(0, 255),
    });
  }
  return true;
}

// Undo the stock OUT of one sold line by re-deriving it: the mirror of
// applySaleStockOut, same branches, same quantities, opposite sign, 'void'.
//
// This is the FALLBACK for orders that predate stock_movements.order_id and so
// cannot be replayed; prefer applyOrderStockReturn above. It reads the recipe as
// it stands NOW, not as it stood at sale time, so amounts can disagree with what
// was taken if the recipe changed in between.
//
// Deliberately returns no warnings: overselling is a concern when stock leaves,
// not when it returns.
export async function applySaleStockReturn(tx: Tx, line: SaleLine): Promise<void> {
  const { outletId, productId, qty, invoiceId, orderId, note } = line;

  const [p] = await tx
    .select({
      name: productsTable.product_name,
      track_stock: productsTable.track_stock,
    })
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);
  if (!p) return;

  if (p.track_stock) {
    await postMovement(tx, {
      outletId,
      productId,
      qtyChange: qty, // positive = stock back in
      reason: "void",
      invoiceId,
      orderId,
      note: note ?? "",
    });
    return;
  }

  // Menu item: put back each leaf the recipe consumed, as the recipe stands NOW.
  const leaves = await expandRecipe(tx, productId, qty);

  for (const leaf of leaves) {
    const restored = leaf.qty.toFixed(3);
    if (Number(restored) <= 0) continue;
    await postMovement(tx, {
      outletId,
      productId: leaf.product_id,
      qtyChange: Number(restored),
      reason: "void",
      invoiceId,
      orderId,
      note: leafNote(note, p.name, qty, leaf.via),
    });
  }
}

// ── Production batches ──────────────────────────────────────────────────────
// Making an in-house intermediate: its ingredients go OUT, the intermediate
// itself comes IN. This is what puts stock on a product that both tracks stock
// and has a recipe — the boundary expandRecipe stops at.
//
// `qty` is in the product's OWN stock unit (2.5 kg of sambal), not in batches.
// products.yield_qty is only the form's default for that number, so nothing
// here has to know what a "batch" is.
//
// Like sales, this is allowed to drive an ingredient negative and reports it
// rather than refusing: the food was cooked whether or not the books agree.
export async function applyProduction(
  tx: Tx,
  line: { outletId: number; productId: string; qty: number; note?: string },
): Promise<string[]> {
  const { outletId, productId, qty, note } = line;
  const warnings: string[] = [];

  const [p] = await tx
    .select({
      name: productsTable.product_name,
      track_stock: productsTable.track_stock,
      outlet_id: productsTable.outlet_id,
    })
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);
  if (!p) throw new Error("PRODUCT_NOT_FOUND");
  if (p.outlet_id !== outletId) throw new Error("PRODUCT_NOT_FOUND");
  // A product with no stock of its own has nowhere to put the batch.
  if (!p.track_stock) throw new Error("NOT_STOCKED");

  const leaves = await expandRecipe(tx, productId, qty);
  if (!leaves.length) throw new Error("NO_RECIPE");

  const label = `${note ? `${note} · ` : ""}Produksi: ${p.name} ×${qty}`.slice(0, 255);

  // Production is the one place in the system where cost is CREATED rather than
  // carried: the batch has no purchase price, so what it is worth is exactly the
  // sum of what went into it. Total the outflows, then price the batch with it.
  let batchCost = 0;
  for (const leaf of leaves) {
    const consumed = leaf.qty.toFixed(3);
    if (Number(consumed) <= 0) continue;
    if (Number(leaf.stock) < Number(consumed)) {
      warnings.push(`${leaf.name}: stok ${leaf.stock}, terpakai ${consumed}`);
    }
    const { costChange } = await postMovement(tx, {
      outletId,
      productId: leaf.product_id,
      qtyChange: -Number(consumed),
      reason: "production",
      note: label,
    });
    batchCost += -costChange; // costChange is negative on the way out
  }

  // ...and the batch itself comes in, priced at what it cost to make. Dividing
  // by qty rather than by yield_qty is deliberate: qty is what was actually
  // made, yield_qty is only the form's default. A short batch costs more per
  // unit, and that is the truth the ledger should record.
  //
  // Blending (rather than overwriting) happens inside postMovement, so a new
  // batch joining stock left over from an older, cheaper one lands on the
  // weighted average of the two instead of jumping to the newest price.
  await postMovement(tx, {
    outletId,
    productId,
    qtyChange: qty,
    reason: "production",
    unitCost: qty > 0 ? batchCost / qty : 0,
    note: label,
  });

  return warnings;
}
