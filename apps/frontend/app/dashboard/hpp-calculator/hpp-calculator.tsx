"use client";

import { useState } from "react";
import { Plus, Trash2, Calculator, Package, TrendingUp, HelpCircle } from "lucide-react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatNumberInput, parseNumberInput } from "@/lib/utils/format";

type Ingredient = {
    id: string;
    name: string;
    buyPrice: string;
    buyQty: string;
    usedQty: string;
    unit: string;
};

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
                <Button
                    type="button"
                    onClick={startTour}
                    className="shrink-0 gap-2 rounded-xl bg-rose-600 font-bold text-white shadow-md hover:bg-rose-700"
                >
                    <HelpCircle className="size-4" />
                    <span className="hidden sm:inline">Tutorial</span>
                </Button>
            </div>

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
                                <Input
                                    value={ing.name}
                                    onChange={(e) => updateIngredient(ing.id, "name", e.target.value)}
                                    placeholder={`Nama bahan (mis. Tepung Terigu)`}
                                    className="rounded-xl font-bold"
                                />
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
            </SectionCard>
        </div>
    );
}
