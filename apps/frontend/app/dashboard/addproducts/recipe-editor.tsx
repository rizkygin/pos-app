'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { API_URL } from '@/lib/api-url';
import { ProductSearchAdd, type PickerOption } from './product-search-add';

type IngredientOption = {
  id: string;
  product_name: string;
  unit: string;
  stock: string;
  // false = this option is itself a composition with no stock of its own. It is
  // a valid ingredient (that is what a sub-composition IS), but showing it a
  // stock number would be a lie, so the label drops it.
  track_stock: boolean;
  category?: string;
};

type RecipeRow = {
  ingredient_id: string;
  qty: string;
};

// The second line under an ingredient: how much is left, or that it has no
// stock of its own to show.
const metaOf = (p: IngredientOption) =>
  p.track_stock ? `Stok ${Number(p.stock)} ${p.unit}` : 'Komposisi, tanpa stok sendiri';

// What a save would send, so "Belum disimpan" ignores a half-typed empty row.
const signature = (rows: RecipeRow[]) =>
  JSON.stringify(
    rows
      .filter((r) => r.ingredient_id && Number(r.qty) > 0)
      .map((r) => [r.ingredient_id, Number(r.qty)]),
  );

// Optional bill-of-materials editor shown on track_stock=false products.
//
// Deliberately NOT food-specific, despite the "recipe" tables behind it.
// applySaleStockOut() keys purely off track_stock + recipe rows and never looks
// at category, so the same mechanism covers two shapes of product:
//
//   olahan   nasi goreng      -> 0.2 kg beras + 1 butir telur
//   paket    Batako 10 pcs    -> 10 batako
//
// The second is why the copy says "komposisi" rather than "resep": an owner who
// won't sell batako below ten at a time makes a bundle product that draws from
// the loose stock, and "Resep / Bahan" reads as nonsense on a hardware shelf.
//
// Saved independently from the product form (replace-on-save PUT); a product
// without a composition is a valid permanent state, so this section never nags.
export function RecipeEditor({
  productId,
  ingredients,
  trackStock,
}: {
  productId: string;
  ingredients: IngredientOption[];
  // Whether the product being edited holds stock of its own. Changes only the
  // copy: a tracked product with a composition is made in batches on the Stok
  // page, an untracked one is expanded live at each sale.
  trackStock: boolean;
}) {
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // Only meaningful for a tracked product: how much ONE batch yields, used as
  // the default in the Produksi dialog. The composition itself is always
  // per-one-unit, so this never changes what a sale deducts.
  const [yieldQty, setYieldQty] = useState('1');
  const [error, setError] = useState('');
  // The row just added from the search, whose qty takes the focus.
  const [justAdded, setJustAdded] = useState<string | null>(null);
  // What is saved on the server, to say so when the list on screen differs.
  // This editor saves on its own button, apart from the product form's Simpan,
  // so a list that silently isn't saved is the easy mistake to make.
  const [savedSig, setSavedSig] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/products/${productId}/recipe`, {
          credentials: 'include',
        });
        const json = await res.json();
        if (!cancelled && json.success) {
          if (json.yield_qty != null) setYieldQty(String(Number(json.yield_qty)));
          const loaded = (json.items as { ingredient_id: string; qty: string }[]).map((it) => ({
            ingredient_id: it.ingredient_id,
            qty: String(Number(it.qty)), // "0.250" -> "0.25" for the input
          }));
          setRows(loaded);
          setSavedSig(signature(loaded));
        }
      } catch {
        /* leave empty — owner can still add rows */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const setRow = (i: number, patch: Partial<RecipeRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const byId = useMemo(() => new Map(ingredients.map((p) => [p.id, p])), [ingredients]);
  const unitOf = (id: string) => byId.get(id)?.unit ?? '';

  // Bahan first: what a composition is usually made of. Anything else in the
  // outlet can still be found by name — a bundle draws on a sellable product.
  const pickerOptions = useMemo<PickerOption[]>(
    () =>
      ingredients.map((p) => ({
        id: p.id,
        name: p.product_name,
        meta: metaOf(p),
        group: p.category === 'bahan' ? 'Bahan' : 'Produk lain',
      })),
    [ingredients],
  );
  const taken = useMemo(() => new Set(rows.map((r) => r.ingredient_id)), [rows]);
  const isDirty = savedSig !== null && signature(rows) !== savedSig;

  const addIngredient = (id: string) => {
    setRows((prev) => [...prev, { ingredient_id: id, qty: '' }]);
    setJustAdded(id);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const items = rows
        .filter((r) => r.ingredient_id && Number(r.qty) > 0)
        .map((r) => ({ ingredient_id: r.ingredient_id, qty: Number(r.qty) }));
      const res = await fetch(`${API_URL}/api/products/${productId}/recipe`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          items,
          ...(trackStock && Number(yieldQty) > 0 ? { yield_qty: Number(yieldQty) } : {}),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Gagal menyimpan komposisi');
      setSavedSig(signature(rows));
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan komposisi');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border-2 border-dashed border-border p-4">
      <label className="text-sm font-bold flex items-center gap-2">
        <Boxes className="h-4 w-4 text-muted-foreground" />
        Komposisi Produk{' '}
        <span className="font-normal text-muted-foreground">(opsional)</span>
      </label>
      <p className="text-xs text-muted-foreground">
        {trackStock
          ? 'Produk ini dibuat sendiri dari bahan di bawah. Stoknya bertambah lewat tombol Produksi di halaman Stok, dan saat terjual yang berkurang stok produk ini — bukan bahannya lagi.'
          : 'Produk ini diambil dari stok produk lain. Setiap 1 terjual, stok di bawah otomatis berkurang sesuai jumlahnya.'}
      </p>
      {/* Two concrete examples, one food one not: without the second, owners
          read this as a kitchen-only feature and never use it for bundles. */}
      <ul className="text-xs text-muted-foreground space-y-0.5 pl-3">
        <li>
          • <span className="font-medium">Produk olahan</span> — Nasi Goreng
          memotong beras &amp; telur.
        </li>
        <li>
          • <span className="font-medium">Paket / eceran</span> — “Batako 10 pcs”
          memotong 10 dari stok Batako.
        </li>
        {/* The nesting rule, stated as the two cases an owner actually has.
            Which one applies is decided by "lacak stok" on the ingredient, so
            it is worth spelling out here rather than in a tooltip. */}
        <li>
          • <span className="font-medium">Bahan bertingkat</span> — bahan boleh
          punya komposisi sendiri. Kalau bahan itu dilacak stoknya (mis. Sambal
          yang dimasak per batch), yang berkurang stok Sambal-nya; kalau tidak
          (mis. Bumbu Dasar), potongan diteruskan ke bahan mentahnya.
        </li>
      </ul>
      <p className="text-xs text-muted-foreground">
        Kosongkan jika tidak perlu — penjualan tetap jalan tanpa komposisi.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat komposisi…
        </div>
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="rounded-xl bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
              Belum ada bahan. Cari di bawah untuk menambahkan.
            </p>
          ) : (
            <div className="space-y-1.5">
              {rows.map((row, i) => {
                const p = byId.get(row.ingredient_id);
                return (
                  <div
                    key={`${row.ingredient_id}-${i}`}
                    // Wraps on a phone: the name gets its own line instead of
                    // being cut to "Roti D…" beside the qty and unit.
                    className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border bg-background px-3 py-2 sm:flex-nowrap sm:py-1.5"
                  >
                    <span className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                      <span className="block truncate text-sm font-medium">
                        {p?.product_name ?? 'Produk tidak ditemukan'}
                      </span>
                      {p && (
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {metaOf(p)}
                        </span>
                      )}
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      autoFocus={row.ingredient_id === justAdded}
                      value={row.qty}
                      onChange={(e) => setRow(i, { qty: e.target.value })}
                      // Enter = on to the next ingredient, never a save of the
                      // whole product form this editor sits inside.
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          searchRef.current?.focus();
                        }
                      }}
                      placeholder="Jumlah"
                      aria-label={`Jumlah ${p?.product_name ?? ''}`}
                      className="h-9 w-24 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none"
                    />
                    <span className="w-10 shrink-0 truncate text-xs text-muted-foreground">
                      {unitOf(row.ingredient_id)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600"
                      aria-label={`Hapus ${p?.product_name ?? 'item'}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <ProductSearchAdd
            ref={searchRef}
            options={pickerOptions}
            groups={['Bahan', 'Produk lain']}
            taken={taken}
            onPick={addIngredient}
            placeholder="Cari bahan untuk ditambahkan…"
          />

          {trackStock && (
            <div className="flex items-center gap-2 pt-1">
              <label className="text-xs text-muted-foreground">
                Sekali produksi jadi
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={yieldQty}
                onChange={(e) => setYieldQty(e.target.value)}
                className="h-9 w-24 rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="text-xs text-muted-foreground">
                dipakai sebagai isian awal tombol Produksi
              </span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-1">
            {isDirty && !saving && (
              <span className="text-xs font-medium text-amber-600 dark:text-amber-500">
                Belum disimpan
              </span>
            )}
            <Button
              type="button"
              size="sm"
              className="rounded-xl"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {savedAt ? 'Tersimpan ✓' : 'Simpan Komposisi'}
            </Button>
          </div>
          {error && <p className="text-xs font-medium text-red-600">{error}</p>}
        </>
      )}
    </div>
  );
}
