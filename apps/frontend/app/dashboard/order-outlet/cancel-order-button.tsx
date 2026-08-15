"use client";

import * as React from "react";
import { Loader2, Trash2 } from "lucide-react";
import { API_URL } from "@/lib/api-url";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const HOLD_MS = 5000;

function fmtIDR(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Cancel a cashier order: hold the button for five seconds, then confirm.
 *
 * The hold is the point. Cancelling reverses real money and puts stock back on
 * the shelf, and this button sits in a dense table row next to "Detail" — one
 * stray tap on a tablet at the counter should not be able to start that. Five
 * seconds of deliberate contact is hard to do by accident, and releasing early
 * aborts with nothing sent.
 *
 * The dialog after it is not redundant: the hold proves intent, the dialog
 * shows WHICH order and how much is about to be reversed, which is the part the
 * cashier actually needs to read before agreeing.
 */
export function CancelOrderButton({
  orderId,
  totalAmount,
  onCancelled,
}: {
  orderId: string;
  totalAmount: number;
  onCancelled: () => void;
}) {
  const [progress, setProgress] = React.useState(0); // 0..1
  const [holding, setHolding] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const rafRef = React.useRef<number | null>(null);
  const startRef = React.useRef(0);

  const stopHold = React.useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setHolding(false);
    setProgress(0);
  }, []);

  // Clean up on unmount — the row can disappear mid-hold when the table
  // refetches, and a live rAF loop calling setState after that warns.
  React.useEffect(() => stopHold, [stopHold]);

  const tick = React.useCallback(() => {
    const elapsed = Date.now() - startRef.current;
    const p = Math.min(1, elapsed / HOLD_MS);
    setProgress(p);
    if (p >= 1) {
      stopHold();
      setConfirmOpen(true);
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [stopHold]);

  const startHold = React.useCallback(() => {
    if (submitting) return;
    setError(null);
    startRef.current = Date.now();
    setHolding(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [submitting, tick]);

  const secondsLeft = Math.ceil((HOLD_MS * (1 - progress)) / 1000);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/orders/${orderId}/cancel`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Dibatalkan kasir" }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        setError(result.error ?? "Gagal membatalkan pesanan");
        return;
      }
      setConfirmOpen(false);
      onCancelled();
    } catch {
      setError("Gagal terhubung ke server");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={submitting}
        // Pointer events rather than mouse/touch pairs: one set of handlers
        // covers finger, stylus and mouse, and pointercancel fires when the
        // browser steals the gesture for a scroll — which must abort the hold,
        // not silently keep counting toward a confirmation the cashier can no
        // longer see.
        onPointerDown={startHold}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
        onContextMenu={(e) => e.preventDefault()}
        title="Tahan 5 detik untuk membatalkan pesanan"
        className="relative flex items-center gap-1 overflow-hidden rounded-md border border-red-200 px-2 py-1 text-xs font-bold text-red-600 transition-colors select-none hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-950"
      >
        {/* Fill sweeps left→right as the hold progresses. Behind the label, and
            pointer-events-none so it can never swallow the pointerup. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 bg-red-500/20"
          style={{ width: `${progress * 100}%` }}
        />
        <span className="relative flex items-center gap-1">
          {submitting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="h-3 w-3" />
          )}
          {holding ? `Tahan ${secondsLeft}s` : "Batalkan"}
        </span>
      </button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan pesanan ini?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Pesanan{" "}
                  <span className="font-black">
                    #{orderId.slice(-8).toUpperCase()}
                  </span>{" "}
                  senilai{" "}
                  <span className="font-black">{fmtIDR(totalAmount)}</span> akan
                  dibatalkan.
                </p>
                <p>
                  Stok akan dikembalikan, dan uangnya dicatat sebagai kas keluar
                  &ldquo;Pembatalan Order Kasir&rdquo;. Pesanan aslinya tetap
                  tersimpan di riwayat!. Tindakan ini tidak bisa dibatalkan.
                </p>
                {error && (
                  <p className="font-bold text-destructive">{error}</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Kembali</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              // Not a submit-and-close: the dialog stays open on failure so the
              // error above is readable.
              onClick={(e) => {
                e.preventDefault();
                submit();
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {submitting ? "Membatalkan…" : "Ya, batalkan"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
