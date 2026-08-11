'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Bike, MapPin, RefreshCw, PackageSearch } from 'lucide-react';
import { API_URL } from '@/lib/api-url';

type Errand = {
  id: string;
  status: string;
  note: string | null;
  price: string | null;
  rejectedReason: string | null;
  destinationAddress: string | null;
  destinationLat: string | null;
  destinationLon: string | null;
  createdAt: string;
  acceptedAt: string | null;
  deliveredAt: string | null;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  courierId: number;
  courierName: string;
  courierPhone: string | null;
  courierPlate: string;
  courierVehicle: string;
};

// Order matters: the two live states first, then the outcomes. Same vocabulary
// the customer and courier screens use, so a support conversation about "ditolak
// kurir" lands on the same word here.
const STATUSES = [
  { key: 'pending', label: 'Menunggu', className: 'bg-amber-500' },
  { key: 'on_delivery', label: 'Berjalan', className: 'bg-sky-500' },
  { key: 'delivered', label: 'Selesai', className: 'bg-emerald-500' },
  { key: 'cancelled_by_customer', label: 'Dibatalkan Pelanggan', className: 'bg-zinc-500' },
  { key: 'rejected_by_courier', label: 'Ditolak Kurir', className: 'bg-rose-500' },
  { key: 'rejected_by_customer', label: 'Harga Ditolak', className: 'bg-rose-400' },
] as const;

function statusMeta(key: string) {
  return STATUSES.find((s) => s.key === key) ?? { key, label: key, className: 'bg-zinc-400' };
}

function rupiah(value: string | null) {
  if (value === null) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `Rp${n.toLocaleString('id-ID')}`;
}

function fmtDateTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function AdminErrandsClient() {
  const [errands, setErrands] = useState<Errand[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const query = filter ? `?status=${filter}` : '';
    try {
      const res = await fetch(`${API_URL}/api/admin/errands${query}`, {
        cache: 'no-store',
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setErrands(data.errands ?? []);
        setCounts(data.counts ?? {});
      }
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
    // Live errands change on their own — a courier accepting or arriving moves a
    // row without anyone touching this page.
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter('')}
          className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
            filter === '' ? 'bg-foreground text-background' : 'hover:bg-muted'
          }`}
        >
          Semua {total}
        </button>
        {STATUSES.map((s) => (
          <button
            key={s.key}
            onClick={() => setFilter(s.key)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
              filter === s.key ? 'bg-foreground text-background' : 'hover:bg-muted'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${s.className}`} />
            {s.label} {counts[s.key] ?? 0}
          </button>
        ))}
        <button
          onClick={load}
          className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Perbarui
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="h-6 w-6 rounded-full border-2 border-orange-400 border-t-transparent"
          />
        </div>
      ) : errands.length === 0 ? (
        <div className="rounded-2xl border border-dashed py-16 text-center">
          <PackageSearch className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-semibold">Belum ada pesanan Tugas Kurir</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Pesanan muncul di sini begitu pelanggan menunjuk seorang kurir.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {errands.map((e) => {
            const meta = statusMeta(e.status);
            return (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-3 rounded-2xl border bg-background p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                      {fmtDateTime(e.createdAt)}
                    </p>
                    <p className="mt-0.5 text-lg font-black tabular-nums">{rupiah(e.price)}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold text-white ${meta.className}`}
                  >
                    {meta.label}
                  </span>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-emerald-100 text-[11px] font-black text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      {initials(e.customerName)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{e.customerName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        Pelanggan · {e.customerPhone ?? 'tanpa nomor'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-orange-100 text-[11px] font-black text-orange-700 dark:bg-orange-950 dark:text-orange-300">
                      <Bike className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{e.courierName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {e.courierPlate} · {e.courierPhone ?? 'tanpa nomor'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 break-words">
                    {e.destinationAddress ?? 'Tanpa alamat'}
                  </span>
                </div>

                {e.note ? (
                  <p className="rounded-xl bg-muted/40 px-3 py-2 text-xs">{e.note}</p>
                ) : null}

                {e.rejectedReason ? (
                  <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                    Alasan tolak: {e.rejectedReason}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-[11px] text-muted-foreground">
                  <span>Diterima {fmtDateTime(e.acceptedAt)}</span>
                  <span>Selesai {fmtDateTime(e.deliveredAt)}</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
