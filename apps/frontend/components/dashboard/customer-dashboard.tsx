"use client";

import React, { useEffect, useState } from "react";
import {
    MapPin,
    Utensils,
    ShoppingBag,
    Truck,
    Bike,
    Coffee,
    Wrench,
    Star,
    ChevronLeft,
    ChevronRight,
    Compass,
    Wallet,
    ArrowRight,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogMedia,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import Image from "next/image";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils/format";
import { resolveProductImage, resolveBannerImage, isBackendImage } from "@/lib/image-src";
import { API_URL } from "@/lib/api-url";
import { CustomerHero, type ActiveLocation } from "@/components/dashboard/customer-hero";

type LastOrder = {
    orderId: string;
    outletId: number;
    outletName: string;
    outletAvatar: string;
    productFeature: string[];
    itemCount: number;
    totalAmount: number;
    itemsSummary: string;
};

type RecommendedMenu = {
    outletId: number;
    outletFeature: string;
    menuName: string;
    rating: string;
    distance: string;
    image: string;
};

type AdBanner = {
    id: number;
    title: string;
    description: string;
    bannerImage: string;
    outletId: number;
    outletFeature: string;
    productName: string;
};

function getOutletAvatarSrc(avatar: string): string {
    if (!avatar || avatar === "avatar.png") return "/avatar.png";
    if (avatar.startsWith("http")) return avatar;
    // Backend-served uploads live on the API origin, not the frontend public dir.
    if (avatar.startsWith("/uploads/")) return `${API_URL}${avatar}`;
    if (avatar.startsWith("/")) return avatar;
    return `/avatars/${avatar}`;
}

function getProductImageSrc(image: string): string {
    return resolveProductImage(image);
}

function getAdBannerSrc(image: string): string {
    return resolveBannerImage(image);
}

type CustomerDashboardProps = {
    lastOrders?: LastOrder[];
    recommend?: RecommendedMenu[];
    ads?: AdBanner[];
    hasLocation?: boolean;
    location?: ActiveLocation;
    hasActiveErrand?: boolean;
};

export const CustomerDashboard = ({ lastOrders = [], recommend = [], ads = [], hasLocation = true, location = null, hasActiveErrand = false }: CustomerDashboardProps) => {
    const [adIndex, setAdIndex] = useState(0);

    useEffect(() => {
        if (ads.length <= 1) return;
        const interval = setInterval(() => {
            setAdIndex((i) => (i + 1) % ads.length);
        }, 5000);
        return () => clearInterval(interval);
    }, [ads.length]);

    const goToPrevAd = () => setAdIndex((i) => (i - 1 + ads.length) % ads.length);
    const goToNextAd = () => setAdIndex((i) => (i + 1) % ads.length);

    const categories = [
        { name: "Food", icon: Utensils, url: 'food', color: "bg-orange-100 text-orange-600" , available: 'available'},
        { name: "Mart", icon: ShoppingBag,url: 'mart', color: "bg-emerald-100 text-emerald-600" , available: 'available'},
        { name: "Minuman", icon: Coffee, url: 'drink', color: "bg-amber-100 text-amber-800" , available: 'available'},
        { name: "Jasa", icon: Wrench, url: 'service', color: "bg-amber-100 text-amber-800", available: 'available' },
        // Tugaskan Kurir hires a courier directly, so it does NOT live under
        // /dashboard/order/<slug> like the category tiles around it — hence the
        // explicit href.
        { name: "Tugaskan Kurir", icon: Truck, url:'suruh-kurir', href: '/dashboard/suruh-kurir', color: "bg-blue-100 text-blue-600" , available: 'available', badge: hasActiveErrand},
        { name: "Ride", icon: Bike, url: 'ride',color: "bg-purple-100 text-purple-600" , available: 'non'},
    ];

    return (
        <main className="px-4 mx-2 md:mx-6 pb-12 space-y-8">
            {/* Address first, then search — both above the greeting, because
                "where does this go" and "what am I looking for" are the two
                things a customer arrives with. */}
            <CustomerHero location={location} />

            {/* Promo Banner */}
            {ads.length > 0 && (
                <div className="relative overflow-hidden rounded-[2rem] h-36 md:h-48 text-white">
                    <AnimatePresence initial={false} mode="popLayout">
                        <motion.div
                            key={ads[adIndex].id}
                            initial={{ opacity: 0, x: 40 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -40 }}
                            transition={{ duration: 0.4 }}
                            className="absolute inset-0"
                        >
                            <Image
                                src={getAdBannerSrc(ads[adIndex].bannerImage)}
                                unoptimized={isBackendImage(ads[adIndex].bannerImage)}
                                alt={ads[adIndex].title}
                                fill
                                className="object-cover"
                            />
                            <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent" />
                            <div className="relative z-10 flex h-full flex-col justify-center gap-2 max-w-md px-5 md:px-10">
                                <span className="w-fit px-3 py-1 rounded-full bg-white/20 text-[10px] font-black uppercase tracking-widest backdrop-blur-sm">Promo</span>
                                <h2 className="text-xl md:text-3xl font-black leading-tight line-clamp-2">{ads[adIndex].title}</h2>
                                {ads[adIndex].description && (
                                    <p className="text-sm text-white/80 font-medium line-clamp-1">{ads[adIndex].description}</p>
                                )}
                                <Button asChild size="sm" className="w-fit rounded-full bg-white text-rose-600 hover:bg-rose-50 font-black mt-1">
                                    <Link href={`/dashboard/order/${ads[adIndex].outletFeature}/${ads[adIndex].outletId}`}>Lihat Menu</Link>
                                </Button>
                            </div>
                        </motion.div>
                    </AnimatePresence>

                    {ads.length > 1 && (
                        <>
                            <button
                                onClick={goToPrevAd}
                                aria-label="Previous ad"
                                className="absolute left-2 top-1/2 -translate-y-1/2 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm hover:bg-black/50 transition-colors"
                            >
                                <ChevronLeft className="h-5 w-5" />
                            </button>
                            <button
                                onClick={goToNextAd}
                                aria-label="Next ad"
                                className="absolute right-2 top-1/2 -translate-y-1/2 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm hover:bg-black/50 transition-colors"
                            >
                                <ChevronRight className="h-5 w-5" />
                            </button>

                            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex gap-1.5">
                                {ads.map((ad, i) => (
                                    <button
                                        key={ad.id}
                                        onClick={() => setAdIndex(i)}
                                        aria-label={`Go to ad ${i + 1}`}
                                        className={`h-1.5 rounded-full transition-all ${i === adIndex ? 'w-6 bg-white' : 'w-1.5 bg-white/40'}`}
                                    />
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Categories */}
            <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
                {categories.map((cat, i) => {
                    const isAvailable = cat.available === 'available';

                    const content = (
                        <>
                            {/* The whole tile hops while an errand is live, so
                                the badge is noticed even at a glance. */}
                            <motion.div
                                className="relative"
                                animate={cat.badge ? { y: [0, -7, 0] } : { y: 0 }}
                                transition={cat.badge ? { duration: 0.9, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
                            >
                                <div className={`w-16 h-16 md:w-20 md:h-20 rounded-3xl ${isAvailable ? cat.color : "bg-muted text-muted-foreground"} flex items-center justify-center shadow-sm transition-all duration-300 ${isAvailable ? "group-hover:shadow-md group-hover:-translate-y-1" : "opacity-50"}`}>
                                    <cat.icon className="h-8 w-8" />
                                </div>
                                {/* Live errand: a red dot is the only thing that
                                    pulls the eye back to the tile the customer
                                    needs to reopen. */}
                                {cat.badge && (
                                    <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                                        <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-red-600 ring-2 ring-background" />
                                    </span>
                                )}
                            </motion.div>
                            <span className={`text-xs font-black uppercase tracking-widest transition-colors ${isAvailable ? "text-muted-foreground group-hover:text-foreground" : "text-muted-foreground/50"}`}>{cat.name}</span>
                        </>
                    );

                    return (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: i * 0.05 }}
                        >
                            {isAvailable ? (
                                <Link
                                    href={cat.href ?? `/dashboard/order/${cat.url}`}
                                    className="flex flex-col items-center gap-3 group"
                                >
                                    {content}
                                </Link>
                            ) : (
                                <div
                                    aria-disabled="true"
                                    className="flex flex-col items-center gap-3 group cursor-not-allowed"
                                >
                                    {content}
                                </div>
                            )}
                        </motion.div>
                    );
                })}
            </div>

            {/* First-order guide — replaces the dead space a brand-new customer
                used to land on: "Pesan Lagi" has nothing to show them (no
                history yet), so this fills that exact spot instead of leaving
                a gap between the category grid and Rekomendasi. Only shown
                once real order history exists is there anything to repeat, so
                this naturally disappears after a first completed order. */}
            {lastOrders.length === 0 && (
                <div className="rounded-[2rem] border border-dashed border-rose-200 bg-rose-50/40 p-6 md:p-8 dark:border-rose-900/40 dark:bg-rose-950/10">
                    <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                        <div className="space-y-1.5">
                            <h3 className="text-xl font-black tracking-tight md:text-2xl">
                                Belum ada pesanan — yuk, mulai yang pertama!
                            </h3>
                            <p className="max-w-md text-sm font-medium text-muted-foreground">
                                Pilih kategori di atas, cari outlet favorit, lalu bayar tunai
                                waktu pesanan sampai. Gampang, kada ribet.
                            </p>
                        </div>
                        <Button
                            asChild
                            size="lg"
                            className="w-fit shrink-0 rounded-2xl bg-rose-600 font-black hover:bg-rose-700"
                        >
                            <Link href={!hasLocation ? "/dashboard/users/locations/setting" : "/dashboard/order/food"}>
                                {!hasLocation ? "Atur Lokasi Dulu" : "Mulai Pesan"}
                                <ArrowRight className="ml-1.5 h-4 w-4" />
                            </Link>
                        </Button>
                    </div>

                    {/* 3-step explainer for someone who has never used the app
                        before — no assumptions about prior GoFood/GrabFood
                        familiarity. */}
                    <div className="mt-6 grid grid-cols-1 gap-4 border-t border-rose-200/60 pt-6 sm:grid-cols-3 dark:border-rose-900/30">
                        {[
                            {
                                icon: Compass,
                                title: "1. Pilih Kategori",
                                desc: "Makanan, minuman, mart, atau jasa — pilih yang pian handaki.",
                            },
                            {
                                icon: ShoppingBag,
                                title: "2. Pilih Outlet & Menu",
                                desc: "Cari outlet terdekat, lihat menu, masukkan ke keranjang.",
                            },
                            {
                                icon: Wallet,
                                title: "3. Bayar Tunai di Tempat",
                                desc: "Bayar langsung ke kurir waktu pesanan sampai di rumah.",
                            },
                        ].map((step, i) => (
                            <div key={i} className="flex items-start gap-3">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
                                    <step.icon className="h-4 w-4" />
                                </div>
                                <div>
                                    <p className="text-xs font-black uppercase tracking-wide">{step.title}</p>
                                    <p className="mt-0.5 text-xs font-medium text-muted-foreground">{step.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Last Orders / Repeat Order Section */}
            {lastOrders.length > 0 && (
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <h3 className="text-2xl font-black tracking-tight">Pesan Lagi</h3>
                    </div>

                    <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
                        {lastOrders.map((order) => (
                            <motion.div
                                key={order.orderId}
                                whileHover={{ y: -4 }}
                                className="shrink-0 w-72 rounded-3xl border border-border/50 bg-background shadow-sm p-4 flex flex-col gap-3"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="relative h-12 w-12 rounded-2xl overflow-hidden border border-border/50 shrink-0">
                                        <Image
                                            src={getOutletAvatarSrc(order.outletAvatar)}
                                            unoptimized={isBackendImage(order.outletAvatar)}
                                            alt={order.outletName}
                                            fill
                                            className="object-cover"
                                        />
                                    </div>
                                    <div className="min-w-0">
                                        <h4 className="font-black truncate">{order.outletName}</h4>
                                        <p className="text-xs font-bold text-muted-foreground truncate">
                                            {order.itemsSummary || `${order.itemCount} item`}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-black text-rose-600">
                                        {formatCurrency(order.totalAmount)}
                                    </span>
                                    <Button asChild size="sm" className="rounded-full font-black bg-rose-600 hover:bg-rose-700">
                                        <Link href={`/dashboard/order/${order.productFeature?.[0] ?? 'food'}/${order.outletId}`}>Order Lagi</Link>
                                    </Button>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            )}

            {/* Recommended Section */}
            {recommend.length > 0 && (
                <div className="space-y-6 lg:min-h-50">
                    <div className="flex items-center justify-between">
                        <h3 className="text-2xl font-black tracking-tight">Rekomendasi untuk pian</h3>
                    </div>

                    <div className="grid gap-6 grid-cols-2 lg:grid-cols-5">
                        {recommend.map((menu, i) => (
                            <Link key={i} href={`/dashboard/order/${menu.outletFeature}/${menu.outletId}`}>
                                <motion.div
                                    whileHover={{ y: -8 }}
                                    className="group cursor-pointer space-y-4"
                                >
                                    <div className="relative aspect-[4/3] rounded-[2rem] overflow-hidden shadow-lg border border-border/50">
                                        <Image
                                            src={getProductImageSrc(menu.image)}
                                            unoptimized={isBackendImage(menu.image)}
                                            alt={menu.menuName}
                                            fill
                                            className="object-cover group-hover:scale-110 transition-transform duration-500"
                                        />
                                        <div className="absolute top-4 right-4 px-3 py-1 rounded-full bg-white/90 backdrop-blur-sm shadow-sm flex items-center gap-1">
                                            <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                                            <span className="text-xs font-bold text-black">{parseFloat(menu.rating).toFixed(1)}</span>
                                        </div>
                                    </div>
                                    <div className="px-2">
                                        <h4 className="text-lg font-black leading-tight group-hover:text-rose-600 transition-colors">{menu.menuName}</h4>
                                        <div className="flex items-center gap-1 mt-1 text-muted-foreground">
                                            <MapPin className="h-3 w-3" />
                                            <span className="text-xs font-bold">{menu.distance}</span>
                                        </div>
                                    </div>
                                </motion.div>
                            </Link>
                        ))}
                    </div>
                </div>
            )}

            <AlertDialog open={!hasLocation}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogMedia className="size-12 bg-rose-50 text-rose-600">
                            <MapPin className="size-6" />
                        </AlertDialogMedia>
                        <AlertDialogTitle>Lokasi Belum Diatur</AlertDialogTitle>
                        <AlertDialogDescription>
                            Pian wajib mengatur lokasi pengiriman terlebih dahulu agar pesanan bisa diproses.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogAction asChild>
                            <Link href="/dashboard/users/locations/setting">Atur Lokasi</Link>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </main>
    );
};
