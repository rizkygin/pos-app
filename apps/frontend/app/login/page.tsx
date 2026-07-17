import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_API_URL } from "@/lib/api-url";
import LoginClient from "./login-client";

// Already signed in? Straight to the dashboard — no login form re-run.
async function hasSession() {
  const cookie = (await headers()).get("cookie") ?? "";
  if (!cookie.includes("auth_session")) return false; // cheap short-circuit
  const res = await fetch(`${SERVER_API_URL}/api/auth/get-session`, {
    headers: { cookie },
    cache: "no-store",
  }).catch(() => null);
  if (!res?.ok) return false;
  const data = await res.json().catch(() => null);
  return !!data?.user;
}

export default async function LoginPage() {
  if (await hasSession()) redirect("/dashboard");
  return <LoginClient />;
}
