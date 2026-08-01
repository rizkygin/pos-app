'use client';

import { useMemo } from 'react';
import { MapContainer, TileLayer, Circle, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { haversineKm } from '@/lib/haversine';

export type PlottedOutlet = {
  id: number;
  name: string;
  lat: number;
  lon: number;
  isOpen: boolean;
  /** Stored flag — may differ from the circle when an admin has overridden it. */
  reachable: boolean;
};

const centerIcon = L.divIcon({
  className: '',
  html: `<span style="display:block;width:20px;height:20px;border-radius:9999px;background:#2563eb;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45)"></span>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

// Covered vs stranded outlets are drawn in different colours rather than the
// same pin, because "which of my shops would this cut off" is the whole reason
// an admin looks at this map before saving.
const outletIcon = (covered: boolean) =>
  L.divIcon({
    className: '',
    html: `<span style="display:block;width:11px;height:11px;border-radius:9999px;background:${
      covered ? '#059669' : '#e11d48'
    };border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></span>`,
    iconSize: [11, 11],
    iconAnchor: [5.5, 5.5],
  });

function ClickToSetCenter({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Refits when the radius changes so the whole circle stays visible — growing it
// past the viewport would otherwise silently hide the part that matters.
function FitRadius({ lat, lon, radiusKm }: { lat: number; lon: number; radiusKm: number }) {
  const map = useMap();
  useMemo(() => {
    const bounds = L.latLng(lat, lon).toBounds(radiusKm * 2000);
    map.fitBounds(bounds, { padding: [24, 24] });
    // Intentionally not reacting to pan/zoom — only to an actual centre or
    // radius change, so the admin can look around without being snapped back.
  }, [lat, lon, radiusKm, map]);
  return null;
}

/**
 * Courier coverage editor.
 *
 * Click anywhere to move the centre. The circle is straight-line distance,
 * matching how the backend decides whether an owner may register — an admin
 * drawing a 50 km circle means the circle they can see.
 */
export function ServiceAreaMap({
  center,
  radiusKm,
  outlets,
  onPick,
  className = '',
}: {
  center: { lat: number; lon: number };
  radiusKm: number;
  outlets: PlottedOutlet[];
  onPick: (lat: number, lon: number) => void;
  className?: string;
}) {
  const plotted = useMemo(
    () =>
      outlets.map((o) => ({
        ...o,
        covered: haversineKm(o.lat, o.lon, center.lat, center.lon) <= radiusKm,
      })),
    [outlets, center.lat, center.lon, radiusKm],
  );

  return (
    <div className={className}>
      <MapContainer
        center={[center.lat, center.lon]}
        zoom={10}
        style={{ height: '100%', width: '100%', borderRadius: '1rem', zIndex: 0 }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <Circle
          center={[center.lat, center.lon]}
          radius={radiusKm * 1000}
          pathOptions={{ color: '#2563eb', weight: 2, fillColor: '#3b82f6', fillOpacity: 0.12 }}
        />

        {plotted.map((o) => (
          <Marker key={o.id} position={[o.lat, o.lon]} icon={outletIcon(o.covered)} />
        ))}

        <Marker position={[center.lat, center.lon]} icon={centerIcon} />

        <ClickToSetCenter onPick={onPick} />
        <FitRadius lat={center.lat} lon={center.lon} radiusKm={radiusKm} />
      </MapContainer>
    </div>
  );
}
