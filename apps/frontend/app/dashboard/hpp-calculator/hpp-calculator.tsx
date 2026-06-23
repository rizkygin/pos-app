"use client";

import { useState } from "react";
import { Plus, Trash2, Calculator, Package, TrendingUp, HelpCircle } from "lucide-react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils/format";

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-2">
            <p className="text-sm font-bold text-muted-foreground">{label}</p>
            {children}
        </div>
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
        <div className="space-y-8 max-w-2xl">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-black flex items-center gap-2">
                        <Calculator className="h-6 w-6 text-rose-500" />
                        Kalkulator HPP
                    </h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Hitung Harga Pokok Penjualan (HPP) berdasarkan bahan baku, lalu dapatkan rekomendasi harga jual.
                    </p>
                </div>
                <Button
                    type="button"
                    onClick={startTour}
                    className="rounded-xl shrink-0 gap-2 bg-rose-600 hover:bg-rose-700 text-white font-bold shadow-md"
                >
                    <HelpCircle className="h-4 w-4" />
                    <span className="hidden sm:inline">Tutorial</span>
                </Button>
            </div>

            {/* Bahan Baku */}
            <div data-tour="ingredients" className="p-5 rounded-2xl border border-border/60 bg-card shadow-sm space-y-4">
                <div>
                    <p className="font-black flex items-center gap-2">
                        <Package className="h-4 w-4 text-rose-500" /> Bahan Baku
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                        Isi harga &amp; jumlah beli, lalu jumlah yang dipakai untuk satu resep.
                    </p>
                </div>

                <div className="space-y-4">
                    {ingredients.map((ing, idx) => (
                        <div key={ing.id} className="p-4 rounded-xl border border-border/60 bg-background space-y-3">
                            <div className="flex items-center justify-between gap-2">
                                <Input
                                    value={ing.name}
                                    onChange={(e) => updateIngredient(ing.id, "name", e.target.value)}
                                    placeholder={`Nama bahan ${idx + 1} (mis. Tepung Terigu)`}
                                    className="rounded-xl font-bold"
                                />
                                <button
                                    type="button"
                                    onClick={() => removeIngredient(ing.id)}
                                    disabled={ingredients.length <= 1}
                                    className="h-9 w-9 shrink-0 flex items-center justify-center rounded-xl border border-border/60 text-muted-foreground hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 transition-all disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:border-border/60"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <Field label="Harga Beli">
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium text-xs">
                                            Rp
                                        </span>
                                        <Input
                                            type="number"
                                            inputMode="decimal"
                                            value={ing.buyPrice}
                                            onChange={(e) => updateIngredient(ing.id, "buyPrice", e.target.value)}
                                            placeholder="20000"
                                            className="rounded-xl pl-9"
                                        />
                                    </div>
                                </Field>
                                <Field label="Jumlah Beli">
                                    <Input
                                        type="number"
                                        inputMode="decimal"
                                        value={ing.buyQty}
                                        onChange={(e) => updateIngredient(ing.id, "buyQty", e.target.value)}
                                        placeholder="1000"
                                        className="rounded-xl"
                                    />
                                </Field>
                                <Field label="Dipakai/Resep">
                                    <Input
                                        type="number"
                                        inputMode="decimal"
                                        value={ing.usedQty}
                                        onChange={(e) => updateIngredient(ing.id, "usedQty", e.target.value)}
                                        placeholder="100"
                                        className="rounded-xl"
                                    />
                                </Field>
                                <Field label="Satuan">
                                    <Input
                                        value={ing.unit}
                                        onChange={(e) => updateIngredient(ing.id, "unit", e.target.value)}
                                        placeholder="gr / ml / pcs"
                                        className="rounded-xl"
                                    />
                                </Field>
                            </div>

                            <div className="flex justify-end text-xs text-muted-foreground">
                                Biaya bahan ini: <span className="ml-1 font-black text-foreground">{formatCurrency(ingredientCosts[idx])}</span>
                            </div>
                        </div>
                    ))}
                </div>

                <button
                    type="button"
                    onClick={addIngredient}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-border/60 text-sm font-bold text-muted-foreground hover:border-rose-200 hover:bg-rose-50/40 hover:text-rose-600 transition-all"
                >
                    <Plus className="h-4 w-4" /> Tambah Bahan
                </button>
            </div>

            {/* Biaya Tambahan & Porsi */}
            <div data-tour="extra-cost" className="p-5 rounded-2xl border border-border/60 bg-card shadow-sm space-y-4">
                <p className="font-black flex items-center gap-2">
                    <Package className="h-4 w-4 text-rose-500" /> Biaya Tambahan &amp; Porsi
                </p>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Biaya Tambahan (kemasan, gas, dll)">
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium text-xs">
                                Rp
                            </span>
                            <Input
                                type="number"
                                inputMode="decimal"
                                value={extraCost}
                                onChange={(e) => setExtraCost(e.target.value)}
                                placeholder="0"
                                className="rounded-xl pl-9"
                            />
                        </div>
                    </Field>
                    <Field label="Jumlah Porsi Dihasilkan">
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
            </div>

            {/* Hasil HPP */}
            <div data-tour="result" className="p-5 rounded-2xl border border-border/60 bg-card shadow-sm space-y-3">
                <p className="font-black flex items-center gap-2">
                    <Calculator className="h-4 w-4 text-rose-500" /> Hasil HPP
                </p>
                <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Total Biaya Bahan</span>
                        <span className="font-bold">{formatCurrency(totalIngredientCost)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Biaya Tambahan</span>
                        <span className="font-bold">{formatCurrency(totalExtraCost)}</span>
                    </div>
                    <div className="h-px bg-border my-1" />
                    <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Total HPP</span>
                        <span className="font-bold">{formatCurrency(totalCost)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Jumlah Porsi</span>
                        <span className="font-bold">{portionCount}</span>
                    </div>
                </div>
                <div className="flex items-center justify-between p-4 rounded-xl bg-rose-50 border border-rose-200">
                    <span className="font-bold text-rose-700">HPP per Porsi</span>
                    <span className="font-black text-lg text-rose-700">{formatCurrency(hppPerPortion)}</span>
                </div>
            </div>

            {/* Rekomendasi Harga Jual */}
            <div data-tour="pricing" className="p-5 rounded-2xl border border-border/60 bg-card shadow-sm space-y-4">
                <p className="font-black flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-rose-500" /> Rekomendasi Harga Jual
                </p>

                <div className="grid grid-cols-2 gap-3">
                    <button
                        type="button"
                        onClick={() => setPricingMode("markup")}
                        className={`px-4 py-2.5 rounded-xl border-2 text-sm font-bold transition-all ${pricingMode === "markup" ? "border-rose-400 bg-rose-50 text-rose-700" : "border-border/60 text-muted-foreground hover:border-rose-200 hover:bg-rose-50/40"}`}
                    >
                        Markup dari HPP
                    </button>
                    <button
                        type="button"
                        onClick={() => setPricingMode("margin")}
                        className={`px-4 py-2.5 rounded-xl border-2 text-sm font-bold transition-all ${pricingMode === "margin" ? "border-rose-400 bg-rose-50 text-rose-700" : "border-border/60 text-muted-foreground hover:border-rose-200 hover:bg-rose-50/40"}`}
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
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium text-xs">
                            %
                        </span>
                    </div>
                </Field>

                <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Keuntungan per Porsi</span>
                        <span className="font-bold">{formatCurrency(profitPerPortion)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Margin Keuntungan</span>
                        <span className="font-bold">{marginPercent.toFixed(1)}%</span>
                    </div>
                </div>

                <div className="flex items-center justify-between p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                    <span className="font-bold text-emerald-700">Harga Jual Disarankan</span>
                    <span className="font-black text-lg text-emerald-700">
                        {isFinite(suggestedPrice) ? formatCurrency(suggestedPrice) : "—"}
                    </span>
                </div>
            </div>
        </div>
    );
}
