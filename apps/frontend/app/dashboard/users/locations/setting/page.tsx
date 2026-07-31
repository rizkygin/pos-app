import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CustomerLocationSetting } from "@/components/dashboard/customer-location-setting";
import { getRole } from "@/lib/utils/get-role";
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
    // Guarded here as well as hidden from the sidebar: removing a nav link only
    // stops people finding the page, not reaching it. A courier landing here by
    // typed URL, stale bookmark, or back button would otherwise be invited to
    // save a delivery address that nothing in the app ever reads for them.
    // `role && role.role` rather than `role?.role`: getRole() returns literal
    // `false` when there's no session, and optional chaining doesn't narrow that.
    const role = await getRole();
    if (role && role.role === "courier") redirect("/dashboard");

    const locations = await getUserLocations();
    return <CustomerLocationSetting locations={locations} />;
}
