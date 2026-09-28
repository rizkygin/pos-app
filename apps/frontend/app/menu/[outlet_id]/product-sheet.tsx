"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Check, Loader2, MessageCircle, Minus, Plus, Star, Truck, X } from "lucide-react";
import { fmtIDR } from "@/lib/utils/format";
import { ORDER_FEATURES } from "@/lib/order-features";
import { BottomSheet } from "./bottom-sheet";
import { LiveImage } from "./live-image";
import { isDiscounted, priceOf, type AddonGroup, type MenuItem, type Product } from "./menu-types";
import type { CartLine } from "./self-order";

// Which /dashboard/order/[feature] page this product belongs to. Prefers the
// product's own feature (an outlet may offer several), falling back to the
// slug that owns its category, then to "food" so the link is never dead.
const orderFeatureSlug = (product: Product) =>
    product.features?.[0] ??
    ORDER_FEATURES.find((f) => f.category === product.category)?.slug ??
    "food";

/** What the picker calls a variant: its own short name, "Reguler" for an unnamed base. */
const variantTitle = (v: Product, base: Product) =>
    v.variant_name ?? (v.id === base.id ? "Reguler" : v.product_name);

const groupRule = (g: AddonGroup) =>
    g.min_select >= 1
        ? g.max_select === 1
            ? "Wajib pilih 1"
            : `Wajib, min. ${g.min_select}${g.max_select ? ` maks. ${g.max_select}` : ""}`
        : g.max_select
          ? `Opsional, maks. ${g.max_select}`
          : "Opsional";

export function StarRating({ value, count }: { value: number; count?: number }) {
    return (
        <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
                <Star
                    key={n}
                    className={`h-3 w-3 ${n <= Math.round(value) ? "fill-amber-400 text-amber-400" : "fill-white/20 text-white/20"}`}
                />
            ))}
            <span className="text-[10px] font-bold text-white/80">{value.toFixed(1)}</span>
            {count !== undefined && count > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] text-white/40">
                    <MessageCircle className="h-2.5 w-2.5" />
                    {count}
                </span>
            )}
        </div>
    );
}

/**
 * A menu item up close. Two questions of different kinds, as at the till
 * (see the cashier's option-picker-modal): WHICH ONE — the variant, which
 * changes the product being bought — and WHAT ELSE — the add-ons, per the
 * owner's min/max. In self-order mode it ends in "Tambah ke Keranjang"; the
 * courier link stays as the way to have it delivered instead.
 */
export function ProductSheet({
    item,
    outletId,
    selfOrder,
    onClose,
    onAdd,
}: {
    item: MenuItem;
    outletId: number;
    /** Whether this page can take the order itself. */
    selfOrder: boolean;
    onClose: () => void;
    /** Resolves false when it could not be added (location refused) — the sheet stays open. */
    onAdd: (line: Omit<CartLine, "key">) => Promise<boolean>;
}) {
    const { base, options } = item;
    const [variantId, setVariantId] = useState(
        () => (options.find((o) => o.isAvailable) ?? options[0] ?? base).id,
    );
    const chosen = options.find((o) => o.id === variantId) ?? base;
    const groups = useMemo(() => base.addon_groups ?? [], [base.addon_groups]);
    const [picked, setPicked] = useState<number[]>([]);
    const [quantity, setQuantity] = useState(1);
    const [note, setNote] = useState("");
    const [adding, setAdding] = useState(false);

    const toggle = (g: AddonGroup, optionId: number) => {
        setPicked((prev) => {
            const inGroup = g.options.map((o) => o.id);
            if (prev.includes(optionId)) return prev.filter((id) => id !== optionId);
            // A pick-one group behaves as a radio: the new pick replaces the old.
            if (g.max_select === 1) return [...prev.filter((id) => !inGroup.includes(id)), optionId];
            const count = prev.filter((id) => inGroup.includes(id)).length;
            if (g.max_select !== null && count >= g.max_select) return prev;
            return [...prev, optionId];
        });
    };

    const missing = groups.find(
        (g) => g.options.filter((o) => picked.includes(o.id)).length < g.min_select,
    );
    const addons = useMemo(
        () => groups.flatMap((g) => g.options.filter((o) => picked.includes(o.id))),
        [groups, picked],
    );
    const unitPrice = priceOf(chosen) + addons.reduce((s, a) => s + a.price, 0);
    const available = chosen.isAvailable;
    const courierHref = `/dashboard/order/${orderFeatureSlug(base)}/${outletId}`;

    const add = async () => {
        if (!available || missing) return;
        setAdding(true);
        const ok = await onAdd({
            productId: chosen.id,
            name: chosen.product_name,
            variantName: options.length ? variantTitle(chosen, base) : null,
            image: chosen.image || base.image,
            unitPrice,
            optionIds: picked,
            addonNames: addons.map((a) => a.name),
            quantity,
            note: note.trim(),
        });
        setAdding(false);
        if (ok) onClose();
    };

    return (
        <BottomSheet
            label={base.product_name}
            onClose={onClose}
            footer={
                selfOrder ? (
                    <div className="flex items-center gap-2.5">
                        <div className="flex shrink-0 items-center gap-0.5 rounded-xl bg-black/30 p-1">
                            <button
                                type="button"
                                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                                aria-label="Kurangi"
                                className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white"
                            >
                                <Minus className="h-4 w-4" />
                            </button>
                            <span className="w-6 text-center font-black tabular-nums">{quantity}</span>
                            <button
                                type="button"
                                onClick={() => setQuantity((q) => Math.min(50, q + 1))}
                                aria-label="Tambah"
                                className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white"
                            >
                                <Plus className="h-4 w-4" />
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={() => void add()}
                            disabled={!available || !!missing || adding}
                            className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-amber-500 px-3 text-sm font-black text-black transition hover:bg-amber-400 disabled:bg-white/10 disabled:text-white/35"
                        >
                            {adding ? (
                                <>
                                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> Memeriksa lokasi…
                                </>
                            ) : !available ? (
                                "Sedang Habis"
                            ) : missing ? (
                                <span className="truncate">Pilih {missing.name} dulu</span>
                            ) : (
                                <span className="tabular-nums">Tambah · {fmtIDR(unitPrice * quantity)}</span>
                            )}
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-3">
                        <div className="shrink-0">
                            <span className="block text-xl font-black leading-tight">{fmtIDR(unitPrice)}</span>
                            <span className="block text-[11px] text-white/35">per {chosen.unit}</span>
                        </div>
                        <a
                            href={courierHref}
                            className={`flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl text-sm font-black transition-colors ${
                                available
                                    ? "bg-amber-500 text-black hover:bg-amber-400"
                                    : "pointer-events-none bg-white/10 text-white/30"
                            }`}
                        >
                            {available ? "Pesan Sekarang" : "Sedang Habis"}
                            {available && <ArrowRight className="h-4 w-4" />}
                        </a>
                    </div>
                )
            }
            header={
                <div className="relative aspect-2/1 w-full shrink-0 overflow-hidden sm:aspect-16/10">
                    <LiveImage
                        image={chosen.image || base.image}
                        alt={base.product_name}
                        seed={`sheet-${base.id}`}
                        sizes="(max-width: 640px) 100vw, 448px"
                        priority
                    />
                    <div className="absolute inset-0 bg-linear-to-t from-[#1a1a1e] via-transparent to-black/30" />
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Tutup"
                        className="absolute right-3 top-3 rounded-full bg-black/50 p-2 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            }
        >
            <div className="space-y-5 px-5 pb-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">
                            {base.menu_group ?? base.category}
                        </span>
                        <h3 className="mt-0.5 text-xl font-black leading-tight">{base.product_name}</h3>
                        <p className="mt-1 flex items-baseline gap-2 text-sm">
                            <span className="font-black text-amber-300">{fmtIDR(priceOf(chosen))}</span>
                            {isDiscounted(chosen) && (
                                <span className="text-xs text-white/35 line-through">{fmtIDR(parseFloat(chosen.price))}</span>
                            )}
                        </p>
                    </div>
                    <StarRating value={parseFloat(base.ratings)} count={base.review_count} />
                </div>

                {base.description ? (
                    <p className="text-sm leading-relaxed text-white/60">{base.description}</p>
                ) : null}

                {options.length > 0 && (
                    <fieldset className="space-y-2">
                        <legend className="mb-2 flex w-full items-center justify-between">
                            <span className="text-sm font-black">{base.variant_label ?? "Varian"}</span>
                            <span className="text-[11px] font-bold text-amber-300/80">Pilih 1</span>
                        </legend>
                        <div className="grid grid-cols-2 gap-2">
                            {options.map((v) => {
                                const on = v.id === variantId;
                                return (
                                    <button
                                        key={v.id}
                                        type="button"
                                        disabled={!v.isAvailable}
                                        onClick={() => setVariantId(v.id)}
                                        className={`rounded-xl border px-3 py-2.5 text-left transition ${
                                            on
                                                ? "border-amber-400 bg-amber-400/15"
                                                : "border-white/10 bg-white/5 hover:border-white/25"
                                        } disabled:cursor-not-allowed disabled:opacity-40`}
                                    >
                                        <span className="block text-sm font-bold">{variantTitle(v, base)}</span>
                                        <span className="block text-xs text-white/55">
                                            {v.isAvailable ? fmtIDR(priceOf(v)) : "Habis"}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </fieldset>
                )}

                {selfOrder &&
                    groups.map((g) => (
                        <fieldset key={g.id} className="space-y-2">
                            <legend className="mb-2 flex w-full items-center justify-between">
                                <span className="text-sm font-black">{g.name}</span>
                                <span
                                    className={`text-[11px] font-bold ${
                                        g.min_select >= 1 ? "text-amber-300/80" : "text-white/40"
                                    }`}
                                >
                                    {groupRule(g)}
                                </span>
                            </legend>
                            {g.options.map((o) => {
                                const on = picked.includes(o.id);
                                return (
                                    <button
                                        key={o.id}
                                        type="button"
                                        disabled={!o.available}
                                        onClick={() => toggle(g, o.id)}
                                        className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                                            on ? "border-amber-400/70 bg-amber-400/10" : "border-white/10 bg-white/5 hover:border-white/25"
                                        } disabled:cursor-not-allowed disabled:opacity-40`}
                                    >
                                        <span
                                            className={`flex h-5 w-5 shrink-0 items-center justify-center border ${
                                                g.max_select === 1 ? "rounded-full" : "rounded-md"
                                            } ${on ? "border-amber-400 bg-amber-400 text-black" : "border-white/30"}`}
                                        >
                                            {on && <Check className="h-3.5 w-3.5" />}
                                        </span>
                                        <span className="flex-1 text-sm">{o.name}</span>
                                        <span className="text-xs text-white/55">
                                            {!o.available ? "Habis" : o.price > 0 ? `+${fmtIDR(o.price)}` : "Gratis"}
                                        </span>
                                    </button>
                                );
                            })}
                        </fieldset>
                    ))}

                {selfOrder && (
                    <label className="block">
                        <span className="text-sm font-black">Catatan</span>
                        <input
                            value={note}
                            onChange={(e) => setNote(e.target.value.slice(0, 200))}
                            placeholder="Mis. jangan pedas, es sedikit"
                            className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-amber-400/60 focus:outline-none"
                        />
                    </label>
                )}

                {selfOrder && (
                    <a
                        href={courierHref}
                        className="flex items-center justify-center gap-1.5 py-1 text-xs font-bold text-white/40 transition hover:text-white/70"
                    >
                        <Truck className="h-3.5 w-3.5" /> Mau diantar? Pesan lewat kurir
                    </a>
                )}
            </div>
        </BottomSheet>
    );
}
