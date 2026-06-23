'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type { RouteMap } from './route-map';

const RouteMapDynamic = dynamic(
  () => import('./route-map').then((m) => m.RouteMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full rounded-2xl bg-muted animate-pulse" />
    ),
  },
);

export function RouteMapClient(props: ComponentProps<typeof RouteMap>) {
  return <RouteMapDynamic {...props} />;
}
