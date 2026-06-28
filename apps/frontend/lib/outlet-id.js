import { serverFetch } from "@/lib/server-fetch";

// The outlet belonging to the current user, via the backend /api/outlet/me
// (was a direct DB lookup). Returns null when there is no session / no outlet.
export default async function getOutletID() {
    const res = await serverFetch("/api/outlet/me");
    if (!res.ok) return null;

    const data = await res.json();
    return data?.outlet ?? null;
}
