"use client"

import { useState, useCallback } from "react";
import { getCurrentPosition, geolocationMessage } from "@/lib/geolocation";

interface Location {
    lat: number;
    long: number;
    accuracy?: number;
}

interface UseLocationReturn {
    location: Location | null;
    error: string | null;
    isPending: boolean;
    getLocation: () => void;
    clearLocation: () => void;
}

export function useLocation(): UseLocationReturn {
    const [location, setLocation] = useState<Location | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isPending, setIsPending] = useState<boolean>(false);

    const getLocation = useCallback(() => {
        // Check if browser supports geolocation
        if (!navigator.geolocation) {
            setError("❌ Geolocation is not supported by your browser");
            return;
        }

        setIsPending(true);
        setError(null);

        // Options and retry live in lib/geolocation.ts — this used to pass
        // enableHighAccuracy + maximumAge: 0, the combination most likely to
        // fail on a laptop, which has no GPS to be accurate with.
        getCurrentPosition(
            (position: GeolocationPosition) => {
                setLocation({
                    lat: position.coords.latitude,
                    long: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                });
                setIsPending(false);
            },
            (err: GeolocationPositionError) => {
                setError(geolocationMessage(err));
                setIsPending(false);
            },
        );
    }, []);

    const clearLocation = useCallback(() => {
        setLocation(null);
        setError(null);
    }, []);

    return {
        location,
        error,
        isPending,
        getLocation,
        clearLocation,
    };
}