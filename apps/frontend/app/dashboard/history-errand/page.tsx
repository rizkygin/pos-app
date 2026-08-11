'use client';

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bike,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  MessageCircle,
  NotepadText,
  Star,
  Truck,
  XCircle,
} from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { HistorySwitcher } from '@/components/history-switcher';

function fmtIDR(n: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Every errand status gets an entry, including the three that never became a
 * job. A customer looking for "what happened to that request" is most often
 * looking for exactly those, so they are labelled plainly rather than lumped
 * into one grey "batal".
 */
const STATUS_META: Record<
  string,
  { label: string; icon: typeof Clock; accent: string; text: string }
> = {
  pending: {
    label: 'Menunggu Jawaban',
    icon: Clock,
    accent: 'from-amber-400 to-orange-500',
    text: 'text-amber-600',
  },
  on_delivery: {
    label: 'Sedang Jalan',
    icon: Bike,
    accent: 'from-cyan-400 to-sky-500',
    text: 'text-cyan-600',
  },
  delivered: {
    label: 'Selesai',
    icon: CheckCircle2,
    accent: 'from-emerald-400 to-teal-500',
    text: 'text-emerald-600',
  },
  rejected_by_courier: {
    label: 'Ditolak Kurir',
    icon: XCircle,
    accent: 'from-rose-400 to-red-500',
    text: 'text-rose-600',
  },
  rejected_by_customer: {
    label: 'Harga Ditolak',
    icon: XCircle,
    accent: 'from-orange-400 to-rose-500',
    text: 'text-orange-600',
  },
  cancelled_by_customer: {
    label: 'Pian Batalkan',
    icon: XCircle,
    accent: 'from-slate-400 to-zinc-500',
    text: 'text-slate-600',
  },
};

type ErrandHistory = {
  id: string;
  status: string;
  note: string | null;
  price: string | null;
  rejectedReason: string | null;
  destinationAddress: string | null;
  createdAt: string;
  deliveredAt: string | null;
  courierName: string;
  courierPhone: string | null;
  courierPlate: string | null;
  rated: boolean;
  canRate: boolean;
};

function ErrandCard({ errand, index }: { errand: ErrandHistory; index: number }) {
  const meta = STATUS_META[errand.status] ?? STATUS_META.pending;
  const StatusIcon = meta.icon;
  const date = errand.createdAt
    ? format(new Date(errand.createdAt), 'd MMM yyyy • HH:mm', { locale: idLocale })
    : '-';
  const live = errand.status === 'pending' || errand.status === 'on_delivery';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className={`relative overflow-hidden rounded-3xl border bg-card shadow-sm ${
        errand.canRate
          ? 'border-amber-300 ring-2 ring-amber-200/60 dark:ring-amber-900/40'
          : 'border-border/60'
      }`}
    >
      <div className={`h-1.5 w-full bg-gradient-to-r ${meta.accent}`} />

      <div className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <div
            className={`flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${meta.accent} text-white shadow-lg`}
          >
            <Truck className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black">{errand.courierName}</p>
            <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <MapPin className="size-3 shrink-0" />
              #{errand.id.slice(-8).toUpperCase()} • {date}
            </p>
          </div>
          <div className="shrink-0 text-right">
            {/* No price until the courier quotes one. "Rp 0" would read as free,
                which is a different thing from "not agreed yet". */}
            <p className="text-base font-black tabular-nums">
              {errand.price ? fmtIDR(Number(errand.price)) : '—'}
            </p>
            <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${meta.text}`}>
              <StatusIcon className="size-3" />
              {meta.label}
            </span>
          </div>
        </div>

        {/* The note is the whole point of this screen — an errand has no product
            list, so what the customer typed IS the record of what they ordered. */}
        {errand.note ? (
          <div className="flex items-start gap-2 rounded-2xl bg-muted/60 px-3 py-2.5">
            <NotepadText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-sm leading-snug">{errand.note}</p>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-2xl bg-muted/40 px-3 py-2.5">
            <NotepadText className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />
            <p className="text-sm italic leading-snug text-muted-foreground">
              Tanpa catatan — kesepakatan lewat WhatsApp.
            </p>
          </div>
        )}

        {errand.destinationAddress && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <MapPin className="mt-0.5 size-3.5 shrink-0" />
            <span className="leading-snug">{errand.destinationAddress}</span>
          </p>
        )}

        {errand.rejectedReason && (
          <p className="rounded-2xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            <span className="font-bold">Alasan: </span>
            {errand.rejectedReason}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {live && (
            <Link
              href="/dashboard/activeorder"
              className="inline-flex items-center gap-1.5 rounded-full bg-rose-500 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-rose-600"
            >
              Lacak Sekarang
            </Link>
          )}
          {errand.canRate && (
            <Link
              href={`/dashboard/ratings/errand/${errand.id}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-amber-400 px-4 py-2 text-xs font-bold text-amber-950 transition-colors hover:bg-amber-300"
            >
              <Star className="size-3.5" />
              Beri Rating
            </Link>
          )}
          {errand.rated && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-2 text-xs font-bold text-muted-foreground">
              <Star className="size-3.5 fill-amber-400 text-amber-400" />
              Sudah dinilai
            </span>
          )}
          {errand.courierPhone && (
            <a
              href={`https://wa.me/${errand.courierPhone}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-bold transition-colors hover:bg-accent"
            >
              <MessageCircle className="size-3.5" />
              WhatsApp
            </a>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function HistoryErrandPage() {
  const [errands, setErrands] = useState<ErrandHistory[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/errands/history`, {
        cache: 'no-store',
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) setErrands(data.errands);
    } catch {
      // Leave whatever is on screen; this is a read-only list.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    // pb-28 clears the fixed bottom nav on portrait phones — without it the last
    // card sits under the tab bar and cannot be scrolled into view.
    <main className="mx-auto max-w-3xl px-4 pb-28 pt-6 md:px-6 md:pb-12">
      <header className="mb-5">
        <h1 className="text-2xl font-black">Riwayat Tugas Kurir</h1>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Semua tugas pian, termasuk yang ditolak atau dibatalkan.
        </p>
        <HistorySwitcher active="errand" />
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : errands.length === 0 ? (
        <div className="rounded-3xl border border-dashed p-10 text-center">
          <Truck className="mx-auto size-10 text-muted-foreground" />
          <p className="mt-3 font-bold">Belum Pernah Menugaskan Kurir</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Pian belum pernah menugaskan kurir. Coba sekali, harganya nego langsung
            sama kurirnya.
          </p>
          <Link
            href="/dashboard/suruh-kurir"
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-rose-500 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-rose-600"
          >
            Tugaskan Kurir Sekarang
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <AnimatePresence mode="popLayout">
            {errands.map((e, i) => (
              <ErrandCard key={e.id} errand={e} index={i} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </main>
  );
}
