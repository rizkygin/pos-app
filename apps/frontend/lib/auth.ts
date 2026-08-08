import type { Session, User } from "better-auth";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_API_URL } from "@/lib/api-url";

// The frontend no longer runs its own betterAuth/drizzle adapter — session
// validation lives entirely on the backend. RSC fetches don't carry
// `credentials: 'include'`, so we forward the incoming auth cookie to the
// backend get-session endpoint. The cookie name + BETTER_AUTH_SECRET are shared
// between both apps, so the backend resolves it. Returns the same
// `{ session, user }` shape betterAuth.api.getSession used to return, and
// redirects to `/` when there is no session (preserved contract).
export const getSession = cache(async (): Promise<{ session: Session; user: User }> => {
  const cookie = (await headers()).get("cookie") ?? "";
  const res = await fetch(`${SERVER_API_URL}/api/auth/get-session`, {
    headers: { cookie },
    cache: "no-store",
  });

  // Only a 401 means "not signed in". Treating every non-200 as a logout was
  // silently evicting merchants: a 429 from the auth rate limiter, or any
  // backend blip, looked exactly like an expired session and bounced them to
  // /login mid-shift. Those are backend failures, so they surface as errors
  // (nearest error boundary) and leave the session cookie alone.
  if (!res.ok && res.status !== 401) {
    throw new Error(`Session check failed: ${res.status} ${res.statusText}`);
  }

  const data = res.ok ? await res.json() : null;
  if (!data || !data.user) {
    redirect("/login");
  }

  return data as { session: Session; user: User };
});
