import type { Metadata } from "next";
import { serverFetch } from "@/lib/server-fetch";
import { resolveOutletImage } from "@/lib/image-src";
import { MenuClient } from "./menu-client";
import type { Product } from "./menu-types";

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
    searchParams,
}: {
    params: Promise<Params>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
    const { outlet_id } = await params;
    // A table's QR sticker opens /menu/<outlet>?meja=<table id>: an order sent
    // from here goes onto that table's bill (Pesan Mandiri).
    const { meja } = await searchParams;
    const table = typeof meja === "string" && /^\d{1,9}$/.test(meja) ? meja : null;

    const res = await serverFetch(
        `/api/get-menu?outlet_id=${encodeURIComponent(outlet_id)}${table ? `&meja=${table}` : ""}`,
    );
    const { outlet, products, selfOrder, ads } = res.ok
        ? await res.json()
        : { outlet: null, products: [], selfOrder: null, ads: [] };

    if (!outlet) {
        return <NotFound />;
    }

    return (
        <MenuClient
            outlet={{
                ...outlet,
                ratings: outlet.ratings ? String(outlet.ratings) : "5.00",
            }}
            products={products.map((p: Product) => ({
                ...p,
                ratings: p.ratings ? String(p.ratings) : "5.00",
                addon_groups: p.addon_groups ?? [],
            }))}
            selfOrder={selfOrder ?? null}
            ads={ads ?? []}
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
