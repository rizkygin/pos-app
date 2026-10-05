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

// ?reauth=admin: proxy.ts sends an admin here when their admin rights have
// lapsed (12 hours after sign-in). They still HAVE a session — just not one
// that may act as admin — so skip the already-signed-in redirect, which would
// bounce them straight back.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const reauth = (await searchParams).reauth === "admin";
  if (!reauth && (await hasSession())) redirect("/dashboard");
  return (
    <LoginClient
      notice={reauth ? "Sesi admin sudah lewat 12 jam. Masuk ulang untuk lanjut memakai menu admin." : undefined}
    />
  );
}
