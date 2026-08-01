"use client";

import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import {
    Utensils,
    Coffee,
    ShoppingBag,
    ArrowRight,
    Heart,
    Star,
    Trash2,
    Search,
    Sparkles,
    Wrench,
    X,
} from "lucide-react";
import { ORDER_FEATURES } from "@/lib/order-features";
import { useWishlist } from "@/hooks/use-wishlist";
import { useState, useMemo } from "react";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { NearbyOutlets } from "@/components/order/nearby-outlets";
import { ActiveOrderBanner } from "@/components/order/active-order-banner";

function fmt(price: number) {
    return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
    }).format(price);
}

export function FeaturePicker() {
    const { items: wishlist, remove } = useWishlist();
    const [wishlistOpen, setWishlistOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<string>("all");

    // Filter features based on search & category selection
    const filteredFeatures = useMemo(() => {
        return ORDER_FEATURES.filter((feature) => {
            if (!feature.isAvailable) return false;
            if (selectedCategory !== "all" && feature.slug !== selectedCategory) {
                return false;
            }
            if (!searchQuery.trim()) return true;
            const q = searchQuery.toLowerCase();
            return (
                feature.label.toLowerCase().includes(q) ||
                feature.description.toLowerCase().includes(q) ||
                feature.category.toLowerCase().includes(q)
            );
        });
    }, [searchQuery, selectedCategory]);

    return (
        <main className="w-full max-w-7xl mx-auto px-3 sm:px-6 pb-20 space-y-5 sm:space-y-8 overflow-x-hidden min-w-0">
            {/* Active order tracker banner */}
            <ActiveOrderBanner />

            {/* ── Top Hero & Search Controls (Mobile Constrained) ─────────────── */}
            <div className="relative w-full rounded-2xl sm:rounded-3xl bg-gradient-to-br from-rose-500/10 via-amber-500/10 to-purple-500/10 p-3.5 sm:p-6 md:p-8 border border-border/60 shadow-sm overflow-hidden min-w-0">
                <div className="absolute top-0 right-0 -mt-10 -mr-10 w-36 sm:w-48 h-36 sm:h-48 rounded-full bg-rose-500/10 blur-3xl pointer-events-none" />
                <div className="absolute bottom-0 left-0 -mb-10 -ml-10 w-36 sm:w-48 h-36 sm:h-48 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />

                <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 min-w-0">
                    <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[11px] sm:text-xs font-black flex items-center gap-1 border border-rose-500/20">
                                <Sparkles className="h-3 w-3 fill-rose-500" />
                                Ulun Order Hub
                            </span>
                        </div>
                        <h1 className="text-xl sm:text-2xl md:text-3xl font-black tracking-tight text-foreground leading-tight truncate">
                            Mau Pesan Apa Hari Ini?
                        </h1>
                        <p className="text-xs sm:text-sm text-muted-foreground max-w-xl line-clamp-2 sm:line-clamp-none">
                            Pilih layanan yang kamu butuhkan dari makanan lezat, minuman, kebutuhan harian, hingga perbaikan jasa.
                        </p>
                    </div>

                    {/* Wishlist Button & Drawer */}
                    <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                        <Sheet open={wishlistOpen} onOpenChange={setWishlistOpen}>
                            <SheetTrigger asChild>
                                <button className="relative flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2.5 rounded-full border border-border/80 bg-background/90 backdrop-blur-md shadow-sm hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:border-rose-300 transition-all text-xs sm:text-sm font-bold text-foreground active:scale-95">
                                    <Heart className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-rose-500 fill-rose-500/20" />
                                    <span>Wishlist</span>
                                    {wishlist.length > 0 && (
                                        <span className="ml-1 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-black leading-none">
                                            {wishlist.length}
                                        </span>
                                    )}
                                </button>
                            </SheetTrigger>
                            <SheetContent side="right" className="w-full max-w-sm flex flex-col gap-4">
                                <SheetHeader>
                                    <SheetTitle className="font-black text-xl flex items-center gap-2">
                                        <Heart className="h-5 w-5 fill-rose-500 text-rose-500" />
                                        Wishlist Saya
                                        <Badge variant="secondary" className="ml-auto font-bold">{wishlist.length} item</Badge>
                                    </SheetTitle>
                                    <SheetDescription className="sr-only">Produk yang disimpan untuk dibeli nanti</SheetDescription>
                                </SheetHeader>
                                <Separator />
                                {wishlist.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center flex-1 gap-4 text-muted-foreground py-16">
                                        <Heart className="h-16 w-16 opacity-15 text-rose-500" />
                                        <p className="font-bold text-lg">Wishlist kosong</p>
                                        <p className="text-sm text-center">Tekan ikon hati pada produk untuk menyimpannya di sini</p>
                                    </div>
                                ) : (
                                    <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                                        <AnimatePresence>
                                            {wishlist.map((item) => {
                                                const finalPrice = item.discountPercent
                                                    ? item.price - Math.floor(item.price * (item.discountPercent / 100))
                                                    : item.price;
                                                return (
                                                    <motion.div
                                                        key={item.productId}
                                                        initial={{ opacity: 0, x: 20 }}
                                                        animate={{ opacity: 1, x: 0 }}
                                                        exit={{ opacity: 0, x: -20 }}
                                                        className="flex gap-3 p-3 rounded-2xl bg-card border border-border/60 shadow-sm"
                                                    >
                                                        <div className="relative h-16 w-16 rounded-xl overflow-hidden flex-shrink-0 bg-muted">
                                                            <Image src={item.productImage} alt={item.productName} fill className="object-cover" />
                                                        </div>
                                                        <div className="flex-1 min-w-0 space-y-1">
                                                            <p className="font-bold text-sm leading-tight line-clamp-2">{item.productName}</p>
                                                            <p className="text-[11px] text-muted-foreground">{item.outletName}</p>
                                                            <div className="flex items-center gap-1">
                                                                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                                                                <span className="text-[11px] font-bold text-amber-600">{Number(item.rating ?? 5).toFixed(1)}</span>
                                                            </div>
                                                            <div className="flex items-center justify-between pt-1">
                                                                <p className="text-sm font-black text-rose-600">{fmt(finalPrice)}</p>
                                                                <div className="flex items-center gap-2">
                                                                    <Link
                                                                        href={`/dashboard/order/${item.feature}/${item.outletId}`}
                                                                        onClick={() => setWishlistOpen(false)}
                                                                        className="px-3 py-1 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-xs font-black transition-colors"
                                                                    >
                                                                        Pesan
                                                                    </Link>
                                                                    <button
                                                                        onClick={() => remove(item.productId)}
                                                                        className="text-muted-foreground hover:text-destructive transition-colors p-1"
                                                                    >
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </motion.div>
                                                );
                                            })}
                                        </AnimatePresence>
                                    </div>
                                )}
                            </SheetContent>
                        </Sheet>
                    </div>
                </div>

                {/* Search Input & Scrollable Category Filter Pills */}
                <div className="mt-3.5 space-y-2.5 min-w-0">
                    <div className="relative w-full">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Cari layanan, makanan, kopi, atau servis..."
                            className="w-full pl-9 sm:pl-10 pr-9 py-2 sm:py-3 rounded-xl sm:rounded-2xl border border-border/80 bg-background/90 backdrop-blur-md text-xs sm:text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-rose-500/50 shadow-sm transition-all"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery("")}
                                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full text-muted-foreground hover:text-foreground"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>

                    {/* Scrollable Filter Pills */}
                    <div className="w-full min-w-0 overflow-x-auto pb-1 no-scrollbar text-xs font-bold flex items-center gap-1.5 snap-x">
                        <button
                            onClick={() => setSelectedCategory("all")}
                            className={`px-3 py-1.5 rounded-full transition-all whitespace-nowrap snap-start shrink-0 ${
                                selectedCategory === "all"
                                    ? "bg-foreground text-background shadow-sm"
                                    : "bg-background/80 border border-border/60 text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            Semua Layanan
                        </button>
                        <button
                            onClick={() => setSelectedCategory("food")}
                            className={`px-3 py-1.5 rounded-full transition-all whitespace-nowrap flex items-center gap-1 snap-start shrink-0 ${
                                selectedCategory === "food"
                                    ? "bg-rose-500 text-white shadow-sm"
                                    : "bg-background/80 border border-border/60 text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Utensils className="h-3 w-3" />
                            Layanan Makan
                        </button>
                        <button
                            onClick={() => setSelectedCategory("drink")}
                            className={`px-3 py-1.5 rounded-full transition-all whitespace-nowrap flex items-center gap-1 snap-start shrink-0 ${
                                selectedCategory === "drink"
                                    ? "bg-amber-500 text-white shadow-sm"
                                    : "bg-background/80 border border-border/60 text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Coffee className="h-3 w-3" />
                            Minuman
                        </button>
                        <button
                            onClick={() => setSelectedCategory("mart")}
                            className={`px-3 py-1.5 rounded-full transition-all whitespace-nowrap flex items-center gap-1 snap-start shrink-0 ${
                                selectedCategory === "mart"
                                    ? "bg-emerald-500 text-white shadow-sm"
                                    : "bg-background/80 border border-border/60 text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <ShoppingBag className="h-3 w-3" />
                            Belanja
                        </button>
                        <button
                            onClick={() => setSelectedCategory("service")}
                            className={`px-3 py-1.5 rounded-full transition-all whitespace-nowrap flex items-center gap-1 snap-start shrink-0 ${
                                selectedCategory === "service"
                                    ? "bg-blue-500 text-white shadow-sm"
                                    : "bg-background/80 border border-border/60 text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Wrench className="h-3 w-3" />
                            Layanan Jasa
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Wishlist Inline Horizontal Bar ────────────────────────────── */}
            <AnimatePresence>
                {wishlist.length > 0 && (
                    <motion.section
                        key="wishlist-section"
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="space-y-2 min-w-0"
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Heart className="h-4 w-4 fill-rose-500 text-rose-500" />
                                <h2 className="font-black text-base sm:text-lg text-foreground">Wishlist Simpanan Kamu</h2>
                                <span className="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 text-[11px] font-black border border-rose-500/20">
                                    {wishlist.length}
                                </span>
                            </div>
                        </div>

                        <div className="w-full flex gap-3 overflow-x-auto pb-2 no-scrollbar snap-x min-w-0">
                            {wishlist.map((item, i) => {
                                const finalPrice = item.discountPercent
                                    ? item.price - Math.floor(item.price * (item.discountPercent / 100))
                                    : item.price;

                                return (
                                    <motion.div
                                        key={item.productId}
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.85, x: -20 }}
                                        transition={{ delay: i * 0.04 }}
                                        className="group flex-shrink-0 w-40 sm:w-52 bg-card border border-border/60 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all snap-start"
                                    >
                                        <div className="relative h-24 sm:h-28 overflow-hidden bg-muted">
                                            <Image
                                                src={item.productImage}
                                                alt={item.productName}
                                                fill
                                                className="object-cover group-hover:scale-105 transition-transform duration-300"
                                            />
                                            {item.discountPercent && (
                                                <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-rose-500 text-[9px] font-black text-white">
                                                    -{item.discountPercent}%
                                                </span>
                                            )}
                                            <button
                                                onClick={() => remove(item.productId)}
                                                className="absolute top-2 right-2 h-6 w-6 rounded-full bg-background/80 backdrop-blur-md flex items-center justify-center text-rose-500 hover:bg-rose-50 transition-colors shadow-sm"
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </button>
                                        </div>

                                        <div className="p-2.5 space-y-1.5">
                                            <p className="font-bold text-xs leading-tight line-clamp-2 text-foreground">{item.productName}</p>
                                            <div className="flex items-center justify-between pt-0.5">
                                                <p className="text-xs font-black text-rose-600">{fmt(finalPrice)}</p>
                                                <Link
                                                    href={`/dashboard/order/${item.feature}/${item.outletId}`}
                                                    className="px-2 py-0.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-black transition-colors"
                                                >
                                                    Pesan
                                                </Link>
                                            </div>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    </motion.section>
                )}
            </AnimatePresence>

            {/* ── Main Feature Selection Section ("Pilih Layanan Utama") ─────── */}
            <section className="space-y-3.5 w-full min-w-0">
                <div className="flex items-center justify-between border-b border-border/50 pb-2">
                    <div className="space-y-0.5">
                        <h2 className="font-black text-base sm:text-xl text-foreground tracking-tight">
                            Pilih Layanan Utama
                        </h2>
                        <p className="text-[11px] sm:text-xs text-muted-foreground">
                            Pilih kategori layanan yang ingin kamu pesan hari ini
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4 w-full min-w-0">
                    {filteredFeatures.map((feature, i) => (
                        <motion.div
                            key={feature.slug}
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.04, type: "spring", stiffness: 200, damping: 20 }}
                            whileTap={{ scale: 0.96 }}
                            className="min-w-0 w-full"
                        >
                            <Link
                                href={`/dashboard/order/${feature.slug}`}
                                className={`group relative flex flex-col justify-between p-3 sm:p-5 rounded-2xl sm:rounded-3xl border border-border/60 bg-gradient-to-br ${feature.gradient} shadow-sm hover:shadow-lg hover:border-rose-300/50 transition-all duration-300 w-full min-w-0 h-full min-h-[135px] sm:min-h-[170px] overflow-hidden`}
                            >
                                {feature.image && <FeatureArt src={feature.image} />}

                                {feature.badge && (
                                    <span
                                        className={`absolute top-2.5 right-2.5 sm:top-4 sm:right-4 z-20 px-1.5 sm:px-2.5 py-0.5 rounded-full text-[8px] sm:text-[10px] font-black ${
                                            feature.badge === "Terpopuler"
                                                ? "bg-rose-500 text-white shadow-sm"
                                                : feature.badge === "Baru"
                                                ? "bg-emerald-500 text-white shadow-sm"
                                                : "bg-muted text-muted-foreground"
                                        }`}
                                    >
                                        {feature.badge}
                                    </span>
                                )}

                                <div className="relative z-10 flex flex-col justify-between h-full gap-2 sm:gap-4 min-w-0">
                                    <div
                                        className={`h-9 w-9 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl ${feature.iconBg} flex items-center justify-center shadow-sm shrink-0 group-hover:scale-105 transition-transform duration-300`}
                                    >
                                        <feature.icon className={`h-4.5 w-4.5 sm:h-6 sm:w-6 ${feature.iconColor}`} />
                                    </div>

                                    <div className="space-y-0.5 min-w-0 pr-1">
                                        <h3 className="font-black text-xs sm:text-base leading-tight text-foreground truncate">
                                            {feature.label}
                                        </h3>
                                        <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight sm:leading-snug line-clamp-2 break-words">
                                            {feature.description}
                                        </p>
                                    </div>

                                    <div className="flex items-center justify-end">
                                        <div
                                            className={`h-5 w-5 sm:h-7 sm:w-7 rounded-full ${feature.iconBg} flex items-center justify-center group-hover:translate-x-0.5 transition-transform duration-300`}
                                        >
                                            <ArrowRight className={`h-2.5 w-2.5 sm:h-3.5 sm:w-3.5 ${feature.iconColor}`} />
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        </motion.div>
                    ))}
                </div>

                {/* Coming Soon Features */}
                {ORDER_FEATURES.some((f) => !f.isAvailable) && (
                    <div className="p-3 sm:p-4 rounded-xl sm:rounded-2xl bg-muted/40 border border-border/50 flex flex-wrap items-center gap-2 text-[11px] sm:text-xs text-muted-foreground min-w-0">
                        <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        <p className="min-w-0 break-words">
                            <span className="font-bold text-foreground">Segera Hadir:</span>{" "}
                            {ORDER_FEATURES.filter((f) => !f.isAvailable)
                                .map((f) => f.label)
                                .join(" · ")}
                        </p>
                    </div>
                )}
            </section>

            {/* ── Nearby Outlets Section ─────────────────────────────── */}
            <NearbyOutlets />
        </main>
    );
}

/**
 * Decorative artwork in bottom-right of feature tile
 */
function FeatureArt({ src }: { src: string }) {
    const [failed, setFailed] = useState(false);
    if (failed) return null;

    return (
        <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 right-0 w-[40%] sm:w-[50%] h-[50%] sm:h-[65%]"
        >
            <Image
                src={src}
                alt=""
                fill
                unoptimized
                onError={() => setFailed(true)}
                className="object-contain object-bottom-right opacity-25 dark:opacity-15 sm:opacity-80 sm:dark:opacity-50 transition-transform duration-500 group-hover:scale-105"
            />
        </span>
    );
}
