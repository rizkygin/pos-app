'use client';

/**
 * The question the owner answers BEFORE the server is asked anything.
 *
 * This popup is not decoration. The four segmented reports group orders by free
 * text stored inside orders.note, and the only thing keeping that affordable is
 * a bounded date window plus the expression indexes from migration 0059. So the
 * range is capped at MAX_RANGE_DAYS here as well as in the API — the client cap
 * is what stops the request from being made at all.
 */

import { useEffect, useState } from 'react';
import { X, CalendarRange } from 'lucide-react';
import { API_URL } from '@/lib/api-url';

// Must match MAX_RANGE_DAYS in apps/backend/src/routes/reports.ts.
export const MAX_RANGE_DAYS = 93;

export type ReportFilters = {
  from: string; // YYYY-MM-DD, inclusive
  to: string; // YYYY-MM-DD, exclusive (the day AFTER the last day shown)
  productId: string;
  menuGroupId: string;
  rating: string;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Last 30 days, ending tomorrow so today's sales are included. */
export function defaultFilters(): ReportFilters {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const start = new Date(now.getTime() - 29 * 86_400_000);
  return { from: iso(start), to: iso(tomorrow), productId: '', menuGroupId: '', rating: '' };
}

type Options = {
  products: { id: string; name: string; menuGroupId: number | null }[];
  menuGroups: { id: number; name: string }[];
};

const selectClass =
  'w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-500';

export function ReportFilterDialog({
  open,
  initial,
  onClose,
  onApply,
  // Invoices carry no rating, so the invoice report hides that row rather than
  // offering a filter the server would have to ignore.
  showRating = true,
}: {
  open: boolean;
  initial: ReportFilters;
  onClose: () => void;
  onApply: (f: ReportFilters) => void;
  showRating?: boolean;
}) {
  const [f, setF] = useState<ReportFilters>(initial);
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Option lists are fetched once, the first time the popup opens — they are
  // small and unchanged by the filters, so re-opening must not re-request them.
  useEffect(() => {
    if (!open || options) return;
    fetch(`${API_URL}/api/reports/filters`, { credentials: 'include', cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => j?.success && setOptions({ products: j.products, menuGroups: j.menuGroups }))
      .catch(() => {});
  }, [open, options]);

  useEffect(() => {
    if (open) setF(initial);
    // `initial` is a fresh object each render; keying off `open` is what makes
    // this "reset the form when the popup opens" rather than an update loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  // Narrowing to one product makes the menu-group filter meaningless (the
  // product already belongs to exactly one), so the two are shown as one choice.
  const products = f.menuGroupId
    ? (options?.products ?? []).filter((p) => String(p.menuGroupId ?? '') === f.menuGroupId)
    : options?.products ?? [];

  const submit = () => {
    const from = new Date(`${f.from}T00:00:00`);
    const to = new Date(`${f.to}T00:00:00`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return setError('Tanggal tidak valid');
    }
    if (to <= from) return setError('Tanggal akhir harus setelah tanggal mulai');
    if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
      return setError('Rentang maksimal 3 bulan — persempit tanggalnya.');
    }
    setError(null);
    onApply(f);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-3xl border border-border/60 bg-card p-5 shadow-2xl sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
              <CalendarRange className="size-4" />
            </span>
            <div>
              <h2 className="text-base font-black tracking-tight">Filter Laporan</h2>
              <p className="text-[11px] text-muted-foreground">Maksimal 3 bulan per laporan</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Dari</span>
              <input
                type="date"
                value={f.from}
                onChange={(e) => setF({ ...f, from: e.target.value })}
                className={`mt-1 ${selectClass}`}
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Sampai</span>
              <input
                type="date"
                value={f.to}
                onChange={(e) => setF({ ...f, to: e.target.value })}
                className={`mt-1 ${selectClass}`}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Menu Grup</span>
            <select
              value={f.menuGroupId}
              onChange={(e) => setF({ ...f, menuGroupId: e.target.value, productId: '' })}
              className={`mt-1 ${selectClass}`}
            >
              <option value="">Semua grup</option>
              {options?.menuGroups.map((g) => (
                <option key={g.id} value={String(g.id)}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Produk</span>
            <select
              value={f.productId}
              onChange={(e) => setF({ ...f, productId: e.target.value })}
              className={`mt-1 ${selectClass}`}
            >
              <option value="">Semua produk</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          {showRating && (
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Rating</span>
              <select
                value={f.rating}
                onChange={(e) => setF({ ...f, rating: e.target.value })}
                className={`mt-1 ${selectClass}`}
              >
                <option value="">Semua rating</option>
                {[5, 4, 3, 2, 1].map((r) => (
                  <option key={r} value={String(r)}>
                    {r} bintang
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {error && <p className="mt-3 text-xs font-bold text-destructive">{error}</p>}

        <button
          onClick={submit}
          className="mt-5 w-full rounded-2xl bg-indigo-600 py-3 text-sm font-black text-white shadow-lg shadow-indigo-500/25 hover:bg-indigo-700"
        >
          Tampilkan Laporan
        </button>
      </div>
    </div>
  );
}
