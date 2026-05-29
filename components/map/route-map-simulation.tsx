'use client';

import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const iconBase = {
  iconSize: [25, 41] as [number, number],
  iconAnchor: [12, 41] as [number, number],
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
};

const dropoffIcon = L.icon({
  ...iconBase,
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  iconRetinaUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
});

const courierIcon = L.icon({
  ...iconBase,
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  iconRetinaUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
});

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && positions.length === 2) {
      map.fitBounds(positions, { padding: [48, 48] });
      fitted.current = true;
    }
  }, [map, positions]);
  return null;
}

type Props = {
  pickup: { lat: number; lon: number };
  dropoff: { lat: number; lon: number };
  className?: string;
};

export function RouteMapSimulation({ pickup, dropoff, className }: Props) {
  const [route, setRoute] = useState<[number, number][]>([]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const url = `https://router.project-osrm.org/route/v1/driving/${pickup.lon},${pickup.lat};${dropoff.lon},${dropoff.lat}?geometries=geojson&overview=full`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        const coords: [number, number][] = (
          data.routes?.[0]?.geometry?.coordinates ?? []
        ).map(([lon, lat]: [number, number]) => [lat, lon]);
        setRoute(coords);
        setStep(0);
      })
      .catch(() => {
        setRoute([[pickup.lat, pickup.lon], [dropoff.lat, dropoff.lon]]);
      });
  }, [pickup.lat, pickup.lon, dropoff.lat, dropoff.lon]);

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setStep((s) => {
          if (s >= route.length - 1) {
            setPlaying(false);
            return s;
          }
          return s + 1;
        });
      }, 80);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing, route.length]);

  const courierPos: [number, number] | null = route[step] ?? null;
  const remainingRoute = route.slice(step);
  const travelledRoute = route.slice(0, step + 1);
  const bounds: [number, number][] = [[pickup.lat, pickup.lon], [dropoff.lat, dropoff.lon]];
  const done = step >= route.length - 1;

  const progress = route.length > 1 ? Math.round((step / (route.length - 1)) * 100) : 0;

  return (
    <div className="space-y-3">
      <MapContainer
        center={[pickup.lat, pickup.lon]}
        zoom={13}
        className={className ?? 'h-[500px] w-full rounded-2xl'}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />

        <Marker position={[dropoff.lat, dropoff.lon]} icon={dropoffIcon} title="Dropoff" />

        {courierPos && (
          <Marker position={courierPos} icon={courierIcon} title="Courier" />
        )}

        {travelledRoute.length > 1 && (
          <Polyline
            positions={travelledRoute}
            pathOptions={{ color: '#9ca3af', weight: 4, opacity: 0.5 }}
          />
        )}
        {remainingRoute.length > 1 && (
          <Polyline
            positions={remainingRoute}
            pathOptions={{ color: '#2563eb', weight: 4, opacity: 0.85 }}
          />
        )}

        <FitBounds positions={bounds} />
      </MapContainer>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => { setStep(0); setPlaying(false); }}
          className="px-4 py-2 rounded-xl border text-sm font-bold hover:bg-muted transition-colors"
        >
          Reset
        </button>
        <button
          disabled={route.length === 0 || done}
          onClick={() => setPlaying((p) => !p)}
          className="px-6 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          {playing ? 'Pause' : done ? 'Arrived' : 'Play'}
        </button>

        <div className="flex-1 flex items-center gap-2">
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-75"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs font-bold text-muted-foreground tabular-nums w-9 text-right">
            {progress}%
          </span>
        </div>
      </div>

      <div className="flex gap-3 text-xs font-bold">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full bg-red-500" /> Courier
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full bg-emerald-500" /> Dropoff
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-1 bg-blue-600 rounded" /> Remaining
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-1 bg-gray-400 rounded" /> Travelled
        </span>
      </div>
    </div>
  );
}
