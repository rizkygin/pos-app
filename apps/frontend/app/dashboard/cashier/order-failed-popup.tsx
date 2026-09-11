'use client';

import { useEffect, useId, useRef } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The failure counterpart of OrderPlacedFlash.
 *
 * Unlike that card this one waits to be dismissed. A checkout that didn't go
 * through is the one outcome the cashier must not miss, and it used to arrive
 * as a native alert() — which at least blocked; a card that faded out on its
 * own would be easy to talk over with a customer at the counter.
 *
 * Retry is offered only where the caller says trying again can help. It is
 * always safe to offer: the checkout carries the tab's idempotency key, so a
 * retry of a sale the server did commit replays it rather than booking twice.
 */

type OrderFailedPopupProps = {
  title: string;
  message: string;
  /** Raw reason (server / network text), shown small beneath the message. */
  detail?: string;
  onRetry?: () => void;
  onClose: () => void;
};

export function OrderFailedPopup({
  title,
  message,
  detail,
  onRetry,
  onClose,
}: OrderFailedPopupProps) {
  const titleId = useId();
  const messageId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);

  // Focus the likely next step, so Enter answers the card and a scanner or
  // keyboard doesn't keep typing into whatever field sat behind it. Hand focus
  // back on the way out.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    primaryRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
        className="placed-pop w-full max-w-80 rounded-[20px] bg-card p-6 text-center text-card-foreground shadow-2xl"
      >
        <div className="failed-shake relative mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400">
          <span
            aria-hidden
            className="placed-ring absolute inset-0 rounded-full border-2 border-red-600"
          />
          <X className="h-8 w-8" strokeWidth={3} />
        </div>
        <p
          id={titleId}
          className="mt-4 text-[19px] font-extrabold text-red-700 dark:text-red-400"
        >
          {title}
        </p>
        <p
          id={messageId}
          className="mt-1 whitespace-pre-line text-[13px] text-muted-foreground"
        >
          {message}
        </p>
        {detail && (
          <p className="mt-3 break-words rounded-lg bg-muted px-3 py-2 text-left font-mono text-[11px] text-muted-foreground">
            {detail}
          </p>
        )}
        <div className="mt-5 flex gap-2">
          <Button
            ref={onRetry ? undefined : primaryRef}
            type="button"
            variant="outline"
            className="h-10 flex-1"
            onClick={onClose}
          >
            Tutup
          </Button>
          {onRetry && (
            <Button
              ref={primaryRef}
              type="button"
              className="h-10 flex-1"
              onClick={onRetry}
            >
              <RotateCcw className="h-4 w-4" />
              Coba Lagi
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
