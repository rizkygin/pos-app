import { db } from "../../db";
import { orderDetailsTable, productsTable } from "../../db/schema";
import { asc, eq, inArray } from "drizzle-orm";

export type OrderItemAddon = {
    productName: string;
    quantity: number;
    summaryPrice: string;
};

type OrderItem = {
    productName: string;
    quantity: number;
    noteProduct: string | null;
    summaryPrice: string;
    // Service products carry a negotiable price range (null for normal products).
    lowestPrice: string | null;
    highestPrice: string | null;
    /**
     * Add-ons chosen for this line ("Telur", "Extra Pedas"). Their prices are
     * NOT folded into summaryPrice above — each carries its own, exactly as it
     * sits in the database, so a caller can render the breakdown the customer
     * was charged. See migration 0069.
     */
    addons: OrderItemAddon[];
};

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
export async function attachOrderItems<T extends { orderId: string }>(
    orders: T[]
): Promise<(T & { items: OrderItem[]; totalAmount: number })[]> {
    if (orders.length === 0) return [];

    const orderIds = orders.map((order) => order.orderId);

    const allItems = await db
        .select({
            id: orderDetailsTable.id,
            parentDetailId: orderDetailsTable.parent_detail_id,
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
        .where(inArray(orderDetailsTable.order_id, orderIds))
        // Ascending id means a parent is always seen before its own add-ons —
        // they are inserted immediately after it, in the same transaction — so
        // one pass is enough to nest them.
        .orderBy(asc(orderDetailsTable.id));

    const itemsByOrderId = new Map<string, OrderItem[]>();
    const parentById = new Map<number, OrderItem>();
    // Every row, flat, for the money. Kept separate from the nested view above
    // so the total can never drift from what the database holds.
    const rawByOrderId = new Map<string, string[]>();

    for (const row of allItems) {
        const prices = rawByOrderId.get(row.orderId);
        if (prices) prices.push(row.summaryPrice);
        else rawByOrderId.set(row.orderId, [row.summaryPrice]);

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

        const item: OrderItem = {
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
        if (existing) existing.push(item);
        else itemsByOrderId.set(row.orderId, [item]);
    }

    return orders.map((order) => {
        const items = itemsByOrderId.get(order.orderId) ?? [];
        const totalAmount = (rawByOrderId.get(order.orderId) ?? []).reduce(
            (sum, price) => sum + parseInt(price || "0"),
            0
        );
        return { ...order, items, totalAmount };
    });
}
