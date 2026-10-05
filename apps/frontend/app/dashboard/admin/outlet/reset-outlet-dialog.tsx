'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Boxes, CheckCircle2, Loader2, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LocalDateTime } from '@/components/local-datetime';
import { API_URL } from '@/lib/api-url';
import type { AdminOutlet } from './columns';

// Mirrors OutletResetCounts / StockFlowCounts in the backend (lib/outlet-reset.ts).
type Counts = Record<
  | 'orders'
  | 'stockMovements'
  | 'invoices'
  | 'cashflows'
  | 'shifts'
  | 'opnameSessions'
  | 'kitchenTickets'
  | 'tableBills'
  | 'selfOrders'
  | 'printLogs'
  | 'pointMovements'
  | 'promoUses'
  | 'ratings'
  | 'stockedProducts',
  number
>;

const ROWS: { key: keyof Counts; label: string }[] = [
  { key: 'orders', label: 'Order / transaksi' },
  { key: 'stockMovements', label: 'Mutasi stok' },
  { key: 'invoices', label: 'Faktur (jual, beli, produksi)' },
  { key: 'cashflows', label: 'Baris Buku Kas' },
  { key: 'shifts', label: 'Shift kasir' },
  { key: 'opnameSessions', label: 'Sesi stok opname' },
  { key: 'kitchenTickets', label: 'Tiket dapur' },
  { key: 'tableBills', label: 'Bill meja' },
  { key: 'selfOrders', label: 'Pesan Mandiri' },
  { key: 'printLogs', label: 'Log cetak struk' },
  { key: 'pointMovements', label: 'Mutasi poin member' },
  { key: 'promoUses', label: 'Pemakaian promo' },
  { key: 'ratings', label: 'Ulasan dari order' },
  { key: 'stockedProducts', label: 'Produk yang stok & HPP-nya jadi 0' },
];

type HppRow = {
  id: string;
  name: string;
  unit: string;
  archived: boolean;
  from: number;
  to: number;
  source: 'harga modal' | 'resep' | 'kosong';
  price: number;
  saleCostNow: number;
  saleCostAfter: number;
};

type StockCounts = {
  movements: number;
  stockedProducts: number;
  openOpname: number;
  stockResetAt: string | null;
  hpp: HppRow[];
  overPrice: HppRow[];
};

const hppFmt = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
// Problems first: anything landing on 0, then what a recipe priced, then the rest.
const hppRank = (r: HppRow) => (r.to === 0 ? 0 : r.source === 'resep' ? 1 : 2);

type Mode = 'stock' | 'all';

const MODES: { id: Mode; icon: typeof Boxes; title: string; body: string }[] = [
  {
    id: 'stock',
    icon: Boxes,
    title: 'Alur Stok saja',
    body: 'Untuk outlet yang riwayat stoknya salah. Order, faktur, dan Buku Kas tetap ada.',
  },
  {
    id: 'all',
    icon: Trash2,
    title: 'Semua Transaksi',
    body: 'Untuk outlet trial yang mau mulai dari nol. Order, stok, faktur, Buku Kas, shift ikut dihapus.',
  },
];

const fmt = (n: number) => n.toLocaleString('id-ID');

export function ResetOutletDialog({
  outlet,
  onClose,
  onDone,
}: {
  outlet: AdminOutlet;
  onClose: () => void;
  onDone: () => void;
}) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [stock, setStock] = useState<StockCounts | null>(null);
  // No default: the admin picks which wipe this is, every time.
  const [mode, setMode] = useState<Mode | null>(null);
  const [done, setDone] = useState<{ mode: Mode; deleted: Record<string, number> } | null>(null);
  const [confirmName, setConfirmName] = useState('');
  // A product that would cost more than it sells for is almost always a unit
  // slip in a recipe or a harga modal. Acknowledged explicitly, every time.
  const [ackOver, setAckOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/admin/outlets/${outlet.id}/reset`, { credentials: 'include' })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) {
          setCounts(json.counts);
          setStock(json.stock);
        } else setError(json.error || 'Gagal memuat data outlet');
      })
      .catch(() => !cancelled && setError('Gagal terhubung ke server'));
    return () => {
      cancelled = true;
    };
  }, [outlet.id]);

  const nameMatches = confirmName.trim() === outlet.name.trim();
  const opnameOpen = mode === 'stock' && (stock?.openOpname ?? 0) > 0;
  const overPrice = mode === 'stock' ? (stock?.overPrice ?? []) : [];
  const blockedByOver = overPrice.length > 0 && !ackOver;

  const pick = (m: Mode) => {
    // A name typed for one kind of wipe does not carry over to the other.
    if (m !== mode) setConfirmName('');
    setMode(m);
    setError('');
  };

  const reset = async () => {
    if (!mode) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/admin/outlets/${outlet.id}/reset`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_name: confirmName, mode }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Reset gagal');
        return;
      }
      setDone({ mode, deleted: json.deleted });
      onDone();
    } catch {
      setError('Gagal terhubung ke server');
    } finally {
      setBusy(false);
    }
  };

  const loaded = counts && stock;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {done ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-rose-600" />
            )}
            {done
              ? done.mode === 'stock'
                ? 'Alur stok sudah direset'
                : 'Data outlet sudah direset'
              : `Reset data ${outlet.name}`}
          </DialogTitle>
          <DialogDescription>
            {done
              ? done.mode === 'stock'
                ? 'Stok semua produk sekarang 0, HPP-nya dari harga modal (atau resep kalau harga modal kosong). Minta owner menghitung stok lewat stok opname.'
                : 'Outlet mulai dari nol. Minta owner mengisi stok awal lewat stok opname atau faktur pembelian.'
              : 'Pilih apa yang mau direset. Data yang dihapus tidak bisa dikembalikan.'}
          </DialogDescription>
        </DialogHeader>

        {!loaded ? (
          error ? (
            <p className="text-sm font-medium text-rose-600">{error}</p>
          ) : (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )
        ) : done ? (
          <div className="rounded-xl border divide-y text-sm">
            {(done.mode === 'stock'
              ? [
                  { label: 'Mutasi stok dihapus', n: done.deleted.movements },
                  { label: 'Produk yang stoknya jadi 0', n: done.deleted.stockedProducts },
                  { label: 'Produk yang HPP-nya berubah', n: done.deleted.hppChanged },
                ]
              : ROWS.map((r) => ({ label: r.label, n: done.deleted[r.key] }))
            ).map((r) => (
              <div key={r.label} className="flex justify-between gap-4 px-3 py-1.5">
                <span className="text-muted-foreground">{r.label}</span>
                <span className="font-semibold tabular-nums">{fmt(r.n ?? 0)}</span>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div role="radiogroup" aria-label="Jenis reset" className="grid gap-2 sm:grid-cols-2">
              {MODES.map((m) => {
                const active = mode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => pick(m.id)}
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      active
                        ? 'border-rose-500 bg-rose-50 ring-1 ring-rose-500 dark:bg-rose-950/30'
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-sm font-bold">
                      <m.icon className={`h-4 w-4 ${active ? 'text-rose-600' : 'text-muted-foreground'}`} />
                      {m.title}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">{m.body}</span>
                  </button>
                );
              })}
            </div>

            {mode === 'stock' && (
              <div className="space-y-2 text-sm">
                <div className="rounded-xl border divide-y">
                  <div className="flex justify-between gap-4 px-3 py-1.5">
                    <span className="text-muted-foreground">Mutasi stok yang dihapus</span>
                    <span className="font-semibold tabular-nums">{fmt(stock.movements)}</span>
                  </div>
                  <div className="flex justify-between gap-4 px-3 py-1.5">
                    <span className="text-muted-foreground">Produk yang stoknya jadi 0</span>
                    <span className="font-semibold tabular-nums">{fmt(stock.stockedProducts)}</span>
                  </div>
                  <div className="flex justify-between gap-4 px-3 py-1.5">
                    <span className="text-muted-foreground">HPP per produk</span>
                    <span className="text-right font-semibold">
                      harga modal; kalau kosong, dari resep
                    </span>
                  </div>
                </div>

                {stock.overPrice.length > 0 && (
                  <div className="space-y-2 rounded-lg border border-rose-300 bg-rose-50 p-2.5 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                    <p className="font-semibold">
                      {stock.overPrice.length} produk akan punya HPP di atas harga jualnya. Biasanya
                      ini salah satuan di resep atau harga modal — cek dulu sebelum reset:
                    </p>
                    <ul className="space-y-1">
                      {stock.overPrice.map((r) => (
                        <li key={r.id} className="flex justify-between gap-3">
                          <span className="min-w-0 truncate font-medium">{r.name}</span>
                          <span className="shrink-0 tabular-nums">
                            HPP {hppFmt(r.saleCostNow)} → <b>{hppFmt(r.saleCostAfter)}</b> · harga{' '}
                            {hppFmt(r.price)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <label className="flex cursor-pointer items-center gap-2 font-medium">
                      <input
                        type="checkbox"
                        checked={ackOver}
                        onChange={(e) => setAckOver(e.target.checked)}
                        className="h-4 w-4 accent-rose-600"
                      />
                      Sudah saya cek, tetap reset
                    </label>
                  </div>
                )}

                {stock.hpp.length > 0 && (
                  <details className="rounded-lg border">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-semibold">
                      Perubahan HPP bahan &amp; olahan ({stock.hpp.length})
                    </summary>
                    <div className="max-h-52 overflow-y-auto border-t divide-y text-xs">
                      {[...stock.hpp]
                        .sort((a, b) => hppRank(a) - hppRank(b) || a.name.localeCompare(b.name, 'id'))
                        .map((r) => (
                          <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                            <span className="min-w-0 truncate">
                              {r.name}
                              {r.archived && <span className="text-muted-foreground"> (arsip)</span>}
                            </span>
                            <span className="flex shrink-0 items-center gap-2 tabular-nums">
                              <span className={r.to === 0 ? 'font-semibold text-amber-600' : ''}>
                                {hppFmt(r.from)} → {hppFmt(r.to)}
                                <span className="text-muted-foreground">/{r.unit}</span>
                              </span>
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {r.source}
                              </span>
                            </span>
                          </div>
                        ))}
                    </div>
                  </details>
                )}
                <p className="rounded-lg bg-muted/60 p-2.5 text-xs text-foreground">
                  Benarkan dulu harga modal dan resep yang salah <b>sebelum</b> menekan reset:
                  HPP dihitung saat tombol ini ditekan, dan mengubah harga modal atau resep
                  sesudahnya tidak mengubah HPP lagi.
                </p>
                <p className="text-xs text-muted-foreground">
                  Laba kotor order lama tetap memakai harga modal yang tercatat saat order itu
                  terjadi. Membatalkan order dari sebelum reset tidak mengembalikan stok.
                  {stock.stockResetAt && (
                    <>
                      {' '}Terakhir direset{' '}
                      <LocalDateTime
                        value={stock.stockResetAt}
                        options={{ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }}
                      />
                      .
                    </>
                  )}
                </p>
                {opnameOpen && (
                  <p className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    Masih ada sesi stok opname yang berjalan. Minta owner menyelesaikan atau
                    membatalkannya dulu.
                  </p>
                )}
              </div>
            )}

            {mode === 'all' && (
              <div className="max-h-56 overflow-y-auto rounded-xl border divide-y text-sm">
                {ROWS.map((r) => (
                  <div key={r.key} className="flex justify-between gap-4 px-3 py-1.5">
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className="font-semibold tabular-nums">{fmt(counts[r.key])}</span>
                  </div>
                ))}
              </div>
            )}

            {mode && !opnameOpen && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground">
                  Ketik nama outlet untuk konfirmasi:{' '}
                  <span className="text-foreground">{outlet.name}</span>
                </label>
                <Input
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={outlet.name}
                  autoComplete="off"
                />
              </div>
            )}
            {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
          </>
        )}

        <DialogFooter>
          {done ? (
            <Button onClick={onClose}>Tutup</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={busy}>
                Batal
              </Button>
              <Button
                variant="destructive"
                onClick={reset}
                disabled={!loaded || !mode || opnameOpen || blockedByOver || !nameMatches || busy}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : mode === 'all' ? (
                  'Hapus Semua Transaksi'
                ) : (
                  'Reset Alur Stok'
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
