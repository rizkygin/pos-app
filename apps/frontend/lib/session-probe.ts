import { headers } from "next/headers";
import { SERVER_API_URL } from "@/lib/api-url";

export type SessionState = "signed-in" | "signed-out" | "unknown";

/**
 * For pages that only need to know whether to step aside for a signed-in
 * visitor — the landing page (the installed app's start_url) and /login.
 *
 * "unknown" means the backend could not answer: a deploy restarting it, a 5xx,
 * a 429 from the auth rate limiter, a timeout. That is NOT "signed out". These
 * pages used to treat it as signed out, so anyone who opened the app during a
 * deploy was shown the logged-out landing page or the login form while their
 * session was perfectly fine — and logged in again, which reads as "the update
 * logged me out". lib/auth.ts made the same distinction for the dashboard.
 *
 * ?disableRefresh=true: this runs on the frontend server, so a session renewal
 * here would send the renewed cookie to this process instead of the browser
 * (see the `before` hook in the backend's auth.ts).
 */
export async function probeSession(): Promise<SessionState> {
  const cookie = (await headers()).get("cookie") ?? "";
  // No cookie at all is a definite answer, and spares crawlers and first-time
  // visitors a backend round-trip.
  if (!cookie.includes("auth_session")) return "signed-out";

  // One retry rides over the few seconds a restart takes.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 800));
    const res = await fetch(`${SERVER_API_URL}/api/auth/get-session?disableRefresh=true`, {
      headers: { cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    if (res?.status === 401) return "signed-out";
    if (res?.ok) {
      const data = await res.json().catch(() => undefined);
      if (data !== undefined) return data?.user ? "signed-in" : "signed-out";
    }
  }
  return "unknown";
}
