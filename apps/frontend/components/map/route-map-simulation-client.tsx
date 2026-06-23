'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type { RouteMapSimulation } from './route-map-simulation';

const RouteMapSimulationDynamic = dynamic(
  () => import('./route-map-simulation').then((m) => m.RouteMapSimulation),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full rounded-xl bg-muted animate-pulse" />
    ),
  },
);

export function RouteMapSimulationClient(
  props: ComponentProps<typeof RouteMapSimulation>,
) {
  return <RouteMapSimulationDynamic {...props} />;
}
