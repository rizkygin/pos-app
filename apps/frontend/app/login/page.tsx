import { redirect } from "next/navigation";
import { probeSession } from "@/lib/session-probe";
import LoginClient from "./login-client";

// Already signed in? Straight to the dashboard — no login form re-run. That
// includes a session the backend could not check this second ("unknown"): the
// dashboard offers a retry, where this form would only invite a pointless
// second login (see lib/session-probe.ts).
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
  if (!reauth && (await probeSession()) !== "signed-out") redirect("/dashboard");
  return (
    <LoginClient
      notice={reauth ? "Sesi admin sudah lewat 12 jam. Masuk ulang untuk lanjut memakai menu admin." : undefined}
    />
  );
}
