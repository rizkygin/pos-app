"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import {
    Search,
    Sparkles,
    ChevronLeft,
    Utensils,
    Coffee,
    Wrench,
    ShoppingBag,
    PackageOpen,
    Scissors,
    Bike,
    BadgePercent,
    Store,
    X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ProductSearchCard } from "./product-search-card";
import { PromoCodeCard } from "./promo-code-card";
import { RecommendedProductCard } from "./recommended-product-card";
import { OutletCard } from "./outlet-card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { Outlet, Product, Promo } from "@/lib/types";

// ─── Feature metadata ────────────────────────────────────────────────────────

const FEATURE_META: Record<string, {
    label: string;
    description: string;
    icon: React.ElementType;
    color: string;
    bg: string;
    gradient: string;
}> = {
    food: {
        label: "Pesan Makanan",
        description: "Makanan lezat dari restoran & warung terdekat",
        icon: Utensils,
        color: "text-rose-600",
        bg: "bg-rose-100",
        gradient: "from-rose-500 to-orange-500",
    },
    drink: {
        label: "Pesan Minuman",
        description: "Kopi, teh, jus, dan minuman segar lainnya",
        icon: Coffee,
        color: "text-amber-700",
        bg: "bg-amber-100",
        gradient: "from-amber-500 to-yellow-500",
    },
    service: {
        label: "Layanan Jasa",
        description: "Servis rumah tangga, reparasi, dan kebutuhan teknis",
        icon: Wrench,
        color: "text-blue-600",
        bg: "bg-blue-100",
        gradient: "from-blue-500 to-sky-500",
    },
    mart: {
        label: "Belanja Mart",
        description: "Kebutuhan sehari-hari, sembako, dan produk rumah",
        icon: ShoppingBag,
        color: "text-emerald-600",
        bg: "bg-emerald-100",
        gradient: "from-emerald-500 to-teal-500",
    },
    delivery: {
        label: "Kirim Paket",
        description: "Pengiriman cepat ke seluruh kota",
        icon: PackageOpen,
        color: "text-violet-600",
        bg: "bg-violet-100",
        gradient: "from-violet-500 to-purple-500",
    },
    beauty: {
        label: "Kecantikan & Spa",
        description: "Salon, barbershop, perawatan tubuh & kecantikan",
        icon: Scissors,
        color: "text-pink-600",
        bg: "bg-pink-100",
        gradient: "from-pink-500 to-fuchsia-500",
    },
    ride: {
        label: "Sewa Kendaraan",
        description: "Motor, mobil, dan ojek instan di sekitarmu",
        icon: Bike,
        color: "text-cyan-600",
        bg: "bg-cyan-100",
        gradient: "from-cyan-500 to-sky-500",
    },
};

const DEFAULT_META = {
    label: "Layanan",
    description: "Temukan semua yang kamu butuhkan",
    icon: Store,
    color: "text-rose-600",
    bg: "bg-rose-100",
    gradient: "from-rose-500 to-pink-500",
};

const MOCK_OUTLETS: Outlet[] = [
    { id: "o1", name: "Warung Makan Bu Tini", image: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&auto=format&fit=crop&q=60", tags: ["Indonesian", "Homestyle", "Halal"], rating: 4.8, reviewCount: 2410, distance: "0.8 km", estimatedTime: "20 min", isOpen: true, feature: ["food"], promoActive: true },
    { id: "o2", name: "Kopi Nusantara", image: "https://images.unsplash.com/photo-1445116572660-236099ec97a0?w=600&auto=format&fit=crop&q=60", tags: ["Coffee", "Cozy", "Wifi"], rating: 4.9, reviewCount: 1823, distance: "1.2 km", estimatedTime: "15 min", isOpen: true, feature: ["drink", "food"], promoActive: true },
    { id: "o3", name: "Resto Padang Sederhana", image: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&auto=format&fit=crop&q=60", tags: ["Padang", "Spicy", "Halal"], rating: 4.7, reviewCount: 3201, distance: "2.1 km", estimatedTime: "25 min", isOpen: true, feature: ["food"], promoActive: false },
    { id: "o4", name: "Bubble Tea & Juice Bar", image: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&auto=format&fit=crop&q=60", tags: ["Bubble Tea", "Fresh Juice"], rating: 4.6, reviewCount: 980, distance: "0.5 km", estimatedTime: "10 min", isOpen: true, feature: ["drink"], promoActive: true },
    { id: "o5", name: "Bengkel Pak Darto", image: "https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?w=600&auto=format&fit=crop&q=60", tags: ["Otomotif", "Servis AC", "Listrik"], rating: 4.5, reviewCount: 412, distance: "3.0 km", estimatedTime: "Same day", isOpen: true, feature: ["service"], promoActive: false },
    { id: "o6", name: "Salon Cantik Salon", image: "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=600&auto=format&fit=crop&q=60", tags: ["Salon", "Spa", "Manicure"], rating: 4.8, reviewCount: 765, distance: "1.7 km", estimatedTime: "Book now", isOpen: true, feature: ["beauty"], promoActive: true },
    { id: "o7", name: "Minimart Segar", image: "https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=600&auto=format&fit=crop&q=60", tags: ["Sembako", "Buah", "Frozen"], rating: 4.4, reviewCount: 528, distance: "0.3 km", estimatedTime: "5 min", isOpen: true, feature: ["mart"], promoActive: false },
    { id: "o8", name: "Pizza House", image: "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&auto=format&fit=crop&q=60", tags: ["Pizza", "Italian", "Dine-in"], rating: 4.6, reviewCount: 1540, distance: "1.5 km", estimatedTime: "30 min", isOpen: false, feature: ["food"], promoActive: false },
];



const MOCK_PROMOS: Promo[] = [
    { id: "promo1", code: "MAKAN20", title: "Diskon Makan Siang", description: "Hemat 20% untuk semua menu makanan berat", discountPercent: 20, minOrder: 50000, maxDiscount: 25000, validUntil: "31 Mei 2026", gradient: "from-rose-500 to-pink-600", feature: ["food"] },
    { id: "promo2", code: "KOPI15", title: "Promo Kopi Pagi", description: "15% off semua minuman kopi & teh berlaku mulai pukul 06.00–10.00", discountPercent: 15, minOrder: 20000, validUntil: "31 Mei 2026", gradient: "from-amber-500 to-orange-600", feature: ["drink"] },
    { id: "promo3", code: "NEWBIE30", title: "Pelanggan Baru", description: "30% off untuk pesanan pertama kamu di semua kategori", discountPercent: 30, minOrder: 30000, maxDiscount: 50000, validUntil: "15 Jun 2026", gradient: "from-violet-500 to-purple-600", feature: ["food", "drink", "service", "mart", "beauty", "ride", "delivery"] },
    { id: "promo4", code: "JASA25", title: "Diskon Layanan Jasa", description: "Hemat 25% untuk servis pertama di Bengkel rekanan", discountPercent: 25, minOrder: 100000, validUntil: "30 Jun 2026", gradient: "from-blue-500 to-sky-600", feature: ["service"] },
    { id: "promo5", code: "BEAUTY20", title: "Glow Up Deal", description: "Diskon 20% untuk semua treatment kecantikan", discountPercent: 20, minOrder: 150000, validUntil: "20 Mei 2026", gradient: "from-pink-500 to-fuchsia-600", feature: ["beauty"] },
    { id: "promo6", code: "MART10", title: "Belanja Hemat", description: "Potongan 10% untuk belanja sembako & kebutuhan rumah", discountPercent: 10, minOrder: 75000, validUntil: "31 Mei 2026", gradient: "from-emerald-500 to-teal-600", feature: ["mart"] },
];

// ─── Main ────────────────────────────────────────────────────────────────────

export function CategoryClient({ feature }: { feature: string }) {
    const meta = FEATURE_META[feature] ?? DEFAULT_META;
    const Icon = meta.icon;

    const [outletSearch, setOutletSearch] = useState("");
    const [productSearch, setProductSearch] = useState("");

    const { data: all_products, isLoading, error } = useQuery<Product[]>({
        queryKey: ["products", feature, productSearch],
        queryFn: async () => {
            const res = await fetch(`/api/get-all-product?name=${productSearch}`);
            const data = await res.json();
            return data.data;
        },
    });



    const filteredOutlets = useMemo(() => {
        const base = MOCK_OUTLETS.filter((o) => o.feature.includes(feature));
        if (!outletSearch) return base;
        return base.filter((o) =>
            o.name.toLowerCase().includes(outletSearch.toLowerCase()) ||
            o.tags.some((t) => t.toLowerCase().includes(outletSearch.toLowerCase()))
        );
    }, [feature, outletSearch]);

    const recommendedProducts = useMemo(() => {
        if (!all_products) return [];
        return all_products?.filter((p) => p.features.includes(feature) && p.is_recommended)
    }, [all_products, feature])

    const filteredProducts = useMemo(() => {
        const base = all_products?.filter((p) => p.features.includes(feature));
        if (!productSearch) return [];
        return base?.filter((p) =>
            p.product_name.toLowerCase().includes(productSearch.toLowerCase()) ||
            p.outlet.toLowerCase().includes(productSearch.toLowerCase())
        );
    }, [feature, productSearch]);

    const relevantPromos = useMemo(
        () => MOCK_PROMOS.filter((p) => p.feature.includes(feature) || p.feature.includes("food")),
        [feature]
    );

    return (
        <div className="min-h-screen bg-background pb-12">

            {/* ── Hero Header ───────────────────────────────────────────── */}
            <div className={`bg-gradient-to-r ${meta.gradient} px-5 md:px-8 py-8 md:py-12`}>
                <Link
                    href="/dashboard/order"
                    className="inline-flex items-center gap-1.5 text-white/80 hover:text-white text-sm font-bold mb-6 transition-colors"
                >
                    <ChevronLeft className="h-4 w-4" /> Kembali
                </Link>

                <div className="flex items-center gap-5">
                    <div className="h-16 w-16 md:h-20 md:w-20 rounded-3xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0 shadow-lg">
                        <Icon className="h-8 w-8 md:h-10 md:w-10 text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl md:text-4xl font-black text-white leading-tight">{meta.label}</h1>
                        <p className="text-white/75 text-sm mt-1">{meta.description}</p>
                        <div className="flex items-center gap-3 mt-2 text-white/60 text-xs">
                            <span>{filteredOutlets.length} outlet tersedia</span>
                            <span>·</span>
                            <span>{recommendedProducts?.length} produk rekomendasi</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="px-4 md:px-8 space-y-10 pt-8">

                {/* ── Recommended Products ─────────────────────────────── */}
                {recommendedProducts && recommendedProducts?.length > 0 && (
                    <section className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Sparkles className="h-5 w-5 text-amber-500" />
                                <h2 className="font-black text-xl">Rekomendasi Terbaik</h2>
                            </div>
                            <Badge variant="secondary" className="font-bold">
                                {recommendedProducts?.length} item
                            </Badge>
                        </div>

                        <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
                            {recommendedProducts?.map((product) => (
                                <RecommendedProductCard key={product.id} product={product} feature={feature} />
                            ))}
                        </div>
                    </section>
                )}

                <Separator />

                {/* ── Outlet Search ─────────────────────────────────────── */}
                <section className="space-y-5">
                    <div className="flex items-center gap-2">
                        <Store className="h-5 w-5 text-muted-foreground" />
                        <h2 className="font-black text-xl">Cari Outlet</h2>
                    </div>

                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <Input
                            value={outletSearch}
                            onChange={(e) => setOutletSearch(e.target.value)}
                            placeholder="Nama outlet, tag, atau lokasi..."
                            className="pl-12 pr-10 py-6 rounded-2xl text-base shadow-sm border-border/60 bg-card"
                        />
                        {outletSearch && (
                            <button
                                onClick={() => setOutletSearch("")}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>

                    {filteredOutlets.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
                            <Store className="h-12 w-12 opacity-20" />
                            <p className="font-bold">Outlet tidak ditemukan</p>
                            <p className="text-sm">Coba kata kunci lain</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                            <AnimatePresence>
                                {filteredOutlets.map((outlet) => (
                                    <OutletCard key={outlet.id} outlet={outlet} feature={feature} />
                                ))}
                            </AnimatePresence>
                        </div>
                    )}
                </section>

                <Separator />

                {/* ── Product / Service Search ──────────────────────────── */}
                <section className="space-y-5">
                    <div className="flex items-center gap-2">
                        <Icon className={`h-5 w-5 ${meta.color}`} />
                        <h2 className="font-black text-xl">Cari Produk / Layanan</h2>
                    </div>

                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <Input
                            value={productSearch}
                            onChange={(e) => setProductSearch(e.target.value)}
                            placeholder="Nama produk atau layanan..."
                            className="pl-12 pr-10 py-6 rounded-2xl text-base shadow-sm border-border/60 bg-card"
                        />
                        {productSearch && (
                            <button
                                onClick={() => setProductSearch("")}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>

                    <AnimatePresence>
                        {productSearch.length > 0 && (
                            <motion.div
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                            >
                                {filteredProducts?.length === 0 ? (
                                    <div className="flex items-center gap-3 py-8 justify-center text-muted-foreground">
                                        <Search className="h-8 w-8 opacity-20" />
                                        <p className="font-bold text-sm">Produk tidak ditemukan</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {filteredProducts?.map((product) => (
                                            <ProductSearchCard key={product.id} product={product} feature={feature} />
                                        ))}
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {!productSearch && (
                        <p className="text-sm text-muted-foreground text-center py-4">
                            Ketik nama produk atau layanan untuk mencari
                        </p>
                    )}
                </section>

                <Separator />

                {/* ── Promo Codes ───────────────────────────────────────── */}
                <section className="space-y-5 pb-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <BadgePercent className="h-5 w-5 text-rose-500" />
                            <h2 className="font-black text-xl">Kode Promo</h2>
                        </div>
                        <span className="text-sm text-muted-foreground font-semibold">
                            {relevantPromos.length} promo aktif
                        </span>
                    </div>

                    <div className="flex gap-4 overflow-x-auto pb-3 no-scrollbar">
                        {relevantPromos.map((promo) => (
                            <PromoCodeCard key={promo.id} promo={promo} />
                        ))}
                    </div>

                    <p className="text-xs text-center text-muted-foreground">
                        Tap kode promo untuk menyalin. Gunakan saat checkout.
                    </p>
                </section>
            </div>
        </div>
    );
}
