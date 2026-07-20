import { serverFetch } from "@/lib/server-fetch";

// Resolves the current user's role + profile via the backend /api/me endpoint
// (was a direct DB probe). Preserves the previous contract: `{ role, data }`
// for a recognised role, or `false` when there is no session / no role row.
export const getRole = async () => {
    const res = await serverFetch("/api/me");
    if (!res.ok) return false;

    const me = await res.json();
    if (!me?.role) return false;

    return {
        role: me.role as "admin" | "customer" | "courier" | "owner" | "employee",
        data: me.data,
        // Subscription gate (owner/employee only): { alive, status, features }.
        gate: me.gate as { alive: boolean; status: string; features: Record<string, unknown> } | undefined,
    };
};

// The caller's outlet. Returns `{ result }` (array) to preserve the previous
// `getOutlet().result[0]` access pattern.
export const getOutlet = async () => {
    const res = await serverFetch("/api/outlet/me");
    const data = res.ok ? await res.json() : null;

    return { result: data?.outlet ? [data.outlet] : [] };
};
