"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Plus,
    Trash2,
    Calculator,
    Package,
    TrendingUp,
    HelpCircle,
    Boxes,
    Loader2,
    Search,
    Save,
    X,
    Check,
} from "lucide-react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { API_URL } from "@/lib/api-url";
import { formatCurrency, formatNumberInput, parseNumberInput } from "@/lib/utils/format";

type Ingredient = {
    id: string;
    name: string;
    buyPrice: string;
    buyQty: string;
    usedQty: string;
    unit: string;
    // Composites walked through to reach this ingredient, nearest first. Display
    // only — it never enters the arithmetic — but without it a row like "Biji
    // Kopi" appearing under Kopi Susu looks like it was typed by mistake.
    via?: string[];
};

// A product the calculator can be seeded from: anything with a composition.
type RecipeProduct = {
    id: string;
    product_name: string;
    unit: string;
    price: string;
    category: string;
};

type PreviewItem = {
    product_id: string;
    name: string;
    qty: number;
    unit_cost: number;
    cost: number;
    via: string[];
};

// Where the expansion stops.
//
//   ledger — stop at anything holding its own stock. Mirrors what a sale really
//     deducts, so the number here matches the HPP the reports will show.
//   raw    — keep going down to the materials nothing is made from. Answers
//     "what does this consume from scratch", ignoring that an intermediate was
//     already made and priced.
type ExpandMode = "ledger" | "raw";

function newIngredient(): Ingredient {
    return { id: crypto.randomUUID(), name: "", buyPrice: "", buyQty: "", usedQty: "", unit: "gr" };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <p className="text-xs font-bold text-muted-foreground sm:text-sm">{label}</p>
            {children}
            {hint ? <p className="text-[11px] leading-snug text-muted-foreground/80">{hint}</p> : null}
        </div>
    );
}

function SectionCard({
    icon: Icon,
    title,
    subtitle,
    tour,
    children,
}: {
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    subtitle?: string;
    tour?: string;
    children: React.ReactNode;
}) {
    return (
        <section
            data-tour={tour}
            className="space-y-4 rounded-2xl border border-border/60 bg-card p-4 shadow-sm sm:p-5"
        >
            <div className="flex items-start gap-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-950/60">
                    <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                    <p className="font-black leading-tight">{title}</p>
                    {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
                </div>
            </div>
            {children}
        </section>
    );
}

export function HppCalculator() {
    const [ingredients, setIngredients] = useState<Ingredient[]>([newIngredient()]);
    const [extraCost, setExtraCost] = useState("");
    const [portions, setPortions] = useState("1");
    const [pricingMode, setPricingMode] = useState<"markup" | "margin">("markup");
    const [percent, setPercent] = useState("30");

    // ── Seeding from a real product ─────────────────────────────────────────
    const [pickerOpen, setPickerOpen] = useState(false);
    const [products, setProducts] = useState<RecipeProduct[]>([]);
    const [productsLoading, setProductsLoading] = useState(false);
    const [productSearch, setProductSearch] = useState("");
    // The product the form was filled from, kept so the mode toggle can refetch
    // and the price can be written back. Null = hand-typed, the original mode.
    const [source, setSource] = useState<RecipeProduct | null>(null);
    const [expandMode, setExpandMode] = useState<ExpandMode>("ledger");
    const [filling, setFilling] = useState(false);
    const [fillError, setFillError] = useState("");
    const [saving, setSaving] = useState(false);
    const [savedPrice, setSavedPrice] = useState<number | null>(null);

    const openPicker = async () => {
        setPickerOpen(true);
        setProductSearch("");
        if (products.length > 0) return;
        setProductsLoading(true);
        try {
            const res = await fetch(`${API_URL}/api/products/mine`, { credentials: "include" });
            const json = await res.json();
            const all: (RecipeProduct & { has_recipe?: boolean })[] = json.products ?? [];
            setProducts(all.filter((p) => p.has_recipe));
        } catch {
            setProducts([]);
        } finally {
            setProductsLoading(false);
        }
    };

    // Pull a product's expanded composition into the form. Every row lands in
    // the SAME shape a hand-typed one has, so nothing downstream needs to know
    // where it came from and the owner can still edit any of it.
    const fillFrom = useCallback(async (product: RecipeProduct, mode: ExpandMode) => {
        setFilling(true);
        setFillError("");
        try {
            const res = await fetch(
                `${API_URL}/api/products/${product.id}/production-preview?qty=1&mode=${mode}`,
                { credentials: "include" },
            );
            const json = await res.json();
            if (!json.success) throw new Error(json.message || "Gagal memuat komposisi");
            const items: PreviewItem[] = json.items ?? [];
            if (items.length === 0) {
                setFillError(
                    "Komposisi produk ini tidak menghasilkan bahan apa pun — cek resepnya.",
                );
                return;
            }
            setIngredients(
                items.map((it) => ({
                    id: crypto.randomUUID(),
                    name: it.name,
                    // buyQty 1 makes "Harga Beli" read as the cost of ONE unit,
                    // which is exactly what the ledger stores (avg_cost). Whole
                    // rupiah because the field strips non-digits by design.
                    buyPrice: String(Math.round(it.unit_cost)),
                    buyQty: "1",
                    usedQty: String(it.qty),
                    unit: "",
                    via: it.via,
                })),
            );
            // The preview is for exactly one unit of the product, so the recipe
            // yields one portion. Extra cost is the owner's to add — the ledger
            // knows nothing about gas or labour.
            setPortions("1");
            setSource(product);
            setSavedPrice(null);
        } catch (e) {
            setFillError(e instanceof Error ? e.message : "Gagal memuat komposisi");
        } finally {
            setFilling(false);
        }
    }, []);

    // Re-expand when the depth toggle moves, but only for a loaded product.
    useEffect(() => {
        if (!source) return;
        fillFrom(source, expandMode);
        // fillFrom is stable; source changes are already handled where it is set.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [expandMode]);

    const clearSource = () => {
        setSource(null);
        setFillError("");
        setSavedPrice(null);
        setIngredients([newIngredient()]);
        setPortions("1");
    };

    const filteredProducts = useMemo(() => {
        const q = productSearch.trim().toLowerCase();
        return q ? products.filter((p) => p.product_name.toLowerCase().includes(q)) : products;
    }, [products, productSearch]);

    function updateIngredient(id: string, field: keyof Ingredient, value: string) {
        setIngredients((prev) => prev.map((ing) => (ing.id === id ? { ...ing, [field]: value } : ing)));
    }

    function addIngredient() {
        setIngredients((prev) => [...prev, newIngredient()]);
    }

    function removeIngredient(id: string) {
        setIngredients((prev) => (prev.length > 1 ? prev.filter((ing) => ing.id !== id) : prev));
    }

    const ingredientCosts = ingredients.map((ing) => {
        const buyPrice = parseFloat(ing.buyPrice) || 0;
        const buyQty = parseFloat(ing.buyQty) || 0;
        const usedQty = parseFloat(ing.usedQty) || 0;
        const unitCost = buyQty > 0 ? buyPrice / buyQty : 0;
        return unitCost * usedQty;
    });

    const totalIngredientCost = ingredientCosts.reduce((sum, c) => sum + c, 0);
    const totalExtraCost = parseFloat(extraCost) || 0;
    const totalCost = totalIngredientCost + totalExtraCost;
    const portionCount = Math.max(parseFloat(portions) || 1, 1);
    const hppPerPortion = totalCost / portionCount;

    const pct = parseFloat(percent) || 0;
    const suggestedPrice =
        pricingMode === "markup"
            ? hppPerPortion * (1 + pct / 100)
            : pct < 100
                ? hppPerPortion / (1 - pct / 100)
                : Infinity;
    const profitPerPortion = isFinite(suggestedPrice) ? suggestedPrice - hppPerPortion : 0;
    const marginPercent = isFinite(suggestedPrice) && suggestedPrice > 0 ? (profitPerPortion / suggestedPrice) * 100 : 0;

    // Write the suggested price back onto the product it was calculated for.
    // Only the price — see PATCH /api/products/:id/price for why this is not
    // the general update route.
    const savePrice = async () => {
        if (!source || !isFinite(suggestedPrice)) return;
        setSaving(true);
        setFillError("");
        try {
            const rounded = Math.round(suggestedPrice);
            const res = await fetch(`${API_URL}/api/products/${source.id}/price`, {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ price: rounded }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.message || "Gagal menyimpan harga");
            setSavedPrice(rounded);
            setSource((prev) => (prev ? { ...prev, price: String(rounded) } : prev));
            setProducts((prev) =>
                prev.map((p) => (p.id === source.id ? { ...p, price: String(rounded) } : p)),
            );
        } catch (e) {
            setFillError(e instanceof Error ? e.message : "Gagal menyimpan harga");
        } finally {
            setSaving(false);
        }
    };

    const startTour = () => {
        const tour = driver({
            showProgress: true,
            progressText: "{{current}} / {{total}}",
            nextBtnText: "Lanjut",
            prevBtnText: "Kembali",
            doneBtnText: "Selesai",
            overlayColor: "rgba(0, 0, 0, 0.6)",
            stagePadding: 6,
            stageRadius: 12,
            steps: [
                {
                    popover: {
                        title: "Kalkulator HPP",
                        description:
                            "Tutorial ini akan menunjukkan cara menghitung Harga Pokok Penjualan (HPP) dan mendapatkan rekomendasi harga jual untuk produk pian.",
                    },
                },
                {
                    element: '[data-tour="ingredients"]',
                    popover: {
                        title: "1. Isi Bahan Baku",
                        description:
                            "Tambahkan setiap bahan yang dipakai. Isi <b>Harga Beli</b> & <b>Jumlah Beli</b> sesuai kemasan yang pian beli, lalu <b>Dipakai/Resep</b> sesuai jumlah yang dipakai untuk satu resep. Klik 'Tambah Bahan' jika perlu lebih.",
                        side: "top",
                    },
                },
                {
                    element: '[data-tour="extra-cost"]',
                    popover: {
                        title: "2. Biaya Tambahan & Porsi",
                        description:
                            "Masukkan biaya lain seperti kemasan atau gas, lalu isi jumlah porsi yang dihasilkan dari resep ini.",
                        side: "top",
                    },
                },
                {
                    element: '[data-tour="result"]',
                    popover: {
                        title: "3. Hasil HPP",
                        description:
                            "Total HPP dan HPP per porsi akan terhitung otomatis dari bahan & biaya yang pian masukkan.",
                        side: "top",
                    },
                },
                {
                    element: '[data-tour="pricing"]',
                    popover: {
                        title: "4. Rekomendasi Harga Jual",
                        description:
                            "Pilih mode Markup (dari HPP) atau Margin (dari harga jual), isi persentasenya, dan pian akan dapat rekomendasi harga jual beserta keuntungan per porsi.",
                        side: "top",
                    },
                },
            ],
        });

        tour.drive();
    };

    return (
        <div className="mx-auto w-full max-w-2xl space-y-5 p-4 sm:space-y-6 sm:p-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="flex items-center gap-2 text-xl font-black tracking-tight sm:text-2xl">
                        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-950/60">
                            <Calculator className="size-5" />
                        </span>
                        Kalkulator HPP
                    </h1>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                        Hitung Harga Pokok Penjualan dari bahan baku, lalu dapatkan rekomendasi harga jual.
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={openPicker}
                        className="gap-2 rounded-xl font-bold"
                    >
                        <Boxes className="size-4" />
                        <span className="hidden sm:inline">Ambil dari Produk</span>
                    </Button>
                    <Button
                        type="button"
                        onClick={startTour}
                        className="gap-2 rounded-xl bg-rose-600 font-bold text-white shadow-md hover:bg-rose-700"
                    >
                        <HelpCircle className="size-4" />
                        <span className="hidden sm:inline">Tutorial</span>
                    </Button>
                </div>
            </div>

            {/* What the form was seeded from. Absent until a product is picked,
                so the calculator still works as the blank what-if tool it was. */}
            {source && (
                <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50/60 p-4 dark:border-rose-900/60 dark:bg-rose-950/30">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-[11px] font-bold uppercase tracking-widest text-rose-700 dark:text-rose-300">
                                Diambil dari produk
                            </p>
                            <p className="truncate font-black">{source.product_name}</p>
                            <p className="text-xs text-muted-foreground">
                                Harga jual sekarang {formatCurrency(Number(source.price) || 0)}
                                {" · "}per 1 {source.unit}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={clearSource}
                            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-background"
                            aria-label="Lepas produk"
                        >
                            <X className="size-4" />
                        </button>
                    </div>

                    {/* The depth choice, stated as the question it answers rather
                        than as jargon — "ledger vs raw" means nothing to an owner. */}
                    <div className="grid grid-cols-2 gap-2">
                        {(
                            [
                                ["ledger", "Sesuai stok", "Berhenti di barang yang punya stok sendiri — sama dengan HPP di laporan."],
                                ["raw", "Sampai bahan mentah", "Diurai terus sampai bahan paling dasar."],
                            ] as const
                        ).map(([mode, label, hint]) => (
                            <button
                                key={mode}
                                type="button"
                                onClick={() => setExpandMode(mode)}
                                className={`rounded-xl border-2 px-3 py-2 text-left transition-all ${
                                    expandMode === mode
                                        ? "border-rose-400 bg-background"
                                        : "border-border/60 hover:border-rose-200"
                                }`}
                            >
                                <span className="block text-xs font-bold">{label}</span>
                                <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                                    {hint}
                                </span>
                            </button>
                        ))}
                    </div>

                    {filling && (
                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="size-3.5 animate-spin" /> Memuat komposisi…
                        </p>
                    )}
                </div>
            )}

            {fillError && (
                <p className="rounded-xl bg-destructive/10 p-3 text-xs font-medium text-destructive">
                    {fillError}
                </p>
            )}

            {/* Bahan Baku */}
            <SectionCard
                icon={Package}
                title="Bahan Baku"
                subtitle="Isi harga & jumlah beli, lalu jumlah yang dipakai untuk satu resep."
                tour="ingredients"
            >
                <div className="space-y-3">
                    {ingredients.map((ing, idx) => (
                        <div key={ing.id} className="space-y-3 rounded-xl border border-border/60 bg-background p-3 sm:p-4">
                            <div className="flex items-center gap-2">
                                <span className="grid size-6 shrink-0 place-items-center rounded-md bg-rose-100 text-[11px] font-black text-rose-600 dark:bg-rose-950/60">
                                    {idx + 1}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <Input
                                        value={ing.name}
                                        onChange={(e) => updateIngredient(ing.id, "name", e.target.value)}
                                        placeholder={`Nama bahan (mis. Tepung Terigu)`}
                                        className="rounded-xl font-bold"
                                    />
                                    {/* Why this row is here at all, when the
                                        product's own recipe never mentions it. */}
                                    {ing.via && ing.via.length > 0 && (
                                        <p className="mt-1 pl-1 text-[10px] text-muted-foreground">
                                            via {ing.via.join(" › ")}
                                        </p>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => removeIngredient(ing.id)}
                                    disabled={ingredients.length <= 1}
                                    className="grid size-9 shrink-0 place-items-center rounded-xl border border-border/60 text-muted-foreground transition-all hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 disabled:hover:border-border/60 disabled:hover:bg-transparent"
                                >
                                    <Trash2 className="size-4" />
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <Field label="Harga Beli" hint="Total saat beli bahan ini. Mis. Rp20.000 / 1 kg tepung.">
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                                            Rp
                                        </span>
                                        <Input
                                            type="text"
                                            inputMode="numeric"
                                            value={formatNumberInput(ing.buyPrice)}
                                            onChange={(e) => updateIngredient(ing.id, "buyPrice", parseNumberInput(e.target.value))}
                                            placeholder="20.000"
                                            className="rounded-xl pl-9"
                                        />
                                    </div>
                                </Field>
                                <Field label="Jumlah Beli" hint="Isi kemasan sesuai satuan. Mis. 1000 (gr).">
                                    <Input
                                        type="number"
                                        inputMode="decimal"
                                        value={ing.buyQty}
                                        onChange={(e) => updateIngredient(ing.id, "buyQty", e.target.value)}
                                        placeholder="1000"
                                        className="rounded-xl"
                                    />
                                </Field>
                                <Field label="Dipakai/Resep" hint="Dipakai untuk 1 resep. Mis. 150 (gr).">
                                    <Input
                                        type="number"
                                        inputMode="decimal"
                                        value={ing.usedQty}
                                        onChange={(e) => updateIngredient(ing.id, "usedQty", e.target.value)}
                                        placeholder="100"
                                        className="rounded-xl"
                                    />
                                </Field>
                                <Field label="Satuan" hint="gr, ml, atau pcs.">
                                    <Input
                                        value={ing.unit}
                                        onChange={(e) => updateIngredient(ing.id, "unit", e.target.value)}
                                        placeholder="gr / ml / pcs"
                                        className="rounded-xl"
                                    />
                                </Field>
                            </div>

                            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs">
                                <span className="text-muted-foreground">Biaya bahan ini</span>
                                <span className="font-black text-foreground">{formatCurrency(ingredientCosts[idx])}</span>
                            </div>
                        </div>
                    ))}
                </div>

                <button
                    type="button"
                    onClick={addIngredient}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 px-4 py-2.5 text-sm font-bold text-muted-foreground transition-all hover:border-rose-200 hover:bg-rose-50/40 hover:text-rose-600"
                >
                    <Plus className="size-4" /> Tambah Bahan
                </button>
            </SectionCard>

            {/* Biaya Tambahan & Porsi */}
            <SectionCard icon={Package} title="Biaya Tambahan & Porsi" tour="extra-cost">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Biaya Tambahan" hint="Kemasan, gas, dan biaya lain di luar bahan.">
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                                Rp
                            </span>
                            <Input
                                type="text"
                                inputMode="numeric"
                                value={formatNumberInput(extraCost)}
                                onChange={(e) => setExtraCost(parseNumberInput(e.target.value))}
                                placeholder="0"
                                className="rounded-xl pl-9"
                            />
                        </div>
                    </Field>
                    <Field label="Jumlah Porsi Dihasilkan" hint="Berapa porsi dari satu resep ini.">
                        <Input
                            type="number"
                            inputMode="decimal"
                            value={portions}
                            onChange={(e) => setPortions(e.target.value)}
                            placeholder="1"
                            className="rounded-xl"
                        />
                    </Field>
                </div>
            </SectionCard>

            {/* Hasil HPP */}
            <SectionCard icon={Calculator} title="Hasil HPP" tour="result">
                <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Total Biaya Bahan</span>
                        <span className="font-bold tabular-nums">{formatCurrency(totalIngredientCost)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Biaya Tambahan</span>
                        <span className="font-bold tabular-nums">{formatCurrency(totalExtraCost)}</span>
                    </div>
                    <div className="my-1 h-px bg-border" />
                    <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Total HPP</span>
                        <span className="font-bold tabular-nums">{formatCurrency(totalCost)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Jumlah Porsi</span>
                        <span className="font-bold tabular-nums">{portionCount}</span>
                    </div>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/60 dark:bg-rose-950/40">
                    <span className="font-bold text-rose-700 dark:text-rose-300">HPP per Porsi</span>
                    <span className="text-lg font-black tabular-nums text-rose-700 dark:text-rose-300">
                        {formatCurrency(hppPerPortion)}
                    </span>
                </div>
            </SectionCard>

            {/* Rekomendasi Harga Jual */}
            <SectionCard icon={TrendingUp} title="Rekomendasi Harga Jual" tour="pricing">
                <div className="grid grid-cols-2 gap-2.5">
                    <button
                        type="button"
                        onClick={() => setPricingMode("markup")}
                        className={`rounded-xl border-2 px-3 py-2.5 text-xs font-bold transition-all sm:text-sm ${pricingMode === "markup" ? "border-rose-400 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" : "border-border/60 text-muted-foreground hover:border-rose-200 hover:bg-rose-50/40"}`}
                    >
                        Markup dari HPP
                    </button>
                    <button
                        type="button"
                        onClick={() => setPricingMode("margin")}
                        className={`rounded-xl border-2 px-3 py-2.5 text-xs font-bold transition-all sm:text-sm ${pricingMode === "margin" ? "border-rose-400 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" : "border-border/60 text-muted-foreground hover:border-rose-200 hover:bg-rose-50/40"}`}
                    >
                        Margin dari Harga Jual
                    </button>
                </div>

                <Field label={pricingMode === "markup" ? "Markup (%)" : "Margin (%)"}>
                    <div className="relative">
                        <Input
                            type="number"
                            inputMode="decimal"
                            value={percent}
                            onChange={(e) => setPercent(e.target.value)}
                            placeholder="30"
                            className="rounded-xl pr-9"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                            %
                        </span>
                    </div>
                </Field>

                <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Keuntungan per Porsi</span>
                        <span className="font-bold tabular-nums">{formatCurrency(profitPerPortion)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Margin Keuntungan</span>
                        <span className="font-bold tabular-nums">{marginPercent.toFixed(1)}%</span>
                    </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/40">
                    <span className="font-bold text-emerald-700 dark:text-emerald-300">Harga Jual Disarankan</span>
                    <span className="text-lg font-black tabular-nums text-emerald-700 dark:text-emerald-300">
                        {isFinite(suggestedPrice) ? formatCurrency(suggestedPrice) : "—"}
                    </span>
                </div>

                {/* Only offered when the number has somewhere to go. Typing a
                    recipe by hand produces a price for a product that does not
                    exist, and there is nothing to save it onto. */}
                {source && (
                    <div className="space-y-2">
                        <Button
                            type="button"
                            onClick={savePrice}
                            disabled={saving || !isFinite(suggestedPrice) || suggestedPrice <= 0}
                            className="w-full gap-2 rounded-xl font-bold"
                        >
                            {saving ? (
                                <Loader2 className="size-4 animate-spin" />
                            ) : savedPrice !== null ? (
                                <Check className="size-4" />
                            ) : (
                                <Save className="size-4" />
                            )}
                            {savedPrice !== null
                                ? `Tersimpan — ${source.product_name} kini ${formatCurrency(savedPrice)}`
                                : `Simpan sebagai harga jual ${source.product_name}`}
                        </Button>
                        <p className="text-[11px] leading-snug text-muted-foreground">
                            Menimpa harga jual produk ini. HPP-nya sendiri tetap dihitung dari
                            pergerakan stok, bukan dari angka di halaman ini.
                        </p>
                    </div>
                )}
            </SectionCard>

            {/* Product picker. Hand-rolled overlay to match the other dashboard
                dialogs, which have no shared primitive either. */}
            {pickerOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                    onClick={() => setPickerOpen(false)}
                >
                    <div
                        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border bg-background shadow-lg"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="space-y-3 border-b p-5">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-black tracking-tight">Pilih Produk</h2>
                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                        Semua produk yang punya komposisi. Bahannya akan diurai
                                        sampai bahan paling dalam, lengkap dengan harganya.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setPickerOpen(false)}
                                    className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted"
                                    aria-label="Tutup"
                                >
                                    <X className="size-4" />
                                </button>
                            </div>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    autoFocus
                                    placeholder="Cari produk…"
                                    className="rounded-xl pl-9"
                                    value={productSearch}
                                    onChange={(e) => setProductSearch(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto p-2">
                            {productsLoading ? (
                                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                                    <Loader2 className="size-4 animate-spin" /> Memuat produk…
                                </div>
                            ) : filteredProducts.length === 0 ? (
                                <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                                    {products.length === 0
                                        ? "Belum ada produk yang punya komposisi. Isi dulu Komposisi Produk di halaman Product."
                                        : "Tidak ada produk yang cocok."}
                                </p>
                            ) : (
                                filteredProducts.map((prod) => (
                                    <button
                                        key={prod.id}
                                        type="button"
                                        onClick={() => {
                                            setPickerOpen(false);
                                            fillFrom(prod, expandMode);
                                        }}
                                        className="flex w-full items-center justify-between gap-3 rounded-xl p-3 text-left transition-colors hover:bg-muted"
                                    >
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-bold">{prod.product_name}</p>
                                            <p className="text-[11px] text-muted-foreground">
                                                {prod.category} · per {prod.unit}
                                            </p>
                                        </div>
                                        <span className="shrink-0 text-sm font-black tabular-nums">
                                            {formatCurrency(Number(prod.price) || 0)}
                                        </span>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
