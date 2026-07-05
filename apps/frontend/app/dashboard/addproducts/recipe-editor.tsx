'use client';

import { useEffect, useState } from 'react';
import { ChefHat, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { API_URL } from '@/lib/api-url';

type IngredientOption = {
  id: string;
  product_name: string;
  unit: string;
  stock: string;
};

type RecipeRow = {
  ingredient_id: string;
  qty: string;
};

// Optional bill-of-materials editor shown on track_stock=false products.
// Saved independently from the product form (replace-on-save PUT); a product
// without a recipe is a valid permanent state, so this section never nags.
export function RecipeEditor({
  productId,
  ingredients,
}: {
  productId: string;
  ingredients: IngredientOption[];
}) {
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/products/${productId}/recipe`, {
          credentials: 'include',
        });
        const json = await res.json();
        if (!cancelled && json.success) {
          setRows(
            (json.items as { ingredient_id: string; qty: string }[]).map((it) => ({
              ingredient_id: it.ingredient_id,
              qty: String(Number(it.qty)), // "0.250" -> "0.25" for the input
            })),
          );
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

  const unitOf = (id: string) => ingredients.find((p) => p.id === id)?.unit ?? '';

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
        body: JSON.stringify({ items }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Gagal menyimpan resep');
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan resep');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border-2 border-dashed border-border p-4">
      <label className="text-sm font-bold flex items-center gap-2">
        <ChefHat className="h-4 w-4 text-muted-foreground" />
        Resep / Bahan <span className="font-normal text-muted-foreground">(opsional)</span>
      </label>
      <p className="text-xs text-muted-foreground">
        Setiap 1 produk terjual otomatis memotong stok bahan di bawah. Kosongkan
        jika tidak perlu — penjualan tetap jalan tanpa resep.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat resep…
        </div>
      ) : (
        <>
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={row.ingredient_id}
                onChange={(e) => setRow(i, { ingredient_id: e.target.value })}
                className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Pilih bahan…</option>
                {ingredients.map((p) => (
                  <option
                    key={p.id}
                    value={p.id}
                    disabled={rows.some((r, idx) => idx !== i && r.ingredient_id === p.id)}
                  >
                    {p.product_name} (stok {Number(p.stock)} {p.unit})
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="any"
                value={row.qty}
                onChange={(e) => setRow(i, { qty: e.target.value })}
                placeholder="Qty"
                className="h-10 w-20 rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="w-10 shrink-0 text-xs text-muted-foreground">
                {unitOf(row.ingredient_id)}
              </span>
              <button
                type="button"
                onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600"
                aria-label="Hapus bahan"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}

          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-xl"
              onClick={() => setRows((prev) => [...prev, { ingredient_id: '', qty: '' }])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Tambah Bahan
            </Button>
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
              {savedAt ? 'Tersimpan ✓' : 'Simpan Resep'}
            </Button>
          </div>
          {error && <p className="text-xs font-medium text-red-600">{error}</p>}
        </>
      )}
    </div>
  );
}
