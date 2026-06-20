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
    Store,
    X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ProductSearchCard } from "./product-search-card";
import { RecommendedProductCard } from "./recommended-product-card";
import { OutletCard } from "./outlet-card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { Outlet, Product } from "@/lib/types";
import { OutletSchema, ProductSchema } from "@/lib/types";

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


// ─── Main ────────────────────────────────────────────────────────────────────

export function CategoryClient({ feature }: { feature: string }) {
    const meta = FEATURE_META[feature] ?? DEFAULT_META;
    const Icon = meta.icon;

    const [outletSearch, setOutletSearch] = useState("");
    const [productSearch, setProductSearch] = useState("");


    const { data: recommended_products } = useQuery<Product[]>({
        queryKey: ["products", feature],
        queryFn: async () => {
            const params = new URLSearchParams({ feature });
            const res = await fetch(`/api/get-all-product?${params.toString()}`);
            if (!res.ok) {
                throw new Error('Produk gagal didapatkan')
            }
            const { data } = await res.json();
            return ProductSchema.array().parse(data);
        },
    });

    const { data: searched_products, isLoading, error } = useQuery<Product[]>({
        queryKey: ["products", feature, "search", productSearch],
        queryFn: async () => {
            const params = new URLSearchParams({ feature, name: productSearch });
            const res = await fetch(`/api/get-all-product?${params.toString()}`);
            if (!res.ok) {
                throw new Error('Produk gagal didapatkan')
            }
            const { data } = await res.json();
            return ProductSchema.array().parse(data);
        },
        enabled: productSearch.length > 0,
    });



    const { data: all_outlets, isLoading: outletsLoading, isError: outletsError, error: outletsQueryError } = useQuery<Outlet[]>({
        queryKey: ["outlets", feature, outletSearch],
        queryFn: async () => {
            const res = await fetch(`/api/get-all-outlet?search=${outletSearch}`);
            if (!res.ok) throw new Error("Gagal memuat outlet");
            const { data } = await res.json();
            return OutletSchema.array().parse(data);
        },
    })
    const handleProductSearch = (e: any) => {
        setProductSearch(e.target.value)
    }
    const filteredOutlets = useMemo(() => {
        return all_outlets?.filter((o) => o.features.includes(feature));
    }, [all_outlets, outletSearch, feature]);
    console.log("[outlets] data:", all_outlets, "filtered:", filteredOutlets)

    const recommendedProducts = useMemo(() => {
        if (!recommended_products) return [];
        return recommended_products.filter((p) => p.isRecommended);
    }, [recommended_products])

    const filteredProducts = useMemo(() => {
        if (!productSearch) return [];
        return searched_products ?? [];
    }, [searched_products, productSearch]);


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
                            <span>{filteredOutlets?.length} outlet tersedia</span>
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
                            onChange={handleProductSearch}
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
                                            <ProductSearchCard key={product?.id} product={product} feature={feature} />
                                        ))}
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {!productSearch && (
                        <div className="space-y-3 py-2">
                            <p className="text-sm text-muted-foreground text-center">
                                Cari apa na Pian?
                            </p>
                        </div>
                    )}
                </section>

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

                    {outletsError ? (
                        <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
                            <Store className="h-12 w-12 opacity-20" />
                            <p className="font-bold">Gagal memuat outlet</p>
                            <p className="text-sm">Coba refresh halaman</p>
                        </div>
                    ) : outletsLoading ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="h-64 rounded-[1.75rem] bg-muted animate-pulse" />
                            ))}
                        </div>
                    ) : filteredOutlets?.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
                            <Store className="h-12 w-12 opacity-20" />
                            <p className="font-bold">Outlet tidak ditemukan</p>
                            <p className="text-sm">Coba kata kunci lain</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 lg:grid-cols-5 gap-5">
                            <AnimatePresence>
                                {filteredOutlets?.map((outlet) => (
                                    <OutletCard key={outlet.id} outlet={outlet} feature={feature} />
                                ))}
                            </AnimatePresence>
                        </div>
                    )}
                </section>

            </div>
        </div>
    );
}
