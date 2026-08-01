'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'motion/react';
import { Store, Navigation, Clock, ArrowRight } from 'lucide-react';
import { resolveOutletImage, isBackendImage } from '@/lib/image-src';
import { OutletSchema, type Outlet } from '@/lib/types';
import { API_URL } from '@/lib/api-url';

// Enough to feel like a real choice, few enough to stay above the fold on a
// phone. The list is already ranked by travel time, so these are genuinely the
// nearest — not an arbitrary slice.
const SHOW = 6;

/**
 * Where an outlet's "order here" link should land.
 *
 * An outlet can offer several features; its own list decides which page opens,
 * the same rule "Pesan Lagi" uses. Falls back to food only when the outlet
 * somehow has none — that shouldn't happen now features are derived from
 * products, but a dead link would be worse than a wrong-tab one.
 */
function featureFor(outlet: Outlet): string {
  return outlet.features.find(Boolean) ?? 'food';
}

// Plain fetch, not react-query: this page sits ABOVE the QueryClientProvider,
// which only wraps /dashboard/order/[feature] and deeper. Mounting a second
// provider here would give one page two caches; a leaf component with a single
// request doesn't need either.
export function NearbyOutlets() {
  const [outlets, setOutlets] = useState<Outlet[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // credentials: the ranking is measured from the customer's saved address,
    // and without the cookie the backend can only fall back to rating order.
    fetch(`${API_URL}/api/get-all-outlet`, { credentials: 'include' })
      .then((r) => r.json())
      .then(({ data }) => {
        if (!cancelled) setOutlets(OutletSchema.array().parse(data));
      })
      .catch(() => {
        // Section simply doesn't render. A browse page must not break because
        // a supplementary list failed to load.
        if (!cancelled) setOutlets([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Closed outlets are excluded rather than greyed out: this section exists to
  // get someone ordering right now, and a shut shop is noise in that moment.
  // They're still reachable through the feature pages.
  const open = (outlets ?? []).filter((o) => o.isOpen).slice(0, SHOW);

  if (isLoading) {
    return (
      <section className="space-y-4">
        <div className="h-6 w-40 rounded-lg bg-muted animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 rounded-2xl bg-muted animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  // Nothing open: say so plainly rather than rendering an empty heading. An
  // empty section reads as a broken page; an absent one reads as nothing to
  // show, which is the truth.
  if (open.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Store className="h-5 w-5 text-rose-500" />
          <h2 className="font-black text-lg">Buka Sekarang di Dekat Pian</h2>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {open.map((outlet, i) => (
          <motion.div
            key={outlet.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <Link
              href={`/dashboard/order/${featureFor(outlet)}/${outlet.id}`}
              className="group flex gap-3 p-3 rounded-2xl border border-border/60 bg-card hover:border-rose-200 hover:shadow-md transition-all h-full"
            >
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-muted">
                <Image
                  src={resolveOutletImage(outlet.image)}
                  unoptimized={isBackendImage(outlet.image)}
                  alt={outlet.name}
                  fill
                  className="object-cover"
                />
              </div>

              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-bold text-sm leading-tight line-clamp-2 group-hover:text-rose-600 transition-colors">
                  {outlet.name}
                </p>

                {/* Distance and ETA are the reason this list is ordered the way
                    it is — showing them is what makes the order legible rather
                    than arbitrary. Both absent for signed-out visitors. */}
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
                  {outlet.distanceKm != null && (
                    <span className="flex items-center gap-1 font-semibold">
                      <Navigation className="h-3 w-3 text-rose-500" />
                      {outlet.distanceKm} km
                    </span>
                  )}
                  {outlet.estimatedTime && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-rose-500" />
                      {outlet.estimatedTime}
                    </span>
                  )}
                  {outlet.distanceKm == null && !outlet.estimatedTime && (
                    <span className="line-clamp-1">{outlet.address}</span>
                  )}
                </div>
              </div>

              <ArrowRight className="h-4 w-4 shrink-0 self-center text-muted-foreground/40 group-hover:text-rose-500 group-hover:translate-x-0.5 transition-all" />
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
