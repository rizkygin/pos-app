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

  const data = res.ok ? await res.json() : null;
  if (!data || !data.user) {
    redirect("/");
  }

  return data as { session: Session; user: User };
});
