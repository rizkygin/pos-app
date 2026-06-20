'use client';

import { DashboardHeader } from '@/components/dashboard-header';
import {
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  ShoppingBag,
  Clock,
  Bike,
  Receipt,
  Building2,
  Users,
  IdCard,
  Star,
  Megaphone,
  CreditCard,
  History,
  Globe,
  Store,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

type RecentOrder = {
  id: string;
  status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'on_delivery' | 'delivered' | 'cancelled';
  outlet_name: string;
  customer_name: string;
  total_paid: number;
  is_offline: boolean;
};

type AdminDashboardProps = {
  revenue30Days: number;
  revenuePercentageChange: number;
  pendingOrdersCount: number;
  activeOrdersCount: number;
  onlineCouriersCount: number;
  totalOutlets: number;
  totalCouriers: number;
  totalCustomers: number;
  recentOrders: RecentOrder[];
};

const STATUS_MAP: Record<RecentOrder['status'], { label: string; className: string }> = {
  pending: { label: 'Menunggu', className: 'bg-amber-100 text-amber-600' },
  confirmed: { label: 'Dikonfirmasi', className: 'bg-blue-100 text-blue-600' },
  preparing: { label: 'Diproses', className: 'bg-blue-100 text-blue-600' },
  ready: { label: 'Siap', className: 'bg-indigo-100 text-indigo-600' },
  on_delivery: { label: 'Diantar', className: 'bg-violet-100 text-violet-600' },
  delivered: { label: 'Selesai', className: 'bg-emerald-100 text-emerald-600' },
  cancelled: { label: 'Dibatalkan', className: 'bg-rose-100 text-rose-600' },
};

function fmtIDR(amount: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

const quickActions = [
  { name: 'Order', icon: Receipt, color: 'text-sky-600', bg: 'bg-sky-50', border: 'border-sky-100', href: '/dashboard/admin/order' },
  { name: 'Manage Courier', icon: Bike, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-100', href: '/dashboard/admin/courier' },
  { name: 'Manage Customer', icon: Users, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100', href: '/dashboard/admin/customer' },
  { name: 'Manage Outlet', icon: Building2, color: 'text-cyan-600', bg: 'bg-cyan-50', border: 'border-cyan-100', href: '/dashboard/admin/outlet' },
  { name: 'Manage User', icon: IdCard, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100', href: '/dashboard/admin/user' },
  { name: 'Manage Rating', icon: Star, color: 'text-violet-600', bg: 'bg-violet-50', border: 'border-violet-100', href: '/dashboard/admin/rating' },
  { name: 'Promote Menu', icon: Megaphone, color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-100', href: '/dashboard/admin/menu/promote' },
  { name: 'Subscription Outlet', icon: CreditCard, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-100', href: '/dashboard/admin/outlet/subscription' },
];

export const AdminDashboard = ({
  revenue30Days,
  revenuePercentageChange,
  pendingOrdersCount,
  activeOrdersCount,
  onlineCouriersCount,
  totalOutlets,
  totalCouriers,
  totalCustomers,
  recentOrders,
}: AdminDashboardProps) => {
  const isPositive = revenuePercentageChange >= 0;

  return (
    <main className="px-4 mx-2 md:mx-6 pb-24 lg:pb-12">
      <DashboardHeader title="Dashboard Admin" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Revenue */}
        <div className="group relative overflow-hidden rounded-xl border bg-linear-to-br from-blue-600/10 to-transparent p-4 transition-all hover:shadow-md hover:border-blue-600/30">
          <div className="flex items-center justify-between">
            <div className="rounded-lg bg-blue-600 p-2 text-white shadow-md shadow-blue-600/20 transition-transform group-hover:scale-110">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div
              className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                isPositive ? 'text-emerald-600 bg-emerald-50' : 'text-rose-600 bg-rose-50'
              }`}
            >
              {isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              <span>
                {isPositive ? '+' : ''}
                {revenuePercentageChange.toFixed(1)}%
              </span>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-0.5">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Revenue (30 Hari)</p>
            <h2 className="text-lg font-bold tracking-tight">{fmtIDR(revenue30Days)}</h2>
          </div>
          <div className="absolute -right-4 -top-4 h-16 w-16 rounded-full bg-blue-600/5 blur-2xl transition-opacity group-hover:opacity-100 opacity-50" />
        </div>

        {/* Pending Orders */}
        <Link
          href="/dashboard/admin/order"
          className="group relative overflow-hidden rounded-xl border bg-linear-to-br from-amber-600/10 to-transparent p-4 transition-all hover:shadow-md hover:border-amber-600/30"
        >
          <div className="flex items-center justify-between">
            <div className="rounded-lg bg-amber-600 p-2 text-white shadow-md shadow-amber-600/20 transition-transform group-hover:scale-110">
              <Clock className="h-4 w-4" />
            </div>
            <div className="flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
              <span>Lihat</span>
              <ArrowUpRight className="h-3 w-3" />
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-0.5">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Pesanan Menunggu</p>
            <h2 className="text-lg font-bold tracking-tight">{pendingOrdersCount}</h2>
          </div>
          <div className="absolute -right-4 -top-4 h-16 w-16 rounded-full bg-amber-600/5 blur-2xl transition-opacity group-hover:opacity-100 opacity-50" />
        </Link>

        {/* Active Orders */}
        <div className="group relative overflow-hidden rounded-xl border bg-linear-to-br from-purple-600/10 to-transparent p-4 transition-all hover:shadow-md hover:border-purple-600/30">
          <div className="flex items-center justify-between">
            <div className="rounded-lg bg-purple-600 p-2 text-white shadow-md shadow-purple-600/20 transition-transform group-hover:scale-110">
              <ShoppingBag className="h-4 w-4" />
            </div>
            <div className="text-xs font-semibold text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">Live</div>
          </div>
          <div className="mt-3 flex flex-col gap-0.5">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Sedang Diproses</p>
            <h2 className="text-lg font-bold tracking-tight">{activeOrdersCount}</h2>
          </div>
          <div className="absolute -right-4 -top-4 h-16 w-16 rounded-full bg-purple-600/5 blur-2xl transition-opacity group-hover:opacity-100 opacity-50" />
        </div>

        {/* Online Couriers */}
        <Link
          href="/dashboard/admin/courier"
          className="group relative overflow-hidden rounded-xl border bg-linear-to-br from-orange-600/10 to-transparent p-4 transition-all hover:shadow-md hover:border-orange-600/30"
        >
          <div className="flex items-center justify-between">
            <div className="rounded-lg bg-orange-600 p-2 text-white shadow-md shadow-orange-600/20 transition-transform group-hover:scale-110">
              <Bike className="h-4 w-4" />
            </div>
            <div className="flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Online
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-0.5">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Kurir Online</p>
            <h2 className="text-lg font-bold tracking-tight">
              {onlineCouriersCount} / {totalCouriers}
            </h2>
          </div>
          <div className="absolute -right-4 -top-4 h-16 w-16 rounded-full bg-orange-600/5 blur-2xl transition-opacity group-hover:opacity-100 opacity-50" />
        </Link>
      </div>

      {/* Platform totals */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Link
          href="/dashboard/admin/outlet"
          className="flex items-center gap-3 rounded-xl border bg-background/50 p-4 hover:shadow-md hover:border-cyan-600/30 transition-all"
        >
          <div className="rounded-lg bg-cyan-50 p-2 text-cyan-600">
            <Building2 className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Outlet</p>
            <p className="text-base font-bold">{totalOutlets}</p>
          </div>
        </Link>
        <Link
          href="/dashboard/admin/courier"
          className="flex items-center gap-3 rounded-xl border bg-background/50 p-4 hover:shadow-md hover:border-orange-600/30 transition-all"
        >
          <div className="rounded-lg bg-orange-50 p-2 text-orange-600">
            <Bike className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Kurir</p>
            <p className="text-base font-bold">{totalCouriers}</p>
          </div>
        </Link>
        <Link
          href="/dashboard/admin/customer"
          className="flex items-center gap-3 rounded-xl border bg-background/50 p-4 hover:shadow-md hover:border-emerald-600/30 transition-all"
        >
          <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Pelanggan</p>
            <p className="text-base font-bold">{totalCustomers}</p>
          </div>
        </Link>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Recent Orders */}
        <div className="rounded-2xl border bg-background/50 p-6 backdrop-blur-sm transition-all hover:bg-background shadow-sm hover:shadow-md">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold tracking-tight text-foreground">Pesanan Terbaru</h3>
              <p className="text-xs text-muted-foreground uppercase tracking-widest font-bold">Live Updates</p>
            </div>
            <Link href="/dashboard/admin/order">
              <Button variant="outline" size="sm" className="text-xs font-bold border-muted hover:bg-muted/50 transition-colors">
                Lihat Semua
              </Button>
            </Link>
          </div>
          {recentOrders.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <History className="h-8 w-8 opacity-20" />
              <p className="text-sm font-semibold">Belum ada pesanan</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentOrders.map((order) => {
                const s = STATUS_MAP[order.status];
                return (
                  <Link
                    key={order.id}
                    href={`/dashboard/admin/order/${order.id}`}
                    className="group flex items-center justify-between p-4 rounded-xl border border-transparent hover:border-muted hover:bg-muted/10 transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-lg ${s.className} opacity-80 group-hover:opacity-100 transition-opacity`}>
                        {order.is_offline ? <Store className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
                      </div>
                      <div>
                        <p className="text-sm font-bold group-hover:text-blue-600 transition-colors">
                          #{order.id.slice(-8).toUpperCase()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {order.customer_name} · {order.outlet_name}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-right">
                      <span className="text-sm font-bold tabular-nums">{fmtIDR(order.total_paid)}</span>
                      <span className={`hidden sm:inline-block px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${s.className}`}>
                        {s.label}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick Actions — desktop only */}
        <div className="hidden lg:block rounded-xl border bg-background/50 p-4 backdrop-blur-sm transition-all hover:bg-background shadow-sm hover:shadow-md">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold tracking-tight text-foreground">Quick Actions</h3>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Admin Controls</p>
            </div>
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {quickActions.map((action) => (
              <Link
                key={action.name}
                href={action.href}
                className={`flex flex-col items-center justify-center gap-2 p-3 rounded-xl border ${action.border} bg-background hover:border-blue-600/30 hover:shadow-md transition-all group relative overflow-hidden`}
              >
                <div className={`p-2 rounded-lg ${action.bg} ${action.color} group-hover:scale-110 transition-transform relative z-10`}>
                  <action.icon className="h-4 w-4" />
                </div>
                <span className="text-xs font-bold text-muted-foreground group-hover:text-foreground transition-colors relative z-10 text-center">
                  {action.name}
                </span>
                <div className="absolute inset-0 bg-linear-to-br from-transparent to-muted/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile Quick Actions Bottom Nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur-sm overflow-x-auto">
        <div className="flex items-center justify-around min-w-max px-2">
          {quickActions.slice(0, 4).map((action) => (
            <Link
              key={action.name}
              href={action.href}
              className={`flex flex-col items-center gap-1 py-3 px-4 ${action.color} hover:opacity-70 transition-opacity`}
            >
              <action.icon className="h-5 w-5" />
              <span className="text-[10px] font-semibold text-foreground/70 whitespace-nowrap">{action.name}</span>
            </Link>
          ))}
        </div>
      </nav>
    </main>
  );
};
