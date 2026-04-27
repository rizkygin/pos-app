"use client";

import React, { useState } from "react";
import { 
    Wallet, 
    MapPin, 
    Navigation, 
    Star, 
    Clock, 
    CheckCircle2, 
    TrendingUp, 
    Bike, 
    Bell,
    Power,
    ArrowRight,
    MessageSquare,
    Phone
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { DashboardHeader } from "@/components/dashboard-header";

export const CourierDashboard = () => {
    const [isOnline, setIsOnline] = useState(true);

    const stats = [
        { label: "Earnings Today", value: "Rp 150.000", icon: Wallet, color: "text-emerald-600", bg: "bg-emerald-100" },
        { label: "Rating", value: "4.9", icon: Star, color: "text-amber-600", bg: "bg-amber-100" },
        { label: "Completion", value: "98%", icon: CheckCircle2, color: "text-blue-600", bg: "bg-blue-100" },
        { label: "Online Time", value: "5h 20m", icon: Clock, color: "text-purple-600", bg: "bg-purple-100" },
    ];

    const activeOrder = {
        id: "#ORD-9921",
        customer: "Budi Santoso",
        pickup: "Restoran Padang Sederhana",
        dropoff: "Jl. Sudirman No. 45",
        items: "3 items",
        amount: "Rp 85.000",
        status: "At Restaurant"
    };

    return (
        <main className="px-4 mx-2 md:mx-6 pb-12 space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <DashboardHeader
                    title="Courier Dashboard"
                    description="Keep moving and keep earning. Track your deliveries in real-time."
                />
                
                <div className="flex items-center gap-3">
                    <div className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all duration-300 ${isOnline ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
                        <div className={`h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                        <span className="text-sm font-bold">{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
                    </div>
                    <Button 
                        variant={isOnline ? "destructive" : "default"}
                        size="sm"
                        onClick={() => setIsOnline(!isOnline)}
                        className="rounded-full px-6 font-bold shadow-lg"
                    >
                        <Power className="h-4 w-4 mr-2" />
                        {isOnline ? 'Go Offline' : 'Go Online'}
                    </Button>
                </div>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                {stats.map((stat, i) => (
                    <motion.div 
                        key={i}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                        className="p-4 rounded-2xl border bg-card/50 backdrop-blur-sm shadow-sm hover:shadow-md transition-all"
                    >
                        <div className="flex items-center gap-3 mb-2">
                            <div className={`p-2 rounded-lg ${stat.bg} ${stat.color}`}>
                                <stat.icon className="h-4 w-4" />
                            </div>
                            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{stat.label}</span>
                        </div>
                        <h2 className="text-xl font-extrabold">{stat.value}</h2>
                    </motion.div>
                ))}
            </div>

            <div className="grid gap-8 lg:grid-cols-3">
                {/* Active Delivery Section */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-extrabold tracking-tight">Active Delivery</h3>
                        <Button variant="ghost" size="sm" className="text-xs font-bold text-blue-600 hover:text-blue-700">View Map</Button>
                    </div>

                    <AnimatePresence mode="wait">
                        {isOnline ? (
                            <motion.div 
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="group relative overflow-hidden rounded-[2.5rem] border bg-gradient-to-br from-blue-600/5 to-transparent p-8 shadow-xl border-blue-100/50"
                            >
                                <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                                    <Bike className="h-32 w-32 -rotate-12" />
                                </div>

                                <div className="relative z-10 space-y-8">
                                    <div className="flex justify-between items-start">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <span className="px-3 py-1 rounded-full bg-blue-600 text-white text-[10px] font-black uppercase tracking-tighter">Current Order</span>
                                                <span className="text-sm font-bold text-blue-600">{activeOrder.id}</span>
                                            </div>
                                            <h4 className="text-3xl font-black">{activeOrder.customer}</h4>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Amount</p>
                                            <p className="text-2xl font-black text-emerald-600">{activeOrder.amount}</p>
                                        </div>
                                    </div>

                                    <div className="grid gap-6 md:grid-cols-2">
                                        <div className="flex gap-4">
                                            <div className="flex flex-col items-center">
                                                <div className="h-6 w-6 rounded-full bg-blue-600 flex items-center justify-center">
                                                    <MapPin className="h-3 w-3 text-white" />
                                                </div>
                                                <div className="w-0.5 h-12 bg-gradient-to-b from-blue-600 to-emerald-600" />
                                                <div className="h-6 w-6 rounded-full bg-emerald-600 flex items-center justify-center">
                                                    <Navigation className="h-3 w-3 text-white" />
                                                </div>
                                            </div>
                                            <div className="flex flex-col justify-between py-0.5">
                                                <div className="space-y-0.5">
                                                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Pickup</p>
                                                    <p className="text-sm font-bold line-clamp-1">{activeOrder.pickup}</p>
                                                </div>
                                                <div className="space-y-0.5">
                                                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Delivery To</p>
                                                    <p className="text-sm font-bold line-clamp-1">{activeOrder.dropoff}</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex flex-col justify-end gap-3">
                                            <div className="flex gap-2">
                                                <Button className="flex-1 rounded-xl font-bold bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-600/20">
                                                    Arrived at Pickup
                                                </Button>
                                            </div>
                                            <div className="flex gap-2">
                                                <Button variant="outline" size="icon" className="rounded-xl aspect-square h-12">
                                                    <MessageSquare className="h-4 w-4" />
                                                </Button>
                                                <Button variant="outline" size="icon" className="rounded-xl aspect-square h-12">
                                                    <Phone className="h-4 w-4" />
                                                </Button>
                                                <Button variant="outline" className="flex-1 rounded-xl font-bold border-rose-200 text-rose-600 hover:bg-rose-50">
                                                    Cancel
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        ) : (
                            <div className="rounded-[2.5rem] border border-dashed border-muted p-20 flex flex-col items-center justify-center text-center space-y-4">
                                <div className="p-4 rounded-full bg-muted/50">
                                    <Power className="h-12 w-12 text-muted-foreground" />
                                </div>
                                <div className="space-y-1">
                                    <h4 className="text-xl font-bold">You are currently offline</h4>
                                    <p className="text-sm text-muted-foreground">Go online to start receiving delivery requests.</p>
                                </div>
                                <Button onClick={() => setIsOnline(true)} className="rounded-full px-8 font-bold">Go Online Now</Button>
                            </div>
                        )}
                    </AnimatePresence>

                    {/* Delivery History */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-extrabold tracking-tight">Recent Deliveries</h3>
                            <Button variant="link" className="text-xs font-bold">See All History</Button>
                        </div>
                        <div className="space-y-3">
                            {[1, 2, 3].map((_, i) => (
                                <div key={i} className="group flex items-center justify-between p-4 rounded-2xl border bg-card/50 hover:bg-card transition-all cursor-pointer">
                                    <div className="flex items-center gap-4">
                                        <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
                                            <Bike className="h-5 w-5 text-muted-foreground group-hover:text-blue-600 transition-colors" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold">Jl. Antasari No. {20 + i}</p>
                                            <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">Completed • 2h ago</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-bold tabular-nums">Rp {15000 + (i * 2500)}</p>
                                        <div className="flex items-center justify-end gap-1">
                                            <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                                            <span className="text-[10px] font-bold">5.0</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Sidebar Stats */}
                <div className="space-y-6">
                    {/* Performance Card */}
                    <div className="rounded-[2rem] border bg-gradient-to-br from-purple-600 to-indigo-700 p-6 text-white shadow-xl shadow-indigo-600/20">
                        <div className="flex items-center justify-between mb-8">
                            <h4 className="font-black uppercase tracking-widest text-xs opacity-80">This Week</h4>
                            <TrendingUp className="h-4 w-4 opacity-80" />
                        </div>
                        <div className="space-y-2 mb-8">
                            <p className="text-xs font-bold opacity-60">Total Earnings</p>
                            <h2 className="text-4xl font-black">Rp 2.450.000</h2>
                            <p className="text-[10px] font-bold bg-white/20 w-fit px-2 py-0.5 rounded-full">+18.5% from last week</p>
                        </div>
                        <div className="grid grid-cols-2 gap-4 border-t border-white/10 pt-6">
                            <div>
                                <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest mb-1">Orders</p>
                                <p className="text-xl font-black">42</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest mb-1">Incentives</p>
                                <p className="text-xl font-black">Rp 120k</p>
                            </div>
                        </div>
                    </div>

                    {/* Notifications */}
                    <div className="rounded-2xl border bg-card/50 p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <h4 className="text-sm font-black uppercase tracking-widest">Notifications</h4>
                            <Bell className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="space-y-4">
                            <div className="flex gap-3">
                                <div className="h-2 w-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                                <div>
                                    <p className="text-xs font-bold">Bonus period active!</p>
                                    <p className="text-[10px] text-muted-foreground">Get extra 2k for every delivery between 5-7 PM.</p>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <div className="h-2 w-2 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                                <div>
                                    <p className="text-xs font-bold">Rating updated</p>
                                    <p className="text-[10px] text-muted-foreground">Your performance rating increased to 4.9. Good job!</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Quick Support */}
                    <Button variant="outline" className="w-full rounded-2xl py-8 border-dashed flex flex-col gap-1 hover:border-blue-500 hover:bg-blue-50 transition-all">
                        <span className="text-xs font-black uppercase tracking-widest">Need Help?</span>
                        <span className="text-[10px] text-muted-foreground">Contact support agent</span>
                    </Button>
                </div>
            </div>
        </main>
    );
};
