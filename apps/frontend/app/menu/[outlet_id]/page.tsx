import { serverFetch } from "@/lib/server-fetch";
import { MenuClient } from "./menu-client";

export default async function MenuPage({
    params,
}: {
    params: Promise<{ outlet_id: string }>;
}) {
    const { outlet_id } = await params;

    const res = await serverFetch(`/api/get-menu?outlet_id=${outlet_id}`);
    const { outlet, products } = res.ok ? await res.json() : { outlet: null, products: [] };

    if (!outlet) {
        return <NotFound />;
    }

    return (
        <MenuClient
            outlet={{
                ...outlet,
                ratings: outlet.ratings ? String(outlet.ratings) : "5.00",
            }}
            products={products.map((p: any) => ({
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
