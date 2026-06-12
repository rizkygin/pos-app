import { db } from "@/src/db";
import { outletsTable, productsTable } from "@/src/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { MenuClient } from "./menu-client";

export default async function MenuPage({
    params,
}: {
    params: Promise<{ outlet_id: string }>;
}) {
    const { outlet_id } = await params;
    const id = parseInt(outlet_id, 10);

    if (isNaN(id)) {
        return <NotFound />;
    }

    const [outlet] = await db
        .select({
            id: outletsTable.id,
            name: outletsTable.name,
            address: outletsTable.address,
            phone: outletsTable.phone,
            lat: outletsTable.lat,
            lon: outletsTable.lon,
            avatar: outletsTable.avatar,
            tags: outletsTable.tags,
            is_open: outletsTable.is_open,
            ratings: outletsTable.ratings,
            review_count: outletsTable.review_count,
        })
        .from(outletsTable)
        .where(and(eq(outletsTable.id, id), isNull(outletsTable.deletedAt)))
        .limit(1);

    if (!outlet) {
        return <NotFound />;
    }

    const products = await db
        .select({
            id: productsTable.id,
            product_name: productsTable.product_name,
            price: productsTable.price,
            price_mark_down: productsTable.price_mark_down,
            category: productsTable.category,
            image: productsTable.image,
            description: productsTable.description,
            unit: productsTable.unit,
            ratings: productsTable.ratings,
            review_count: productsTable.review_count,
            is_recommended: productsTable.is_recommended,
            isAvailable: productsTable.isAvailable,
            discount_percent: productsTable.discount_percent,
        })
        .from(productsTable)
        .where(
            and(
                eq(productsTable.outlet_id, id),
                eq(productsTable.isAvailable, true),
                isNull(productsTable.deletedAt),
            ),
        );

    return (
        <MenuClient
            outlet={{
                ...outlet,
                ratings: outlet.ratings ? String(outlet.ratings) : "5.00",
            }}
            products={products.map((p) => ({
                ...p,
                ratings: p.ratings ? String(p.ratings) : "5.00",
            }))}
        />
    );
}

function NotFound() {
    return (
        <main className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-4">
            <div className="text-center space-y-4">
                <div className="text-6xl">🍽️</div>
                <h1 className="text-2xl font-bold text-white">Menu Not Found</h1>
                <p className="text-white/50">This menu link is invalid or the outlet no longer exists.</p>
            </div>
        </main>
    );
}
