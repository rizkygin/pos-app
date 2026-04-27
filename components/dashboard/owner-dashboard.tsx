'use client'
import { DashboardHeader } from "@/components/dashboard-header";
import {
    TrendingUp,
    ShoppingBag,
    Layers,
    AlertTriangle,
    ArrowUpRight,
    ShoppingCart,
    History,
    User,
    MessageSquare
} from "lucide-react";
import { Button } from "@/components/ui/button";
export const OwnerDashboard = () => {
    return (
        <main className="px-4 mx-2 md:mx-6 pb-12">
            <DashboardHeader
                title="Dashboard"
                description="Monitor your sales, inventory, and business performance at a glance."
            />

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {/* Stats Card: Total Sales */}
                <div className="group relative overflow-hidden rounded-2xl border bg-gradient-to-br from-blue-600/10 to-transparent p-6 transition-all hover:shadow-lg hover:border-blue-600/30">
                    <div className="flex items-center justify-between">
                        <div className="rounded-xl bg-blue-600 p-2.5 text-white shadow-lg shadow-blue-600/20 transition-transform group-hover:scale-110">
                            <TrendingUp className="h-5 w-5" />
                        </div>
                        <div className="flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                            <ArrowUpRight className="h-3 w-3" />
                            <span>+12.5%</span>
                        </div>
                    </div>
                    <div className="mt-4 flex flex-col gap-1">
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Total Sales</p>
                        <h2 className="text-3xl font-extrabold tracking-tight">$45,231.89</h2>
                    </div>
                    <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-blue-600/5 blur-2xl transition-opacity group-hover:opacity-100 opacity-50" />
                </div>

                {/* Stats Card: Active Orders */}
                <div className="group relative overflow-hidden rounded-2xl border bg-gradient-to-br from-purple-600/10 to-transparent p-6 transition-all hover:shadow-lg hover:border-purple-600/30">
                    <div className="flex items-center justify-between">
                        <div className="rounded-xl bg-purple-600 p-2.5 text-white shadow-lg shadow-purple-600/20 transition-transform group-hover:scale-110">
                            <ShoppingBag className="h-5 w-5" />
                        </div>
                        <div className="text-xs font-semibold text-muted-foreground bg-muted/50 px-2 py-1 rounded-full">
                            Last 24h
                        </div>
                    </div>
                    <div className="mt-4 flex flex-col gap-1">
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Active Orders</p>
                        <h2 className="text-3xl font-extrabold tracking-tight">142</h2>
                    </div>
                    <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-purple-600/5 blur-2xl transition-opacity group-hover:opacity-100 opacity-50" />
                </div>

                {/* Stats Card: Top Category */}
                <div className="group relative overflow-hidden rounded-2xl border bg-gradient-to-br from-amber-600/10 to-transparent p-6 transition-all hover:shadow-lg hover:border-amber-600/30">
                    <div className="flex items-center justify-between">
                        <div className="rounded-xl bg-amber-600 p-2.5 text-white shadow-lg shadow-amber-600/20 transition-transform group-hover:scale-110">
                            <Layers className="h-5 w-5" />
                        </div>
                        <div className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
                            Popular
                        </div>
                    </div>
                    <div className="mt-4 flex flex-col gap-1">
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Top Category</p>
                        <h2 className="text-3xl font-extrabold tracking-tight">Electronics</h2>
                    </div>
                    <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-amber-600/5 blur-2xl transition-opacity group-hover:opacity-100 opacity-50" />
                </div>

                {/* Stats Card: Low Stock */}
                <div className="group relative overflow-hidden rounded-2xl border bg-gradient-to-br from-rose-600/10 to-transparent p-6 transition-all hover:shadow-lg hover:border-rose-600/30">
                    <div className="flex items-center justify-between">
                        <div className="rounded-xl bg-rose-600 p-2.5 text-white shadow-lg shadow-rose-600/20 transition-transform group-hover:scale-110">
                            <AlertTriangle className="h-5 w-5" />
                        </div>
                        <div className="text-xs font-semibold text-rose-600 bg-rose-50 px-2 py-1 rounded-full">
                            Action Needed
                        </div>
                    </div>
                    <div className="mt-4 flex flex-col gap-1">
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Low Stock</p>
                        <h2 className="text-3xl font-extrabold tracking-tight">12 Items</h2>
                    </div>
                    <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-rose-600/5 blur-2xl transition-opacity group-hover:opacity-100 opacity-50" />
                </div>
            </div>

            {/* Premium Dashboard Sections */}
            <div className="mt-8 grid gap-6 lg:grid-cols-2">
                {/* Recent Orders Table */}
                <div className="rounded-2xl border bg-background/50 p-6 backdrop-blur-sm transition-all hover:bg-background shadow-sm hover:shadow-md">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h3 className="text-lg font-bold tracking-tight text-foreground">Recent Orders</h3>
                            <p className="text-xs text-muted-foreground uppercase tracking-widest font-bold">Live Updates</p>
                        </div>
                        <Button variant="outline" size="sm" className="text-xs font-bold border-muted hover:bg-muted/50 transition-colors">View All</Button>
                    </div>
                    <div className="space-y-3">
                        {[
                            { id: "#ORD-7721", items: "3 Items", amount: "$124.00", status: "Processing", color: "bg-blue-100 text-blue-600", icon: ShoppingCart },
                            { id: "#ORD-7720", items: "1 Items", amount: "$45.50", status: "Completed", color: "bg-emerald-100 text-emerald-600", icon: ShoppingBag },
                            { id: "#ORD-7719", items: "5 Items", amount: "$310.00", status: "Pending", color: "bg-amber-100 text-amber-600", icon: History },
                        ].map((order, i) => (
                            <div key={i} className="group flex items-center justify-between p-4 rounded-xl border border-transparent hover:border-muted hover:bg-muted/10 transition-all cursor-pointer">
                                <div className="flex items-center gap-4">
                                    <div className={`p-2 rounded-lg ${order.color} opacity-80 group-hover:opacity-100 transition-opacity`}>
                                        <order.icon className="h-4 w-4" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold group-hover:text-blue-600 transition-colors">{order.id}</p>
                                        <p className="text-xs text-muted-foreground">{order.items}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-6 text-right">
                                    <span className="text-sm font-bold tabular-nums">{order.amount}</span>
                                    <span className={`hidden sm:inline-block px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${order.color}`}>
                                        {order.status}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Quick Actions Grid */}
                <div className="rounded-2xl border bg-background/50 p-6 backdrop-blur-sm transition-all hover:bg-background shadow-sm hover:shadow-md">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h3 className="text-lg font-bold tracking-tight text-foreground">Quick Actions</h3>
                            <p className="text-xs text-muted-foreground uppercase tracking-widest font-bold">System Controls</p>
                        </div>
                        <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        {[
                            { name: "Add Product", icon: ShoppingBag, color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-100" },
                            { name: "View Reports", icon: TrendingUp, color: "text-purple-600", bg: "bg-purple-50", border: "border-purple-100" },
                            { name: "Manage Users", icon: User, color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-100" },
                            { name: "Settings", icon: Layers, color: "text-rose-600", bg: "bg-rose-50", border: "border-rose-100" },
                        ].map((action, i) => (
                            <button key={i} className={`flex flex-col items-center justify-center gap-3 p-6 rounded-2xl border ${action.border} bg-background hover:border-blue-600/30 hover:shadow-md transition-all group relative overflow-hidden`}>
                                <div className={`p-3 rounded-xl ${action.bg} ${action.color} group-hover:scale-110 transition-transform relative z-10`}>
                                    <action.icon className="h-6 w-6" />
                                </div>
                                <span className="text-sm font-bold text-muted-foreground group-hover:text-foreground transition-colors relative z-10">{action.name}</span>
                                <div className="absolute inset-0 bg-gradient-to-br from-transparent to-muted/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </main>
    )
}