import { SERVER_API_URL } from '@/lib/api-url';
import { MAINTENANCE_OFF, type Maintenance } from '@/lib/maintenance';

// The proxy runs on (almost) every request and fetch caching has no effect
// there — see next/dist/docs/01-app/01-getting-started/16-proxy.md. So the
// backend round-trip is cached in module memory instead, per server instance.
// 15s is short enough that "end maintenance now" takes effect while the admin
// is still looking at the screen, and long enough that a burst of page loads
// costs one query.
const TTL_MS = 15_000;

let cached: { at: number; value: Maintenance } | null = null;

export async function getMaintenance(): Promise<Maintenance> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  try {
    const res = await fetch(`${SERVER_API_URL}/api/maintenance`, {
      cache: 'no-store',
      // The gate must never be what makes the site slow. If the backend is
      // wedged, fail open quickly rather than hanging every request.
      signal: AbortSignal.timeout(2000),
    });
    const value: Maintenance = res.ok ? await res.json() : MAINTENANCE_OFF;
    cached = { at: Date.now(), value };
    return value;
  } catch {
    // Unreachable backend is not the same as "under maintenance" — showing the
    // maintenance page for an unrelated outage would be a lie, and it would
    // also hide the real one. Serve the app; the pages themselves will report
    // their own failures.
    cached = { at: Date.now(), value: MAINTENANCE_OFF };
    return MAINTENANCE_OFF;
  }
}
