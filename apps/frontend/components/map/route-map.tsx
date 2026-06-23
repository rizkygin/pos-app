'use client';

import { useEffect, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const iconBase = {
  iconSize: [25, 41] as [number, number],
  iconAnchor: [12, 41] as [number, number],
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
};

const pickupIcon = L.icon({
  ...iconBase,
  iconUrl:
    'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png',
  iconRetinaUrl:
    'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
});

const dropoffIcon = L.icon({
  ...iconBase,
  iconUrl:
    'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  iconRetinaUrl:
    'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
});

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length === 2) {
      map.fitBounds(positions, { padding: [48, 48] });
    }
  }, [map, positions]);
  return null;
}

type Props = {
  pickup: { lat: number; lon: number; label?: string };
  dropoff: { lat: number; lon: number; label?: string };
  className?: string;
};

export function RouteMap({ pickup, dropoff, className }: Props) {
  const [route, setRoute] = useState<[number, number][]>([]);

  useEffect(() => {
    const url = `https://router.project-osrm.org/route/v1/driving/${pickup.lon},${pickup.lat};${dropoff.lon},${dropoff.lat}?geometries=geojson&overview=full`;

    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        console.log(data);
        const coords: [number, number][] =
          data.routes?.[0]?.geometry?.coordinates?.map(
            ([lon, lat]: [number, number]) => [lat, lon],
          ) ?? [];
        setRoute(coords);
      })
      .catch(() => {
        // fallback: straight line if OSRM fails
        setRoute([
          [pickup.lat, pickup.lon],
          [dropoff.lat, dropoff.lon],
        ]);
      });
  }, [pickup.lat, pickup.lon, dropoff.lat, dropoff.lon]);

  const positions: [number, number][] = [
    [pickup.lat, pickup.lon],
    [dropoff.lat, dropoff.lon],
  ];

  return (
    <MapContainer
      center={[pickup.lat, pickup.lon]}
      zoom={13}
      className={className ?? 'h-[400px] w-full rounded-2xl'}
      zoomControl={true}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />

      <Marker
        position={[pickup.lat, pickup.lon]}
        icon={pickupIcon}
        title={pickup.label ?? 'Pickup'}
      />
      <Marker
        position={[dropoff.lat, dropoff.lon]}
        icon={dropoffIcon}
        title={dropoff.label ?? 'Dropoff'}
      />

      {route.length > 0 && (
        <Polyline
          positions={route}
          pathOptions={{ color: '#2563eb', weight: 4, opacity: 0.8 }}
        />
      )}

      <FitBounds positions={positions} />
    </MapContainer>
  );
}
