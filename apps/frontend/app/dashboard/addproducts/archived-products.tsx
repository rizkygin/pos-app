'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Barcode,
  CheckCircle2,
  Loader2,
  Package,
  RotateCcw,
  Ruler,
  Search,
  X,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { LocalDateTime } from '@/components/local-datetime';
import { API_URL } from '@/lib/api-url';
import { isBackendImage, resolveProductImage } from '@/lib/image-src';

export type ArchiveKind = 'produk' | 'bahan' | 'tambahan';

// GET /api/products/archived (backend routes/products.ts), plus the kind the
// manager resolves from the category the same way its own tabs do.
export type ArchivedProduct = {
  id: string;
  product_name: string;
  category: string | null;
  image: string | null;
  price: string;
  buying_price: string | null;
  stock: string;
  unit: string | null;
  track_stock: boolean;
  barcode: string | null;
  variant_of: string | null;
  variant_name: string | null;
  base_name: string | null;
  archived_at: string;
  kind: ArchiveKind;
};

const KIND_LABEL: Record<ArchiveKind, string> = {
  produk: 'Produk',
  bahan: 'Bahan',
  tambahan: 'Tambahan',
};

const rupiah = (v: number | string | null) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(Number(v) || 0);

const qty = (v: string) =>
  (Number(v) || 0).toLocaleString('id-ID', { maximumFractionDigits: 3 });

type Sort = 'recent' | 'name';

/**
 * The Arsip tab: products a delete archived because they have history.
 * Read-mostly — the only action is Pulihkan, which puts a product back exactly
 * as it was. There is no "hapus permanen" here on purpose: everything in this
 * list is still named by an old receipt, invoice or stock movement.
 */
export function ArchivedProducts({
  products,
  onRestored,
  onShowProduct,
}: {
  products: ArchivedProduct[];
  onRestored: () => void;
  onShowProduct: (kind: ArchiveKind, name: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<ArchiveKind | 'all'>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [restoring, setRestoring] = useState<ArchivedProduct | null>(null);
  const [done, setDone] = useState<{ message: string; kind: ArchiveKind; name: string } | null>(
    null,
  );

  const archivedIds = useMemo(() => new Set(products.map((p) => p.id)), [products]);
  const variantsByBase = useMemo(() => {
    const m = new Map<string, ArchivedProduct[]>();
    for (const p of products) {
      if (!p.variant_of) continue;
      m.set(p.variant_of, [...(m.get(p.variant_of) ?? []), p]);
    }
    return m;
  }, [products]);

  const counts = useMemo(() => {
    const c: Record<ArchiveKind, number> = { produk: 0, bahan: 0, tambahan: 0 };
    for (const p of products) c[p.kind] += 1;
    return c;
  }, [products]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = products.filter(
      (p) =>
        (kind === 'all' || p.kind === kind) &&
        (!q ||
          [p.product_name, p.barcode, p.base_name, p.variant_name, p.category].some((v) =>
            v?.toLowerCase().includes(q),
          )),
    );
    return sort === 'name'
      ? [...rows].sort((a, b) => a.product_name.localeCompare(b.product_name, 'id'))
      : rows; // the backend already sends newest archive first
  }, [products, search, kind, sort]);

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-muted/10 p-10 text-center">
        <div className="mb-3 rounded-full bg-muted p-3 text-muted-foreground">
          <Archive className="h-6 w-6" />
        </div>
        <h3 className="font-bold">Arsip kosong</h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Produk yang dihapus padahal sudah punya riwayat (penjualan, faktur, stok, atau
          opname) akan disimpan di sini, dan bisa dipulihkan kapan saja.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Produk yang dihapus tapi punya riwayat disimpan di sini supaya struk dan laporan lama
        tetap utuh. Tidak tampil di kasir, menu pelanggan, maupun halaman Stok.
      </p>

      {done && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{done.message}</span>
          <button
            type="button"
            onClick={() => onShowProduct(done.kind, done.name)}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-bold hover:underline"
          >
            Lihat <ArrowRight className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setDone(null)}
            aria-label="Tutup"
            className="shrink-0 rounded p-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari di arsip — nama, varian, atau barcode…"
            className="h-11 w-full rounded-xl border border-input bg-transparent pl-10 pr-9 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Hapus pencarian"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label="Urutkan"
          className="h-11 rounded-xl border border-input bg-background px-3 text-sm shadow-sm"
        >
          <option value="recent">Terbaru diarsipkan</option>
          <option value="name">Nama A–Z</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(['all', 'produk', 'bahan', 'tambahan'] as const).map((k) => {
          const n = k === 'all' ? products.length : counts[k];
          if (k !== 'all' && n === 0) return null;
          const active = kind === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                active
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-input bg-background hover:bg-muted'
              }`}
            >
              {k === 'all' ? 'Semua' : KIND_LABEL[k]}
              <span className={`tabular-nums ${active ? 'text-white/80' : 'text-muted-foreground'}`}>
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Tidak ada produk arsip yang cocok dengan pencarian.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-background">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5 font-semibold">Produk</th>
                  <th className="px-3 py-2.5 font-semibold">Diarsipkan</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Harga</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Stok tersisa</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const stockNum = Number(p.stock) || 0;
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2.5">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40 grayscale">
                            {p.image && p.image !== 'avatar.png' ? (
                              <Image
                                src={resolveProductImage(p.image)}
                                unoptimized={isBackendImage(p.image)}
                                fill
                                className="object-cover"
                                alt={p.product_name}
                              />
                            ) : (
                              <Package className="h-5 w-5 text-muted-foreground/40" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-semibold">{p.product_name}</p>
                            <span className="text-[11px] capitalize text-muted-foreground">
                              {KIND_LABEL[p.kind]}
                              {p.kind === 'produk' && p.category ? ` · ${p.category}` : ''}
                            </span>
                            {p.variant_of && (
                              <span className="flex items-center gap-1 truncate text-[11px] text-violet-600 dark:text-violet-400">
                                <Ruler className="h-3 w-3 shrink-0" />
                                {p.variant_name || 'Varian'} · {p.base_name ?? 'produk lain'}
                              </span>
                            )}
                            {p.barcode && (
                              <span className="mt-0.5 flex items-center gap-1 truncate font-mono text-[11px] text-muted-foreground">
                                <Barcode className="h-3 w-3 shrink-0" />
                                {p.barcode}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                        <LocalDateTime
                          value={p.archived_at}
                          options={{
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          }}
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums">
                        {rupiah(p.kind === 'bahan' ? p.buying_price : p.price)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                        {!p.track_stock ? (
                          <span className="text-muted-foreground" title="Tidak dihitung stoknya">
                            —
                          </span>
                        ) : stockNum !== 0 ? (
                          <span
                            className="inline-flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-500"
                            title="Stok ini masih tercatat, tapi tidak terlihat selama produknya diarsipkan"
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {qty(p.stock)}
                            {p.unit && (
                              <span className="font-normal text-muted-foreground">{p.unit}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRestoring(p)}
                          className="rounded-lg"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Pulihkan
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {restoring && (
        <RestoreDialog
          product={restoring}
          baseArchived={!!restoring.variant_of && archivedIds.has(restoring.variant_of)}
          archivedVariants={restoring.variant_of ? [] : (variantsByBase.get(restoring.id) ?? [])}
          onClose={() => setRestoring(null)}
          onRestored={(message) => {
            // A restored variant shows up under its base's name in the list.
            const name =
              restoring.variant_of && restoring.base_name
                ? restoring.base_name
                : restoring.product_name;
            setDone({ message, kind: restoring.kind, name });
            setRestoring(null);
            onRestored();
          }}
        />
      )}
    </div>
  );
}

function RestoreDialog({
  product,
  baseArchived,
  archivedVariants,
  onClose,
  onRestored,
}: {
  product: ArchivedProduct;
  baseArchived: boolean;
  archivedVariants: ArchivedProduct[];
  onClose: () => void;
  onRestored: (message: string) => void;
}) {
  const [withVariants, setWithVariants] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const restore = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/products/${product.id}/restore`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ with_variants: archivedVariants.length > 0 && withVariants }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.message || 'Gagal memulihkan produk');
        return;
      }
      onRestored(json.message);
    } catch {
      setError('Gagal terhubung ke server');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Pulihkan &ldquo;{product.product_name}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>
                Produk kembali ke tab <b className="text-foreground">{KIND_LABEL[product.kind]}</b>{' '}
                persis seperti sebelum diarsipkan: harga, stok, resep, dan status jualnya.
                {product.kind === 'produk' &&
                  ' Kalau dulu dijual, produk langsung muncul lagi di kasir dan menu pelanggan.'}
              </p>
              {baseArchived && (
                <p className="rounded-lg bg-violet-50 p-2.5 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300">
                  Ini varian dari &ldquo;{product.base_name}&rdquo;, yang juga diarsipkan. Produk
                  induknya ikut dipulihkan, karena varian hanya bisa dipilih lewat induknya.
                </p>
              )}
              {archivedVariants.length > 0 && (
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-foreground">
                  <input
                    type="checkbox"
                    checked={withVariants}
                    onChange={(e) => setWithVariants(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-blue-600"
                  />
                  <span>
                    Pulihkan juga {archivedVariants.length} varian:{' '}
                    <span className="text-muted-foreground">
                      {archivedVariants.map((v) => v.variant_name || v.product_name).join(', ')}
                    </span>
                  </span>
                </label>
              )}
              {error && <p className="font-medium text-rose-600">{error}</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel>
          <Button onClick={restore} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
            Pulihkan
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
