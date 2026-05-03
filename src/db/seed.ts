import { auth } from "@/lib/auth";
import { db } from "./index";
import { customersTable, outletsTable, couriersTable, productsTable } from "./schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

const main = async () => {
    // Load env variables
    const hashPassword = "12345678";

    const usersToSeed = [
        {
            name: "customers_test",
            email: "rizkygin1@gmail.com",
            password: hashPassword,
        },
        {
            name: "owner_test",
            email: "rizkygin2@gmail.com",
            password: hashPassword,
        },
        {
            name: "courier_test",
            email: "rizkygin3@gmail.com",
            password: hashPassword,
        }
    ];

    // let outlet: typeof outletsTable.$inferSelect;
    for (const user of usersToSeed) {
        console.log(`Seeding ${user.name}...`);
        try {
            const res = await auth.api.signUpEmail({
                body: {
                    email: user.email,
                    password: user.password,
                    name: user.name,
                }
            });

            if (user.name === "customers_test") {
                await db.insert(customersTable).values({
                    user_id: res.user.id,
                });
            } else if (user.name === "owner_test") {
                await db.insert(outletsTable).values({
                    name: `${user.name}'s Resto`,
                    phone: "08123456789",
                    email: res.user.email,
                    address: "Jakarta, Indonesia",
                    user_id: res.user.id,
                });
                await addProductstoOutlets(res.user.id);
            } else if (user.name === "courier_test") {
                await db.insert(couriersTable).values({
                    user_id: res.user.id,
                    vehicle_plate: "B 1234 CDE",
                    vehicle_type: "motorcycle",
                });
            }

            console.log(`Successfully seeded ${user.name}`);
        } catch (e: any) {
            if (e.message?.includes("already exists") || e.status === 422) {
                console.log(`User ${user.name} already exists, skipping.`);
            } else {
                console.error(`Failed to seed ${user.name}:`, e);
            }
        }
    }

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
