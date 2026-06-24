import { API_URL } from "@/lib/api-url";

export type LocationFormData = {
    label: string;
    address: string;
    lat: string;
    lon: string;
    note?: string;
};

export type UserLocation = {
    id: number;
    label: string;
    address: string;
    lat: string;
    lon: string;
    note: string | null;
    is_default: boolean;
};

type ActionResult = { success: boolean; message: string };

async function postLocation(path: string, body: unknown): Promise<ActionResult> {
    try {
        const res = await fetch(`${API_URL}${path}`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        return (await res.json()) as ActionResult;
    } catch {
        return { success: false, message: "Terjadi kesalahan jaringan." };
    }
}

export async function checkUserHasLocations(): Promise<boolean> {
    try {
        const res = await fetch(`${API_URL}/api/locations/exists`, { credentials: "include" });
        const json = await res.json();
        return !!json.exists;
    } catch {
        return false;
    }
}

export async function addLocationAction(data: LocationFormData) {
    return postLocation("/api/locations", data);
}

export async function updateLocationAction(id: number, data: LocationFormData) {
    return postLocation("/api/locations/update", { id, data });
}

export async function deleteLocationAction(id: number) {
    return postLocation("/api/locations/delete", { id });
}

export async function setDefaultLocationAction(id: number) {
    return postLocation("/api/locations/set-default", { id });
}
