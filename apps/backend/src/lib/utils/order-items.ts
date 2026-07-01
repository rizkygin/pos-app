import { db } from "../../db";
import { orderDetailsTable, productsTable } from "../../db/schema";
import { eq, inArray } from "drizzle-orm";

type OrderItem = {
    productName: string;
    quantity: number;
    noteProduct: string | null;
    summaryPrice: string;
    // Service products carry a negotiable price range (null for normal products).
    lowestPrice: string | null;
    highestPrice: string | null;
};

export async function attachOrderItems<T extends { orderId: string }>(
    orders: T[]
): Promise<(T & { items: OrderItem[]; totalAmount: number })[]> {
    if (orders.length === 0) return [];

    const orderIds = orders.map((order) => order.orderId);

    const allItems = await db
        .select({
            orderId: orderDetailsTable.order_id,
            productName: productsTable.product_name,
            quantity: orderDetailsTable.quantity,
            noteProduct: orderDetailsTable.note_product,
            summaryPrice: orderDetailsTable.summary_price,
            lowestPrice: productsTable.lowest_price,
            highestPrice: productsTable.highest_price,
        })
        .from(orderDetailsTable)
        .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
        .where(inArray(orderDetailsTable.order_id, orderIds));

    const itemsByOrderId = new Map<string, OrderItem[]>();
    for (const { orderId, ...item } of allItems) {
        const existing = itemsByOrderId.get(orderId);
        if (existing) existing.push(item);
        else itemsByOrderId.set(orderId, [item]);
    }

    return orders.map((order) => {
        const items = itemsByOrderId.get(order.orderId) ?? [];
        const totalAmount = items.reduce((sum, item) => sum + parseInt(item.summaryPrice || "0"), 0);
        return { ...order, items, totalAmount };
    });
}
