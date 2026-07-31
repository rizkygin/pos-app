'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type { DeliveryTrackingMap } from './delivery-tracking-map';

// Leaflet touches `window` at import time, so the map must never be part of the
// server render — same pattern as the other map wrappers in this codebase.
const Dynamic = dynamic(
  () => import('./delivery-tracking-map').then((m) => m.DeliveryTrackingMap),
  {
    ssr: false,
    loading: () => <div className="h-full w-full rounded-2xl bg-muted animate-pulse" />,
  },
);

export function DeliveryTrackingMapClient(
  props: ComponentProps<typeof DeliveryTrackingMap>,
) {
  return <Dynamic {...props} />;
}
