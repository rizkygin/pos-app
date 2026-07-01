'use client';

import { useState } from 'react';
import { X, Loader2, CalendarClock, Wrench } from 'lucide-react';
import {
  confirmServiceOrder,
  scheduleServiceOrder,
} from '@/app/dashboard/activeorder/actions';

function fmtIDR(amount: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

// Owner accepts a pending service order: pick the price within the product's
// range, set the appointment time, and optionally apply a discount. Runs
// confirm-service (sets the agreed price) then schedule-service (date + discount)
// so the order moves pending -> confirmed -> preparing in one action.
export function ServiceConfirmModal({
  orderId,
  productName,
  lowest,
  highest,
  onClose,
  onDone,
}: {
  orderId: string;
  productName: string;
  lowest: number;
  highest: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [price, setPrice] = useState(lowest);
  const [scheduledAt, setScheduledAt] = useState('');
  const [discountMode, setDiscountMode] = useState<'amount' | 'percent'>('amount');
  const [discountValue, setDiscountValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const discountNum = Number(discountValue) || 0;
  const discountRp =
    discountMode === 'percent'
      ? Math.round((price * discountNum) / 100)
      : Math.round(discountNum);
  const net = Math.max(0, price - discountRp);

  const submit = async () => {
    setError('');
    if (!scheduledAt) {
      setError('Tentukan tanggal & jam layanan.');
      return;
    }
    if (price < lowest || price > highest) {
      setError(`Harga harus di antara ${fmtIDR(lowest)} dan ${fmtIDR(highest)}.`);
      return;
    }
    setSubmitting(true);
    try {
      await confirmServiceOrder(orderId, price);
      await scheduleServiceOrder(
        orderId,
        new Date(scheduledAt).toISOString(),
        discountMode === 'percent'
          ? { discount_percent: discountNum }
          : { discount_amount: discountNum },
      );
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memproses order');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-background p-5 space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
              <Wrench className="h-4 w-4" />
            </span>
            <div>
              <p className="font-black text-sm">Terima Layanan</p>
              <p className="text-xs text-muted-foreground line-clamp-1">{productName}</p>
            </div>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Price slider within range */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Harga
            </label>
            <span className="text-lg font-black text-blue-600 tabular-nums">{fmtIDR(price)}</span>
          </div>
          <input
            type="range"
            min={lowest}
            max={highest}
            step={Math.max(1, Math.round((highest - lowest) / 100))}
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            className="w-full accent-blue-600"
          />
          <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
            <span>{fmtIDR(lowest)}</span>
            <span>{fmtIDR(highest)}</span>
          </div>
          <input
            type="number"
            value={price}
            min={lowest}
            max={highest}
            onChange={(e) => setPrice(Number(e.target.value))}
            className="w-full h-11 rounded-xl border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Schedule */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" /> Jadwal Layanan
          </label>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="w-full h-11 rounded-xl border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Discount */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Diskon (opsional)
          </label>
          <div className="flex gap-2">
            <div className="flex rounded-xl border border-input overflow-hidden">
              <button
                type="button"
                onClick={() => setDiscountMode('amount')}
                className={`px-3 text-sm font-bold ${discountMode === 'amount' ? 'bg-blue-600 text-white' : 'text-muted-foreground'}`}
              >
                Rp
              </button>
              <button
                type="button"
                onClick={() => setDiscountMode('percent')}
                className={`px-3 text-sm font-bold ${discountMode === 'percent' ? 'bg-blue-600 text-white' : 'text-muted-foreground'}`}
              >
                %
              </button>
            </div>
            <input
              type="number"
              min={0}
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              placeholder={discountMode === 'percent' ? '10' : '0'}
              className="flex-1 h-11 rounded-xl border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Summary */}
        <div className="rounded-xl bg-muted/40 p-3 text-sm space-y-1">
          <div className="flex justify-between text-muted-foreground">
            <span>Harga</span>
            <span className="tabular-nums">{fmtIDR(price)}</span>
          </div>
          {discountRp > 0 && (
            <div className="flex justify-between text-emerald-600">
              <span>Diskon</span>
              <span className="tabular-nums">-{fmtIDR(discountRp)}</span>
            </div>
          )}
          <div className="flex justify-between font-black pt-1 border-t border-border/50">
            <span>Total</span>
            <span className="tabular-nums text-blue-600">{fmtIDR(net)}</span>
          </div>
        </div>

        {error && <p className="text-xs font-medium text-rose-600">{error}</p>}

        <button
          onClick={submit}
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {submitting ? 'Memproses...' : 'Terima & Jadwalkan'}
        </button>
      </div>
    </div>
  );
}
