"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

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

    return (
        <MapContainer
            center={[lat, lon]}
            zoom={15}
            style={{ height: "320px", width: "100%", borderRadius: "1rem", zIndex: 0 }}
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FlyTo lat={lat} lon={lon} />
            <ClickHandler onMove={onChange} />
            <Marker
                position={[lat, lon]}
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
