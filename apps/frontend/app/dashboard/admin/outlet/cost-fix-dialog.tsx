'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Search, Wrench } from 'lucide-react';
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

// Mirrors CostGroup / CostFixPreview in the backend (lib/cost-fix.ts).
type Group = {
  productId: string;
  name: string;
  unit: string;
  unitCost: number;
  rows: number;
  qty: number;
  cost: number;
  first: string;
  last: string;
  hppNow: number;
  hargaModal: number;
  suspicious: boolean;
  flag: 'tinggi' | 'nol' | null;
};

type Preview = {
  rows: number;
  invoiceRows: number;
  oldCost: number;
  newCost: number;
  months: { month: string; omzet: number; labaNow: number; labaAfter: number }[];
};

const num = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const monthLabel = (m: string) => `${BULAN[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const dateOpts = { day: 'numeric', month: 'short' } as const;

/**
 * Koreksi HPP: re-cost the sales of one product that were booked at a wrong
 * unit cost (outlet 33's Galon Air at Rp 38.000/ml). Pick a group, type the
 * right cost, read the laba kotor it gives per month, apply. Nothing else in
 * the outlet's stock history moves.
 */
export function CostFixDialog({
  outlet,
  onClose,
}: {
  outlet: AdminOutlet;
  onClose: () => void;
}) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [ledger, setLedger] = useState(true);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Group | null>(null);
  const [toCost, setToCost] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  // Which typed cost the preview on screen was computed for.
  const [previewTo, setPreviewTo] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [setHpp, setSetHpp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ updated: number; revalued: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/admin/outlets/${outlet.id}/cost-fix`, { credentials: 'include' })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) {
          setGroups(json.groups);
          setLedger(json.ledger);
        } else setError(json.error || 'Gagal memuat data');
      })
      .catch(() => !cancelled && setError('Gagal terhubung ke server'));
    return () => {
      cancelled = true;
    };
  }, [outlet.id]);

  const to = Number(toCost.replace(',', '.'));
  const validTo = toCost.trim() !== '' && Number.isFinite(to) && to >= 0 && !!picked && to !== picked.unitCost;

  // Debounced: the preview recomputes laba kotor per month on the backend.
  useEffect(() => {
    if (!picked || !validTo) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setPreviewing(true);
      const q = new URLSearchParams({
        product_id: picked.productId,
        from_cost: String(picked.unitCost),
        to_cost: String(to),
      });
      fetch(`${API_URL}/api/admin/outlets/${outlet.id}/cost-fix/preview?${q}`, { credentials: 'include' })
        .then((res) => res.json())
        .then((json) => {
          if (cancelled) return;
          if (json.success) {
            setPreview(json);
            setPreviewTo(to);
          } else setError(json.error || 'Gagal menghitung');
        })
        .catch(() => !cancelled && setError('Gagal terhubung ke server'))
        .finally(() => !cancelled && setPreviewing(false));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [outlet.id, picked, to, validTo]);

  const pick = (g: Group) => {
    setPicked(g);
    setPreview(null);
    setError('');
    // The product's own reference cost is the usual answer; the admin can type over it.
    const reference = g.hppNow > 0 && g.hppNow !== g.unitCost ? g.hppNow : g.hargaModal;
    setToCost(reference > 0 && reference !== g.unitCost ? String(reference) : '');
    // Offer to fix the running HPP too, pre-ticked when it still carries the wrong cost.
    setSetHpp(g.hppNow === g.unitCost);
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (groups ?? []).filter((g) => !q || g.name.toLowerCase().includes(q));
  }, [groups, search]);

  const apply = async () => {
    if (!picked || !validTo) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/admin/outlets/${outlet.id}/cost-fix`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: picked.productId,
          from_cost: picked.unitCost,
          to_cost: to,
          set_hpp: setHpp,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Koreksi gagal');
        return;
      }
      setDone({ updated: json.updated, revalued: json.revalued });
    } catch {
      setError('Gagal terhubung ke server');
    } finally {
      setBusy(false);
    }
  };

  const hppDiffers = !!picked && validTo && picked.hppNow !== to;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {done ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <Wrench className="h-5 w-5 text-muted-foreground" />
            )}
            {done ? 'HPP sudah dikoreksi' : `Koreksi HPP — ${outlet.name}`}
          </DialogTitle>
          <DialogDescription>
            {done
              ? `${done.updated} baris penjualan ${picked?.name} sekarang tercatat ${num(to)}/${picked?.unit}.${
                  done.revalued ? ` HPP produknya juga sudah diset ke ${num(to)}.` : ''
                } Laba kotor langsung mengikuti.`
              : 'Ganti biaya per unit yang salah tercatat di penjualan satu produk. Stok, jumlah, dan riwayat lainnya tidak berubah.'}
          </DialogDescription>
        </DialogHeader>

        {!ledger && !done && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            Paket outlet ini tidak menghitung HPP dari alur stok, jadi koreksi ini tidak mengubah
            laba kotornya.
          </p>
        )}

        {done ? null : !groups ? (
          error ? (
            <p className="text-sm font-medium text-rose-600">{error}</p>
          ) : (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )
        ) : groups.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Outlet ini belum punya penjualan yang tercatat di alur stok.
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-bold text-muted-foreground">
                1. Pilih biaya yang salah — dikelompokkan per produk & biaya per unit yang tercatat
              </p>
              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari produk…"
                  className="h-9 pl-8"
                />
              </div>
              <div className="max-h-56 overflow-y-auto rounded-xl border divide-y text-sm">
                {shown.map((g) => {
                  const active = picked?.productId === g.productId && picked.unitCost === g.unitCost;
                  return (
                    <button
                      key={`${g.productId}:${g.unitCost}`}
                      type="button"
                      onClick={() => pick(g)}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors ${
                        active ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-muted/50'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-semibold">
                          {g.flag === 'tinggi' && (
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600" />
                          )}
                          <span className="truncate">{g.name}</span>
                          {g.flag === 'nol' && (
                            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                              biaya 0
                            </span>
                          )}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {g.rows} penjualan ·{' '}
                          <LocalDateTime value={g.first} options={dateOpts} />–
                          <LocalDateTime value={g.last} options={dateOpts} /> · HPP produk sekarang{' '}
                          {num(g.hppNow)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right tabular-nums">
                        <span
                          className={`block font-semibold ${
                            g.flag === 'tinggi' ? 'text-rose-600' : g.flag === 'nol' ? 'text-amber-600' : ''
                          }`}
                        >
                          {num(g.unitCost)}/{g.unit}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">{rp(g.cost)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                <AlertTriangle className="inline h-3 w-3 text-rose-600" /> = biaya tercatat 10× atau
                lebih dari HPP produknya sendiri, biasanya salah satuan. <b>biaya 0</b> = terjual
                waktu produknya belum punya HPP, jadi laba kotornya terbaca terlalu tinggi.
              </p>
            </div>

            {picked && (
              <div className="space-y-2">
                <label className="block text-xs font-bold text-muted-foreground">
                  2. Biaya yang benar per {picked.unit} untuk {picked.name} (sekarang tercatat{' '}
                  {num(picked.unitCost)})
                </label>
                <Input
                  value={toCost}
                  onChange={(e) => setToCost(e.target.value)}
                  inputMode="decimal"
                  placeholder="mis. 2"
                  className="max-w-48"
                />

                {validTo && (previewing && !preview ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : preview ? (
                  <div className={`space-y-2 text-sm ${previewing ? 'opacity-60' : ''}`}>
                    <p>
                      <b>{preview.rows}</b> baris penjualan: HPP {rp(preview.oldCost)} →{' '}
                      <b>{rp(preview.newCost)}</b>
                      {preview.invoiceRows > 0 && (
                        <span className="text-muted-foreground">
                          {' '}({preview.invoiceRows} dari faktur penjualan)
                        </span>
                      )}
                    </p>
                    {preview.months.length > 0 && (
                      <div className="rounded-xl border divide-y">
                        <div className="grid grid-cols-3 gap-2 px-3 py-1.5 text-[11px] font-semibold uppercase text-muted-foreground">
                          <span>Bulan</span>
                          <span className="text-right">Laba kotor sekarang</span>
                          <span className="text-right">Setelah koreksi</span>
                        </div>
                        {preview.months.map((m) => (
                          <div key={m.month} className="grid grid-cols-3 gap-2 px-3 py-1.5 tabular-nums">
                            <span>{monthLabel(m.month)}</span>
                            <span className={`text-right ${m.labaNow < 0 ? 'text-rose-600' : ''}`}>
                              {rp(m.labaNow)}
                            </span>
                            <span
                              className={`text-right font-semibold ${
                                m.labaAfter < 0 ? 'text-rose-600' : 'text-emerald-600'
                              }`}
                            >
                              {rp(m.labaAfter)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {hppDiffers && (
                      <label className="flex cursor-pointer items-start gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={setHpp}
                          onChange={(e) => setSetHpp(e.target.checked)}
                          className="mt-0.5 h-4 w-4 accent-blue-600"
                        />
                        <span>
                          Set juga HPP {picked.name} sekarang ke {num(to)}/{picked.unit} (sekarang{' '}
                          {num(picked.hppNow)}), supaya penjualan berikutnya tidak salah lagi.
                        </span>
                      </label>
                    )}
                  </div>
                ) : null)}
              </div>
            )}
            {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
          </div>
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
                onClick={apply}
                disabled={
                  !picked || !validTo || !preview || previewTo !== to || previewing || preview.rows === 0 || busy
                }
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  `Koreksi ${preview?.rows ?? ''} baris`
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
