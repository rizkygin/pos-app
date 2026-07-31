'use client';

import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { API_URL } from '@/lib/api-url';

type Point = { lat: number; lon: number };

const courierIcon = L.divIcon({
  className: '',
  // divIcon rather than an image marker: this needs a pulsing halo, and a PNG
  // can't do that. The inner dot keeps a hard edge so the exact position stays
  // readable while the halo animates around it.
  html: `
    <span style="position:relative;display:block;width:22px;height:22px">
      <span style="position:absolute;inset:0;border-radius:9999px;background:#06b6d4;opacity:.35;animation:courier-ping 1.8s cubic-bezier(0,0,.2,1) infinite"></span>
      <span style="position:absolute;inset:4px;border-radius:9999px;background:#0891b2;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>
    </span>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

const homeIcon = L.divIcon({
  className: '',
  html: `
    <span style="display:block;width:18px;height:18px;border-radius:9999px;background:#e11d48;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

/**
 * Keeps both the courier and the destination on screen.
 *
 * Refits whenever the courier moves rather than following them: a map that pans
 * to keep one marker centred loses the destination, and "how much further" is
 * the entire question being asked.
 */
function FitBoth({ a, b }: { a: [number, number]; b: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(L.latLngBounds([a, b]), { padding: [48, 48], maxZoom: 16 });
  }, [map, a[0], a[1], b[0], b[1]]);
  return null;
}

/**
 * Live courier tracking.
 *
 * The courier's device reports every 30 seconds, so raw updates would make the
 * marker teleport four or five blocks at a time. Each new position is instead
 * eased toward over ~2s, which reads as movement rather than a jump — the
 * position shown is always one the courier genuinely occupied, just reached
 * smoothly.
 */
export function DeliveryTrackingMap({
  courier,
  destination,
  className = '',
}: {
  courier: Point;
  destination: Point;
  className?: string;
}) {
  // Where the marker is drawn right now, mid-tween.
  const [drawn, setDrawn] = useState<[number, number]>([courier.lat, courier.lon]);
  const [route, setRoute] = useState<[number, number][]>([]);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const from = drawn;
    const to: [number, number] = [courier.lat, courier.lon];
    const DURATION = 2000;
    const start = performance.now();

    // Straight-line tween between reports. Not the road path: interpolating
    // along the polyline would imply knowledge of where they were at each
    // instant, which nobody has.
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      // easeOutCubic — decelerates into the new point, so it settles rather
      // than stopping dead.
      const e = 1 - Math.pow(1 - t, 3);
      setDrawn([from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e]);
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
    // Only re-tween on a genuinely new position — `drawn` is deliberately not a
    // dependency or every animation frame would restart the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courier.lat, courier.lon]);

  useEffect(() => {
    let cancelled = false;
    fetch(
      `${API_URL}/api/route?from=${courier.lat},${courier.lon}&to=${destination.lat},${destination.lon}`,
      { credentials: 'include' },
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data?.success || !Array.isArray(data.geometry)) return;
        setRoute(data.geometry);
      })
      .catch(() => {
        // No route line is fine — the two markers still tell the story.
      });
    return () => {
      cancelled = true;
    };
  }, [courier.lat, courier.lon, destination.lat, destination.lon]);

  const home: [number, number] = [destination.lat, destination.lon];

  return (
    <div className={className}>
      <style>{`@keyframes courier-ping{75%,100%{transform:scale(2.2);opacity:0}}`}</style>
      <MapContainer
        center={drawn}
        zoom={15}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%', borderRadius: '1rem', zIndex: 0 }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {route.length > 1 && (
          <Polyline positions={route} pathOptions={{ color: '#0891b2', weight: 4, opacity: 0.7 }} />
        )}
        <Marker position={home} icon={homeIcon} />
        <Marker position={drawn} icon={courierIcon} />
        <FitBoth a={drawn} b={home} />
      </MapContainer>
    </div>
  );
}
