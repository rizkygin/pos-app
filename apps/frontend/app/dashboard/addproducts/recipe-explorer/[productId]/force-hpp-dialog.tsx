'use client';

/**
 * Paksa Hitung HPP — the owner sets what each ingredient of this recipe costs,
 * and the cost a SALE books follows. For outlets that never buy through a
 * Faktur, where the ledger has no average and every recipe sale books Rp 0.
 * All the rules live server-side in lib/force-hpp.ts; this dialog only shows
 * them and projects the result.
 *
 * THE CHECKBOX IS THE WHOLE CONTRACT. A ticked row is written, an unticked row
 * is left exactly as it is and counted at its current cost in the projection.
 * Rows at Rp 0 start ticked (that is the bug being fixed). A cost that came
 * from a Faktur or Produksi starts unticked and says, when ticked, that it is
 * about to be overwritten — the server refuses it without that tick.
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

export type Source = 'none' | 'invoice' | 'production' | 'manual';

type Row = {
    product_id: string;
    name: string;
    unit: string;
    qty: number;
    kind: 'stock' | 'batch' | 'plain';
    target: 'avg' | 'buying';
    current: number;
    suggested: number;
    source: Source;
    protected: boolean;
    counted: boolean;
    used_by: string[];
};

type Preview = {
    success: true;
    ledger: boolean;
    product: { id: string; name: string; unit: string; price: number; track_stock: boolean };
    root: { target: 'avg' | 'buying' | null; current: number; source: Source; protected: boolean };
    booked_hpp: number;
    recipe_hpp: number;
    rows: Row[];
};

export type ForceHppResult = { changed: number; booked_hpp: number; recipe_hpp: number };

const NF = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const NF4 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 4 });
const rp = (n: number) => 'Rp ' + NF.format(Math.round(n));
// Per-unit costs at recipe scale are routinely under a rupiah (0,9 per ml).
export const rpUnit = (n: number) => 'Rp ' + (n < 100 ? NF4.format(n) : NF.format(Math.round(n)));
const qtyFmt = (n: number) => NF4.format(n);

const EPS = 0.00005;
const same = (a: number, b: number) => Math.abs(a - b) < EPS;
const round4 = (n: number) => Number(n.toFixed(4));

// Read the way an Indonesian owner types money: "1.500" is fifteen hundred and
// "0,9" is nine tenths. A lone dot is taken as a decimal point only where it
// cannot be a thousands separator ("0.9", "12.5") — and the row always prints
// back the number it understood, so a misread is visible before it is saved.
export function parseCost(raw: string): number {
    const t = raw.replace(/\s|rp/gi, '');
    if (!t) return NaN;
    let norm: string;
    if (t.includes(',')) {
        norm = t.replace(/\./g, '').replace(',', '.');
    } else {
        const parts = t.split('.');
        norm =
            parts.length === 2 && (parts[1].length !== 3 || parts[0] === '0')
                ? t
                : t.replace(/\./g, '');
    }
    return /^\d+(\.\d+)?$/.test(norm) ? Number(norm) : NaN;
}

// Units a recipe is written in at gram/ml scale. A cost of thousands of rupiah
// per one of these is almost always a PACK price (per galon, per sak) typed
// against a per-ml unit — the mistake behind a 38.000/ml Galon Air.
export const SMALL_UNITS = new Set(['g', 'gr', 'gram', 'mg', 'ml', 'cc']);

export const SOURCE_LABEL: Record<Source, string> = {
    none: 'Belum ada biaya',
    invoice: 'Dari Faktur',
    production: 'Dari Produksi',
    manual: 'Diisi manual',
};

type Draft = { on: boolean; text: string };

// Mounted only while open (the explorer renders it conditionally), so every
// opening starts from a fresh read of the costs rather than a stale draft.
export function ForceHppDialog({
    productId,
    onClose,
    onApplied,
}: {
    productId: string;
    onClose: () => void;
    onApplied: (result: ForceHppResult) => void;
}) {
    const [preview, setPreview] = useState<Preview | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [drafts, setDrafts] = useState<Record<string, Draft>>({});
    const [rootOn, setRootOn] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const fetchPreview = useCallback(async (): Promise<Preview | string> => {
        try {
            const res = await fetch(`${API_URL}/api/products/${productId}/force-hpp`, { credentials: 'include' });
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
            setDrafts(
                Object.fromEntries(
                    p.rows.map((r) => [
                        r.product_id,
                        {
                            on: r.source === 'none' && r.suggested > 0,
                            text: r.suggested > 0 ? NF4.format(r.suggested) : '',
                        },
                    ]),
                ),
            );
        // Pressing the button is asking for the dish's HPP to be set — unless
        // that means replacing an average a Produksi batch computed.
        setRootOn(p.root.target !== null && !p.root.protected);
    }, []);

    useEffect(() => {
        let alive = true;
        fetchPreview().then((p) => alive && loaded(p));
        return () => {
            alive = false;
        };
    }, [fetchPreview, loaded]);

    // "Coba lagi" / "Muat ulang" — after a failed read, or after the server
    // refused a save because a cost changed underneath the dialog.
    const reload = () => {
        setPreview(null);
        setLoadError(null);
        setSaveError(null);
        fetchPreview().then(loaded);
    };

    // ---- projection: exactly the numbers the server will write ----
    const view = (() => {
        if (!preview) return null;
        const rows = preview.rows.map((r) => {
            const d = drafts[r.product_id] ?? { on: false, text: '' };
            const parsed = parseCost(d.text);
            const typed = r.target === 'buying' ? Math.round(parsed) : round4(parsed);
            const invalid = d.on && !(typed > 0);
            const cost = d.on && !invalid ? typed : r.current;
            const changes = d.on && !invalid && !same(cost, r.current);
            return { row: r, draft: d, parsed, typed, invalid, cost, changes };
        });
        const recipeNew = rows.reduce((s, v) => s + v.row.qty * v.cost, 0);
        const t = preview.root.target;
        const rootNew = t === 'buying' ? Math.round(recipeNew) : round4(recipeNew);
        const rootChanges = t !== null && rootOn && rootNew > 0 && !same(rootNew, preview.root.current);
        const bookedNew =
            t === null
                ? rows.filter((v) => v.row.counted).reduce((s, v) => s + v.row.qty * v.cost, 0)
                : rootOn && rootNew > 0
                  ? rootNew
                  : preview.root.current;
        const changeCount = rows.filter((v) => v.changes).length + (rootChanges ? 1 : 0);
        const overwrites =
            rows.filter((v) => v.changes && v.row.protected).length + (rootChanges && preview.root.protected ? 1 : 0);
        const invalid = rows.some((v) => v.invalid) || (t !== null && rootOn && !(rootNew > 0));
        return { rows, recipeNew, rootNew, rootChanges, bookedNew, changeCount, overwrites, invalid };
    })();

    const setDraft = (id: string, patch: Partial<Draft>) =>
        setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? { on: false, text: '' }), ...patch } }));

    const submit = async () => {
        if (!preview || !view || saving) return;
        setSaving(true);
        setSaveError(null);
        try {
            const res = await fetch(`${API_URL}/api/products/${productId}/force-hpp`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: view.rows
                        .filter((v) => v.changes)
                        .map((v) => ({
                            product_id: v.row.product_id,
                            unit_cost: v.typed,
                            expected: v.row.current,
                            // Ticking a protected row IS the owner's consent to
                            // overwrite it; the server refuses it without this.
                            overwrite: v.row.protected,
                        })),
                    root: view.rootChanges
                        ? { expected: preview.root.current, overwrite: preview.root.protected }
                        : null,
                }),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok || !json?.success) {
                setSaveError(json?.error ?? 'Gagal menyimpan HPP.');
                return;
            }
            onApplied(json as ForceHppResult);
            onClose();
        } catch {
            setSaveError('Gagal menghubungi server.');
        } finally {
            setSaving(false);
        }
    };

    const p = preview?.product;
    const unitWord = p?.unit ?? 'unit';
    const overPrice = !!(view && p && p.price > 0 && view.bookedNew > p.price);

    return (
        <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
            <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0 sm:max-w-2xl">
                <DialogHeader className="border-b px-5 pb-3 pt-5">
                    <DialogTitle>Paksa Hitung HPP{p ? ` — ${p.name}` : ''}</DialogTitle>
                    <DialogDescription className="text-[12.5px] leading-relaxed">
                        {!preview
                            ? 'Memuat biaya bahan…'
                            : preview.root.target === 'buying' && !preview.ledger
                              ? `Laporan laba paket ini memakai HPP produk. Biaya bahan di bawah dipakai untuk menghitungnya, lalu hasilnya disimpan sebagai HPP ${p!.name}.`
                              : preview.root.target === 'avg'
                                ? `${p!.name} punya stok sendiri, jadi saat terjual HPP-nya diambil dari biaya rata-rata stoknya. Biaya bahan di bawah dipakai untuk menghitung angka itu.`
                                : preview.root.target === 'buying'
                                  ? `Tidak ada bahan resep ini yang dilacak stoknya, jadi saat terjual HPP-nya diambil dari HPP produk ${p!.name}.`
                                  : `Saat ${p!.name} terjual, HPP-nya diambil dari biaya rata-rata tiap bahan yang dilacak stoknya.`}{' '}
                        {preview && 'Hanya baris yang dicentang yang diubah. Penjualan yang sudah terjadi tidak ikut berubah.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
                    {loadError ? (
                        <div className="flex flex-col items-start gap-2 py-6">
                            <p className="text-sm text-muted-foreground">{loadError}</p>
                            <Button variant="outline" size="sm" onClick={reload}>
                                Coba lagi
                            </Button>
                        </div>
                    ) : !preview || !view ? (
                        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> Memuat biaya bahan…
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2">
                            <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                                Biaya bahan · per 1 {unitWord} {p!.name}
                            </div>
                            {view.rows.map((v) => (
                                <IngredientRow
                                    key={v.row.product_id}
                                    v={v}
                                    rootUnit={unitWord}
                                    price={p!.price}
                                    onToggle={(on) => setDraft(v.row.product_id, { on })}
                                    onText={(text) => setDraft(v.row.product_id, { text })}
                                />
                            ))}

                            {preview.root.target !== null && (
                                <label
                                    className={`mt-2 flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 ${
                                        rootOn ? 'border-primary/50 bg-primary/5' : ''
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={rootOn}
                                        onChange={(e) => setRootOn(e.target.checked)}
                                        className="mt-0.5 h-4 w-4 shrink-0"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-baseline gap-x-2">
                                            <span className="text-sm font-semibold">Simpan sebagai HPP {p!.name}</span>
                                            <span className="ml-auto font-mono text-[12.5px] font-semibold">
                                                {rpUnit(preview.root.current)} → {rpUnit(view.rootNew)}
                                            </span>
                                        </div>
                                        <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                                            {preview.root.target === 'avg'
                                                ? `Biaya rata-rata stok ${p!.name} · ${SOURCE_LABEL[preview.root.source]}`
                                                : `Harga modal ${p!.name} · ${SOURCE_LABEL[preview.root.source]}`}
                                            {preview.root.target === 'buying' && ' · dibulatkan ke rupiah'}
                                        </div>
                                        {rootOn && preview.root.protected && (
                                            <OverwriteNote source={preview.root.source} current={preview.root.current} unit={unitWord} />
                                        )}
                                        {rootOn && !(view.rootNew > 0) && (
                                            <p className="mt-1 text-[11.5px] text-rose-600 dark:text-rose-400">
                                                HPP resep masih Rp 0 — isi dulu biaya bahannya.
                                            </p>
                                        )}
                                    </div>
                                </label>
                            )}
                        </div>
                    )}
                </div>

                {preview && view && (
                    <div className="border-t px-5 py-3">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
                            <span className="text-muted-foreground">HPP resep</span>
                            <span className="text-right font-mono">
                                {rp(preview.recipe_hpp)} → <span className="font-semibold">{rp(view.recipeNew)}</span>
                            </span>
                            <span className="text-muted-foreground">Tercatat saat terjual</span>
                            <span className="text-right font-mono">
                                {rp(preview.booked_hpp)} → <span className="font-semibold">{rp(view.bookedNew)}</span>
                            </span>
                            {p!.price > 0 && (
                                <>
                                    <span className="text-muted-foreground">Margin dari harga jual {rp(p!.price)}</span>
                                    <span
                                        className={`text-right font-mono font-semibold ${
                                            overPrice ? 'text-rose-600 dark:text-rose-400' : ''
                                        }`}
                                    >
                                        {(((p!.price - view.bookedNew) / p!.price) * 100).toFixed(1)}%
                                    </span>
                                </>
                            )}
                        </div>
                        {overPrice && (
                            <div className="mt-2 flex items-start gap-2 rounded-lg bg-rose-50 p-2.5 text-[12px] leading-relaxed text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <span>
                                    HPP melebihi harga jual — setiap penjualan akan tercatat rugi. Biasanya ada bahan yang biayanya diisi
                                    per kemasan (sak, galon, dus), bukan per satuan resepnya.
                                </span>
                            </div>
                        )}
                        {saveError && (
                            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 p-2.5 text-[12px] text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
                                <span className="flex-1">{saveError}</span>
                                <Button variant="outline" size="xs" onClick={reload}>
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
                        variant={overPrice ? 'destructive' : 'default'}
                        onClick={submit}
                        disabled={!view || view.changeCount === 0 || view.invalid || saving}
                    >
                        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                        {!view || view.changeCount === 0
                            ? 'Belum ada perubahan'
                            : `${overPrice ? 'Tetap terapkan' : 'Terapkan'} ${view.changeCount} perubahan${
                                  view.overwrites ? ` (${view.overwrites} menimpa)` : ''
                              }`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function OverwriteNote({ source, current, unit }: { source: Source; current: number; unit: string }) {
    return (
        <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11.5px] leading-snug text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
                Akan <strong>menimpa</strong> biaya rata-rata {rpUnit(current)}/{unit} yang dihitung dari{' '}
                {source === 'invoice' ? 'Faktur pembelian' : 'Produksi'}.
            </span>
        </p>
    );
}

function IngredientRow({
    v,
    rootUnit,
    price,
    onToggle,
    onText,
}: {
    v: {
        row: Row;
        draft: Draft;
        parsed: number;
        typed: number;
        invalid: boolean;
        cost: number;
    };
    rootUnit: string;
    price: number;
    onToggle: (on: boolean) => void;
    onText: (text: string) => void;
}) {
    const { row: r, draft: d } = v;
    const inputId = `fh-${r.product_id}`;
    const contribution = r.qty * v.cost;
    const packPrice = d.on && !v.invalid && SMALL_UNITS.has(r.unit.trim().toLowerCase()) && v.typed >= 1000;
    const overDish = d.on && !v.invalid && price > 0 && contribution > price;
    const rounded = d.on && r.target === 'buying' && Number.isFinite(v.parsed) && v.parsed !== v.typed;

    return (
        <div className={`rounded-xl border p-3 ${d.on ? 'border-primary/50 bg-primary/5' : ''}`}>
            <div className="flex items-start gap-2.5">
                <input
                    type="checkbox"
                    checked={d.on}
                    onChange={(e) => onToggle(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-label={`Ubah biaya ${r.name}`}
                />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-semibold">{r.name}</span>
                        {r.kind === 'batch' && (
                            <span className="rounded bg-indigo-50 px-1.5 py-px text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                                olahan sendiri
                            </span>
                        )}
                        <span className="ml-auto font-mono text-[11.5px] text-muted-foreground">
                            {qtyFmt(r.qty)} {r.unit} / {rootUnit}
                        </span>
                    </div>

                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted-foreground">
                        <span>
                            Sekarang{' '}
                            <span className={`font-mono ${r.current <= 0 ? 'font-semibold text-rose-600 dark:text-rose-400' : ''}`}>
                                {rpUnit(r.current)}/{r.unit}
                            </span>
                        </span>
                        <span
                            className={`rounded px-1.5 py-px text-[10.5px] font-semibold ${
                                r.protected
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                                    : r.source === 'none'
                                      ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                                      : 'bg-muted text-muted-foreground'
                            }`}
                        >
                            {SOURCE_LABEL[r.source]}
                        </span>
                        <span>{r.target === 'avg' ? 'biaya rata-rata stok' : 'harga beli (tanpa Lacak Stok)'}</span>
                    </div>

                    {d.on && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <label htmlFor={inputId} className="text-[12px] font-medium">
                                Biaya baru
                            </label>
                            <div className="relative">
                                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">
                                    Rp
                                </span>
                                <input
                                    id={inputId}
                                    inputMode={r.target === 'buying' ? 'numeric' : 'decimal'}
                                    autoComplete="off"
                                    value={d.text}
                                    onChange={(e) => onText(e.target.value)}
                                    placeholder={r.target === 'buying' ? '15' : '0,9'}
                                    aria-invalid={v.invalid || undefined}
                                    className="h-8 w-32 rounded-lg border bg-background pl-8 pr-2 font-mono text-[13px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-rose-500"
                                />
                            </div>
                            <span className="text-[12px] text-muted-foreground">/ {r.unit}</span>
                            <span className="ml-auto font-mono text-[12px]">
                                = {v.invalid ? '—' : rp(contribution)} / {rootUnit}
                            </span>
                        </div>
                    )}

                    {d.on && v.invalid && (
                        <p className="mt-1 text-[11.5px] text-rose-600 dark:text-rose-400">
                            {r.target === 'buying'
                                ? 'Isi minimal Rp 1 — bahan tanpa Lacak Stok disimpan dalam rupiah bulat.'
                                : 'Isi biaya lebih dari 0.'}
                        </p>
                    )}
                    {rounded && !v.invalid && (
                        <p className="mt-1 text-[11.5px] text-muted-foreground">
                            Disimpan {rp(v.typed)} — harga beli bahan tanpa Lacak Stok hanya rupiah bulat.
                        </p>
                    )}
                    {d.on && r.protected && <OverwriteNote source={r.source} current={r.current} unit={r.unit} />}
                    {(packPrice || overDish) && (
                        <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-snug text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                            <span>
                                {overDish
                                    ? 'Bahan ini saja sudah melebihi harga jual. '
                                    : `${rpUnit(v.typed)} per ${r.unit} itu besar. `}
                                Pastikan ini biaya per {r.unit}, bukan per kemasan.
                            </span>
                        </p>
                    )}
                    {!r.counted && (
                        <p className="mt-1 text-[11.5px] text-muted-foreground">
                            Tidak ikut tercatat saat produk terjual — Lacak Stok bahan ini mati, jadi penjualan tidak mengurangi apa
                            pun darinya.
                        </p>
                    )}
                    {r.used_by.length > 0 && (
                        <p className="mt-1 text-[11px] text-muted-foreground" title={r.used_by.join(', ')}>
                            Juga dipakai di resep {r.used_by.slice(0, 3).join(', ')}
                            {r.used_by.length > 3 ? ` +${r.used_by.length - 3} lainnya` : ''}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
