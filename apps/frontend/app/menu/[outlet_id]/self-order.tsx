"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
    Armchair,
    Check,
    CheckCircle2,
    Clock,
    Loader2,
    MapPin,
    Minus,
    Plus,
    ShoppingBag,
    Trash2,
    XCircle,
} from "lucide-react";
import { API_URL } from "@/lib/api-url";
import { fmtIDR } from "@/lib/utils/format";
import { computeTax, taxLineLabel } from "@/lib/tax";
import { SERVICE_TYPE_LABEL, type ServiceType } from "@/lib/service-type";
import { BottomSheet } from "./bottom-sheet";
import type { SelfOrderInfo } from "./menu-types";

/**
 * Pesan Mandiri on the customer's phone: the cart, the location check, the
 * send, and the status screen afterwards. The server decides everything that
 * matters — it re-checks the location, prices every line from its own
 * catalogue, and the cashier accepts before anything is cooked or paid — so
 * this side is about being quick and clear, not about being trusted.
 */

type EnabledInfo = Extract<SelfOrderInfo, { enabled: true }>;

/** One cart line, as the phone keeps it. Prices here are display only. */
export type CartLine = {
    /** Same pick = same line: product + add-ons + note. */
    key: string;
    productId: string;
    name: string;
    variantName: string | null;
    image: string;
    /** One unit, add-ons included. */
    unitPrice: number;
    optionIds: number[];
    addonNames: string[];
    quantity: number;
    note: string;
};

export type OrderStatus = "pending" | "accepted" | "rejected" | "cancelled" | "expired";

export type PublicOrder = {
    id: string;
    outletName: string;
    queueNo: number;
    status: OrderStatus;
    customerName: string;
    note: string | null;
    serviceType: ServiceType | null;
    tableLabel: string | null;
    lines: {
        name: string;
        variantName: string | null;
        quantity: number;
        addons: string[];
        note: string | null;
        unitPrice: number;
        total: number;
    }[];
    subtotal: number;
    createdAt: string;
    acceptedAt: string | null;
    rejectReason: string | null;
};

export const lineKey = (productId: string, optionIds: number[], note: string) =>
    [productId, ...[...optionIds].sort((a, b) => a - b), note.trim()].join("|");

const UNLOCK_TTL_MS = 45 * 60_000;
const POLL_MS = 4000;
const MAX_QTY = 50;

/** randomUUID needs a secure context; a LAN test over plain http has none. */
const newId = () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `so-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const readJson = <T,>(storage: "local" | "session", key: string): T | null => {
    try {
        const raw = (storage === "local" ? localStorage : sessionStorage).getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
};
const writeJson = (storage: "local" | "session", key: string, value: unknown) => {
    try {
        const s = storage === "local" ? localStorage : sessionStorage;
        if (value === null) s.removeItem(key);
        else s.setItem(key, JSON.stringify(value));
    } catch {
        /* private mode / quota — the cart just won't survive a reload */
    }
};

type Position = { lat: number; lon: number; accuracy: number };

function locationError(err: unknown): string {
    if (typeof window !== "undefined" && !window.isSecureContext) {
        return "Lokasi hanya bisa dibaca lewat https. Buka menu dari alamat https-nya.";
    }
    const code = (err as GeolocationPositionError | undefined)?.code;
    if (code === 1) {
        return "Izin lokasi ditolak. Izinkan lokasi untuk situs ini di pengaturan browser, lalu coba lagi.";
    }
    if (code === 3) return "Mencari lokasi terlalu lama. Coba lagi, sebaiknya dengan GPS menyala.";
    return "Lokasi HP tidak ditemukan. Nyalakan GPS lalu coba lagi.";
}

function getPosition(): Promise<Position> {
    return new Promise((resolve, reject) => {
        if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
            reject(new Error("unsupported"));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
            reject,
            { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
        );
    });
}

/** Everything the menu page needs to take an order. Inert when `info` is not enabled. */
export function useSelfOrder(outletId: number, info: SelfOrderInfo) {
    const enabled = info?.enabled === true;
    const cartKey = `menu_cart_${outletId}`;
    const unlockKey = `menu_unlock_${outletId}`;
    const activeKey = `menu_active_order_${outletId}`;

    const [cart, setCart] = useState<CartLine[]>([]);
    const [customerName, setCustomerName] = useState("");
    const [unlocked, setUnlocked] = useState(false);
    const [locating, setLocating] = useState(false);
    const [locateError, setLocateError] = useState<string | null>(null);
    const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
    const [hydrated, setHydrated] = useState(false);

    // Client-only state, read after mount so the server render matches.
    useEffect(() => {
        const saved = readJson<CartLine[]>("local", cartKey);
        if (Array.isArray(saved)) setCart(saved);
        setCustomerName(readJson<string>("local", "menu_customer_name") ?? "");
        const unlock = readJson<{ at: number }>("session", unlockKey);
        setUnlocked(!!unlock && Date.now() - unlock.at < UNLOCK_TTL_MS);
        setActiveOrderId(readJson<string>("local", activeKey));
        setHydrated(true);
    }, [cartKey, unlockKey, activeKey]);

    useEffect(() => {
        if (hydrated) writeJson("local", cartKey, cart.length ? cart : null);
    }, [cart, cartKey, hydrated]);

    useEffect(() => {
        if (hydrated) writeJson("local", "menu_customer_name", customerName.trim() || null);
    }, [customerName, hydrated]);

    /**
     * Ask the phone where it is, and the server whether that is inside the
     * outlet. Resolves null when it is, otherwise the reason to show.
     */
    const unlock = useCallback(async (): Promise<string | null> => {
        if (!enabled) return "Outlet ini belum membuka Pesan Mandiri.";
        setLocating(true);
        setLocateError(null);
        try {
            const pos = await getPosition().catch((err) => {
                throw new Error(locationError(err));
            });
            const res = await fetch(`${API_URL}/api/self-order/locate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ outletId, location: pos }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data?.success) throw new Error(data?.error || "Lokasi tidak bisa diperiksa.");
            setUnlocked(true);
            writeJson("session", unlockKey, { at: Date.now() });
            return null;
        } catch (err) {
            const message =
                err instanceof TypeError
                    ? "Tidak bisa terhubung. Cek koneksi internet lalu coba lagi."
                    : err instanceof Error
                      ? err.message
                      : "Lokasi tidak bisa diperiksa.";
            setLocateError(message);
            return message;
        } finally {
            setLocating(false);
        }
    }, [enabled, outletId, unlockKey]);

    const addLine = useCallback((line: Omit<CartLine, "key">) => {
        const key = lineKey(line.productId, line.optionIds, line.note);
        setCart((prev) => {
            const hit = prev.find((l) => l.key === key);
            if (hit) {
                return prev.map((l) =>
                    l.key === key ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + line.quantity) } : l,
                );
            }
            return [...prev, { ...line, key }];
        });
    }, []);

    const setQuantity = useCallback((key: string, quantity: number) => {
        setCart((prev) =>
            quantity <= 0
                ? prev.filter((l) => l.key !== key)
                : prev.map((l) => (l.key === key ? { ...l, quantity: Math.min(MAX_QTY, quantity) } : l)),
        );
    }, []);

    const count = cart.reduce((s, l) => s + l.quantity, 0);
    const subtotal = cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0);

    // One id per send, kept across retries: if a send committed but its answer
    // was lost, sending again lands on the same order instead of a second one.
    const sendIdRef = useRef<string | null>(null);
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);

    const send = useCallback(
        async (opts: { note: string; serviceType: ServiceType | null }): Promise<PublicOrder | null> => {
            if (!enabled || cart.length === 0) return null;
            const name = customerName.trim();
            if (!name) {
                setSendError("Isi nama kamu dulu, supaya kasir bisa memanggil.");
                return null;
            }
            setSending(true);
            setSendError(null);
            try {
                // A fresh fix for the send itself: the unlock may be half an hour old.
                const pos = await getPosition().catch((err) => {
                    throw new Error(locationError(err));
                });
                sendIdRef.current ??= newId();
                const res = await fetch(`${API_URL}/api/self-order`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        id: sendIdRef.current,
                        outletId,
                        tableId: info?.enabled ? (info.table?.id ?? null) : null,
                        customerName: name,
                        note: opts.note.trim() || null,
                        serviceType: opts.serviceType,
                        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                        location: pos,
                        lines: cart.map((l) => ({
                            productId: l.productId,
                            quantity: l.quantity,
                            optionIds: l.optionIds,
                            note: l.note.trim() || null,
                        })),
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data?.success) {
                    // The server refused it, so nothing was written under this id.
                    sendIdRef.current = null;
                    if (data?.code === "TOO_FAR" || data?.code === "INACCURATE") {
                        setUnlocked(false);
                        writeJson("session", unlockKey, null);
                    }
                    throw new Error(data?.error || "Pesanan belum terkirim. Coba lagi.");
                }
                const order = data.order as PublicOrder;
                sendIdRef.current = null;
                setCart([]);
                setActiveOrderId(order.id);
                writeJson("local", activeKey, order.id);
                return order;
            } catch (err) {
                setSendError(
                    err instanceof TypeError
                        ? "Tidak bisa terhubung. Cek koneksi internet lalu kirim lagi."
                        : err instanceof Error
                          ? err.message
                          : "Pesanan belum terkirim. Coba lagi.",
                );
                return null;
            } finally {
                setSending(false);
            }
        },
        [enabled, cart, customerName, info, outletId, unlockKey, activeKey],
    );

    const forgetActiveOrder = useCallback(() => {
        setActiveOrderId(null);
        writeJson("local", activeKey, null);
    }, [activeKey]);

    return {
        enabled,
        info: enabled ? (info as EnabledInfo) : null,
        hydrated,
        cart,
        count,
        subtotal,
        addLine,
        setQuantity,
        clearCart: () => setCart([]),
        customerName,
        setCustomerName,
        unlocked,
        locating,
        locateError,
        unlock,
        send,
        sending,
        sendError,
        setSendError,
        activeOrderId,
        forgetActiveOrder,
    };
}

export type SelfOrderState = ReturnType<typeof useSelfOrder>;

/**
 * The customer's order as the server has it, polled while the till decides.
 * Callers key their component by the id, so a new id starts from nothing.
 */
export function useOrderStatus(id: string | null) {
    const [order, setOrder] = useState<PublicOrder | null>(null);
    const [missing, setMissing] = useState(false);

    const load = useCallback(async () => {
        if (!id) return;
        try {
            const res = await fetch(`${API_URL}/api/self-order/${encodeURIComponent(id)}`);
            if (res.status === 404) {
                setMissing(true);
                return;
            }
            const data = await res.json().catch(() => ({}));
            if (data?.success) setOrder(data.order);
        } catch {
            /* offline for a moment — the next poll tries again */
        }
    }, [id]);

    useEffect(() => {
        const t = setTimeout(() => void load(), 0);
        return () => clearTimeout(t);
    }, [load]);

    const pending = order?.status === "pending";
    useEffect(() => {
        if (!id || (order && !pending)) return;
        const t = setInterval(() => {
            if (document.visibilityState === "visible") void load();
        }, POLL_MS);
        return () => clearInterval(t);
    }, [id, order, pending, load]);

    return { order, missing, reload: load };
}

// ── pieces of UI ──────────────────────────────────────────────────────────────

/** Under the hero: where you are, and the one button that turns the menu into a cart. */
export function SelfOrderBar({ so, outletName }: { so: SelfOrderState; outletName: string }) {
    if (!so.enabled || !so.info) return null;
    const table = so.info.table;
    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="overflow-hidden rounded-2xl border border-amber-400/25 bg-linear-to-r from-amber-500/15 via-amber-500/5 to-transparent p-4"
        >
            {/* Text above the button on a phone: side by side, the button
                squeezes the text into a one-word column. */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400/20 text-amber-300">
                        {table ? <Armchair className="h-5 w-5" /> : <ShoppingBag className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-white">
                            {table ? `Meja ${table.label} · Pesan dari HP` : "Pesan dari HP, bayar di kasir"}
                        </p>
                        <p className="text-xs leading-snug text-white/55">
                            {so.unlocked
                                ? "Lokasi cocok. Pilih menu, kirim, lalu bayar di kasir."
                                : `Lagi di ${outletName}? Aktifkan lokasi untuk mulai memesan.`}
                        </p>
                    </div>
                    {so.unlocked && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-bold text-emerald-300">
                            <Check className="h-3.5 w-3.5" /> Siap
                        </span>
                    )}
                </div>
                {!so.unlocked && (
                    <button
                        type="button"
                        onClick={() => void so.unlock()}
                        disabled={so.locating}
                        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-black text-black transition hover:bg-amber-400 disabled:opacity-60 sm:h-10 sm:w-auto"
                    >
                        {so.locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                        {so.locating ? "Memeriksa…" : "Mulai Pesan"}
                    </button>
                )}
            </div>
            {so.locateError && !so.unlocked && (
                <p className="mt-3 rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{so.locateError}</p>
            )}
        </motion.div>
    );
}

/** Bottom-right: the cart, bumping every time something lands in it. */
export function CartFab({ count, subtotal, onOpen }: { count: number; subtotal: number; onOpen: () => void }) {
    return (
        <AnimatePresence>
            {count > 0 && (
                <motion.button
                    type="button"
                    onClick={onOpen}
                    initial={{ opacity: 0, scale: 0.6, y: 30 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.6, y: 30 }}
                    transition={{ type: "spring", stiffness: 420, damping: 26 }}
                    className="fixed bottom-5 right-4 z-30 flex items-center gap-3 rounded-full bg-amber-500 py-2.5 pl-3 pr-5 text-black shadow-2xl shadow-amber-900/40 md:right-8"
                    aria-label={`Keranjang, ${count} item`}
                >
                    <motion.span
                        key={count}
                        initial={{ scale: 1.35, rotate: -12 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ type: "spring", stiffness: 500, damping: 14 }}
                        className="relative flex h-10 w-10 items-center justify-center rounded-full bg-black/85 text-amber-400"
                    >
                        <ShoppingBag className="h-5 w-5" />
                        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white">
                            {count}
                        </span>
                    </motion.span>
                    <span className="text-left leading-tight">
                        <span className="block text-[10px] font-bold uppercase tracking-wider text-black/60">Keranjang</span>
                        <span className="block text-sm font-black">{fmtIDR(subtotal)}</span>
                    </span>
                </motion.button>
            )}
        </AnimatePresence>
    );
}

/**
 * The order already sent, one tap back to its status. Bottom-right, stacked
 * above the cart button while there is one — side by side they collide on a
 * narrow phone.
 */
export function ActiveOrderChip({ id, onOpen, raised }: { id: string; onOpen: () => void; raised: boolean }) {
    const { order } = useOrderStatus(id);
    if (!order) return null;
    const tone =
        order.status === "accepted"
            ? "bg-emerald-500 text-black"
            : order.status === "pending"
              ? "bg-white text-black"
              : "bg-white/15 text-white";
    const label =
        order.status === "accepted"
            ? "Diterima · bayar di kasir"
            : order.status === "pending"
              ? "Menunggu kasir"
              : order.status === "rejected"
                ? "Ditolak"
                : order.status === "cancelled"
                  ? "Dibatalkan"
                  : "Kedaluwarsa";
    return (
        <motion.button
            type="button"
            onClick={onOpen}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            layout
            className={`fixed right-4 z-30 flex items-center gap-2 rounded-full px-4 py-3 text-xs font-black shadow-2xl md:right-8 ${
                raised ? "bottom-24" : "bottom-5"
            } ${tone}`}
        >
            {order.status === "pending" ? (
                <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
                </span>
            ) : order.status === "accepted" ? (
                <CheckCircle2 className="h-4 w-4" />
            ) : null}
            #{order.queueNo} · {label}
        </motion.button>
    );
}

export function CartSheet({
    so,
    onClose,
    onSent,
}: {
    so: SelfOrderState;
    onClose: () => void;
    onSent: (order: PublicOrder) => void;
}) {
    const info = so.info;
    const [note, setNote] = useState("");
    const [serviceType, setServiceType] = useState<ServiceType>("dine_in");
    if (!info) return null;
    const tax = info.tax ? computeTax(so.subtotal, info.tax) : null;
    const askService = info.askServiceType && !info.table;

    return (
        <BottomSheet
            label="Keranjang"
            onClose={onClose}
            wide
            footer={
                <div className="space-y-2">
                    {so.sendError && (
                        <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{so.sendError}</p>
                    )}
                    <button
                        type="button"
                        disabled={so.sending || so.cart.length === 0}
                        onClick={async () => {
                            const order = await so.send({
                                note,
                                serviceType: askService ? serviceType : null,
                            });
                            if (order) onSent(order);
                        }}
                        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 px-3 text-sm font-black text-black transition hover:bg-amber-400 disabled:bg-white/10 disabled:text-white/30"
                    >
                        {so.sending ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" /> Mengirim…
                            </>
                        ) : (
                            <span className="tabular-nums">
                                Kirim Pesanan · {fmtIDR(tax ? tax.total : so.subtotal)}
                            </span>
                        )}
                    </button>
                </div>
            }
        >
            <div className="space-y-5 p-5">
                {so.cart.length === 0 ? (
                    <p className="py-10 text-center text-sm text-white/40">Keranjang masih kosong.</p>
                ) : (
                    <ul className="space-y-3">
                        <AnimatePresence initial={false}>
                            {so.cart.map((l) => (
                                <motion.li
                                    key={l.key}
                                    layout
                                    initial={{ opacity: 0, x: -12 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 40, height: 0 }}
                                    className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-3"
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold leading-snug">{l.name}</p>
                                        {l.addonNames.length > 0 && (
                                            <p className="mt-0.5 text-xs text-white/50">+ {l.addonNames.join(", ")}</p>
                                        )}
                                        {l.note && <p className="mt-0.5 text-xs italic text-amber-200/70">“{l.note}”</p>}
                                        <p className="mt-1 text-sm font-black text-amber-300">
                                            {fmtIDR(l.unitPrice * l.quantity)}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1 rounded-xl bg-black/30 p-1">
                                        <button
                                            type="button"
                                            onClick={() => so.setQuantity(l.key, l.quantity - 1)}
                                            aria-label={l.quantity === 1 ? "Hapus" : "Kurangi"}
                                            className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
                                        >
                                            {l.quantity === 1 ? <Trash2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                                        </button>
                                        <span className="w-6 text-center text-sm font-black tabular-nums">{l.quantity}</span>
                                        <button
                                            type="button"
                                            onClick={() => so.setQuantity(l.key, l.quantity + 1)}
                                            aria-label="Tambah"
                                            className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
                                        >
                                            <Plus className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </motion.li>
                            ))}
                        </AnimatePresence>
                    </ul>
                )}

                <div className="space-y-3">
                    <label className="block">
                        <span className="text-xs font-bold uppercase tracking-wider text-white/50">Nama kamu</span>
                        <input
                            value={so.customerName}
                            onChange={(e) => so.setCustomerName(e.target.value.slice(0, 60))}
                            placeholder="Supaya kasir bisa memanggil"
                            className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-amber-400/60 focus:outline-none"
                        />
                    </label>
                    <label className="block">
                        <span className="text-xs font-bold uppercase tracking-wider text-white/50">Catatan (opsional)</span>
                        <input
                            value={note}
                            onChange={(e) => setNote(e.target.value.slice(0, 200))}
                            placeholder="Mis. tanpa sendok plastik"
                            className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-amber-400/60 focus:outline-none"
                        />
                    </label>
                    {askService && (
                        <div className="grid grid-cols-2 gap-2">
                            {(["dine_in", "take_away"] as const).map((t) => (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => setServiceType(t)}
                                    className={`rounded-xl border px-3 py-2.5 text-sm font-bold transition ${
                                        serviceType === t
                                            ? "border-amber-400 bg-amber-400/15 text-amber-200"
                                            : "border-white/10 bg-white/5 text-white/60 hover:text-white"
                                    }`}
                                >
                                    {SERVICE_TYPE_LABEL[t]}
                                </button>
                            ))}
                        </div>
                    )}
                    {info.table && (
                        <p className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white/70">
                            <Armchair className="h-4 w-4 text-amber-300" /> Diantar ke Meja {info.table.label}
                        </p>
                    )}
                </div>

                <div className="space-y-1.5 border-t border-white/10 pt-4 text-sm">
                    <div className="flex justify-between text-white/60">
                        <span>Subtotal</span>
                        <span className="tabular-nums">{fmtIDR(so.subtotal)}</span>
                    </div>
                    {tax?.applies && info.tax && (
                        <div className="flex justify-between text-white/60">
                            <span>
                                {taxLineLabel(info.tax)}
                                {info.tax.inclusive ? " (sudah termasuk)" : ""}
                            </span>
                            <span className="tabular-nums">{fmtIDR(tax.amount)}</span>
                        </div>
                    )}
                    <div className="flex justify-between text-base font-black">
                        <span>Perkiraan total</span>
                        <span className="tabular-nums text-amber-300">{fmtIDR(tax ? tax.total : so.subtotal)}</span>
                    </div>
                    <p className="text-xs text-white/40">
                        Bayar di kasir setelah pesanan diterima. Promo atau diskon dihitung kasir.
                    </p>
                </div>

            </div>
        </BottomSheet>
    );
}

export function OrderStatusSheet({
    id,
    onClose,
    onDone,
}: {
    id: string;
    onClose: () => void;
    /** The order is finished with — forget it and go back to the menu. */
    onDone: () => void;
}) {
    const { order, missing, reload } = useOrderStatus(id);
    const [cancelling, setCancelling] = useState(false);
    const [cancelError, setCancelError] = useState<string | null>(null);

    const cancel = async () => {
        if (!window.confirm("Batalkan pesanan ini?")) return;
        setCancelling(true);
        setCancelError(null);
        try {
            const res = await fetch(`${API_URL}/api/self-order/${encodeURIComponent(id)}/cancel`, { method: "POST" });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data?.success) setCancelError(data?.error || "Belum bisa dibatalkan.");
            await reload();
        } catch {
            setCancelError("Tidak bisa terhubung.");
        } finally {
            setCancelling(false);
        }
    };

    return (
        <BottomSheet label="Status Pesanan" onClose={onClose}>
            <div className="space-y-5 p-5">
                {!order ? (
                    <div className="flex flex-col items-center gap-3 py-12 text-white/50">
                        {missing ? (
                            <>
                                <p className="text-sm">Pesanan tidak ditemukan.</p>
                                <button type="button" onClick={onDone} className="text-sm font-bold text-amber-300">
                                    Kembali ke menu
                                </button>
                            </>
                        ) : (
                            <Loader2 className="h-6 w-6 animate-spin" />
                        )}
                    </div>
                ) : (
                    <>
                        <StatusHero order={order} />

                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <div className="mb-3 flex items-center justify-between text-xs text-white/50">
                                <span>
                                    a.n. <b className="text-white/80">{order.customerName}</b>
                                </span>
                                <span>
                                    {order.tableLabel
                                        ? `Meja ${order.tableLabel}`
                                        : order.serviceType
                                          ? SERVICE_TYPE_LABEL[order.serviceType]
                                          : order.outletName}
                                </span>
                            </div>
                            <ul className="space-y-2 text-sm">
                                {order.lines.map((l, i) => (
                                    <li key={i} className="flex justify-between gap-3">
                                        <span className="min-w-0">
                                            <span className="font-bold">{l.quantity}×</span> {l.name}
                                            {l.addons.length > 0 && (
                                                <span className="block text-xs text-white/45">+ {l.addons.join(", ")}</span>
                                            )}
                                            {l.note && <span className="block text-xs italic text-white/45">“{l.note}”</span>}
                                        </span>
                                        <span className="shrink-0 tabular-nums text-white/70">{fmtIDR(l.total)}</span>
                                    </li>
                                ))}
                            </ul>
                            <div className="mt-3 flex justify-between border-t border-white/10 pt-3 text-sm font-black">
                                <span>Subtotal</span>
                                <span className="tabular-nums text-amber-300">{fmtIDR(order.subtotal)}</span>
                            </div>
                        </div>

                        {cancelError && (
                            <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{cancelError}</p>
                        )}

                        {order.status === "pending" ? (
                            <button
                                type="button"
                                onClick={() => void cancel()}
                                disabled={cancelling}
                                className="w-full rounded-2xl border border-white/15 py-3 text-sm font-bold text-white/70 transition hover:bg-white/5 disabled:opacity-50"
                            >
                                {cancelling ? "Membatalkan…" : "Batalkan Pesanan"}
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={onDone}
                                className="w-full rounded-2xl bg-white/10 py-3 text-sm font-black transition hover:bg-white/15"
                            >
                                {order.status === "accepted" ? "Selesai, pesan lagi" : "Kembali ke menu"}
                            </button>
                        )}
                    </>
                )}
            </div>
        </BottomSheet>
    );
}

function StatusHero({ order }: { order: PublicOrder }) {
    const pending = order.status === "pending";
    const accepted = order.status === "accepted";
    return (
        <div className="flex flex-col items-center gap-3 pt-2 text-center">
            <div className="relative">
                {pending && (
                    <motion.span
                        className="absolute inset-0 rounded-full bg-amber-400/30"
                        animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
                        transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                    />
                )}
                <motion.div
                    key={order.status}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 380, damping: 18 }}
                    className={`relative flex h-24 w-24 flex-col items-center justify-center rounded-full ${
                        accepted ? "bg-emerald-500 text-black" : pending ? "bg-amber-500 text-black" : "bg-white/10 text-white"
                    }`}
                >
                    <span className="text-[10px] font-black uppercase tracking-wider opacity-70">Nomor</span>
                    <span className="text-3xl font-black leading-none">#{order.queueNo}</span>
                </motion.div>
            </div>
            <div>
                <p className="flex items-center justify-center gap-1.5 text-lg font-black">
                    {pending && <Clock className="h-5 w-5 text-amber-300" />}
                    {accepted && <CheckCircle2 className="h-5 w-5 text-emerald-400" />}
                    {!pending && !accepted && <XCircle className="h-5 w-5 text-rose-400" />}
                    {pending
                        ? "Menunggu kasir"
                        : accepted
                          ? "Pesanan diterima!"
                          : order.status === "rejected"
                            ? "Pesanan ditolak"
                            : order.status === "cancelled"
                              ? "Pesanan dibatalkan"
                              : "Pesanan kedaluwarsa"}
                </p>
                <p className="mt-1 text-sm text-white/55">
                    {pending
                        ? "Kasir sudah diberi tahu. Halaman ini akan berubah begitu pesananmu diterima."
                        : accepted
                          ? `Silakan bayar di kasir — sebutkan nomor #${order.queueNo} atas nama ${order.customerName}.`
                          : order.status === "rejected"
                            ? order.rejectReason
                                ? `Alasan: ${order.rejectReason}`
                                : "Silakan tanya langsung ke kasir."
                            : order.status === "cancelled"
                              ? "Pesanan ini sudah dibatalkan."
                              : "Pesanan ini tidak diproses. Silakan pesan lagi atau tanya kasir."}
                </p>
            </div>
        </div>
    );
}
