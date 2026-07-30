import { cache } from "react";
import { serverFetch } from "@/lib/server-fetch";

// Resolves the current user's role + profile via the backend /api/me endpoint
// (was a direct DB probe). Preserves the previous contract: `{ role, data }`
// for a recognised role, or `false` when there is no session / no role row.
//
// cache()-wrapped like lib/auth.ts's getSession(), for the same reason: every
// /dashboard request calls this at least twice (once in dashboard/layout.tsx
// for the sidebar, again in dashboard/page.tsx to pick which dashboard to
// render), and 20+ other pages call it again in their own layout/page. Without
// memoizing, each call was a fresh network round-trip to the backend — a
// second full /api/me fetch that returns the exact same answer as the first,
// serially blocking the response before any HTML could be sent.
export const getRole = cache(async () => {
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
});

// The caller's outlet. Returns `{ result }` (array) to preserve the previous
// `getOutlet().result[0]` access pattern. Same duplicate-fetch reasoning as
// getRole() above.
export const getOutlet = cache(async () => {
    const res = await serverFetch("/api/outlet/me");
    const data = res.ok ? await res.json() : null;

    return { result: data?.outlet ? [data.outlet] : [] };
});
