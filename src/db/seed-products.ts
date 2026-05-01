import { auth } from "@/lib/auth";
import { db } from "./index";
import { customersTable, outletsTable, couriersTable, productsTable } from "./schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

const main = async () => {
    // Load env variables
    const user_id = 'OCIaQgj9gTxz7yRpZ7LveZy0YPfdq6Qj';
    await addProductstoOutlets(user_id);
}

const addProductstoOutlets = async (user_id: string) => {
    const outlet = await db.query.outletsTable.findFirst({ where: eq(outletsTable.user_id, user_id) });
    if (!outlet) {
        throw new Error(`Outlet not found for user ${user_id}`);
    }

    const productsToSeed = [
        {
            id: crypto.randomUUID(),
            product_name: "Cappuccino",
            price: '250000',
            price_mark_down: '10000',
            outlet_id: outlet.id,
            description: 'A classic coffee drink made with espresso and steamed milk.',
            unit: 'pcs',
        },
        {
            id: crypto.randomUUID(),
            product_name: "Latte",
            price: '250000',
            price_mark_down: '10000',
            outlet_id: outlet.id,
            description: 'A classic coffee drink made with espresso and steamed milk.',
            unit: 'pcs',
        },
        {
            id: crypto.randomUUID(),
            product_name: "Espresso",
            price: '250000',
            price_mark_down: '10000',
            outlet_id: outlet.id,
            description: 'A classic coffee drink made with espresso and steamed milk.',
            unit: 'pcs',
        },
        {
            id: crypto.randomUUID(),
            product_name: "Americano",
            price: '250000',
            price_mark_down: '10000',
            outlet_id: outlet.id,
            description: 'A classic coffee drink made with espresso and steamed milk.',
            unit: 'pcs',
        },
        {
            id: crypto.randomUUID(),
            product_name: "Flat White",
            price: '250000',
            price_mark_down: '10000',
            outlet_id: outlet.id,
            description: 'A classic coffee drink made with espresso and steamed milk.',
            unit: 'pcs',
        },
    ];

    for (const product of productsToSeed) {
        try {
            console.log(`seeding products ${product.product_name}`)
            await db.insert(productsTable).values(product);
        }
        catch (error: any) {
            if (error.message?.includes("already exists") || error.status === 422) {
                console.log(`Product ${product.product_name} already exists, skipping.`);
            } else {
                console.error(`Failed to seed product ${product.product_name}:`, error);
            }
        }
    }
}

main()
