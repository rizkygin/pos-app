import { headers } from "next/headers";
import { CustomerLocationSetting } from "@/components/dashboard/customer-location-setting";
import { API_URL } from "@/lib/api-url";
import type { UserLocation } from "./actions";

// Server-side load: forward the auth cookie to the backend so the session
// resolves (browser `credentials: 'include'` doesn't apply in RSC fetches).
async function getUserLocations(): Promise<UserLocation[]> {
    const cookie = (await headers()).get("cookie") ?? "";
    const res = await fetch(`${API_URL}/api/locations`, {
        headers: { cookie },
        cache: "no-store",
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data ?? []) as UserLocation[];
}

export default async function LocationSettingPage() {
    const locations = await getUserLocations();
    return <CustomerLocationSetting locations={locations} />;
}
