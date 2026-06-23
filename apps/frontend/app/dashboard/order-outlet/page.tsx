"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DashboardHeader } from "@/components/dashboard-header";
import {
    ChevronLeft,
    ShoppingCart,
    ShoppingBag,
    CheckCircle2,
    Package,
    Clock,
    XCircle,
} from "lucide-react";
import { columns, Order } from "./columns";
import { OrdersTable } from "./data-table";

type Stats = { allCount: number; pendingCount: number; processingCount: number; completedCount: number; cancelledCount: number };

export default function OrderOutletPage() {
    const [data, setData] = useState<Order[]>([]);
    const [stats, setStats] = useState<Stats>({ allCount: 0, pendingCount: 0, processingCount: 0, completedCount: 0, cancelledCount: 0 });
    const [count, setCount] = useState(0);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);
    const [search, setSearch] = useState("");
    const [status, setStatus] = useState("all");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [loading, setLoading] = useState(true);
    const [forbidden, setForbidden] = useState(false);

    useEffect(() => {
        const fetchOrders = async () => {
            setLoading(true);
            try {
                const params = new URLSearchParams({
                    page: String(page),
                    limit: String(limit),
                    search,
                    status,
                    ...(dateFrom && { dateFrom }),
                    ...(dateTo && { dateTo }),
                });
                const res = await fetch(`/api/get-outlet-orders?${params}`);
                if (res.status === 401 || res.status === 403) { setForbidden(true); return; }
                const result = await res.json();
                if (result.success) {
                    setData(result.data);
                    setCount(result.count);
                    setStats(result.stats);
                }
            } catch (e) {
                console.error("Failed to fetch orders:", e);
            } finally {
                setLoading(false);
            }
        };
        fetchOrders();
    }, [page, limit, search, status, dateFrom, dateTo]);

    if (forbidden) {
        return (
            <div className="flex h-full w-full items-center justify-center py-32">
                <p className="text-destructive font-semibold">Anda tidak memiliki akses ke halaman ini.</p>
            </div>
        );
    }

    return (
        <main className="px-6 md:px-10 lg:px-14 pb-12 space-y-6">
            <div className="flex items-center gap-3">
                <Link
                    href="/dashboard"
                    className="flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ChevronLeft className="h-4 w-4" /> Dashboard
                </Link>
            </div>

            <DashboardHeader
                title="Semua Pesanan"
                description={`${stats.allCount} pesanan ditemukan`}
            />

            {/* Summary chips — clickable filters */}
            <div className="flex flex-wrap gap-3">
                {([
                    { value: "all",       label: "Total",      count: stats.allCount,        icon: <Package className="h-4 w-4" />,      base: "border-border/60 bg-card text-foreground",                     active: "ring-2 ring-offset-1 ring-foreground" },
                    { value: "pending",   label: "Pending",    count: stats.pendingCount,    icon: <Clock className="h-4 w-4" />,        base: "border-amber-200 bg-amber-50 text-amber-700",                  active: "ring-2 ring-offset-1 ring-amber-500" },
                    { value: "aktif",     label: "Aktif",      count: stats.processingCount, icon: <ShoppingCart className="h-4 w-4" />, base: "border-blue-200 bg-blue-50 text-blue-700",                     active: "ring-2 ring-offset-1 ring-blue-500" },
                    { value: "selesai",   label: "Selesai",    count: stats.completedCount,  icon: <CheckCircle2 className="h-4 w-4" />, base: "border-emerald-200 bg-emerald-50 text-emerald-700",            active: "ring-2 ring-offset-1 ring-emerald-500" },
                    { value: "cancelled", label: "Dibatalkan", count: stats.cancelledCount,  icon: <XCircle className="h-4 w-4" />,      base: "border-red-200 bg-red-50 text-red-700",                        active: "ring-2 ring-offset-1 ring-red-500" },
                ] as const).map((chip) => (
                    <button
                        key={chip.value}
                        onClick={() => { setStatus(chip.value); setPage(1); }}
                        className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-bold transition-all ${chip.base} ${status === chip.value ? chip.active : "hover:opacity-80"}`}
                    >
                        {chip.icon}
                        <span>{chip.label}: {chip.count}</span>
                    </button>
                ))}
            </div>

            {/* Table */}
            {!loading && data.length === 0 && search === "" && status === "all" && !dateFrom && !dateTo ? (
                <div className="rounded-2xl border border-border/60 bg-card shadow-sm flex flex-col items-center gap-3 py-20 text-muted-foreground">
                    <ShoppingBag className="h-12 w-12 opacity-20" />
                    <p className="font-bold text-lg">Belum ada pesanan</p>
                    <p className="text-sm">Pesanan akan muncul di sini setelah pelanggan melakukan order</p>
                </div>
            ) : (
                <OrdersTable
                    columns={columns}
                    data={data}
                    page={page}
                    limit={limit}
                    count={count}
                    loading={loading}
                    search={search}
                    status={status}
                    onPageChange={setPage}
                    onLimitChange={setLimit}
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    onSearchChange={(v: string) => { setSearch(v); setPage(1); }}
                    onStatusChange={(v: string) => { setStatus(v); setPage(1); }}
                    onDateFromChange={(v: string) => { setDateFrom(v); setPage(1); }}
                    onDateToChange={(v: string) => { setDateTo(v); setPage(1); }}
                />
            )}
        </main>
    );
}
