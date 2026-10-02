'use client';

/**
 * Paksa Hitung HPP for one bahan with no recipe — Paksa Hitung HPP's single-row
 * sibling. The rules are the same and live in the same place
 * (lib/force-hpp.ts): a tracked bahan's cost is its stock average, set by a
 * revaluation that shows in Alur Stok; an untracked one's is its buying price
 * in whole rupiah; an average a Faktur or Produksi computed is only replaced
 * when the owner ticks the box that says so.
 *
 * What it adds is the other direction: every product the bahan becomes, with
 * its HPP before and after, so the owner sees what a number does before it is
 * saved.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { SMALL_UNITS, SOURCE_LABEL, parseCost, rpUnit, type Source } from '../../recipe-explorer/[productId]/force-hpp-dialog';
import { rp } from '../../recipe-explorer/[productId]/recipe-explorer';
import type { ApiNode } from './finished-goods-explorer';

type Preview = {
    success: true;
    product: { id: string; name: string; unit: string; track_stock: boolean };
    target: 'avg' | 'buying';
    current: number;
    suggested: number;
    source: Source;
    protected: boolean;
};

export type UnitCostResult = { changed: number; unit_cost: number };

const NF4 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 4 });
const EPS = 0.00005;
const same = (a: number, b: number) => Math.abs(a - b) < EPS;
const round4 = (n: number) => Number(n.toFixed(4));
const SHOWN = 8;

// Mounted only while open, so every opening reads the cost afresh.
export function UnitCostDialog({
    productId,
    unitCost,
    bookedCost,
    nodes,
    onClose,
    onApplied,
}: {
    productId: string;
    // What the explorer prices the bahan at now (an average, else the typed
    // price) — the base the products' HPPs below were computed from.
    unitCost: number;
    bookedCost: number;
    nodes: ApiNode[];
    onClose: () => void;
    onApplied: (result: UnitCostResult) => void;
}) {
    const [preview, setPreview] = useState<Preview | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [text, setText] = useState('');
    const [overwrite, setOverwrite] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const fetchPreview = useCallback(async (): Promise<Preview | string> => {
        try {
            const res = await fetch(`${API_URL}/api/products/${productId}/unit-cost`, { credentials: 'include' });
            const json = await res.json().catch(() => null);
            return !res.ok || !json?.success ? (json?.error ?? 'Gagal memuat biaya bahan.') : (json as Preview);
        } catch {
            return 'Gagal menghubungi server.';
        }
    }, [productId]);

    const loaded = useCallback((p: Preview | string) => {
        if (typeof p === 'string') {
            setLoadError(p);
            return;
        }
        setPreview(p);
        setText(p.suggested > 0 ? NF4.format(p.suggested) : '');
        setOverwrite(false);
    }, []);

    useEffect(() => {
        let alive = true;
        fetchPreview().then((p) => alive && loaded(p));
        return () => {
            alive = false;
        };
    }, [fetchPreview, loaded]);

    // "Coba lagi" / "Muat ulang" — after a failed read, or after the server
    // refused a save because the cost changed underneath the dialog.
    const load = () => {
        setPreview(null);
        setLoadError(null);
        setSaveError(null);
        fetchPreview().then(loaded);
    };

    // ---- projection: exactly the number the server will write ----
    const view = (() => {
        if (!preview) return null;
        const parsed = parseCost(text);
        const typed = preview.target === 'buying' ? Math.round(parsed) : round4(parsed);
        const invalid = !(typed > 0);
        const changes = !invalid && !same(typed, preview.current);
        const delta = invalid ? 0 : typed - unitCost;
        const affected = nodes
            .filter((n) => n.live_qty > 1e-9)
            .map((n) => {
                const after = n.unit_cost + n.live_qty * delta;
                return { n, after, loss: n.price > 0 && n.category.trim().toLowerCase() !== 'bahan' && after > n.price };
            })
            .sort((a, b) => Math.abs(b.after - b.n.unit_cost) - Math.abs(a.after - a.n.unit_cost));
        const locked = nodes.length - affected.length;
        const rounded = preview.target === 'buying' && Number.isFinite(parsed) && parsed !== typed;
        const packPrice = !invalid && SMALL_UNITS.has(preview.product.unit.trim().toLowerCase()) && typed >= 1000;
        return { parsed, typed, invalid, changes, affected, locked, rounded, packPrice };
    })();

    const blockedByOverwrite = !!(preview?.protected && view?.changes && !overwrite);

    const submit = async () => {
        if (!preview || !view || !view.changes || saving || blockedByOverwrite) return;
        setSaving(true);
        setSaveError(null);
        try {
            const res = await fetch(`${API_URL}/api/products/${productId}/unit-cost`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    unit_cost: view.typed,
                    expected: preview.current,
                    // The tick IS the owner's consent; the server refuses a
                    // protected average without it.
                    ...(preview.protected && { overwrite }),
                }),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok || !json?.success) {
                setSaveError(json?.error ?? 'Gagal menyimpan HPP.');
                return;
            }
            onApplied(json as UnitCostResult);
            onClose();
        } catch {
            setSaveError('Gagal menghubungi server.');
        } finally {
            setSaving(false);
        }
    };

    const p = preview?.product;
    const unit = p?.unit || 'unit';
    const losses = view?.affected.filter((a) => a.loss).length ?? 0;

    return (
        <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
            <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0 sm:max-w-xl">
                <DialogHeader className="border-b px-5 pb-3 pt-5">
                    <DialogTitle>Paksa Hitung HPP{p ? ` — ${p.name}` : ''}</DialogTitle>
                    <DialogDescription className="text-[12.5px] leading-relaxed">
                        {!preview
                            ? 'Memuat biaya bahan…'
                            : preview.target === 'avg'
                              ? `${p!.name} dilacak stoknya, jadi biaya ini disimpan sebagai biaya rata-rata stoknya — angka yang dicatat setiap resep yang memakainya saat terjual. Perubahannya tercatat di Alur Stok.`
                              : `${p!.name} tidak dilacak stoknya, jadi biaya ini disimpan sebagai harga belinya, dalam rupiah bulat.`}{' '}
                        {preview && 'Penjualan yang sudah terjadi tidak ikut berubah.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
                    {loadError ? (
                        <div className="flex flex-col items-start gap-2 py-6">
                            <p className="text-sm text-muted-foreground">{loadError}</p>
                            <Button variant="outline" size="sm" onClick={load}>
                                Coba lagi
                            </Button>
                        </div>
                    ) : !preview || !view ? (
                        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> Memuat biaya bahan…
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
                                <span>
                                    Sekarang{' '}
                                    <span
                                        className={`font-mono ${preview.current <= 0 ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-foreground'}`}
                                    >
                                        {rpUnit(preview.current)}/{unit}
                                    </span>
                                </span>
                                <span
                                    className={`rounded px-1.5 py-px text-[10.5px] font-semibold ${
                                        preview.protected
                                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                                            : preview.source === 'none'
                                              ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                                              : 'bg-muted text-muted-foreground'
                                    }`}
                                >
                                    {SOURCE_LABEL[preview.source]}
                                </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <label htmlFor="uc-input" className="text-[12.5px] font-medium">
                                    Biaya baru
                                </label>
                                <div className="relative">
                                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">
                                        Rp
                                    </span>
                                    <input
                                        id="uc-input"
                                        autoFocus
                                        inputMode={preview.target === 'buying' ? 'numeric' : 'decimal'}
                                        autoComplete="off"
                                        value={text}
                                        onChange={(e) => setText(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && submit()}
                                        placeholder={preview.target === 'buying' ? '15' : '0,9'}
                                        aria-invalid={(text !== '' && view.invalid) || undefined}
                                        className="h-9 w-40 rounded-lg border bg-background pl-8 pr-2 font-mono text-[14px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-rose-500"
                                    />
                                </div>
                                <span className="text-[12.5px] text-muted-foreground">/ {unit}</span>
                                {!view.invalid && (
                                    <span className="ml-auto font-mono text-[12px] text-muted-foreground">dibaca {rpUnit(view.typed)}</span>
                                )}
                            </div>

                            {text !== '' && view.invalid && (
                                <p className="text-[11.5px] text-rose-600 dark:text-rose-400">
                                    {preview.target === 'buying'
                                        ? 'Isi minimal Rp 1 — bahan tanpa Lacak Stok disimpan dalam rupiah bulat.'
                                        : 'Isi biaya lebih dari 0.'}
                                </p>
                            )}
                            {view.rounded && !view.invalid && (
                                <p className="text-[11.5px] text-muted-foreground">
                                    Disimpan {rp(view.typed)} — harga beli bahan tanpa Lacak Stok hanya rupiah bulat.
                                </p>
                            )}
                            {view.packPrice && (
                                <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-amber-700 dark:text-amber-400">
                                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                                    <span>
                                        {rpUnit(view.typed)} per {unit} itu besar. Pastikan ini biaya per {unit}, bukan per kemasan (sak, galon,
                                        dus).
                                    </span>
                                </p>
                            )}

                            {preview.protected && (
                                <label
                                    className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 ${
                                        overwrite ? 'border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30' : ''
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={overwrite}
                                        onChange={(e) => setOverwrite(e.target.checked)}
                                        className="mt-0.5 h-4 w-4 shrink-0"
                                    />
                                    <span className="text-[12.5px] leading-relaxed">
                                        <span className="font-semibold">Timpa biaya rata-rata {rpUnit(preview.current)}/{unit}</span>
                                        <span className="block text-muted-foreground">
                                            Angka ini dihitung dari {preview.source === 'invoice' ? 'Faktur pembelian' : 'Produksi'}. Faktur
                                            berikutnya akan dirata-ratakan dari biaya baru ini.
                                        </span>
                                    </span>
                                </label>
                            )}

                            {nodes.length > 0 && (
                                <div className="flex flex-col gap-1.5">
                                    <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                                        HPP produk yang ikut berubah
                                    </div>
                                    {view.affected.slice(0, SHOWN).map(({ n, after, loss }) => (
                                        <div key={n.product_id} className="flex items-baseline gap-2 rounded-lg border px-2.5 py-1.5 text-[12.5px]">
                                            <span className="min-w-0 flex-1 truncate font-semibold">{n.name}</span>
                                            <span className="whitespace-nowrap font-mono text-[12px]">
                                                {rp(n.unit_cost)} →{' '}
                                                <span className={`font-semibold ${loss ? 'text-rose-600 dark:text-rose-400' : ''}`}>{rp(after)}</span>
                                            </span>
                                            {n.price > 0 && (
                                                <span className={`w-14 text-right font-mono text-[11px] ${loss ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}`}>
                                                    {(((n.price - after) / n.price) * 100).toFixed(0)}%
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                    {view.affected.length > SHOWN && (
                                        <div className="text-[11.5px] text-muted-foreground">+{view.affected.length - SHOWN} produk lainnya</div>
                                    )}
                                    {view.locked > 0 && (
                                        <div className="text-[11.5px] leading-relaxed text-muted-foreground">
                                            {view.affected.length ? `${view.locked} produk lain` : `Semua ${view.locked} produk`} mendapat{' '}
                                            {p!.name} lewat olahan berstok (batch) — HPP-nya baru berubah di Produksi berikutnya.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {preview && view && (
                    <div className="border-t px-5 py-3">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
                            <span className="text-muted-foreground">Tercatat saat terpakai</span>
                            <span className="text-right font-mono">
                                {rpUnit(bookedCost)} → <span className="font-semibold">{view.invalid ? '—' : rpUnit(view.typed)}</span> / {unit}
                            </span>
                        </div>
                        {losses > 0 && (
                            <div className="mt-2 flex items-start gap-2 rounded-lg bg-rose-50 p-2.5 text-[12px] leading-relaxed text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <span>
                                    HPP {losses} produk akan melebihi harga jualnya — setiap penjualannya tercatat rugi. Cek lagi apakah biaya
                                    ini per {unit}.
                                </span>
                            </div>
                        )}
                        {saveError && (
                            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 p-2.5 text-[12px] text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
                                <span className="flex-1">{saveError}</span>
                                <Button variant="outline" size="xs" onClick={load}>
                                    Muat ulang
                                </Button>
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter className="border-t px-5 py-3">
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        Batal
                    </Button>
                    <Button
                        variant={losses > 0 ? 'destructive' : 'default'}
                        onClick={submit}
                        disabled={!view || !view.changes || blockedByOverwrite || saving}
                    >
                        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                        {!view || !view.changes
                            ? 'Belum ada perubahan'
                            : blockedByOverwrite
                              ? 'Centang untuk menimpa'
                              : losses > 0
                                ? 'Tetap simpan'
                                : 'Simpan HPP'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
