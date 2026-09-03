'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Loader2,
  Pencil,
  Plus,
  Ruler,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { API_URL } from '@/lib/api-url';
import { formatCurrency } from '@/lib/utils/format';

type Variant = {
  id: string;
  product_name: string;
  variant_name: string | null;
  price: string;
  price_mark_down: string;
  variant_sort: number;
  isAvailable: boolean;
  stock: string;
  track_stock: boolean;
};

const priceOf = (v: { price: string; price_mark_down: string }) =>
  v.price_mark_down && v.price_mark_down !== '0'
    ? Number(v.price_mark_down)
    : Number(v.price);

/**
 * Variants for one product: "Reguler / Large / Jumbo", "Panas / Dingin".
 *
 * A VARIANT IS NOT AN ADD-ON, and this editor sits next to the add-on one so
 * the difference is visible at the moment the owner picks:
 *
 *   add-on    ADDS something to the order. Nasi goreng + telur = two lines.
 *   variant   IS what is being ordered. Large is not a Reguler plus an upsize;
 *             it is a different drink, at its own price, using more milk.
 *
 * Sizing through add-ons is the trap this replaces: an "Ukuran" group has to be
 * attached to every product it could apply to, it prices the DIFFERENCE rather
 * than the drink, and the sale reports a Reguler plus an abstract "upsize" — so
 * "how many Large did we sell" has no answer and the extra milk comes out of
 * nobody's stock.
 *
 * Each variant here is a real product row (migration 0071), created by copying
 * this one — same category, picture, menu section and stock model, INCLUDING
 * ITS RECIPE. That copy is the important part: a variant with no recipe would
 * sell while consuming nothing, and the margin report would quietly improve
 * every time the bigger size sold. The owner's next move is to raise the milk
 * on the Large, not to author the drink again.
 *
 * Saved independently of the product form, like the recipe and add-on editors:
 * adding a size is one request, never a reason to re-save the whole product.
 */
export function VariantEditor({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [label, setLabel] = useState('');
  const [baseName, setBaseName] = useState('');
  const [basePrice, setBasePrice] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', price: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ name: '', price: '' });
  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => setReloadTick((n) => n + 1), []);

  // Read back from the same endpoint the POS reads, so the form and the counter
  // can never disagree about what a product offers.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/products/mine`, {
          credentials: 'include',
        });
        const json = await res.json();
        if (cancelled) return;
        const all = (json?.products ?? []) as (Variant & {
          variant_of: string | null;
          variant_label: string | null;
        })[];
        const base = all.find((p) => p.id === productId);
        setLabel(base?.variant_label ?? '');
        setBaseName(base?.variant_name ?? '');
        setBasePrice(base ? priceOf(base) : 0);
        setVariants(
          all
            .filter((p) => p.variant_of === productId)
            .sort(
              (a, b) =>
                a.variant_sort - b.variant_sort ||
                a.product_name.localeCompare(b.product_name, 'id'),
            ),
        );
      } catch {
        if (!cancelled) setError('Gagal memuat varian.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId, reloadTick]);

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(''), 4000);
  };

  /** Every write re-reads rather than patching local state: these calls create
   *  and delete PRODUCTS, and a stale row here is a product the owner thinks
   *  they removed. */
  const send = async (
    url: string,
    method: string,
    body?: unknown,
  ): Promise<boolean> => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Gagal menyimpan.');
      if (json.message) flash(json.message);
      reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addVariant = async () => {
    const name = draft.name.trim();
    if (!name) return setError('Nama varian wajib diisi.');
    if (draft.price === '' || Number(draft.price) < 0)
      return setError('Harga varian wajib diisi.');
    const ok = await send(`${API_URL}/api/products/${productId}/variants`, 'POST', {
      variant_name: name,
      price: String(Math.round(Number(draft.price))),
    });
    if (ok) {
      setDraft({ name: '', price: '' });
      setAdding(false);
    }
  };

  const saveEdit = async (id: string) => {
    const ok = await send(
      `${API_URL}/api/products/${productId}/variants/${id}`,
      'PATCH',
      {
        variant_name: editDraft.name.trim(),
        price: String(Math.round(Number(editDraft.price) || 0)),
      },
    );
    if (ok) setEditingId(null);
  };

  const removeVariant = async (v: Variant) => {
    if (
      !confirm(
        `Hapus varian "${v.variant_name || v.product_name}"?\n\nKalau varian ini pernah terjual, dia diarsipkan (riwayat penjualan tetap utuh), bukan dihapus.`,
      )
    )
      return;
    await send(`${API_URL}/api/products/delete`, 'POST', { productId: v.id });
  };

  const move = async (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= variants.length) return;
    const next = [...variants];
    [next[index], next[target]] = [next[target], next[index]];
    setVariants(next); // optimistic — the arrows should feel instant
    await send(`${API_URL}/api/products/${productId}/variants/reorder`, 'POST', {
      ids: next.map((v) => v.id),
    });
  };

  const saveMeta = async (nextLabel: string, nextBaseName: string) => {
    await send(`${API_URL}/api/products/${productId}/variant-meta`, 'PATCH', {
      variant_label: nextLabel,
      variant_name: nextBaseName,
    });
  };

  if (loading) {
    return (
      <div className="rounded-2xl border p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Memuat varian…
      </div>
    );
  }

  const hasVariants = variants.length > 0;

  return (
    <div className="space-y-3 rounded-2xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold flex items-center gap-2">
            <Ruler className="h-4 w-4 text-muted-foreground" />
            Varian
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ukuran atau pilihan yang <strong>mengganti</strong> produknya —
            Reguler / Large, Panas / Dingin. Beda dengan tambahan, yang{' '}
            <strong>menambah</strong> item ke pesanan.
          </p>
        </div>
      </div>

      {hasVariants && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-semibold">Pertanyaan di kasir</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => saveMeta(label, baseName)}
              placeholder="Ukuran"
              className="w-full rounded-lg border px-3 py-2 text-sm bg-background"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold">
              Nama pilihan untuk produk ini
            </span>
            <input
              value={baseName}
              onChange={(e) => setBaseName(e.target.value)}
              onBlur={() => saveMeta(label, baseName)}
              placeholder="Reguler"
              className="w-full rounded-lg border px-3 py-2 text-sm bg-background"
            />
          </label>
        </div>
      )}

      <div className="space-y-1.5">
        {/* The base is a row like any other, because it IS one: adding sizes
            never turns the product the owner already priced into an abstract
            heading. It leads the list because it is the default. */}
        {hasVariants && (
          <div className="flex items-center gap-2 rounded-xl border border-dashed p-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold">
              1
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm truncate">
                {baseName || 'Reguler'}
                <span className="text-muted-foreground"> · produk utama</span>
              </span>
              <span className="block text-[11px] text-muted-foreground truncate">
                {productName}
              </span>
            </span>
            <span className="text-sm font-semibold shrink-0">
              {formatCurrency(basePrice)}
            </span>
          </div>
        )}

        {variants.map((v, index) => {
          const editing = editingId === v.id;
          return (
            <div key={v.id} className="rounded-xl border p-2.5">
              {editing ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    autoFocus
                    value={editDraft.name}
                    onChange={(e) =>
                      setEditDraft((d) => ({ ...d, name: e.target.value }))
                    }
                    placeholder="Large"
                    className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm bg-background"
                  />
                  <input
                    type="number"
                    inputMode="numeric"
                    value={editDraft.price}
                    onChange={(e) =>
                      setEditDraft((d) => ({ ...d, price: e.target.value }))
                    }
                    placeholder="0"
                    className="w-28 rounded-lg border px-2 py-1.5 text-sm bg-background"
                  />
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => saveEdit(v.id)}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingId(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold">
                    {index + 2}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm truncate">
                      {v.variant_name || v.product_name}
                      {!v.isAvailable && (
                        <span className="text-rose-500"> · habis</span>
                      )}
                    </span>
                    <span className="block text-[11px] text-muted-foreground truncate">
                      {v.product_name}
                      {v.track_stock && ` · stok ${Number(v.stock)}`}
                    </span>
                  </span>
                  <span className="text-sm font-semibold shrink-0">
                    {formatCurrency(priceOf(v))}
                  </span>
                  <div className="flex shrink-0 items-center">
                    <button
                      type="button"
                      aria-label="Naikkan urutan"
                      disabled={index === 0 || busy}
                      onClick={() => move(index, -1)}
                      className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Turunkan urutan"
                      disabled={index === variants.length - 1 || busy}
                      onClick={() => move(index, 1)}
                      className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Ubah varian"
                      onClick={() => {
                        setEditingId(v.id);
                        setEditDraft({
                          name: v.variant_name ?? '',
                          price: String(priceOf(v)),
                        });
                      }}
                      className="p-1 text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Hapus varian"
                      disabled={busy}
                      onClick={() => removeVariant(v)}
                      className="p-1 text-rose-500 hover:text-rose-600 disabled:opacity-30"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {adding ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-2.5">
          <input
            autoFocus
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Nama varian — Large"
            className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm bg-background"
          />
          <input
            type="number"
            inputMode="numeric"
            value={draft.price}
            onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
            placeholder="Harga"
            className="w-28 rounded-lg border px-2 py-1.5 text-sm bg-background"
          />
          <Button size="sm" disabled={busy} onClick={addVariant}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Simpan'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setAdding(false);
              setDraft({ name: '', price: '' });
              setError('');
            }}
          >
            Batal
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setAdding(true)}
        >
          <Plus className="h-4 w-4 mr-1" />
          {hasVariants ? 'Tambah varian lagi' : 'Tambah varian (ukuran/pilihan)'}
        </Button>
      )}

      {notice && <p className="text-xs text-emerald-600">{notice}</p>}
      {error && <p className="text-xs text-rose-500">{error}</p>}

      {hasVariants && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Tiap varian jadi produk sendiri: punya stok, resep dan harga modal
          masing-masing. Resepnya <strong>disalin dari produk utama</strong> —
          buka produk varian di daftar untuk menaikkan takarannya (mis. susu
          untuk Large). Di kasir produk ini muncul satu kali; ukurannya dipilih
          saat diketuk.
        </p>
      )}
    </div>
  );
}
