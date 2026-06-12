"use client";

import React from "react";
import {
    MapPin,
    Utensils,
    ShoppingBag,
    Truck,
    Bike,
    Coffee,
    Wrench,
    Star,
} from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { DashboardHeader } from "@/components/dashboard-header";
import Image from "next/image";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils/format";

type LastOrder = {
    orderId: string;
    outletId: number;
    outletName: string;
    outletAvatar: string;
    outletFeature: string;
    itemCount: number;
    totalAmount: number;
    itemsSummary: string;
};

type RecommendedMenu = {
    outletId: number;
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
    if (avatar.startsWith("http") || avatar.startsWith("/")) return avatar;
    return `/avatars/${avatar}`;
}

function getProductImageSrc(image: string): string {
    if (!image || image === "avatar.png") return "/avatar.png";
    if (image.startsWith("http") || image.startsWith("/")) return image;
    return `/products/${image}`;
}

function getAdBannerSrc(image: string): string {
    if (!image) return "/avatar.png";
    if (image.startsWith("http") || image.startsWith("/")) return image;
    return `/ads/${image}`;
}

type CustomerDashboardProps = {
    lastOrders?: LastOrder[];
    recommend?: RecommendedMenu[];
    ads?: AdBanner[];
};

export const CustomerDashboard = ({ lastOrders = [], recommend = [], ads = [] }: CustomerDashboardProps) => {
    const categories = [
        { name: "Food", icon: Utensils, url: 'food', color: "bg-orange-100 text-orange-600" , available: 'available'},
        { name: "Send", icon: Truck, url:'send', color: "bg-blue-100 text-blue-600" , available: 'available'},
        { name: "Ride", icon: Bike, url: 'ride',color: "bg-purple-100 text-purple-600" , available: 'available'},
        { name: "Mart", icon: ShoppingBag,url: 'mart', color: "bg-emerald-100 text-emerald-600" , available: 'available'},
        { name: "Minuman", icon: Coffee, url: 'drink', color: "bg-amber-100 text-amber-800" , available: 'available'},
        { name: "Jasa", icon: Wrench, url: 'service', color: "bg-amber-100 text-amber-800", available: 'non' },
    ];

    return (
        <main className="px-4 mx-2 md:mx-6 pb-12 space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <DashboardHeader
                    title="Honda pesan apa?"
                    description="What would you like to order today?"
                />

                {/* <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground bg-muted/30 px-4 py-2 rounded-full border border-border/50">
                    <MapPin className="h-4 w-4 text-rose-500" />
                    <span>Sudirman, Jakarta</span>
                </div> */}
            </div>

            {/* Promo Banner */}
            {ads.length > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="relative overflow-hidden rounded-[2rem] h-36 md:h-48 text-white"
                >
                    <Image
                        src={getAdBannerSrc(ads[0].bannerImage)}
                        alt={ads[0].title}
                        fill
                        className="object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent" />
                    <div className="relative z-10 flex h-full flex-col justify-center gap-2 max-w-md px-5 md:px-10">
                        <span className="w-fit px-3 py-1 rounded-full bg-white/20 text-[10px] font-black uppercase tracking-widest backdrop-blur-sm">Promo</span>
                        <h2 className="text-xl md:text-3xl font-black leading-tight line-clamp-2">{ads[0].title}</h2>
                        {ads[0].description && (
                            <p className="text-sm text-white/80 font-medium line-clamp-1">{ads[0].description}</p>
                        )}
                        <Button asChild size="sm" className="w-fit rounded-full bg-white text-rose-600 hover:bg-rose-50 font-black mt-1">
                            <Link href={`/dashboard/order/${ads[0].outletFeature}/${ads[0].outletId}`}>Lihat Menu</Link>
                        </Button>
                    </div>
                </motion.div>
            )}

            {/* Categories */}
            <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
                {categories.map((cat, i) => {
                    const isAvailable = cat.available === 'available';

                    const content = (
                        <>
                            <div className={`w-16 h-16 md:w-20 md:h-20 rounded-3xl ${isAvailable ? cat.color : "bg-muted text-muted-foreground"} flex items-center justify-center shadow-sm transition-all duration-300 ${isAvailable ? "group-hover:shadow-md group-hover:-translate-y-1" : "opacity-50"}`}>
                                <cat.icon className="h-8 w-8" />
                            </div>
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
                                    href={`/dashboard/order/${cat.url}`}
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
                                        <Link href={`/dashboard/order/${order.outletFeature}/${order.outletId}`}>Order Lagi</Link>
                                    </Button>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            )}

            {/* Recommended Section */}
            {recommend.length > 0 && (
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <h3 className="text-2xl font-black tracking-tight">Rekomendasi untuk pian</h3>
                    </div>

                    <div className="grid gap-6 md:grid-cols-3">
                        {recommend.map((menu, i) => (
                            <Link key={i} href={`/menu/${menu.outletId}`}>
                                <motion.div
                                    whileHover={{ y: -8 }}
                                    className="group cursor-pointer space-y-4"
                                >
                                    <div className="relative aspect-[4/3] rounded-[2rem] overflow-hidden shadow-lg border border-border/50">
                                        <Image
                                            src={getProductImageSrc(menu.image)}
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
        </main>
    );
};
