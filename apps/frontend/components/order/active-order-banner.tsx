'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { ArrowRight, Bike } from 'lucide-react';
import { API_URL } from '@/lib/api-url';

type ActiveOrder = {
  id: string;
  status: string;
  outletName: string;
  fulfillment?: 'delivery' | 'service' | 'materials';
  etaMinutes?: number | null;
};

// Statuses where something is genuinely still happening. 'delivered' and
// 'cancelled' are finished, and a finished order has no business occupying the
// top of the page someone came to to order something new.
const IN_FLIGHT = ['pending', 'confirmed', 'preparing', 'ready', 'on_delivery'];

const LABEL: Record<string, string> = {
  pending: 'Menunggu konfirmasi outlet',
  confirmed: 'Sudah dikonfirmasi',
  preparing: 'Sedang disiapkan',
  ready: 'Siap, menunggu kurir',
  on_delivery: 'Dalam perjalanan',
};

/**
 * A strip linking to the order the customer already has in flight.
 *
 * Without it, someone with a live order who lands here has no path back to
 * tracking except guessing at the sidebar — and the most likely reason they
 * opened this page at all is to check on it.
 */
// Polled, but slowly. The tracking page itself refreshes every 2s; this is only
// a signpost, and hammering it from a browse page would be waste.
const POLL_MS = 30_000;

export function ActiveOrderBanner() {
  const [order, setOrder] = useState<ActiveOrder | null>(null);

  // Plain fetch rather than react-query: /dashboard/order sits above the
  // QueryClientProvider, which only wraps /dashboard/order/[feature] and below.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/api/get-active-order`, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setOrder(json?.success ? (json.order as ActiveOrder) : null);
      } catch {
        // Keep whatever was last shown. A dropped poll on a browse page isn't
        // worth tearing the banner down over — the next tick will correct it.
      }
    };

    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!order || !IN_FLIGHT.includes(order.status)) return null;

  // Jasa is tracked on its own surface, not /dashboard/activeorder.
  const href =
    order.fulfillment === 'service' ? '/dashboard/scheduled-order' : '/dashboard/activeorder';

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
      <Link
        href={href}
        className="group flex items-center gap-3 rounded-2xl border-2 border-cyan-400 bg-cyan-50 px-4 py-3 transition-colors hover:bg-cyan-100 dark:bg-cyan-950/30 dark:hover:bg-cyan-950/50"
      >
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-500/15">
          <span className="absolute inset-0 animate-ping rounded-xl bg-cyan-400/30" />
          <Bike className="relative h-4 w-4 text-cyan-700 dark:text-cyan-400" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-cyan-900 dark:text-cyan-300">
            Pesanan pian di {order.outletName} masih berjalan
          </p>
          <p className="text-xs text-cyan-700/80 dark:text-cyan-400/80">
            {LABEL[order.status] ?? 'Sedang diproses'}
            {order.etaMinutes != null && ` · perkiraan tiba ${order.etaMinutes} menit`}
          </p>
        </div>

        <ArrowRight className="h-4 w-4 shrink-0 text-cyan-600 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </motion.div>
  );
}
