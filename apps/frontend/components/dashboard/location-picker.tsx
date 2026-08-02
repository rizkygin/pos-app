"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { isValidLat, isValidLon, isValidCoord } from "@/lib/coords";
import { FALLBACK_COORDS } from "@/lib/geolocation";

// Where the map sits when it has nothing valid to show, matching the
// server-side fallback in outlet.ts. A stored coordinate can still be junk (see
// lib/coords.ts), and Leaflet throws rather than degrading, so the picker
// renders here instead of taking the whole settings page down with it.
const FALLBACK_LAT = FALLBACK_COORDS.lat;
const FALLBACK_LON = FALLBACK_COORDS.lon;

// Fix default marker icon (webpack breaks leaflet's auto-detection)
const icon = L.icon({
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
});

function ClickHandler({ onMove }: { onMove: (lat: number, lon: number) => void }) {
    useMapEvents({
        click(e) {
            onMove(e.latlng.lat, e.latlng.lng);
        },
    });
    return null;
}

function FlyTo({ lat, lon }: { lat: number; lon: number }) {
    const map = useMap();
    useEffect(() => {
        // Never hand Leaflet a NaN — it throws "Invalid LatLng object" from
        // inside this effect, which React surfaces as an unrecoverable error.
        if (!isValidCoord(lat, lon)) return;
        map.flyTo([lat, lon], map.getZoom(), { animate: true, duration: 1.2 });
    }, [lat, lon, map]);
    return null;
}

export function LocationPicker({
    lat,
    lon,
    onChange,
}: {
    lat: number;
    lon: number;
    onChange: (lat: number, lon: number) => void;
}) {
    const markerRef = useRef<L.Marker>(null);

    // A caller can still pass NaN (an outlet saved before coordinates were
    // validated, `parseFloat('')`, a half-filled form). Substitute the fallback
    // rather than propagating it: every Leaflet entry point below throws on NaN.
    const safeLat = isValidLat(lat) ? lat : FALLBACK_LAT;
    const safeLon = isValidLon(lon) ? lon : FALLBACK_LON;

    return (
        <MapContainer
            center={[safeLat, safeLon]}
            zoom={15}
            style={{ height: "320px", width: "100%", borderRadius: "1rem", zIndex: 0 }}
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FlyTo lat={safeLat} lon={safeLon} />
            <ClickHandler onMove={onChange} />
            <Marker
                position={[safeLat, safeLon]}
                icon={icon}
                draggable
                ref={markerRef}
                eventHandlers={{
                    dragend() {
                        const latlng = markerRef.current?.getLatLng();
                        if (latlng) onChange(latlng.lat, latlng.lng);
                    },
                }}
            />
        </MapContainer>
    );
}
