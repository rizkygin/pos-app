"use client"

import { useState, useCallback } from "react";

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

        navigator.geolocation.getCurrentPosition(
            // Success
            (position: GeolocationPosition) => {
                setLocation({
                    lat: position.coords.latitude,
                    long: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                });
                setIsPending(false);
            },
            // Error
            (err: GeolocationPositionError) => {
                switch (err.code) {
                    case err.PERMISSION_DENIED:
                        setError("❌ User denied location access");
                        break;
                    case err.POSITION_UNAVAILABLE:
                        setError("❌ Location information unavailable");
                        break;
                    case err.TIMEOUT:
                        setError("❌ Location request timed out");
                        break;
                    default:
                        setError("❌ An unknown error occurred");
                }
                setIsPending(false);
            },
            // Options
            {
                enableHighAccuracy: true, // use GPS if available
                timeout: 10000,           // 10 seconds
                maximumAge: 0,            // don't use cached location
            }
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