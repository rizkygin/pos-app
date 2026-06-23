import { RouteMapSimulationClient } from '@/components/map/route-map-simulation-client';

const SAMPLE_PICKUP  = { lat: -6.1751, lon: 106.8650, label: 'Restoran Padang (Pickup)' };
const SAMPLE_DROPOFF = { lat: -6.2146, lon: 106.8451, label: 'Jl. Sudirman No.45 (Dropoff)' };

export default function MapSamplePage() {
  return (
    <div className="mx-4 md:mx-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-black">Route Map — Simulation</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Press <strong>Play</strong> to simulate the courier moving along the road toward the dropoff.
        </p>
      </div>

      <div className="rounded-2xl border p-4 shadow-sm bg-card">
        <RouteMapSimulationClient pickup={SAMPLE_PICKUP} dropoff={SAMPLE_DROPOFF} className="h-[500px] w-full rounded-xl" />
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="p-4 rounded-xl border bg-red-50">
          <p className="font-black text-red-700 text-xs uppercase tracking-widest mb-1">Courier starts at</p>
          <p className="font-bold">{SAMPLE_PICKUP.label}</p>
          <p className="text-muted-foreground text-xs mt-0.5">{SAMPLE_PICKUP.lat}, {SAMPLE_PICKUP.lon}</p>
        </div>
        <div className="p-4 rounded-xl border bg-emerald-50">
          <p className="font-black text-emerald-700 text-xs uppercase tracking-widest mb-1">Dropoff</p>
          <p className="font-bold">{SAMPLE_DROPOFF.label}</p>
          <p className="text-muted-foreground text-xs mt-0.5">{SAMPLE_DROPOFF.lat}, {SAMPLE_DROPOFF.lon}</p>
        </div>
      </div>
    </div>
  );
}
