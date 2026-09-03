'use client';

import { useCallback, useEffect, useState } from 'react';
import { Layers, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { API_URL } from '@/lib/api-url';
import { formatCurrency } from '@/lib/utils/format';

type ProductOption = {
  id: string;
  product_name: string;
  category: string;
};

/**
 * The internal category add-on options live under (INTERNAL_CATEGORIES on the
 * backend). Options are not restricted to it — a real menu item can be offered
 * as an add-on, which is why the picker below still lists everything — but
 * anything filed here was created FOR this, so it is what the owner is looking
 * for and it goes first.
 */
const ADDON_CATEGORY = 'tambahan';

type Option = {
  id: number;
  product_id: string;
  name: string;
  price: number;
};

type Group = {
  id: number;
  name: string;
  min_select: number;
  max_select: number | null;
  sort_order: number;
  options: Option[];
};

/**
 * Add-on groups for a product ("Topping", "Level Pedas", "Ukuran").
 *
 * Two things are edited here and they are deliberately different scopes:
 *
 *   the GROUPS are the outlet's, shared across products. Renaming "Topping" or
 *     repricing telur changes it everywhere it is offered, which is the point —
 *     otherwise the same question has to be authored twenty times.
 *   the ATTACHMENT is this product's. Ticking a group only decides whether THIS
 *     dish asks that question.
 *
 * An add-on option is an ordinary product with is_for_sale = false, so it keeps
 * its own stock, recipe and cost. That is what lets a sold topping deduct
 * ingredients and land in COGS like anything else — see migration 0069.
 *
 * min_select >= 1 is "wajib pilih". Those rules bind the cashier's picker only;
 * a cart parked before a rule was tightened still settles, on purpose.
 */
export function AddonEditor({
  productId,
  products,
}: {
  productId: string;
  /** The outlet's products, any of which can serve as an add-on option. */
  products: ProductOption[];
}) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [attached, setAttached] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Group | null>(null);
  // Bumped to re-read after a write, so the fetch stays inside the effect
  // rather than being a callback the effect invokes.
  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => setReloadTick((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [groupsRes, mineRes] = await Promise.all([
          fetch(`${API_URL}/api/addon-groups`, { credentials: 'include' }),
          fetch(`${API_URL}/api/products/mine`, { credentials: 'include' }),
        ]);
        const groupsJson = await groupsRes.json();
        const mineJson = await mineRes.json();
        if (cancelled) return;
        setGroups(Array.isArray(groupsJson?.groups) ? groupsJson.groups : []);
        // Which groups THIS product currently asks. Read back from the same
        // endpoint the POS uses, so the form and the counter can never disagree
        // about what is attached.
        const me = (mineJson?.products ?? []).find(
          (p: { id: string }) => p.id === productId,
        );
        setAttached(
          new Set(
            (me?.addon_groups ?? []).map((g: { id: number }) => g.id) as number[],
          ),
        );
      } catch {
        if (!cancelled) setError('Gagal memuat data tambahan.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId, reloadTick]);

  const saveAttachment = async (next: Set<number>) => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(
        `${API_URL}/api/products/${productId}/addon-groups`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ group_ids: [...next] }),
        },
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Gagal menyimpan');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan');
      // Re-read rather than trusting local state after a failed write.
      reload();
    } finally {
      setSaving(false);
    }
  };

  const toggleAttached = (groupId: number) => {
    const next = new Set(attached);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    setAttached(next);
    saveAttachment(next);
  };

  if (loading) {
    return (
      <div className="rounded-xl border p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Memuat tambahan...
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-bold flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          Tambahan (Add-on)
        </label>
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {!saving && saved && (
            <span className="text-[11px] text-emerald-600">Tersimpan</span>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setEditing({
                id: 0,
                name: '',
                min_select: 0,
                max_select: null,
                sort_order: groups.length,
                options: [],
              })
            }
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Grup baru
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Centang grup yang ingin ditanyakan saat produk ini dipesan. Grup dipakai
        bersama oleh semua produk — mengubah harganya berlaku di semua tempat.
      </p>

      {error && <p className="text-xs text-rose-500">{error}</p>}

      {groups.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          Belum ada grup tambahan. Buat satu untuk menawarkan topping atau
          pilihan level.
        </p>
      ) : (
        <div className="space-y-1.5">
          {groups.map((g) => (
            <div
              key={g.id}
              className="flex items-start gap-2 rounded-lg border p-2.5"
            >
              <input
                type="checkbox"
                checked={attached.has(g.id)}
                onChange={() => toggleAttached(g.id)}
                className="mt-0.5 h-4 w-4 shrink-0"
                aria-label={`Pakai grup ${g.name}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">
                  {g.name}
                  {g.min_select > 0 && (
                    <span className="ml-1 text-[10px] font-normal text-rose-500">
                      wajib
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {g.options.length === 0
                    ? 'belum ada pilihan'
                    : g.options
                        .map(
                          (o) =>
                            `${o.name}${o.price > 0 ? ` +${formatCurrency(o.price)}` : ''}`,
                        )
                        .join(', ')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditing(g)}
                aria-label={`Ubah grup ${g.name}`}
                className="p-1 text-muted-foreground hover:text-foreground shrink-0"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <GroupDialog
          group={editing}
          products={products}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

/** Create or edit one group and its options. Options are replaced wholesale. */
function GroupDialog({
  group,
  products,
  onClose,
  onSaved,
}: {
  group: Group;
  products: ProductOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = group.id === 0;
  const [name, setName] = useState(group.name);
  const [minSelect, setMinSelect] = useState(String(group.min_select));
  const [maxSelect, setMaxSelect] = useState(
    group.max_select === null ? '' : String(group.max_select),
  );
  const [rows, setRows] = useState<{ product_id: string; price: string }[]>(
    group.options.map((o) => ({ product_id: o.product_id, price: String(o.price) })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Split once for the picker below. Sorted by name inside each half: the list
  // arrives in the product table's order, which is the order the owner added
  // things in — no help at all when you are hunting for "Telur Ceplok".
  const byName = (a: ProductOption, b: ProductOption) =>
    a.product_name.localeCompare(b.product_name, 'id');
  const addonProducts = products
    .filter((p) => p.category === ADDON_CATEGORY)
    .sort(byName);
  const otherProducts = products
    .filter((p) => p.category !== ADDON_CATEGORY)
    .sort(byName);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: name.trim(),
        min_select: Number(minSelect) || 0,
        max_select: maxSelect.trim() === '' ? null : Number(maxSelect),
      };

      let groupId = group.id;
      if (isNew) {
        const res = await fetch(`${API_URL}/api/addon-groups`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'Gagal membuat grup');
        groupId = json.id;
      } else {
        const res = await fetch(`${API_URL}/api/addon-groups/${group.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'Gagal menyimpan grup');
      }

      const clean = rows.filter((r) => r.product_id);
      const optRes = await fetch(
        `${API_URL}/api/addon-groups/${groupId}/options`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            options: clean.map((r) => ({
              product_id: r.product_id,
              price: Number(r.price) || 0,
            })),
          }),
        },
      );
      const optJson = await optRes.json();
      if (!optJson.success) throw new Error(optJson.message || 'Gagal menyimpan pilihan');

      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (isNew) return onClose();
    if (!window.confirm(`Hapus grup "${group.name}" dari semua produk?`)) return;
    setSaving(true);
    try {
      await fetch(`${API_URL}/api/addon-groups/${group.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border bg-background shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between border-b px-5 py-3 shrink-0">
          <h3 className="font-bold">{isNew ? 'Grup tambahan baru' : 'Ubah grup'}</h3>
          <button onClick={onClose} aria-label="Tutup" className="p-1 text-muted-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold">Nama grup</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Topping"
              className="w-full rounded-lg border px-3 py-2 text-sm bg-background"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold">Minimal pilih</label>
              <input
                type="number"
                min={0}
                value={minSelect}
                onChange={(e) => setMinSelect(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm bg-background"
              />
              <p className="text-[10px] text-muted-foreground">1 = wajib dipilih</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold">Maksimal pilih</label>
              <input
                type="number"
                min={1}
                value={maxSelect}
                onChange={(e) => setMaxSelect(e.target.value)}
                placeholder="bebas"
                className="w-full rounded-lg border px-3 py-2 text-sm bg-background"
              />
              <p className="text-[10px] text-muted-foreground">kosong = tanpa batas</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold">Pilihan</label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setRows([...rows, { product_id: '', price: '0' }])}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Tambah
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Pilihan diambil dari produk. Buat produk seperti &quot;Telur
              Ceplok&quot; di kategori <b>Tambahan (Add-on)</b> — stok dan
              HPP-nya tetap ikut terhitung, tapi ia tidak muncul sendiri di
              kasir maupun di menu pelanggan.
            </p>
            {rows.map((row, i) => (
              <div key={i} className="flex gap-2">
                <select
                  value={row.product_id}
                  aria-label="Produk pilihan"
                  onChange={(e) => {
                    const next = [...rows];
                    next[i] = { ...next[i], product_id: e.target.value };
                    setRows(next);
                  }}
                  className="flex-1 min-w-0 rounded-lg border px-2 py-2 text-sm bg-background"
                >
                  <option value="">— pilih produk —</option>
                  {addonProducts.length > 0 && (
                    <optgroup label="Tambahan">
                      {addonProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.product_name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {otherProducts.length > 0 && (
                    <optgroup label="Produk lain">
                      {otherProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.product_name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <input
                  type="number"
                  min={0}
                  aria-label="Harga tambahan"
                  value={row.price}
                  onChange={(e) => {
                    const next = [...rows];
                    next[i] = { ...next[i], price: e.target.value };
                    setRows(next);
                  }}
                  className="w-24 shrink-0 rounded-lg border px-2 py-2 text-sm bg-background"
                />
                <button
                  type="button"
                  aria-label="Hapus pilihan"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  className="shrink-0 p-1 text-muted-foreground hover:text-rose-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          {error && <p className="text-xs text-rose-500">{error}</p>}
        </div>

        <div className="flex gap-2 border-t px-5 py-3 shrink-0">
          {!isNew && (
            <Button type="button" variant="outline" onClick={remove} disabled={saving}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">
            Batal
          </Button>
          <Button type="button" onClick={save} disabled={saving || !name.trim()} className="flex-1">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Simpan'}
          </Button>
        </div>
      </div>
    </div>
  );
}
