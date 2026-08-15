"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applySaleStockOut = applySaleStockOut;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
// Record the stock OUT for one sold line, inside an open transaction.
// - track_stock products decrement their own stock (one 'sales' movement).
// - track_stock=false products with recipe rows decrement each ingredient by
//   recipe qty × sold qty instead (one movement per ingredient).
// - track_stock=false products without a recipe move nothing — recipes are
//   strictly opt-in; menu items without one are a valid permanent state.
// Overselling is allowed; returns "name: stok X, terjual Y" warnings so
// invoice posting can surface them without failing the sale.
async function applySaleStockOut(tx, line) {
    const { outletId, productId, qty, invoiceId, note } = line;
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
        await tx.insert(schema_1.stockMovementsTable).values({
            outlet_id: outletId,
            product_id: productId,
            qty_change: String(-qty), // negative = stock out
            reason: "sales",
            invoice_id: invoiceId ?? null,
            note: note ?? "",
        });
        await tx
            .update(schema_1.productsTable)
            .set({ stock: (0, drizzle_orm_1.sql) `${schema_1.productsTable.stock} - ${qty}::numeric` })
            .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, productId));
        return warnings;
    }
    // Menu item: expand its recipe (if any) into ingredient movements.
    const recipe = await tx
        .select({
        ingredient_id: schema_1.recipeItemsTable.ingredient_id,
        per_unit: schema_1.recipeItemsTable.qty,
        stock: schema_1.productsTable.stock,
        name: schema_1.productsTable.product_name,
    })
        .from(schema_1.recipeItemsTable)
        .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.productsTable.id, schema_1.recipeItemsTable.ingredient_id))
        .where((0, drizzle_orm_1.eq)(schema_1.recipeItemsTable.product_id, productId));
    for (const r of recipe) {
        // toFixed(3) matches the ledger's numeric scale and kills float noise
        // from e.g. 0.005 * 3.
        const consumed = (Number(r.per_unit) * qty).toFixed(3);
        if (Number(consumed) <= 0)
            continue;
        if (Number(r.stock) < Number(consumed)) {
            warnings.push(`${r.name}: stok ${r.stock}, terpakai ${consumed}`);
        }
        await tx.insert(schema_1.stockMovementsTable).values({
            outlet_id: outletId,
            product_id: r.ingredient_id,
            qty_change: `-${consumed}`,
            reason: "sales",
            invoice_id: invoiceId ?? null,
            note: `${note ? `${note} · ` : ""}Resep: ${p.name} ×${qty}`.slice(0, 255),
        });
        await tx
            .update(schema_1.productsTable)
            .set({ stock: (0, drizzle_orm_1.sql) `${schema_1.productsTable.stock} - ${consumed}::numeric` })
            .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, r.ingredient_id));
    }
    return warnings;
}
