import type { Metadata } from "next";
import { serverFetch } from "@/lib/server-fetch";
import { resolveOutletImage } from "@/lib/image-src";
import { MenuClient } from "./menu-client";

type Params = { outlet_id: string };

// Per-outlet SEO: this page (not the homepage) is what people actually search
// for — "<nama warung> <kota>". Reuses the same fetch as the page body;
// Next.js dedupes identical fetches within one request.
export async function generateMetadata({
    params,
}: {
    params: Promise<Params>;
}): Promise<Metadata> {
    const { outlet_id } = await params;
    const res = await serverFetch(`/api/get-menu?outlet_id=${outlet_id}`);
    const { outlet } = res.ok ? await res.json() : { outlet: null };
    if (!outlet) return { title: "Menu Tidak Ditemukan" };

    const title = `${outlet.name} — Pesan Online`;
    const description = `Pesan dari ${outlet.name} di ${outlet.address ?? "sekitar Anda"} lewat Ulun Pesan. Lihat menu, harga, dan pesan langsung dari HP.`;
    const image = resolveOutletImage(outlet.avatar);

    return {
        title,
        description,
        alternates: { canonical: `/menu/${outlet_id}` },
        openGraph: {
            title,
            description,
            url: `/menu/${outlet_id}`,
            images: [image],
        },
        twitter: {
            card: "summary_large_image",
            title,
            description,
            images: [image],
        },
    };
}

export default async function MenuPage({
    params,
}: {
    params: Promise<Params>;
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
