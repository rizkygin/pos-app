'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ClipboardCheck,
  DoorOpen,
  Loader2,
  Lock,
  LockKeyhole,
  Sparkles,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { API_URL } from '@/lib/api-url';
import {
  ShiftReportModal,
  type ShiftReport,
} from '@/components/dashboard/shift-report-modal';

/**
 * The shift strip above the product grid: open the drawer, watch it fill, close
 * it against a count.
 *
 * It shows the running expected cash while the shift is open, which is the
 * whole reason it lives on the cashier screen rather than behind a menu. A
 * cashier who only ever sees that number at closing time has no way to notice a
 * discrepancy while the mistake is still findable.
 *
 * Selling without an open shift is allowed — the bar nags, it does not block.
 * Blocking the till because someone forgot to tap a button is how a feature
 * gets switched off for good, and the sale still has to happen either way.
 */

const fmt = (n: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(n);

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

/** Digits only, so a typed "Rp 200.000" still parses to 200000. */
const digits = (s: string) => s.replace(/\D/g, '');

type Props = {
  /** Falls back onto the shift row when the cashier doesn't type a name. */
  cashierName: string;
  /**
   * Bumped by the cashier screen after each checkout, so the running drawer
   * total reflects the sale that was just rung up. Polling would work too and
   * cost a request every few seconds on a screen that is open all day.
   */
  refreshSignal?: number;
  /**
   * Whether the plan includes shifts (Max Lite and up). Passed from the page's
   * server render so the strip never flashes "Buka Shift" at a merchant who
   * can't use it. The backend enforces it again on /api/shifts/open.
   *
   * Only OPENING is gated. A shift that was already open when the plan changed
   * still renders in full, with its Tutup Shift button, so the drawer can
   * always be counted and closed. /api/shifts/current re-states this as
   * `canOpen` for the same reason.
   */
  canUseShift: boolean;
};

export function ShiftBar({
  cashierName,
  refreshSignal = 0,
  canUseShift,
}: Props) {
  const [shift, setShift] = useState<ShiftReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<'open' | 'close' | null>(null);
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [floatInput, setFloatInput] = useState('');
  const [countInput, setCountInput] = useState('');
  const [noteInput, setNoteInput] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/shifts/current`, {
        credentials: 'include',
      });
      if (!res.ok) {
        setShift(null);
        return;
      }
      const body = await res.json();
      setShift(body.shift ?? null);
    } catch {
      // Offline or backend down. The bar goes quiet rather than throwing a
      // dialog over a screen someone is trying to sell from.
      setShift(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Still loaded when the feature is off: an outlet that downgraded with a
    // shift open must keep seeing it until someone closes it.
    load();
  }, [load, refreshSignal]);

  const openShift = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/shifts/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          openingFloat: Number(digits(floatInput) || '0'),
          cashierName,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409 carries the shift that already exists, so a second tap lands the
        // cashier on the running shift instead of an error they can't act on.
        if (body?.shift) setShift(body.shift);
        setError(body?.error ?? 'Gagal membuka shift');
        return;
      }
      setShift(body.shift);
      setDialog(null);
      setFloatInput('');
    } catch {
      setError('Tidak bisa menghubungi server');
    } finally {
      setSubmitting(false);
    }
  };

  const closeShift = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/shifts/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          countedCash: Number(digits(countInput) || '0'),
          note: noteInput.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? 'Gagal menutup shift');
        return;
      }
      setShift(null);
      setDialog(null);
      setCountInput('');
      setNoteInput('');
      // Straight to the slip: closing a shift without printing the report is
      // the one outcome this whole flow exists to prevent.
      setReport(body.shift);
    } catch {
      setError('Tidak bisa menghubungi server');
    } finally {
      setSubmitting(false);
    }
  };

  const expected = shift?.drawer.expectedCash ?? 0;
  const counted = Number(digits(countInput) || '0');
  const variance = counted - expected;

  return (
    <>
      {loading ? null : shift ? (
        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs dark:border-emerald-900 dark:bg-emerald-950/40">
          <span className="flex items-center gap-1.5 font-bold text-emerald-700 dark:text-emerald-400">
            <DoorOpen className="h-3.5 w-3.5" />
            Shift #{shift.shift.id}
          </span>
          <span className="text-emerald-800/70 dark:text-emerald-300/70">
            {shift.shift.cashierName} &middot; buka {fmtTime(shift.shift.openedAt)}
          </span>
          <span className="flex items-center gap-1 font-semibold text-emerald-800 dark:text-emerald-300">
            <Wallet className="h-3.5 w-3.5" />
            Laci {fmt(expected)}
          </span>
          {/* Flagged while the shift is still running, not just at closing:
              a cashier who only learns at 22:00 that a tenth of the till isn't
              theirs has already been reconciling against the wrong number all
              day. */}
          {shift.drawer.taxInDrawer > 0 && (
            <span className="text-emerald-800/70 dark:text-emerald-300/70">
              (pajak {fmt(shift.drawer.taxInDrawer)})
            </span>
          )}
          <span className="text-emerald-800/70 dark:text-emerald-300/70">
            {shift.revenue.orderCount} transaksi
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => setReport(shift)}
              className="rounded-lg border border-emerald-300 px-2.5 py-1 font-bold text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
            >
              <ClipboardCheck className="mr-1 inline h-3.5 w-3.5" />
              Ringkasan
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setCountInput('');
                setDialog('close');
              }}
              className="rounded-lg bg-emerald-600 px-2.5 py-1 font-bold text-white transition-colors hover:bg-emerald-700"
            >
              <LockKeyhole className="mr-1 inline h-3.5 w-3.5" />
              Tutup Shift
            </button>
          </div>
        </div>
      ) : !canUseShift ? (
        // No shift open and the plan doesn't include them: say what the feature
        // is and where to get it, rather than showing a button that 403s.
        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-muted/50 px-3 py-1.5 text-xs">
          <span className="flex items-center gap-1.5 font-bold text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            Buka Shift
          </span>
          <span className="text-muted-foreground">
            Modal awal, hitung laci, dan laporan penutupan shift tersedia mulai
            paket Max Lite.
          </span>
          <Link
            href="/dashboard/subscription"
            className="ml-auto flex items-center gap-1 rounded-lg bg-foreground px-2.5 py-1 font-bold text-background transition-opacity hover:opacity-90"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Upgrade
          </Link>
        </div>
      ) : (
        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs dark:border-amber-900 dark:bg-amber-950/40">
          <span className="flex items-center gap-1.5 font-bold text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            Shift belum dibuka
          </span>
          <span className="text-amber-800/70 dark:text-amber-300/70">
            Penjualan tetap bisa diproses, tapi tidak masuk laporan penutupan.
          </span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setFloatInput('');
              setDialog('open');
            }}
            className="ml-auto rounded-lg bg-amber-600 px-2.5 py-1 font-bold text-white transition-colors hover:bg-amber-700"
          >
            <DoorOpen className="mr-1 inline h-3.5 w-3.5" />
            Buka Shift
          </button>
        </div>
      )}

      {dialog === 'open' && (
        <Dialog title="Buka Shift" onClose={() => setDialog(null)}>
          <p className="mb-3 text-xs text-muted-foreground">
            Masukkan uang modal yang ada di laci saat shift dimulai. Modal awal
            tidak dihitung sebagai pemasukan — hanya sebagai saldo pembuka laci.
          </p>
          <label className="mb-1 block text-xs font-semibold">Modal Awal</label>
          <input
            autoFocus
            type="text"
            inputMode="numeric"
            value={floatInput ? fmt(Number(digits(floatInput))) : ''}
            onChange={(e) => setFloatInput(digits(e.target.value))}
            placeholder="Rp 0"
            className="mb-3 h-11 w-full rounded-xl border bg-background px-3 text-right text-base font-bold outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && <p className="mb-2 text-xs font-semibold text-rose-600">{error}</p>}
          <DialogActions
            confirmLabel="Buka Shift"
            submitting={submitting}
            onCancel={() => setDialog(null)}
            onConfirm={openShift}
          />
        </Dialog>
      )}

      {dialog === 'close' && shift && (
        <Dialog title="Tutup Shift" onClose={() => setDialog(null)}>
          <div className="mb-3 space-y-1 rounded-xl bg-muted/40 p-3 text-xs">
            <Line label="Modal Awal" value={fmt(shift.drawer.openingFloat)} />
            <Line label="Tunai Masuk" value={fmt(shift.drawer.cashIn)} />
            <Line label="Tunai Keluar" value={`-${fmt(shift.drawer.cashOut)}`} />
            <div className="border-t pt-1">
              <Line label="Seharusnya di laci" value={fmt(expected)} strong />
            </div>
            {/* What the count is actually made of.
                Under exclusive pricing the customer hands over the tax as well,
                so it is physically in the drawer — the count still has to match
                "Seharusnya di laci" exactly, but part of that money is not the
                shop's. Without this split the cashier reconciles to zero and
                still can't tell how much to set aside, which reads as the
                drawer being permanently wrong. */}
            {shift.drawer.taxInDrawer > 0 && (
              <div className="mt-1 space-y-1 border-t pt-1 text-muted-foreground">
                <Line
                  label="• Pajak (disetor)"
                  value={fmt(shift.drawer.taxInDrawer)}
                />
                <Line
                  label="• Uang toko"
                  value={fmt(expected - shift.drawer.taxInDrawer)}
                />
              </div>
            )}
          </div>

          <label className="mb-1 block text-xs font-semibold">
            Uang fisik yang dihitung
          </label>
          <input
            autoFocus
            type="text"
            inputMode="numeric"
            value={countInput ? fmt(counted) : ''}
            onChange={(e) => setCountInput(digits(e.target.value))}
            placeholder="Rp 0"
            className="h-11 w-full rounded-xl border bg-background px-3 text-right text-base font-bold outline-none focus:ring-2 focus:ring-blue-500"
          />
          {/* Shown live, before the shift is committed: a cashier who sees the
              gap while the drawer is still open can go and find the mistake. */}
          {countInput !== '' && (
            <p
              className={`mt-2 text-center text-sm font-bold ${
                variance === 0
                  ? 'text-emerald-600'
                  : variance < 0
                    ? 'text-rose-600'
                    : 'text-amber-600'
              }`}
            >
              {variance === 0
                ? 'Cocok — tidak ada selisih'
                : `Selisih ${variance > 0 ? '+' : ''}${fmt(variance)} (${
                    variance < 0 ? 'kurang' : 'lebih'
                  })`}
            </p>
          )}

          <label className="mt-3 mb-1 block text-xs font-semibold">
            Catatan (opsional)
          </label>
          <textarea
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value.slice(0, 255))}
            rows={2}
            placeholder="Contoh: selisih karena kembalian kurang"
            className="mb-3 w-full resize-none rounded-xl border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && <p className="mb-2 text-xs font-semibold text-rose-600">{error}</p>}
          <DialogActions
            confirmLabel="Tutup & Cetak"
            submitting={submitting}
            disabled={countInput === ''}
            onCancel={() => setDialog(null)}
            onConfirm={closeShift}
          />
        </Dialog>
      )}

      {report && (
        <ShiftReportModal report={report} onClose={() => setReport(null)} />
      )}
    </>
  );
}

function Line({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className={`flex justify-between ${strong ? 'font-bold' : ''}`}>
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-background p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground"
            aria-label="Tutup"
          >
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DialogActions({
  confirmLabel,
  submitting,
  disabled,
  onCancel,
  onConfirm,
}: {
  confirmLabel: string;
  submitting: boolean;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="h-11 flex-1 rounded-xl border-2 text-sm font-bold text-muted-foreground transition-colors hover:bg-muted"
      >
        Batal
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={submitting || disabled}
        className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {confirmLabel}
      </button>
    </div>
  );
}
