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
    ShoppingBasket,
    Tag,
    Clock,
    Zap,
    Gift,
    Percent,
} from "lucide-react";
import { ORDER_FEATURES } from "@/lib/order-features";
import { DashboardHeader } from "@/components/dashboard-header";
import { useWishlist } from "@/hooks/use-wishlist";
import { useState } from "react";
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

type Promo = {
    id: number;
    code: string;
    title: string;
    description: string;
    discount_percent: number;
    min_order: number;
    valid_until: string;
    gradient: string;
    icon: React.ElementType;
    accent: string;
    shape: string;
};

const PROMOS: Promo[] = [
    {
        id: 1,
        code: "MAKAN30",
        title: "Diskon Makan Siang",
        description: "Hemat hingga 30% untuk semua menu makanan saat makan siang",
        discount_percent: 30,
        min_order: 30000,
        valid_until: "2026-05-31",
        gradient: "from-rose-500 via-pink-500 to-orange-400",
        icon: Utensils,
        accent: "bg-white/20",
        shape: "top-[-20px] right-[-20px] w-32 h-32 rounded-full bg-white/10",
    },
    {
        id: 2,
        code: "KOPI20",
        title: "Happy Hour Kopi",
        description: "Nikmati kopi favoritmu dengan diskon 20% setiap sore hari",
        discount_percent: 20,
        min_order: 20000,
        valid_until: "2026-06-15",
        gradient: "from-amber-500 via-yellow-500 to-amber-400",
        icon: Coffee,
        accent: "bg-white/20",
        shape: "bottom-[-30px] right-[-10px] w-40 h-40 rounded-full bg-white/10",
    },
    {
        id: 3,
        code: "NEWUSER50",
        title: "Selamat Datang!",
        description: "Diskon 50% untuk pengguna baru di semua kategori layanan",
        discount_percent: 50,
        min_order: 0,
        valid_until: "2026-12-31",
        gradient: "from-violet-600 via-purple-500 to-indigo-500",
        icon: Gift,
        accent: "bg-white/20",
        shape: "top-[-10px] right-[-30px] w-36 h-36 rounded-full bg-white/10",
    },
    {
        id: 4,
        code: "MART15",
        title: "Belanja Lebih Hemat",
        description: "Potongan 15% untuk belanja kebutuhan sehari-hari di Ulun Mart",
        discount_percent: 15,
        min_order: 50000,
        valid_until: "2026-05-25",
        gradient: "from-emerald-500 via-teal-500 to-green-400",
        icon: ShoppingBag,
        accent: "bg-white/20",
        shape: "bottom-[-20px] left-[-20px] w-28 h-28 rounded-full bg-white/10",
    },
    {
        id: 5,
        code: "KILAT25",
        title: "Pengiriman Kilat",
        description: "Gratis ongkir + diskon 25% untuk layanan kirim ekspres",
        discount_percent: 25,
        min_order: 40000,
        valid_until: "2026-06-01",
        gradient: "from-cyan-500 via-sky-500 to-blue-500",
        icon: Zap,
        accent: "bg-white/20",
        shape: "top-[-15px] left-[-15px] w-32 h-32 rounded-full bg-white/10",
    },
    {
        id: 6,
        code: "WEEKEND10",
        title: "Promo Akhir Pekan",
        description: "Diskon 10% setiap Sabtu & Minggu untuk semua pesanan",
        discount_percent: 10,
        min_order: 25000,
        valid_until: "2026-07-31",
        gradient: "from-fuchsia-500 via-pink-500 to-rose-400",
        icon: Percent,
        accent: "bg-white/20",
        shape: "bottom-[-10px] right-[-20px] w-36 h-36 rounded-full bg-white/10",
    },
];


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

    return (
        <main className="px-4 md:px-6 pb-16 space-y-8">

            {/* ── Header ─────────────────────────────────────────────── */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <DashboardHeader
                    title="Mau pesan apa hari ini?"
                    description="Pilih layanan yang kamu butuhkan"
                />
                <div className="flex items-center gap-3">
                    {/* Wishlist button — always visible */}
                    <Sheet open={wishlistOpen} onOpenChange={setWishlistOpen}>
                        <SheetTrigger asChild>
                            <button className="relative flex items-center gap-2 px-4 py-2 rounded-full border border-border/60 bg-card shadow-sm hover:bg-rose-50 hover:border-rose-200 transition-all text-sm font-bold text-muted-foreground hover:text-rose-600">
                                <Heart className="h-4 w-4 text-rose-500" />
                                <span>Wishlist</span>
                                {wishlist.length > 0 && (
                                    <span className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center">
                                        {wishlist.length}
                                    </span>
                                )}
                            </button>
                        </SheetTrigger>
                        <SheetContent side="right" className="w-full max-w-sm flex flex-col gap-4">
                            <SheetHeader>
                                <SheetTitle className="font-black text-xl flex items-center gap-2">
                                    <Heart className="h-5 w-5 fill-rose-500 text-rose-500" />
                                    Wishlist
                                    <Badge variant="secondary" className="ml-auto">{wishlist.length} item</Badge>
                                </SheetTitle>
                                <SheetDescription className="sr-only">Produk yang disimpan untuk dibeli nanti</SheetDescription>
                            </SheetHeader>
                            <Separator />
                            {wishlist.length === 0 ? (
                                <div className="flex flex-col items-center justify-center flex-1 gap-4 text-muted-foreground py-16">
                                    <Heart className="h-16 w-16 opacity-15" />
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
                                                    className="flex gap-3 p-3 rounded-2xl bg-muted/40 border border-border/50"
                                                >
                                                    <div className="relative h-16 w-16 rounded-xl overflow-hidden flex-shrink-0">
                                                        <Image src={item.productImage} alt={item.productName} fill className="object-cover" />
                                                    </div>
                                                    <div className="flex-1 min-w-0 space-y-1">
                                                        <p className="font-bold text-sm leading-tight line-clamp-2">{item.productName}</p>
                                                        <p className="text-[11px] text-muted-foreground">{item.outletName}</p>
                                                        <div className="flex items-center gap-1">
                                                            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                                                            <span className="text-[11px] font-bold text-amber-600">{item.rating.toFixed(1)}</span>
                                                        </div>
                                                        <div className="flex items-center justify-between">
                                                            <p className="text-sm font-black text-rose-600">{fmt(finalPrice)}</p>
                                                            <div className="flex items-center gap-2">
                                                                <Link
                                                                    href={`/dashboard/order/${item.feature}/${item.outletId}`}
                                                                    onClick={() => setWishlistOpen(false)}
                                                                    className="px-2.5 py-1 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-[11px] font-black transition-colors"
                                                                >
                                                                    Pesan
                                                                </Link>
                                                                <button
                                                                    onClick={() => remove(item.productId)}
                                                                    className="text-muted-foreground hover:text-destructive transition-colors"
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
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

            {/* ── Wishlist ────────────────────────────────────────────── */}
            <AnimatePresence>
                {wishlist.length > 0 && (
                    <motion.section
                        key="wishlist-section"
                        initial={{ opacity: 0, y: -12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        className="space-y-4"
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Heart className="h-5 w-5 fill-rose-500 text-rose-500" />
                                <h2 className="font-black text-lg">Wishlist Kamu</h2>
                                <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-600 text-xs font-black">
                                    {wishlist.length}
                                </span>
                            </div>
                        </div>

                        <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
                            {wishlist.map((item, i) => {
                                const finalPrice = item.discountPercent
                                    ? item.price - Math.floor(item.price * (item.discountPercent / 100))
                                    : item.price;

                                return (
                                    <motion.div
                                        key={item.productId}
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.85, x: -20 }}
                                        transition={{ delay: i * 0.04 }}
                                        className="group flex-shrink-0 w-52 bg-card border border-border/60 rounded-[1.5rem] overflow-hidden shadow-sm hover:shadow-lg transition-all"
                                    >
                                        {/* Image with remove button */}
                                        <div className="relative h-32 overflow-hidden">
                                            <Image
                                                src={item.productImage}
                                                alt={item.productName}
                                                fill
                                                className="object-cover group-hover:scale-110 transition-transform duration-500"
                                            />
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />

                                            {item.discountPercent && (
                                                <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-full bg-rose-500/90 backdrop-blur-sm text-[9px] font-black text-white">
                                                    -{item.discountPercent}%
                                                </span>
                                            )}
                                            <button
                                                onClick={() => remove(item.productId)}
                                                className="absolute top-2.5 right-2.5 h-7 w-7 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-sm hover:bg-red-50 transition-colors"
                                            >
                                                <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                                            </button>

                                            <div className="absolute bottom-2.5 left-2.5">
                                                <span className="text-[10px] font-bold text-white/80 bg-black/30 backdrop-blur-sm px-2 py-0.5 rounded-full">
                                                    {item.outletName}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="p-3 space-y-2">
                                            <p className="font-black text-sm leading-tight line-clamp-2">{item.productName}</p>

                                            <div className="flex items-center gap-1.5">
                                                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                                                <span className="text-xs font-bold text-amber-600">{item.rating.toFixed(1)}</span>
                                            </div>

                                            <div>
                                                {item.discountPercent && (
                                                    <p className="text-[10px] line-through text-muted-foreground">{fmt(item.price)}</p>
                                                )}
                                                <p className="text-sm font-black text-rose-600">{fmt(finalPrice)}</p>
                                            </div>

                                            <Link
                                                href={`/dashboard/order/${item.feature}/${item.outletId}`}
                                                className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-black transition-colors shadow-sm shadow-rose-200"
                                            >
                                                <ShoppingBasket className="h-3.5 w-3.5" />
                                                Pesan Sekarang
                                            </Link>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    </motion.section>
                )}
            </AnimatePresence>
            <section className="space-y-4">
                <div className="flex items-center gap-2">
                    <Tag className="h-5 w-5 text-rose-500" />
                    <h2 className="font-black text-lg">Promo Spesial</h2>
                    <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-600 text-xs font-black">{PROMOS.length} aktif</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {PROMOS.map((promo, i) => (
                        <motion.button
                            key={promo.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.07, type: "spring", stiffness: 200, damping: 20 }}
                            whileHover={{ y: -4, scale: 1.02 }}
                            whileTap={{ scale: 0.97 }}
                            className={`relative text-left w-full bg-gradient-to-br ${promo.gradient} rounded-2xl px-4 py-3 overflow-hidden shadow-md hover:shadow-xl transition-all duration-300`}
                        >
                            {/* Decorative circle */}
                            <div className={`absolute ${promo.shape}`} />

                            <div className="relative z-10 flex items-center gap-3">
                                {/* Icon */}
                                <div className="h-9 w-9 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
                                    <promo.icon className="h-4 w-4 text-white" />
                                </div>

                                {/* Middle */}
                                <div className="flex-1 min-w-0">
                                    <p className="font-black text-white text-sm leading-tight truncate">{promo.title}</p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className="font-bold text-white/70 text-[10px] tracking-widest uppercase">{promo.code}</span>
                                        <span className="text-white/50 text-[10px]">·</span>
                                        <div className="flex items-center gap-0.5 text-white/70">
                                            <Clock className="h-2.5 w-2.5" />
                                            <span className="text-[10px] font-bold">
                                                s/d {new Date(promo.valid_until).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Discount */}
                                <div className="flex-shrink-0 text-right">
                                    <span className="font-black text-white text-xl leading-none">{promo.discount_percent}%</span>
                                    <span className="text-[10px] font-bold text-white/70 block">OFF</span>
                                </div>
                            </div>
                        </motion.button>
                    ))}
                </div>
            </section>

            {/* ── Feature grid ────────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {ORDER_FEATURES.map((feature, i) => (
                    <motion.div
                        key={feature.slug}
                        initial={{ opacity: 0, y: 24 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.06, type: "spring", stiffness: 200, damping: 20 }}
                        whileHover={{ y: -6, scale: 1.02 }}
                        whileTap={{ scale: 0.97 }}
                    >
                        <Link
                            href={`/dashboard/order/${feature.slug}`}
                            className={`group relative flex flex-col gap-4 p-5 rounded-[1.75rem] border border-border/60 bg-gradient-to-br ${feature.gradient} shadow-sm hover:shadow-xl hover:border-border transition-all duration-300 h-full`}
                        >
                            {feature.badge && (
                                <span className={`absolute top-4 right-4 px-2.5 py-0.5 rounded-full text-[10px] font-black
                                    ${feature.badge === "Terpopuler" ? "bg-rose-500 text-white" : ""}
                                    ${feature.badge === "Baru" ? "bg-emerald-500 text-white" : ""}
                                    ${feature.badge === "Segera" ? "bg-muted text-muted-foreground" : ""}
                                `}>
                                    {feature.badge}
                                </span>
                            )}

                            <div className={`h-14 w-14 rounded-2xl ${feature.iconBg} flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform duration-300`}>
                                <feature.icon className={`h-7 w-7 ${feature.iconColor}`} />
                            </div>

                            <div className="space-y-1 flex-1">
                                <h3 className="font-black text-base leading-tight">{feature.label}</h3>
                                <p className="text-xs text-muted-foreground leading-snug">{feature.description}</p>
                            </div>

                            <div className="flex items-center justify-between">
                                <span className="text-[11px] font-bold text-muted-foreground/70">{feature.count}</span>
                                <div className={`h-7 w-7 rounded-full ${feature.iconBg} flex items-center justify-center group-hover:translate-x-1 transition-transform duration-300`}>
                                    <ArrowRight className={`h-3.5 w-3.5 ${feature.iconColor}`} />
                                </div>
                            </div>
                        </Link>
                    </motion.div>
                ))}
            </div>
        </main>
    );
}
