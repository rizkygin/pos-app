import { headers } from "next/headers";
import { API_URL } from "@/lib/api-url";

// Server-side (RSC) fetch to the backend that forwards the incoming auth cookie.
// RSC fetches don't apply `credentials: 'include'`, so the session cookie must
// be passed through explicitly for the backend to resolve the session. Defaults
// to `cache: 'no-store'` since these are per-request authenticated reads.
export async function serverFetch(path: string, init?: RequestInit) {
  const cookie = (await headers()).get("cookie") ?? "";
  return fetch(`${API_URL}${path}`, {
    cache: "no-store",
    ...init,
    headers: { cookie, ...(init?.headers ?? {}) },
  });
}
