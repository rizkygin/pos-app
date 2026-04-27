"use client";

import React from "react";
import {
    Search,
    MapPin,
    Utensils,
    ShoppingBag,
    Truck,
    Bike,
    Coffee,
    Pizza,
    Heart,
    Clock,
    Star,
    Bell,
    User,
    ArrowRight
} from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DashboardHeader } from "@/components/dashboard-header";
import Image from "next/image";

export const CustomerDashboard = () => {
    const categories = [
        { name: "Food", icon: Utensils, color: "bg-orange-100 text-orange-600" },
        { name: "Mart", icon: ShoppingBag, color: "bg-emerald-100 text-emerald-600" },
        { name: "Send", icon: Truck, color: "bg-blue-100 text-blue-600" },
        { name: "Ride", icon: Bike, color: "bg-purple-100 text-purple-600" },
        { name: "Coffee", icon: Coffee, color: "bg-amber-100 text-amber-800" },
        { name: "Promo", icon: Star, color: "bg-rose-100 text-rose-600" },
    ];

    const restaurants = [
        { name: "Bakmie GM - Thamrin", rating: "4.8", time: "20 min", distance: "1.2 km", image: "https://images.unsplash.com/photo-1585032226651-759b368d7246?w=500&auto=format&fit=crop&q=60" },
        { name: "Kopi Kenangan", rating: "4.9", time: "15 min", distance: "0.8 km", image: "/images/coffee.jpg" },
        { name: "Pizza Hut", rating: "4.7", time: "30 min", distance: "2.5 km", image: "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=500&auto=format&fit=crop&q=60" },
    ];

    return (
        <main className="px-4 mx-2 md:mx-6 pb-12 space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <DashboardHeader
                    title="Hi, Welcome Back!"
                    description="What would you like to order today?"
                />

                <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground bg-muted/30 px-4 py-2 rounded-full border border-border/50">
                    <MapPin className="h-4 w-4 text-rose-500" />
                    <span>Sudirman, Jakarta</span>
                </div>
            </div>

            {/* Search Bar */}
            <div className="relative max-w-2xl">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                    placeholder="Search for food, mart, or services..."
                    className="pl-12 py-7 rounded-2xl text-lg shadow-lg border-none bg-card focus-visible:ring-primary/20 transition-all"
                />
            </div>

            {/* Promo Banner */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-r from-rose-500 to-rose-600 p-8 md:p-12 text-white"
            >
                <div className="relative z-10 space-y-4 max-w-md">
                    <span className="px-3 py-1 rounded-full bg-white/20 text-[10px] font-black uppercase tracking-widest">Flash Sale</span>
                    <h2 className="text-4xl md:text-5xl font-black leading-tight">Discount up to 50% for all food!</h2>
                    <p className="text-rose-100 font-medium">Valid only for today. Don't miss out on your favorite meals.</p>
                    <Button className="rounded-full bg-white text-rose-600 hover:bg-rose-50 font-black px-8 py-6">
                        Claim Now
                    </Button>
                </div>
                <div className="absolute right-0 bottom-0 top-0 w-1/2 hidden lg:block">
                    <Image
                        src="https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&auto=format&fit=crop&q=60"
                        alt="Promo"
                        fill
                        className="object-cover opacity-40 mix-blend-overlay"
                    />
                </div>
            </motion.div>

            {/* Categories */}
            <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
                {categories.map((cat, i) => (
                    <motion.button
                        key={i}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.05 }}
                        className="flex flex-col items-center gap-3 group"
                    >
                        <div className={`w-16 h-16 md:w-20 md:h-20 rounded-3xl ${cat.color} flex items-center justify-center shadow-sm group-hover:shadow-md group-hover:-translate-y-1 transition-all duration-300`}>
                            <cat.icon className="h-8 w-8" />
                        </div>
                        <span className="text-xs font-black uppercase tracking-widest text-muted-foreground group-hover:text-foreground transition-colors">{cat.name}</span>
                    </motion.button>
                ))}
            </div>

            {/* Recommended Section */}
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <h3 className="text-2xl font-black tracking-tight">Nearby Restaurants</h3>
                    <Button variant="ghost" className="font-bold text-rose-600 hover:text-rose-700">
                        See All <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                </div>

                <div className="grid gap-6 md:grid-cols-3">
                    {restaurants.map((res, i) => (
                        <motion.div
                            key={i}
                            whileHover={{ y: -8 }}
                            className="group cursor-pointer space-y-4"
                        >
                            <div className="relative aspect-[4/3] rounded-[2rem] overflow-hidden shadow-lg border border-border/50">
                                <Image
                                    src={res.image}
                                    alt={res.name}
                                    fill
                                    className="object-cover group-hover:scale-110 transition-transform duration-500"
                                />
                                <div className="absolute top-4 right-4 px-3 py-1 rounded-full bg-white/90 backdrop-blur-sm shadow-sm flex items-center gap-1">
                                    <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                                    <span className="text-xs font-bold text-black">{res.rating}</span>
                                </div>
                            </div>
                            <div className="px-2">
                                <h4 className="text-lg font-black leading-tight group-hover:text-rose-600 transition-colors">{res.name}</h4>
                                <div className="flex items-center gap-3 mt-1 text-muted-foreground">
                                    <div className="flex items-center gap-1">
                                        <Clock className="h-3 w-3" />
                                        <span className="text-xs font-bold">{res.time}</span>
                                    </div>
                                    <div className="h-1 w-1 rounded-full bg-muted-foreground/30" />
                                    <span className="text-xs font-bold">{res.distance}</span>
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </div>
        </main>
    );
};
