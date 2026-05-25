"use client";

import { useEffect, useState, useCallback, useTransition, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ShoppingBag, Clock, User, Package, ChevronRight, X, UtensilsCrossed, CheckCheck, Bell, ScanLine, Camera, CameraOff, Truck, Printer } from "lucide-react";
import { confirmOrder, markOrderReady, confirmPickup } from "@/app/dashboard/activeorder/actions";
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel,
    AlertDialogAction,
    AlertDialogMedia,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type OrderItem = {
    productName: string;
    quantity: number;
    noteProduct: string | null;
    summaryPrice: string;
};

type Order = {
    orderId: string;
    customerName: string;
    customerPhone: string | null;
    deliveryFee: string | null;
    note: unknown;
    createdAt: string;
    status: string;
    courierId: number | null;
    items: OrderItem[];
    totalAmount: number;
};

type Tab = "pending" | "preparing" | "ready";

function fmtIDR(amount: number) {
    return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
    }).format(amount);
}

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}d lalu`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m lalu`;
    return `${Math.floor(m / 60)}j lalu`;
}

function noteStr(note: unknown): string | null {
    if (note == null) return null;
    const s = typeof note === "string" ? note : JSON.stringify(note);
    if (s === "{}" || s === "null" || s === "") return null;
    return s;
}

function ItemList({ items }: { items: OrderItem[] }) {
    return (
        <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-widest">
                <Package className="h-3 w-3" />
                <span>{items.length} Item</span>
            </div>
            <div className="rounded-xl bg-muted/30 divide-y divide-border/50">
                {items.map((item, i) => (
                    <div key={i} className="flex items-start justify-between px-3 py-2 text-sm">
                        <div className="flex items-baseline gap-2 min-w-0">
                            <span className="font-bold text-foreground/60 tabular-nums w-5 text-right shrink-0">
                                {item.quantity}×
                            </span>
                            <div className="min-w-0">
                                <span className="font-medium truncate block">{item.productName}</span>
                                {item.noteProduct && (
                                    <p className="text-xs text-muted-foreground mt-0.5 italic">{item.noteProduct}</p>
                                )}
                            </div>
                        </div>
                        <span className="text-xs font-semibold tabular-nums text-muted-foreground shrink-0 ml-3">
                            {fmtIDR(parseInt(item.summaryPrice || "0"))}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function EmptyState({ tab }: { tab: Tab }) {
    const config = {
        pending: {
            ring: "border-purple-300/50",
            bg: "bg-purple-50 dark:bg-purple-950/30",
            icon: <ShoppingBag className="h-8 w-8 text-purple-400" />,
            title: "Menunggu Pesanan Masuk",
            desc: "Belum ada pesanan yang menunggu konfirmasi.",
        },
        preparing: {
            ring: "border-blue-300/50",
            bg: "bg-blue-50 dark:bg-blue-950/30",
            icon: <UtensilsCrossed className="h-8 w-8 text-blue-400" />,
            title: "Tidak Ada Pesanan Diproses",
            desc: "Belum ada pesanan yang sedang dipersiapkan.",
        },
        ready: {
            ring: "border-emerald-300/50",
            bg: "bg-emerald-50 dark:bg-emerald-950/30",
            icon: <Bell className="h-8 w-8 text-emerald-400" />,
            title: "Tidak Ada Pesanan Siap",
            desc: "Belum ada pesanan yang siap diambil.",
        },
    }[tab];

    return (
        <div className="flex flex-col items-center justify-center py-24 gap-6 text-muted-foreground">
            <div className="relative flex items-center justify-center w-28 h-28">
                {[0, 1, 2].map((i) => (
                    <motion.span
                        key={i}
                        className={`absolute rounded-full border ${config.ring}`}
                        style={{ width: 36 + i * 26, height: 36 + i * 26 }}
                        animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.15, 0.5] }}
                        transition={{ duration: 2.5, delay: i * 0.5, repeat: Infinity, ease: "easeInOut" }}
                    />
                ))}
                <motion.div
                    animate={{ scale: [1, 1.05, 1] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    className={`z-10 rounded-full p-5 ${config.bg}`}
                >
                    {config.icon}
                </motion.div>
            </div>
            <div className="text-center space-y-1">
                <p className="font-bold text-foreground text-lg">{config.title}</p>
                <p className="text-sm">{config.desc}</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Halaman diperbarui otomatis setiap 2 detik.</p>
            </div>
        </div>
    );
}

function PendingOrderCard({ order, index, onConfirm }: { order: Order; index: number; onConfirm: (id: string) => void }) {
    const [isPending, startTransition] = useTransition();
    const note = noteStr(order.note);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.3, delay: index * 0.05 }}
            className="rounded-2xl border bg-background shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col"
        >
            <div className="flex items-center justify-between px-5 py-3 bg-amber-50 dark:bg-amber-950/20 border-b border-amber-100 dark:border-amber-900/30">
                <div className="flex items-center gap-2">
                    <span className="font-mono font-black text-sm text-amber-700 dark:text-amber-400">
                        #{order.orderId.slice(-8).toUpperCase()}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase tracking-wider">
                        Menunggu
                    </span>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{timeAgo(order.createdAt)}</span>
                </div>
            </div>

            <div className="px-5 py-4 flex flex-col gap-4 flex-1">
                <div className="flex items-center gap-2 text-sm">
                    <User className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-semibold">{order.customerName}</span>
                    {order.customerPhone && (
                        <span className="text-muted-foreground text-xs">· {order.customerPhone}</span>
                    )}
                </div>
                <ItemList items={order.items} />
                {note && (
                    <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-3 leading-relaxed">
                        {note}
                    </p>
                )}
                <div className="flex items-end justify-between mt-auto pt-4 border-t border-border/50">
                    <div>
                        <p className="text-xs text-muted-foreground">Total</p>
                        <p className="text-xl font-black tabular-nums">{fmtIDR(order.totalAmount)}</p>
                        {order.deliveryFee && parseInt(order.deliveryFee) > 0 && (
                            <p className="text-xs text-muted-foreground">
                                +{fmtIDR(parseInt(order.deliveryFee))} ongkir
                            </p>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <button
                            disabled
                            title="Segera hadir"
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold border border-red-200 text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <X className="h-3 w-3" />
                            Tolak
                        </button>
                        <button
                            disabled={isPending}
                            onClick={() => startTransition(() => onConfirm(order.orderId))}
                            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors shadow-sm shadow-emerald-200 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {isPending ? "Memproses..." : "Konfirmasi"}
                            {!isPending && <ChevronRight className="h-3 w-3" />}
                        </button>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

function PreparingOrderCard({ order, index, onMarkReady }: { order: Order; index: number; onMarkReady: (id: string) => void }) {
    const [isPending, startTransition] = useTransition();
    const note = noteStr(order.note);
    const hasCourier = order.courierId != null;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.3, delay: index * 0.05 }}
            className={`rounded-2xl border shadow-sm overflow-hidden flex flex-col transition-shadow ${
                hasCourier
                    ? "bg-background hover:shadow-md"
                    : "bg-muted/30 opacity-60"
            }`}
        >
            <div className={`flex items-center justify-between px-5 py-3 border-b ${
                hasCourier
                    ? "bg-blue-50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900/30"
                    : "bg-muted/50 border-border/40"
            }`}>
                <div className="flex items-center gap-2">
                    <span className={`font-mono font-black text-sm ${hasCourier ? "text-blue-700 dark:text-blue-400" : "text-muted-foreground"}`}>
                        #{order.orderId.slice(-8).toUpperCase()}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        hasCourier
                            ? "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400"
                            : "bg-muted text-muted-foreground"
                    }`}>
                        {hasCourier ? "Diproses" : "Menunggu Kurir"}
                    </span>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{timeAgo(order.createdAt)}</span>
                </div>
            </div>

            <div className="px-5 py-4 flex flex-col gap-4 flex-1">
                <div className="flex items-center gap-2 text-sm">
                    <User className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-semibold">{order.customerName}</span>
                    {order.customerPhone && (
                        <span className="text-muted-foreground text-xs">· {order.customerPhone}</span>
                    )}
                </div>
                <ItemList items={order.items} />
                {note && (
                    <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-3 leading-relaxed">
                        {note}
                    </p>
                )}
                <div className="flex items-end justify-between mt-auto pt-4 border-t border-border/50">
                    <div>
                        <p className="text-xs text-muted-foreground">Total</p>
                        <p className="text-xl font-black tabular-nums">{fmtIDR(order.totalAmount)}</p>
                        {order.deliveryFee && parseInt(order.deliveryFee) > 0 && (
                            <p className="text-xs text-muted-foreground">
                                +{fmtIDR(parseInt(order.deliveryFee))} ongkir
                            </p>
                        )}
                    </div>
                    <button
                        disabled={!hasCourier || isPending}
                        onClick={() => startTransition(() => onMarkReady(order.orderId))}
                        title={!hasCourier ? "Menunggu kurir menerima pesanan" : undefined}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors shadow-sm shadow-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                    >
                        {isPending ? "Memproses..." : "Siap"}
                        {!isPending && <CheckCheck className="h-3 w-3" />}
                    </button>
                </div>
            </div>
        </motion.div>
    );
}

function ReadyOrderCard({ order, index }: { order: Order; index: number }) {
    const note = noteStr(order.note);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.3, delay: index * 0.05 }}
            className="rounded-2xl border bg-background shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col"
        >
            <div className="flex items-center justify-between px-5 py-3 bg-emerald-50 dark:bg-emerald-950/20 border-b border-emerald-100 dark:border-emerald-900/30">
                <div className="flex items-center gap-2">
                    <span className="font-mono font-black text-sm text-emerald-700 dark:text-emerald-400">
                        #{order.orderId.slice(-8).toUpperCase()}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
                        Siap
                    </span>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{timeAgo(order.createdAt)}</span>
                </div>
            </div>

            <div className="px-5 py-4 flex flex-col gap-4 flex-1">
                <div className="flex items-center gap-2 text-sm">
                    <User className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-semibold">{order.customerName}</span>
                    {order.customerPhone && (
                        <span className="text-muted-foreground text-xs">· {order.customerPhone}</span>
                    )}
                </div>
                <ItemList items={order.items} />
                {note && (
                    <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-3 leading-relaxed">
                        {note}
                    </p>
                )}
                <div className="mt-auto pt-4 border-t border-border/50">
                    <p className="text-xs text-muted-foreground">Total</p>
                    <p className="text-xl font-black tabular-nums">{fmtIDR(order.totalAmount)}</p>
                    {order.deliveryFee && parseInt(order.deliveryFee) > 0 && (
                        <p className="text-xs text-muted-foreground">
                            +{fmtIDR(parseInt(order.deliveryFee))} ongkir
                        </p>
                    )}
                </div>
            </div>
        </motion.div>
    );
}

function QRScannerBar({ orders, onPickup }: { orders: Order[]; onPickup: (id: string) => void }) {
    const [input, setInput] = useState("");
    const [scanning, setScanning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [pendingPickup, setPendingPickup] = useState<Order | null>(null);

    //SEARCH:: print reciept from picking courier
    const printPickupReceipt = (order: Order) => {
        const shortId = order.orderId.slice(-8).toUpperCase();
        const date = new Date();
        const deliveryFee = order.deliveryFee ? parseInt(order.deliveryFee) : 0;

        const itemsHtml = order.items.map((item) => `
            <div style="margin-bottom:6px">
                <p class="item-name">${item.productName}</p>
                <div class="row">
                    <span class="item-detail">${item.quantity} × ${fmtIDR(Math.round(parseInt(item.summaryPrice || "0") / item.quantity))}</span>
                    <span>${fmtIDR(parseInt(item.summaryPrice || "0"))}</span>
                </div>
                ${item.noteProduct ? `<p class="item-detail">Catatan: ${item.noteProduct}</p>` : ""}
            </div>
        `).join("");

        const w = window.open("", "_blank", "width=420,height=700");
        if (!w) return;
        w.document.write(`<!DOCTYPE html><html><head><title>Receipt #${shortId}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', monospace; font-size: 12px; width: 300px; margin: 0 auto; padding: 16px 8px; color: #111; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .large { font-size: 15px; }
  .small { font-size: 11px; color: #555; }
  .divider { border-top: 1px dashed #888; margin: 8px 0; }
  .row { display: flex; justify-content: space-between; margin: 3px 0; }
  .total-row { display: flex; justify-content: space-between; font-weight: bold; font-size: 14px; margin-top: 4px; }
  .item-name { font-weight: bold; }
  .item-detail { color: #555; font-size: 11px; }
</style></head><body>
<div class="center bold large" style="margin-bottom:4px;">BUKTI PENGIRIMAN</div>
<div class="divider"></div>
<div class="row"><span class="small">Order #</span><span class="bold">${shortId}</span></div>
<div class="row"><span class="small">Pelanggan</span><span>${order.customerName}</span></div>
${order.customerPhone ? `<div class="row"><span class="small">Telepon</span><span>${order.customerPhone}</span></div>` : ""}
<div class="row"><span class="small">Tanggal</span><span>${date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</span></div>
<div class="row"><span class="small">Waktu</span><span>${date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span></div>
<div class="divider"></div>
${itemsHtml}
<div class="divider"></div>
<div class="row"><span class="small">Subtotal</span><span>${fmtIDR(order.totalAmount)}</span></div>
${deliveryFee > 0 ? `<div class="row"><span class="small">Ongkos kirim</span><span>${fmtIDR(deliveryFee)}</span></div>` : ""}
<div class="total-row"><span>TOTAL</span><span>${fmtIDR(order.totalAmount + deliveryFee)}</span></div>
<div class="divider"></div>
<p class="center small" style="margin-top:12px;">Terima kasih!</p>
</body></html>`);
        w.document.close();
        w.focus();
        w.onafterprint = () => w.close();
        w.print();
    };
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const rafRef = useRef<number>(0);

    const resolve = (raw: string) => {
        const trimmed = raw.trim();
        const match = orders.find(
            (o) =>
                `COURIER:${o.courierId}|ORDER:${o.orderId}`.toUpperCase()||
                o.orderId === trimmed ||
                o.orderId.slice(-8).toUpperCase() === trimmed.toUpperCase()
        );
        if (!match) {
            setError("Order tidak ditemukan di daftar siap.");
            return false;
        }
        setError(null);
        setInput("");
        setPendingPickup(match);
        return true;
    };

    // Keep a stable ref so the camera tick loop always sees fresh orders
    // without the effect needing to restart on every poll.
    const resolveRef = useRef(resolve);
    resolveRef.current = resolve;

    const handleSubmit = (e: { preventDefault(): void }) => {
        e.preventDefault();
        if (!input.trim()) return;
        resolve(input);
    };

    const releaseTracks = useCallback(() => {
        cancelAnimationFrame(rafRef.current);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
    }, []);

    const stopCamera = useCallback(() => {
        releaseTracks();
        setScanning(false);
    }, [releaseTracks]);

    useEffect(() => {
        if (!scanning) return;
        setError(null);
        let cancelled = false;

        (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    // ideal so it doesn't hard-fail on laptops without a rear camera
                    video: { facingMode: { ideal: "environment" } },
                });
                if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
                streamRef.current = stream;

                const video = videoRef.current;
                if (!video) { stream.getTracks().forEach((t) => t.stop()); return; }

                video.srcObject = stream;
                try { await video.play(); } catch { /* autoPlay attribute handles it */ }

                if (!("BarcodeDetector" in window)) {
                    if (!cancelled) setError("Browser ini tidak mendukung kamera QR scan. Gunakan input manual.");
                    releaseTracks();
                    setScanning(false);
                    return;
                }

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });

                const tick = async () => {
                    if (cancelled) return;
                    try {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const codes: any[] = await detector.detect(video);
                        if (codes.length > 0) {
                            const found = resolveRef.current(codes[0].rawValue);
                            if (found) { stopCamera(); return; }
                        }
                    } catch { /* ignore frame errors */ }
                    rafRef.current = requestAnimationFrame(tick);
                };
                rafRef.current = requestAnimationFrame(tick);
            } catch (err) {
                if (!cancelled) {
                    const name = err instanceof Error ? err.name : "";
                    if (name === "NotAllowedError") {
                        setError("Izin kamera ditolak. Izinkan akses kamera di browser.");
                    } else if (name === "NotFoundError") {
                        setError("Kamera tidak ditemukan di perangkat ini.");
                    } else {
                        setError("Tidak dapat mengakses kamera.");
                    }
                    setScanning(false);
                }
            }
        })();

        // only release tracks on cleanup — don't touch scanning state here
        return () => { cancelled = true; releaseTracks(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scanning]);

    useEffect(() => {
        if (!success) return;
        const t = setTimeout(() => setSuccess(null), 3000);
        return () => clearTimeout(t);
    }, [success]);

    return (
        <>
            <div className="mb-6 rounded-2xl border bg-background shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 bg-emerald-50 dark:bg-emerald-950/20 border-b border-emerald-100 dark:border-emerald-900/30">
                    <ScanLine className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">Konfirmasi Pickup</span>
                    <span className="text-xs text-muted-foreground ml-1">— scan atau ketik ID pesanan</span>
                </div>

                <div className="px-5 py-4 space-y-3">
                    {scanning && (
                        <div className="relative w-full h-48 rounded-xl overflow-hidden bg-black">
                            <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline autoPlay />
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <motion.div
                                    animate={{ opacity: [0.4, 1, 0.4] }}
                                    transition={{ duration: 1.5, repeat: Infinity }}
                                    className="w-40 h-40 border-2 border-white/80 rounded-xl"
                                />
                            </div>
                            <button
                                onClick={stopCamera}
                                className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/50 text-white hover:bg-black/70 transition-colors"
                            >
                                <CameraOff className="h-4 w-4" />
                            </button>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="flex gap-2">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => { setInput(e.target.value); setError(null); }}
                            placeholder="Ketik Order ID atau 8 karakter terakhir…"
                            className="flex-1 px-3 py-2 text-sm rounded-lg border bg-muted/30 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 focus:border-emerald-400 transition-all"
                        />
                        <button
                            type="submit"
                            disabled={!input.trim()}
                            className="px-4 py-2 rounded-lg text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Konfirmasi
                        </button>
                        <button
                            type="button"
                            onClick={() => setScanning((v) => !v)}
                            className={`px-3 py-2 rounded-lg border text-sm font-bold transition-colors ${
                                scanning
                                    ? "bg-red-50 border-red-200 text-red-600 hover:bg-red-100 dark:bg-red-950/20 dark:border-red-900/30"
                                    : "bg-muted/30 border-border hover:bg-muted/60 text-foreground"
                            }`}
                        >
                            {scanning ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
                        </button>
                    </form>

                    {error && (
                        <motion.p
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-xs text-red-500 font-medium"
                        >
                            {error}
                        </motion.p>
                    )}
                    {success && (
                        <motion.p
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-xs text-emerald-600 font-medium"
                        >
                            {success}
                        </motion.p>
                    )}
                </div>
            </div>

            <AlertDialog open={pendingPickup != null} onOpenChange={(open) => { if (!open) setPendingPickup(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogMedia className="bg-emerald-50 dark:bg-emerald-950/30">
                            <Truck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                        </AlertDialogMedia>
                        <AlertDialogTitle>Konfirmasi Pickup</AlertDialogTitle>
                        <AlertDialogDescription>
                            Pastikan kurir sudah mengambil pesanan sebelum mengonfirmasi.
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    {pendingPickup && (
                        <div className="rounded-xl bg-muted/40 px-4 py-3 space-y-2 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Order</span>
                                <span className="font-mono font-black text-xs">
                                    #{pendingPickup.orderId.slice(-8).toUpperCase()}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Pelanggan</span>
                                <span className="font-semibold">{pendingPickup.customerName}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Item</span>
                                <span className="font-semibold">{pendingPickup.items.length} item</span>
                            </div>
                            <div className="flex items-center justify-between border-t border-border/50 pt-2 mt-1">
                                <span className="text-muted-foreground">Total</span>
                                <span className="font-black">{fmtIDR(pendingPickup.totalAmount)}</span>
                            </div>
                        </div>
                    )}

                    <AlertDialogFooter>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => pendingPickup && printPickupReceipt(pendingPickup)}
                        >
                            <Printer />
                            Print Receipt
                        </Button>
                        <AlertDialogAction
                            className="bg-emerald-500 hover:bg-emerald-600 text-white"
                            onClick={() => {
                                if (!pendingPickup) return;
                                setSuccess(`#${pendingPickup.orderId.slice(-8).toUpperCase()} dikonfirmasi pickup!`);
                                onPickup(pendingPickup.orderId);
                                setPendingPickup(null);
                            }}
                        >
                            Konfirmasi Pickup
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

function useOrdersPolling(endpoint: string) {
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetch_ = useCallback(async () => {
        try {
            const res = await fetch(endpoint, { cache: "no-store" });
            const data = await res.json();
            if (data.success) {
                setOrders(data.orders);
                setLastUpdated(new Date());
            }
        } catch {
            // silently retry next tick
        } finally {
            setLoading(false);
        }
    }, [endpoint]);

    useEffect(() => {
        fetch_();
        const id = setInterval(fetch_, 2000);
        return () => clearInterval(id);
    }, [fetch_]);

    return { orders, setOrders, loading, lastUpdated };
}

const TAB_CONFIG: { id: Tab; label: string; badgeColor: string }[] = [
    { id: "pending",   label: "Pending",   badgeColor: "bg-amber-500" },
    { id: "preparing", label: "Preparing", badgeColor: "bg-blue-500" },
    { id: "ready",     label: "Ready",     badgeColor: "bg-emerald-500" },
];

export function PendingOrdersLobby() {
    const [activeTab, setActiveTab] = useState<Tab>("pending");

    const pending   = useOrdersPolling("/api/get-pending-orders");
    const preparing = useOrdersPolling("/api/get-preparing-orders");
    const ready     = useOrdersPolling("/api/get-ready-orders");

    const handleConfirm = useCallback(async (orderId: string) => {
        pending.setOrders((prev) => prev.filter((o) => o.orderId !== orderId));
        await confirmOrder(orderId);
    }, [pending]);

    const handleMarkReady = useCallback(async (orderId: string) => {
        preparing.setOrders((prev) => prev.filter((o) => o.orderId !== orderId));
        await markOrderReady(orderId);
    }, [preparing]);

    const handlePickup = useCallback(async (orderId: string) => {
        ready.setOrders((prev) => prev.filter((o) => o.orderId !== orderId));
        await confirmPickup(orderId);

        
    }, [ready]);

    const current = activeTab === "pending" ? pending : activeTab === "preparing" ? preparing : ready;
    const counts: Record<Tab, number> = {
        pending:   pending.orders.length,
        preparing: preparing.orders.length,
        ready:     ready.orders.length,
    };

    return (
        <div>
            {/* Page header */}
            <div className="flex items-start justify-between mb-6 py-4 border-b">
                <div>
                    <div className="flex items-center gap-2.5 mb-1">
                        <h1 className="text-2xl font-black tracking-tight">Order Lobby</h1>
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                                Live
                            </span>
                        </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        {pending.orders.length > 0
                            ? `${pending.orders.length} pesanan menunggu konfirmasimu`
                            : "Belum ada pesanan yang menunggu konfirmasi"}
                    </p>
                </div>
                {current.lastUpdated && (
                    <div className="text-right shrink-0">
                        <p className="text-xs text-muted-foreground">
                            {current.lastUpdated.toLocaleTimeString("id-ID", {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                            })}
                        </p>
                        <p className="text-[10px] text-muted-foreground/50">refresh / 2 detik</p>
                    </div>
                )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 p-1 rounded-xl bg-muted/50 w-fit mb-6">
                {TAB_CONFIG.map(({ id, label, badgeColor }) => {
                    const count = counts[id];
                    const isActive = activeTab === id;
                    return (
                        <button
                            key={id}
                            onClick={() => setActiveTab(id)}
                            className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                                isActive
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            {label}
                            {count > 0 && (
                                <motion.span
                                    key={count}
                                    initial={{ scale: 0.7, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    className={`flex items-center justify-center h-5 min-w-5 px-1 rounded-full text-[10px] font-black text-white ${badgeColor}`}
                                >
                                    {count}
                                </motion.span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Content */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18 }}
                >
                    {current.loading ? (
                        <div className="flex items-center justify-center py-32">
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                className="h-6 w-6 rounded-full border-2 border-purple-400 border-t-transparent"
                            />
                        </div>
                    ) : current.orders.length === 0 ? (
                        <EmptyState tab={activeTab} />
                    ) : activeTab === "preparing" ? (
                        (() => {
                            const waiting  = preparing.orders.filter((o) => o.courierId == null);
                            const assigned = preparing.orders.filter((o) => o.courierId != null);
                            return (
                                <div className="space-y-8">
                                    {assigned.length > 0 && (
                                        <div>
                                            <p className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest mb-3">
                                                Kurir sudah accept · {assigned.length} pesanan
                                            </p>
                                            <AnimatePresence mode="popLayout">
                                                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                                                    {assigned.map((order, i) => (
                                                        <PreparingOrderCard key={order.orderId} order={order} index={i} onMarkReady={handleMarkReady} />
                                                    ))}
                                                </div>
                                            </AnimatePresence>
                                        </div>
                                    )}
                                    {waiting.length > 0 && (
                                        <div>
                                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">
                                                Menunggu kurir · {waiting.length} pesanan
                                            </p>
                                            <AnimatePresence mode="popLayout">
                                                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                                                    {waiting.map((order, i) => (
                                                        <PreparingOrderCard key={order.orderId} order={order} index={i} onMarkReady={handleMarkReady} />
                                                    ))}
                                                </div>
                                            </AnimatePresence>
                                        </div>
                                    )}
                                </div>
                            );
                        })()
                    ) : activeTab === "ready" ? (
                        <>
                            <QRScannerBar orders={ready.orders} onPickup={handlePickup} />
                            <AnimatePresence mode="popLayout">
                                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                                    {ready.orders.map((order, i) => (
                                        <ReadyOrderCard key={order.orderId} order={order} index={i} />
                                    ))}
                                </div>
                            </AnimatePresence>
                        </>
                    ) : (
                        <AnimatePresence mode="popLayout">
                            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                                {pending.orders.map((order, i) => (
                                    <PendingOrderCard key={order.orderId} order={order} index={i} onConfirm={handleConfirm} />
                                ))}
                            </div>
                        </AnimatePresence>
                    )}
                </motion.div>
            </AnimatePresence>
        </div>
    );
}
