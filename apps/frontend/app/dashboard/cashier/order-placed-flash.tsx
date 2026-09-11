'use client';

import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';

/**
 * The beat between "the server has it" and the receipt modal.
 *
 * Checkout used to jump straight to the struk, which looks the same whether the
 * sale was just booked or the modal was opened for a reprint. This card says
 * the one thing the cashier is waiting to hear — it's recorded — and then gets
 * out of the way on its own. Nothing here is interactive.
 */

/** How long the card holds before the receipt takes over. Also the bar's fill. */
export const PLACED_HOLD_MS = 1400;

export function OrderPlacedFlash({ orderId }: { orderId: string }) {
  const shortId = orderId.split('-')[0].toUpperCase();

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/45 backdrop-blur-sm"
    >
      <div className="placed-pop w-75 rounded-[20px] bg-card p-6 text-center text-card-foreground shadow-2xl">
        <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-950/60 dark:text-green-400">
          <span
            aria-hidden
            className="placed-ring absolute inset-0 rounded-full border-2 border-green-600"
          />
          <Check className="placed-check h-8 w-8" strokeWidth={3} />
        </div>
        <p className="mt-4 text-[19px] font-extrabold text-green-700 dark:text-green-400">
          Order Placed
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Pesanan #{shortId} tercatat di server.
        </p>
        <div className="mt-5 h-1 overflow-hidden rounded-full bg-green-100 dark:bg-green-950/60">
          <div
            className="placed-progress h-full rounded-full bg-green-600"
            style={{ '--placed-hold': `${PLACED_HOLD_MS}ms` } as CSSProperties}
          />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Menyiapkan struk…</p>
      </div>
    </div>
  );
}
