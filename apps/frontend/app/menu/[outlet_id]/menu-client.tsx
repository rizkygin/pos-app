"use client";

import { useState, useEffect, useMemo, useCallback, useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "motion/react";
import Image from "next/image";
import QRCode from "react-qr-code";
import { Phone, Share2, X, Copy, Check, Navigation, Plus, CircleAlert } from "lucide-react";
import { fmtIDR } from "@/lib/utils/format";
import { resolveProductImage, isBackendImage } from "@/lib/image-src";
import { AdBanner } from "./ad-banner";
import { GroupShowcase } from "./group-showcase";
import { LiveImage } from "./live-image";
import { ProductSheet, StarRating } from "./product-sheet";
import {
    ActiveOrderChip,
    CartFab,
    CartSheet,
    OrderStatusSheet,
    SelfOrderBar,
    useSelfOrder,
    type CartLine,
} from "./self-order";
import {
    buildSections,
    isDiscounted,
    slugify,
    type MenuAd,
    type MenuItem,
    type Outlet,
    type Product,
    type SelfOrderInfo,
} from "./menu-types";

type Props = {
    outlet: Outlet;
    products: Product[];
    selfOrder: SelfOrderInfo;
    ads: MenuAd[];
};

const noSubscribe = () => () => {};

/** Does tapping "+" need the sheet, or can it go straight into the cart? */
const needsPicker = (item: MenuItem) =>
    item.options.length > 0 || (item.base.addon_groups ?? []).length > 0;

function ProductCard({
    item,
    index,
    canOrder,
    onOpen,
    onQuickAdd,
}: {
    item: MenuItem;
    index: number;
    canOrder: boolean;
    onOpen: (item: MenuItem) => void;
    onQuickAdd: (item: MenuItem) => void;
}) {
    const { base } = item;
    const discounted = isDiscounted(base) && item.options.length === 0;

    return (
        <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4, delay: (index % 6) * 0.055, ease: [0.22, 1, 0.36, 1] }}
            className="group relative"
        >
            <button
                type="button"
                onClick={() => onOpen(item)}
                aria-label={`Lihat detail ${base.product_name}`}
                className="relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-left backdrop-blur-md transition-colors hover:border-white/20 hover:bg-white/8 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
                <div className="relative aspect-4/3 w-full overflow-hidden">
                    <LiveImage
                        image={base.image}
                        alt={base.product_name}
                        seed={base.id}
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 30vw, 22vw"
                        className="transition-transform duration-700 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-linear-to-t from-black/70 via-black/5 to-transparent" />
                    <div className="absolute left-2 top-2 flex flex-col gap-1">
                        {base.is_recommended && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/90 px-2 py-0.5 text-[10px] font-black text-black backdrop-blur-sm">
                                ✦ Rekomendasi
                            </span>
                        )}
                        {discounted && base.discount_percent ? (
                            <span className="w-fit rounded-full bg-rose-500/90 px-2 py-0.5 text-[10px] font-black text-white backdrop-blur-sm">
                                -{base.discount_percent}%
                            </span>
                        ) : null}
                    </div>
                    <div className="absolute bottom-2 left-2">
                        <StarRating value={parseFloat(base.ratings)} count={base.review_count} />
                    </div>
                </div>

                <div className="flex flex-1 flex-col gap-1 p-2.5 sm:p-3 md:p-3.5">
                    <p className="line-clamp-2 text-[13px] font-bold leading-snug text-white sm:text-sm">
                        {base.product_name}
                    </p>
                    {base.description && (
                        <p className="line-clamp-1 text-[11px] leading-relaxed text-white/45 sm:line-clamp-2">
                            {base.description}
                        </p>
                    )}
                    {item.options.length > 0 && (
                        <p className="truncate text-[10px] font-bold uppercase tracking-wider text-violet-300/70">
                            {item.options.length} {base.variant_label?.toLowerCase() ?? "varian"}
                        </p>
                    )}
                    {/* "mulai" and the struck-out price on their own lines: beside
                        the + button a two-up phone card has no room for one row. */}
                    <div className={`mt-auto pt-1 ${canOrder ? "pr-10" : ""}`}>
                        {item.options.length > 0 && (
                            <span className="block text-[10px] font-bold leading-none text-white/45">mulai</span>
                        )}
                        <span className="block text-sm font-black text-white md:text-[15px]">
                            {fmtIDR(item.fromPrice)}
                        </span>
                        {discounted && (
                            <span className="block text-[11px] leading-none text-white/35 line-through">
                                {fmtIDR(parseFloat(base.price))}
                            </span>
                        )}
                    </div>
                </div>
            </button>

            {canOrder && (
                <motion.button
                    type="button"
                    whileTap={{ scale: 0.85 }}
                    onClick={() => onQuickAdd(item)}
                    aria-label={`Tambah ${base.product_name}`}
                    className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-amber-500 text-black shadow-lg shadow-black/40 transition hover:bg-amber-400 sm:bottom-2.5 sm:right-2.5 sm:h-9 sm:w-9"
                >
                    <Plus className="h-5 w-5" />
                </motion.button>
            )}
        </motion.div>
    );
}

export function MenuClient({ outlet, products, selfOrder, ads }: Props) {
    const sections = useMemo(() => buildSections(products), [products]);
    const so = useSelfOrder(outlet.id, selfOrder);

    const [detail, setDetail] = useState<MenuItem | null>(null);
    const [cartOpen, setCartOpen] = useState(false);
    const [statusId, setStatusId] = useState<string | null>(null);
    const [shareOpen, setShareOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
    // Share the menu, not the table: a ?meja= link passed on would seat
    // whoever opens it at somebody else's table. Empty on the server render.
    const menuUrl = useSyncExternalStore(
        noSubscribe,
        () => `${window.location.origin}${window.location.pathname}`,
        () => "",
    );

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), toast.ok ? 1800 : 4500);
        return () => clearTimeout(t);
    }, [toast]);

    // Ads name a product; it may be a variant, which lives inside its base's item.
    const itemByProductId = useMemo(() => {
        const map = new Map<string, MenuItem>();
        for (const s of sections)
            for (const item of s.items) {
                map.set(item.base.id, item);
                for (const o of item.options) map.set(o.id, item);
            }
        return map;
    }, [sections]);

    const canOrder = so.enabled;

    /** Into the cart — after the location check, the first time. */
    const handleAdd = useCallback(
        async (line: Omit<CartLine, "key">) => {
            if (!so.unlocked) {
                const problem = await so.unlock();
                if (problem) {
                    setToast({ ok: false, text: problem });
                    return false;
                }
            }
            so.addLine(line);
            setToast({ ok: true, text: `${line.name} masuk keranjang` });
            return true;
        },
        [so],
    );

    const quickAdd = useCallback(
        async (item: MenuItem) => {
            if (needsPicker(item)) {
                setDetail(item);
                return;
            }
            const ok = await handleAdd({
                productId: item.base.id,
                name: item.base.product_name,
                variantName: null,
                image: item.base.image,
                unitPrice: item.fromPrice,
                optionIds: [],
                addonNames: [],
                quantity: 1,
                note: "",
            });
            if (!ok) setDetail(item);
        },
        [handleAdd],
    );

    const handleCopy = async () => {
        await navigator.clipboard.writeText(menuUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const avatarSrc = resolveProductImage(outlet.avatar);
    const rating = parseFloat(outlet.ratings);
    const mapsUrl =
        outlet.lat && outlet.lon && outlet.lat !== "0" && outlet.lon !== "0"
            ? `https://www.google.com/maps?q=${outlet.lat},${outlet.lon}`
            : `https://www.google.com/maps/search/${encodeURIComponent(outlet.address)}`;

    return (
        <div className="min-h-screen overflow-x-hidden bg-[#111114] pb-28 text-white">
            {/* ── Hero with blurred outlet photo backdrop ── */}
            <div className="relative overflow-hidden">
                <div
                    className="absolute inset-0 scale-110"
                    style={{
                        backgroundImage: `url(${avatarSrc})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        filter: "blur(48px) brightness(0.55) saturate(1.6)",
                    }}
                />
                <div className="absolute inset-0 bg-linear-to-b from-orange-900/30 via-black/30 to-[#111114]" />
                <div className="absolute inset-x-0 top-0 h-48 bg-linear-to-b from-amber-500/15 to-transparent" />

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                    className="relative z-10 mx-auto max-w-5xl px-5 pb-8 pt-10 md:px-8 md:pt-16"
                >
                    <div className="flex flex-col items-center gap-5 text-center md:flex-row md:items-end md:gap-8 md:text-left">
                        <motion.div
                            initial={{ scale: 0.85, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ duration: 0.55, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
                            className="relative shrink-0"
                        >
                            <div className="h-24 w-24 overflow-hidden rounded-2xl shadow-2xl ring-2 ring-white/25 ring-offset-2 ring-offset-transparent md:h-32 md:w-32">
                                <Image
                                    src={avatarSrc}
                                    unoptimized={isBackendImage(outlet.avatar)}
                                    alt={outlet.name}
                                    width={128}
                                    height={128}
                                    className="h-full w-full object-cover"
                                />
                            </div>
                            <span
                                className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#111114] ${
                                    outlet.is_open ? "bg-emerald-400" : "bg-white/30"
                                }`}
                            >
                                {outlet.is_open && (
                                    <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-60" />
                                )}
                            </span>
                        </motion.div>

                        <div className="flex flex-col gap-2.5">
                            <div>
                                <span
                                    className={`mb-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${
                                        outlet.is_open
                                            ? "border border-emerald-400/30 bg-emerald-400/20 text-emerald-300"
                                            : "border border-white/10 bg-white/10 text-white/40"
                                    }`}
                                >
                                    <span className={`h-1.5 w-1.5 rounded-full ${outlet.is_open ? "bg-emerald-400" : "bg-white/30"}`} />
                                    {outlet.is_open ? "Buka Sekarang" : "Tutup"}
                                </span>
                                <h1 className="text-3xl font-black tracking-tight text-white drop-shadow-lg md:text-5xl">
                                    {outlet.name}
                                </h1>
                            </div>
                            <div className="space-y-2">
                                <div className="flex items-center justify-center gap-3 md:justify-start">
                                    <StarRating value={rating} count={outlet.review_count} />
                                </div>
                                {outlet.tags.length > 0 && (
                                    <div className="flex flex-wrap justify-center gap-1.5 md:justify-start">
                                        {outlet.tags.map((tag) => (
                                            <span
                                                key={tag}
                                                className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-0.5 text-xs font-semibold text-amber-300/80 backdrop-blur-sm"
                                            >
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {outlet.phone && (
                                    <span className="flex items-center justify-center gap-1.5 text-xs text-white/50 md:justify-start">
                                        <Phone className="h-3.5 w-3.5 text-amber-400/70" />
                                        {outlet.phone}
                                    </span>
                                )}
                            </div>
                            <div className="flex justify-center md:justify-start">
                                <button
                                    onClick={() => setShareOpen(true)}
                                    className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-xs font-bold text-white/80 backdrop-blur-sm transition-all hover:bg-white/20 hover:text-white"
                                >
                                    <Share2 className="h-3.5 w-3.5" />
                                    Bagikan Menu
                                </button>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </div>

            <div className="mx-auto max-w-5xl space-y-4 px-4 md:px-8">
                <SelfOrderBar so={so} outletName={outlet.name} />
                <AdBanner
                    ads={ads}
                    onOpen={(productId) => {
                        const item = itemByProductId.get(productId);
                        if (item) setDetail(item);
                    }}
                />
            </div>

            {/* ── Section jump bar ──
                Chips scroll to a section rather than filtering, so the whole
                menu stays in the DOM: better for a customer scanning it top to
                bottom, and it keeps every item indexable for per-outlet SEO. */}
            {sections.length > 1 && (
                <div className="sticky top-0 z-20 mt-6 border-b border-white/8 bg-[#111114]/85 backdrop-blur-xl">
                    <div className="mx-auto max-w-5xl px-4 md:px-8">
                        <div className="flex gap-1 overflow-x-auto py-3" style={{ scrollbarWidth: "none" }}>
                            {sections.map((s) => (
                                <a
                                    key={s.label}
                                    href={`#section-${slugify(s.label)}`}
                                    className="shrink-0 rounded-full px-4 py-1.5 text-xs font-bold text-white/40 transition-colors hover:bg-white/5 hover:text-white/80"
                                >
                                    {s.label}
                                </a>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Menu sections: showcase on the left, the group's grid on the right ── */}
            <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
                {sections.length === 0 ? (
                    <div className="py-16 text-center text-white/30">
                        <p className="text-lg font-bold">Belum ada menu</p>
                    </div>
                ) : (
                    <div className="space-y-12">
                        {sections.map((section) => (
                            <section
                                key={section.label}
                                id={`section-${slugify(section.label)}`}
                                className="scroll-mt-20"
                            >
                                <div className="mb-4 flex items-baseline gap-3">
                                    <h2 className="text-lg font-black uppercase tracking-wide text-white">
                                        {section.label}
                                    </h2>
                                    <span className="text-xs font-bold text-white/25">{section.items.length} menu</span>
                                    <span className="h-px flex-1 bg-white/10" />
                                </div>
                                {/* Phone: the showcase is a slider across the top and
                                    the grid runs two-up under it — beside a 40%-wide
                                    showcase the cards were one long column with an
                                    empty strip down the left. From sm the showcase
                                    stands on the left and sticks while the grid scrolls. */}
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start md:gap-5">
                                    <div className="w-full shrink-0 sm:sticky sm:top-16 sm:w-52 md:w-60 lg:w-64">
                                        <GroupShowcase section={section} onOpen={setDetail} />
                                    </div>
                                    <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3">
                                        {section.items.map((item, i) => (
                                            <ProductCard
                                                key={item.base.id}
                                                item={item}
                                                index={i}
                                                canOrder={canOrder}
                                                onOpen={setDetail}
                                                onQuickAdd={(it) => void quickAdd(it)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </section>
                        ))}
                    </div>
                )}
            </div>

            {/* ── QR Share Section ── */}
            {menuUrl && (
                <div className="mx-auto max-w-5xl px-4 pb-10 md:px-8">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.45 }}
                        className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/5 p-8 text-center backdrop-blur-md"
                    >
                        <h2 className="text-base font-black text-white">Bagikan Menu Ini</h2>
                        <p className="text-sm text-white/45">Scan dengan kamera untuk share via WhatsApp, LINE, atau chat lainnya</p>
                        <div className="rounded-2xl bg-white p-4 shadow-2xl shadow-black/50">
                            <QRCode value={menuUrl} size={180} />
                        </div>
                        <p className="max-w-xs break-all text-[11px] text-white/25">{menuUrl}</p>
                    </motion.div>
                </div>
            )}

            <footer className="border-t border-white/8 px-4 py-8 text-center text-xs text-white/20">
                <p className="font-bold text-white/35">{outlet.name}</p>
                {outlet.address && <p className="mt-1">{outlet.address}</p>}
                {outlet.phone && <p>{outlet.phone}</p>}
                <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-400/10 px-5 py-2 text-xs font-bold text-blue-300 backdrop-blur-sm transition-colors hover:bg-blue-400/20 hover:text-blue-200"
                >
                    <Navigation className="h-3.5 w-3.5" />
                    Lihat Lokasi di Google Maps
                </a>
            </footer>

            {/* ── Floating: cart, and the order already sent ── */}
            {so.hydrated && so.enabled && (
                <>
                    <CartFab count={so.count} subtotal={so.subtotal} onOpen={() => setCartOpen(true)} />
                    {so.activeOrderId && !statusId && (
                        <ActiveOrderChip
                            key={so.activeOrderId}
                            id={so.activeOrderId}
                            raised={so.count > 0}
                            onOpen={() => setStatusId(so.activeOrderId)}
                        />
                    )}
                </>
            )}

            <AnimatePresence>
                {toast && (
                    <motion.div
                        initial={{ opacity: 0, y: -20, x: "-50%" }}
                        animate={{ opacity: 1, y: 0, x: "-50%" }}
                        exit={{ opacity: 0, y: -20, x: "-50%" }}
                        className={`fixed left-1/2 top-4 z-60 flex max-w-[90vw] items-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold shadow-2xl ${
                            toast.ok ? "bg-emerald-500 text-black" : "bg-rose-500 text-white"
                        }`}
                    >
                        {toast.ok ? <Check className="h-4 w-4 shrink-0" /> : <CircleAlert className="h-4 w-4 shrink-0" />}
                        <span className="truncate">{toast.text}</span>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {detail && (
                    <ProductSheet
                        key={detail.base.id}
                        item={detail}
                        outletId={outlet.id}
                        selfOrder={canOrder}
                        onClose={() => setDetail(null)}
                        onAdd={handleAdd}
                    />
                )}

                {cartOpen && (
                    <CartSheet
                        key="cart"
                        so={so}
                        onClose={() => setCartOpen(false)}
                        onSent={(order) => {
                            setCartOpen(false);
                            setStatusId(order.id);
                        }}
                    />
                )}

                {statusId && (
                    <OrderStatusSheet
                        key={`status-${statusId}`}
                        id={statusId}
                        onClose={() => setStatusId(null)}
                        onDone={() => {
                            so.forgetActiveOrder();
                            setStatusId(null);
                        }}
                    />
                )}

                {shareOpen && (
                    <>
                        <motion.div
                            key="share-backdrop"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
                            onClick={() => setShareOpen(false)}
                        />
                        <motion.div
                            key="share"
                            initial={{ opacity: 0, scale: 0.92, y: 16 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.92, y: 16 }}
                            transition={{ type: "spring", stiffness: 420, damping: 32 }}
                            className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-sm -translate-y-1/2 rounded-2xl border border-white/15 bg-[#1a1a1e] p-6 shadow-2xl"
                        >
                            <div className="mb-5 flex items-center justify-between">
                                <h3 className="text-base font-black text-white">Bagikan Menu</h3>
                                <button
                                    onClick={() => setShareOpen(false)}
                                    className="rounded-full p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            <div className="mb-5 flex justify-center">
                                <div className="rounded-xl bg-white p-3 shadow-xl">
                                    <QRCode value={menuUrl} size={160} />
                                </div>
                            </div>
                            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                                <p className="flex-1 truncate text-xs text-white/45">{menuUrl}</p>
                                <button
                                    onClick={handleCopy}
                                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-black transition-colors hover:bg-amber-400"
                                >
                                    {copied ? (
                                        <>
                                            <Check className="h-3.5 w-3.5" /> Tersalin!
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="h-3.5 w-3.5" /> Salin
                                        </>
                                    )}
                                </button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
