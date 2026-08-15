"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachOrderItems = attachOrderItems;
const db_1 = require("../../db");
const schema_1 = require("../../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
async function attachOrderItems(orders) {
    if (orders.length === 0)
        return [];
    const orderIds = orders.map((order) => order.orderId);
    const allItems = await db_1.db
        .select({
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
        .where((0, drizzle_orm_1.inArray)(schema_1.orderDetailsTable.order_id, orderIds));
    const itemsByOrderId = new Map();
    for (const { orderId, ...item } of allItems) {
        const existing = itemsByOrderId.get(orderId);
        if (existing)
            existing.push(item);
        else
            itemsByOrderId.set(orderId, [item]);
    }
    return orders.map((order) => {
        const items = itemsByOrderId.get(order.orderId) ?? [];
        const totalAmount = items.reduce((sum, item) => sum + parseInt(item.summaryPrice || "0"), 0);
        return { ...order, items, totalAmount };
    });
}
