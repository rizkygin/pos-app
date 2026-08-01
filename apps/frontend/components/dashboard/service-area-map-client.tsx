'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type { ServiceAreaMap } from './service-area-map';

// Leaflet touches `window` at import time, so it must stay out of the server
// render — same pattern as the other map wrappers here.
const Dynamic = dynamic(
    () => import('./service-area-map').then((m) => m.ServiceAreaMap),
    {
        ssr: false,
        loading: () => <div className="h-full w-full rounded-2xl bg-muted animate-pulse" />,
    },
);

export function ServiceAreaMapClient(props: ComponentProps<typeof ServiceAreaMap>) {
    return <Dynamic {...props} />;
}
