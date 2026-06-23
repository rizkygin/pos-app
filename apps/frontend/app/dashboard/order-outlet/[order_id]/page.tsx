"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { DashboardHeader } from "@/components/dashboard-header";
import {
    ChevronLeft,
    ShoppingCart,
    CheckCircle2,
    Clock,
    User,
    Phone,
    Mail,
    MapPin,
    Package,
    Receipt,
    Wallet,
    Banknote,
    Tag,
    ArrowLeftRight,
    Store,
    Globe,
} from "lucide-react";

const STATUS_MAP = {
    addToChart: { label: "Diproses", icon: ShoppingCart, className: "bg-blue-100 text-blue-700" },
    checkout: { label: "Selesai", icon: CheckCircle2, className: "bg-emerald-100 text-emerald-700" },
} as const;

function fmtIDR(n: number) {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

type Item = {
    detailId: string;
    quantity: number | null;
    note: string | null;
    summaryPrice: string | number | null;
    status: "addToChart" | "checkout" | null;
    createdAt: Date | string | null;
    productId: string;
    productName: string | null;
    price: string | number | null;
    category: string | null;
    unit: string | null;
    image: string | null;
};

type Customer = {
    name: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
};

type OfflineNote = {
    customerName?: string | null;
    discountAmount?: number;
    paymentMethod?: "cash" | "non_cash";
    amountPaid?: number;
    changeDue?: number;
};

type ApiResponse = {
    success: boolean;
    outlet: { id: string; name: string };
    items: Item[];
    customer: Customer | null;
    isOfflineOrder: boolean;
    offlineNote: OfflineNote | null;
};

export default function OrderDetailPage() {
    const params = useParams<{ order_id: string }>();
    const order_id = params?.order_id ?? "";
    const router = useRouter();


    const [data, setData] = useState<ApiResponse | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`/api/get-outlet-order-detail?order_id=${order_id}`)
            .then((r) => r.json())
            .then((res: ApiResponse) => {
                if (!res.success) { router.push("/dashboard/order-outlet"); return; }
                setData(res);
            })
            .catch(() => router.push("/dashboard/order-outlet"))
            .finally(() => setLoading(false));
    }, [order_id, router]);

    if (loading) {
        return (
            <main className="px-4 md:px-6 pb-12 flex items-center justify-center min-h-[40vh]">
                <p className="text-sm text-muted-foreground animate-pulse">Memuat pesanan...</p>
            </main>
        );
    }

    if (!data) return null;

    const { outlet, items, customer, isOfflineOrder, offlineNote } = data;

    const totalAmount = items.reduce((sum, i) => sum + Number(i.summaryPrice), 0);
    const firstItem = items[0];
    const orderStatus = firstItem.status;
    const orderDate = firstItem.createdAt
        ? format(new Date(firstItem.createdAt), "d MMMM yyyy, HH:mm", { locale: idLocale })
        : "-";

    const s = orderStatus
        ? STATUS_MAP[orderStatus]
        : { label: "Pending", icon: Clock, className: "bg-amber-100 text-amber-700" };
    const StatusIcon = s.icon;

    return (
        <main className="px-4 md:px-6 pb-12 space-y-6">
            {/* Back nav */}
            <div className="flex items-center gap-3">
                <Link
                    href="/dashboard/order-outlet"
                    className="flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ChevronLeft className="h-4 w-4" /> Semua Pesanan
                </Link>
            </div>

            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div className="space-y-1.5">
                    <span
                        className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider ${
                            isOfflineOrder ? "text-amber-600" : "text-blue-600"
                        }`}
                    >
                        {isOfflineOrder ? <Store className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}
                        {isOfflineOrder ? "Offline Receipt" : "Online Receipt"}
                    </span>
                    <DashboardHeader
                        title={`Order #${order_id.slice(-8).toUpperCase()}`}
                        description={`${outlet.name} · ${orderDate}`}
                    />
                </div>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black ${s.className}`}>
                    <StatusIcon className="h-3.5 w-3.5" />
                    {s.label}
                </span>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
                {/* Customer card */}
                <div className="md:col-span-1 rounded-2xl border border-border/60 bg-card shadow-sm p-6 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-black text-muted-foreground uppercase tracking-widest">
                        <User className="h-4 w-4" /> Pelanggan
                    </div>
                    {isOfflineOrder ? (
                        <div className="space-y-3">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                                    <User className="h-5 w-5 text-muted-foreground" />
                                </div>
                                <div>
                                    <p className="font-black text-sm">{offlineNote?.customerName || "Walk-in Customer"}</p>
                                    <p className="text-xs text-muted-foreground font-semibold">Pesanan Kasir (Offline)</p>
                                </div>
                            </div>
                        </div>
                    ) : customer ? (
                        <div className="space-y-3">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                                    <User className="h-5 w-5 text-muted-foreground" />
                                </div>
                                <div>
                                    <p className="font-black text-sm">{customer.name}</p>
                                    <p className="text-xs text-muted-foreground font-semibold">Pelanggan</p>
                                </div>
                            </div>
                            <div className="space-y-2 pt-1">
                                {customer.email && (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                                        <span className="font-semibold truncate">{customer.email}</span>
                                    </div>
                                )}
                                {customer.phone && (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <Phone className="h-3.5 w-3.5 flex-shrink-0" />
                                        <span className="font-semibold">{customer.phone}</span>
                                    </div>
                                )}
                                {customer.address && (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                                        <span className="font-semibold">{customer.address}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground font-semibold">Data pelanggan tidak tersedia</p>
                    )}
                </div>

                {/* Items + summary */}
                <div className="md:col-span-2 space-y-4">
                    {/* Items table */}
                    <div className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden">
                        <div className="flex items-center gap-2 px-5 py-4 border-b border-border/60 bg-muted/20">
                            <Package className="h-4 w-4 text-muted-foreground" />
                            <span className="text-xs font-black text-muted-foreground uppercase tracking-widest">
                                {items.length} Item Pesanan
                            </span>
                        </div>
                        <div className="divide-y divide-border/40">
                            {items.map((item) => (
                                <div key={item.detailId} className="flex items-start gap-4 px-5 py-4">
                                    <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center flex-shrink-0 text-xl">
                                        🛍️
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-black text-sm">{item.productName}</p>
                                        <p className="text-xs text-muted-foreground font-semibold capitalize">{item.category}</p>
                                        {item.note && (
                                            <p className="text-xs text-muted-foreground mt-0.5 italic">"{item.note}"</p>
                                        )}
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                        <p className="font-black text-sm">{fmtIDR(Number(item.summaryPrice))}</p>
                                        <p className="text-xs text-muted-foreground font-semibold">
                                            {item.quantity} {item.unit} × {fmtIDR(Number(item.price))}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Total summary */}
                    <div className="rounded-2xl border border-border/60 bg-card shadow-sm p-5 space-y-3">
                        <div className="flex items-center gap-2 text-xs font-black text-muted-foreground uppercase tracking-widest">
                            <Receipt className="h-4 w-4" /> Ringkasan Pembayaran
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground font-semibold">Subtotal ({items.length} item)</span>
                                <span className="font-bold">{fmtIDR(totalAmount)}</span>
                            </div>
                            {isOfflineOrder && (offlineNote?.discountAmount ?? 0) > 0 && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground font-semibold flex items-center gap-1.5">
                                        <Tag className="h-3.5 w-3.5" /> Diskon
                                    </span>
                                    <span className="font-bold text-rose-500">-{fmtIDR(offlineNote?.discountAmount ?? 0)}</span>
                                </div>
                            )}
                            <div className="border-t border-border/60 pt-2 flex justify-between">
                                <span className="font-black text-sm">Total</span>
                                <span className="font-black text-sm text-rose-600">
                                    {fmtIDR(totalAmount - (isOfflineOrder ? (offlineNote?.discountAmount ?? 0) : 0))}
                                </span>
                            </div>
                        </div>

                        {isOfflineOrder && offlineNote && (
                            <div className="border-t border-border/60 pt-3 space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground font-semibold flex items-center gap-1.5">
                                        <Wallet className="h-3.5 w-3.5" /> Metode Pembayaran
                                    </span>
                                    <span className="font-bold">{offlineNote.paymentMethod === "non_cash" ? "Non-Cash" : "Cash"}</span>
                                </div>
                                {offlineNote.paymentMethod !== "non_cash" && (
                                    <>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground font-semibold flex items-center gap-1.5">
                                                <Banknote className="h-3.5 w-3.5" /> Uang Diterima
                                            </span>
                                            <span className="font-bold">{fmtIDR(offlineNote.amountPaid ?? 0)}</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground font-semibold flex items-center gap-1.5">
                                                <ArrowLeftRight className="h-3.5 w-3.5" /> Kembalian
                                            </span>
                                            <span className="font-bold text-emerald-600">{fmtIDR(offlineNote.changeDue ?? 0)}</span>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </main>
    );
}
