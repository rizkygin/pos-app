"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachOrderItems = attachOrderItems;
const db_1 = require("../../db");
const schema_1 = require("../../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
/**
 * Attach the lines of each order, with add-ons nested under the line they
 * belong to.
 *
 * `totalAmount` deliberately sums EVERY row, add-ons included: each row's
 * summary_price is what that product sold for, so the flat sum is the order
 * total. Summing only the parents would silently drop every add-on ever sold
 * from every screen that shows an order's value.
 *
 * Only `items` is nested, and only for display — the arithmetic stays flat.
 */
async function attachOrderItems(orders) {
    if (orders.length === 0)
        return [];
    const orderIds = orders.map((order) => order.orderId);
    const allItems = await db_1.db
        .select({
        id: schema_1.orderDetailsTable.id,
        parentDetailId: schema_1.orderDetailsTable.parent_detail_id,
        orderId: schema_1.orderDetailsTable.order_id,
        productName: schema_1.productsTable.product_name,
        quantity: schema_1.orderDetailsTable.quantity,
        noteProduct: schema_1.orderDetailsTable.note_product,
        summaryPrice: schema_1.orderDetailsTable.summary_price,
        lowestPrice: schema_1.productsTable.lowest_price,
        highestPrice: schema_1.productsTable.highest_price,
    })
        .from(schema_1.orderDetailsTable)
        .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, schema_1.productsTable.id))
        .where((0, drizzle_orm_1.inArray)(schema_1.orderDetailsTable.order_id, orderIds))
        // Ascending id means a parent is always seen before its own add-ons —
        // they are inserted immediately after it, in the same transaction — so
        // one pass is enough to nest them.
        .orderBy((0, drizzle_orm_1.asc)(schema_1.orderDetailsTable.id));
    const itemsByOrderId = new Map();
    const parentById = new Map();
    // Every row, flat, for the money. Kept separate from the nested view above
    // so the total can never drift from what the database holds.
    const rawByOrderId = new Map();
    for (const row of allItems) {
        const prices = rawByOrderId.get(row.orderId);
        if (prices)
            prices.push(row.summaryPrice);
        else
            rawByOrderId.set(row.orderId, [row.summaryPrice]);
        if (row.parentDetailId !== null) {
            // An add-on whose parent is in another order, or missing entirely,
            // cannot happen (the FK cascades) — but if it ever did, dropping it
            // from the nested view is better than crashing an order list.
            parentById.get(row.parentDetailId)?.addons.push({
                productName: row.productName,
                quantity: row.quantity,
                summaryPrice: row.summaryPrice,
            });
            continue;
        }
        const item = {
            productName: row.productName,
            quantity: row.quantity,
            noteProduct: row.noteProduct,
            summaryPrice: row.summaryPrice,
            lowestPrice: row.lowestPrice,
            highestPrice: row.highestPrice,
            addons: [],
        };
        parentById.set(row.id, item);
        const existing = itemsByOrderId.get(row.orderId);
        if (existing)
            existing.push(item);
        else
            itemsByOrderId.set(row.orderId, [item]);
    }
    return orders.map((order) => {
        const items = itemsByOrderId.get(order.orderId) ?? [];
        const totalAmount = (rawByOrderId.get(order.orderId) ?? []).reduce((sum, price) => sum + parseInt(price || "0"), 0);
        return { ...order, items, totalAmount };
    });
}
