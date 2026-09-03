"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecipeGraphError = void 0;
exports.findRecipeCycle = findRecipeCycle;
exports.applySaleStockOut = applySaleStockOut;
exports.applyOrderStockReturn = applyOrderStockReturn;
exports.applySaleStockReturn = applySaleStockReturn;
exports.previewProduction = previewProduction;
exports.applyProduction = applyProduction;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const cost_1 = require("./cost");
// How deep a recipe may nest. Recipes are rejected at write time above this
// (routes/products.ts), so hitting it here means the data is already bad.
const MAX_RECIPE_DEPTH = 5;
// Thrown by findRecipeCycle's caller to roll a recipe save back with a message
// the product form can show as-is.
class RecipeGraphError extends Error {
}
exports.RecipeGraphError = RecipeGraphError;
// Validate the recipe graph reachable from `productId`, and describe the first
// problem found — a cycle, or nesting deeper than MAX_RECIPE_DEPTH.
//
// Meant to run INSIDE the transaction that just wrote the rows, so it sees the
// graph as it would actually be committed. Returns null when the graph is fine.
//
// One recursive CTE rather than a walk in JS: the recursion is the database's
// job, it is a single round trip regardless of depth, and it cannot disagree
// with itself the way two hand-written traversals eventually would.
async function findRecipeCycle(tx, productId) {
    const res = await tx.execute((0, drizzle_orm_1.sql) `
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
    const row = res.rows?.[0]
        ?? (Array.isArray(res) ? res[0] : undefined);
    if (!row)
        return null;
    const trail = String(row.trail ?? "");
    return row.looped
        ? `Resep berputar: ${trail}. Sebuah bahan tidak boleh memakai produk yang memakainya.`
        : `Resep terlalu dalam (maksimal ${MAX_RECIPE_DEPTH} tingkat): ${trail}.`;
}
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
//
// `mode` decides where the walk stops, and the two modes answer different
// questions:
//
//   "ledger" (default) — stop at track_stock. What a sale ACTUALLY deducts, and
//     therefore what it actually costs: an Espresso that is produced in batches
//     is taken at its own average, not re-expanded into beans. Every write path
//     uses this; changing it would change what sales and cancellations move.
//
//   "raw" — keep descending while the ingredient has a recipe at all, stopping
//     only at things nothing is made from. Answers "what raw materials does one
//     of these consume", which is a planning question, not a bookkeeping one.
//     Read-only callers only (the HPP calculator).
//
// They agree exactly when every intermediate's avg_cost equals what its recipe
// costs today, and diverge when a batch was made at old prices — which is the
// honest difference between "what it cost" and "what it would cost".
async function expandRecipe(tx, productId, qty, 
// Product ids on the current path, used to refuse cycles.
path = [], 
// Display names of the composites walked through, nearest-first.
via = [], into = new Map(), mode = "ledger") {
    if (path.includes(productId)) {
        throw new Error(`RECIPE_CYCLE: ${[...path, productId].join(" -> ")}`);
    }
    if (path.length >= MAX_RECIPE_DEPTH) {
        throw new Error(`RECIPE_TOO_DEEP: ${[...path, productId].join(" -> ")}`);
    }
    const ingredient = schema_1.productsTable;
    const rows = await tx
        .select({
        ingredient_id: schema_1.recipeItemsTable.ingredient_id,
        per_unit: schema_1.recipeItemsTable.qty,
        stock: ingredient.stock,
        name: ingredient.product_name,
        track_stock: ingredient.track_stock,
        // Only consulted in "raw" mode, where having a recipe — not holding
        // stock — is what makes something worth descending into.
        has_recipe: (0, drizzle_orm_1.sql) `exists (
        select 1 from recipe_items r2 where r2.product_id = ${schema_1.recipeItemsTable.ingredient_id}
      )`,
    })
        .from(schema_1.recipeItemsTable)
        .innerJoin(ingredient, (0, drizzle_orm_1.eq)(ingredient.id, schema_1.recipeItemsTable.ingredient_id))
        .where((0, drizzle_orm_1.eq)(schema_1.recipeItemsTable.product_id, productId));
    for (const r of rows) {
        const consumed = Number(r.per_unit) * qty;
        if (!Number.isFinite(consumed) || consumed <= 0)
            continue;
        const descend = mode === "raw" ? r.has_recipe : !r.track_stock;
        if (descend) {
            // Pass-through composite: it holds no stock of its own, so nothing moves
            // here — keep walking down to the things that do. (In "raw" mode the same
            // step is taken for anything made from something else, tracked or not.)
            await expandRecipe(tx, r.ingredient_id, consumed, [...path, productId], [...via, r.name], into, mode);
            continue;
        }
        const existing = into.get(r.ingredient_id);
        if (existing) {
            existing.qty += consumed;
        }
        else {
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
function leafNote(note, rootName, qty, via) {
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
async function applySaleStockOut(tx, line) {
    const { outletId, productId, qty, invoiceId, orderId, orderDetailId, note } = line;
    const warnings = [];
    const [p] = await tx
        .select({
        stock: schema_1.productsTable.stock,
        name: schema_1.productsTable.product_name,
        track_stock: schema_1.productsTable.track_stock,
    })
        .from(schema_1.productsTable)
        .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, productId))
        .limit(1);
    if (!p)
        return warnings;
    if (p.track_stock) {
        if (Number(p.stock) < qty)
            warnings.push(`${p.name}: stok ${p.stock}, terjual ${qty}`);
        // No unitCost: a sale is valued at the running average (see lib/cost.ts).
        await (0, cost_1.postMovement)(tx, {
            outletId,
            productId,
            qtyChange: -qty, // negative = stock out
            reason: "sales",
            invoiceId,
            orderId,
            orderDetailId,
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
        if (Number(consumed) <= 0)
            continue;
        if (Number(leaf.stock) < Number(consumed)) {
            warnings.push(`${leaf.name}: stok ${leaf.stock}, terpakai ${consumed}`);
        }
        await (0, cost_1.postMovement)(tx, {
            outletId,
            productId: leaf.product_id,
            qtyChange: -Number(consumed),
            reason: "sales",
            invoiceId,
            orderId,
            // The leaf is beras; the LINE is Nasi Goreng. Tagging the line is what
            // makes this movement's cost attributable to the thing that was sold.
            orderDetailId,
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
async function applyOrderStockReturn(tx, args) {
    const { outletId, orderId, note } = args;
    const moves = await tx
        .select({
        product_id: schema_1.stockMovementsTable.product_id,
        qty_change: schema_1.stockMovementsTable.qty_change,
        unit_cost: schema_1.stockMovementsTable.unit_cost,
        order_detail_id: schema_1.stockMovementsTable.order_detail_id,
        note: schema_1.stockMovementsTable.note,
    })
        .from(schema_1.stockMovementsTable)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.stockMovementsTable.order_id, orderId), (0, drizzle_orm_1.eq)(schema_1.stockMovementsTable.reason, "sales")));
    if (!moves.length)
        return false;
    for (const m of moves) {
        await (0, cost_1.postMovement)(tx, {
            outletId,
            productId: m.product_id,
            qtyChange: -Number(m.qty_change), // reverse the OUT (back IN)
            reason: "void",
            orderId,
            // Return the value the sale actually took, not today's average — the same
            // reason this path replays quantities instead of re-deriving them. Null on
            // pre-0063 rows, where postMovement falls back to the average.
            unitCost: m.unit_cost != null ? Number(m.unit_cost) : null,
            // Carried from the row being reversed, not re-derived: the void has to
            // land on the SAME line as the sale it undoes, or that line's ledger
            // rows stop netting to zero and lib/cogs.ts reports a cost for goods
            // that came back. Null on pre-0066 rows, which is correct — those orders
            // are read by the pre-0066 expression anyway.
            orderDetailId: m.order_detail_id,
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
async function applySaleStockReturn(tx, line) {
    const { outletId, productId, qty, invoiceId, orderId, orderDetailId, note } = line;
    const [p] = await tx
        .select({
        name: schema_1.productsTable.product_name,
        track_stock: schema_1.productsTable.track_stock,
    })
        .from(schema_1.productsTable)
        .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, productId))
        .limit(1);
    if (!p)
        return;
    if (p.track_stock) {
        await (0, cost_1.postMovement)(tx, {
            outletId,
            productId,
            qtyChange: qty, // positive = stock back in
            reason: "void",
            invoiceId,
            orderId,
            orderDetailId,
            note: note ?? "",
        });
        return;
    }
    // Menu item: put back each leaf the recipe consumed, as the recipe stands NOW.
    const leaves = await expandRecipe(tx, productId, qty);
    for (const leaf of leaves) {
        const restored = leaf.qty.toFixed(3);
        if (Number(restored) <= 0)
            continue;
        await (0, cost_1.postMovement)(tx, {
            outletId,
            productId: leaf.product_id,
            qtyChange: Number(restored),
            reason: "void",
            invoiceId,
            orderId,
            orderDetailId,
            note: leafNote(note, p.name, qty, leaf.via),
        });
    }
}
// What a production run WOULD consume, without writing anything.
//
// Same expandRecipe the real run uses, so the preview cannot describe a
// different batch than the one applyProduction is about to book — the failure
// mode of a hand-written second expansion is that it drifts from the first and
// quietly lies about cost.
//
// Prices each leaf at its CURRENT average, which is exactly what the real run
// will pay (postMovement values an ordinary outflow at the running average). The
// two can only disagree if stock moves in between, which is the same race any
// preview has and is why nothing here is authoritative until it is booked.
async function previewProduction(tx, line) {
    const { productId, qty } = line;
    const leaves = await expandRecipe(tx, productId, qty, [], [], new Map(), line.mode ?? "ledger");
    const items = [];
    let totalCost = 0;
    for (const leaf of leaves) {
        // toFixed(3) here for the same reason the write path does it: the preview
        // must round where the real run rounds, or it shows a cost the batch will
        // not actually have.
        const consumed = Number(leaf.qty.toFixed(3));
        if (consumed <= 0)
            continue;
        const unitCost = await (0, cost_1.currentUnitCost)(tx, leaf.product_id);
        const cost = Number((consumed * unitCost).toFixed(2));
        totalCost += cost;
        items.push({
            product_id: leaf.product_id,
            name: leaf.name,
            qty: consumed,
            stock: Number(leaf.stock),
            unit_cost: unitCost,
            cost,
            via: leaf.via,
            // Shown, never blocking — the same stance applyProduction takes. The food
            // gets cooked whether or not the books agree.
            short: Number(leaf.stock) < consumed,
        });
    }
    return { items, totalCost: Number(totalCost.toFixed(2)) };
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
async function applyProduction(tx, line) {
    const { outletId, productId, qty, note } = line;
    const warnings = [];
    const [p] = await tx
        .select({
        name: schema_1.productsTable.product_name,
        track_stock: schema_1.productsTable.track_stock,
        outlet_id: schema_1.productsTable.outlet_id,
    })
        .from(schema_1.productsTable)
        .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, productId))
        .limit(1);
    if (!p)
        throw new Error("PRODUCT_NOT_FOUND");
    if (p.outlet_id !== outletId)
        throw new Error("PRODUCT_NOT_FOUND");
    // A product with no stock of its own has nowhere to put the batch.
    if (!p.track_stock)
        throw new Error("NOT_STOCKED");
    const leaves = await expandRecipe(tx, productId, qty);
    if (!leaves.length)
        throw new Error("NO_RECIPE");
    const label = `${note ? `${note} · ` : ""}Produksi: ${p.name} ×${qty}`.slice(0, 255);
    // Production is the one place in the system where cost is CREATED rather than
    // carried: the batch has no purchase price, so what it is worth is exactly the
    // sum of what went into it. Total the outflows, then price the batch with it.
    let batchCost = 0;
    for (const leaf of leaves) {
        const consumed = leaf.qty.toFixed(3);
        if (Number(consumed) <= 0)
            continue;
        if (Number(leaf.stock) < Number(consumed)) {
            warnings.push(`${leaf.name}: stok ${leaf.stock}, terpakai ${consumed}`);
        }
        const { costChange } = await (0, cost_1.postMovement)(tx, {
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
    await (0, cost_1.postMovement)(tx, {
        outletId,
        productId,
        qtyChange: qty,
        reason: "production",
        unitCost: qty > 0 ? batchCost / qty : 0,
        note: label,
    });
    return warnings;
}
