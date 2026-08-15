import { FRONTEND_URL } from "./app-env";

/**
 * Outbound WhatsApp for the phone-verification link, via Fonnte.
 *
 * Fonnte is an Indonesian gateway that drives a real WhatsApp session behind a
 * REST API. It is deliberately NOT Meta's Cloud API: that route requires
 * Business Verification against Indonesian company documents this project does
 * not have, plus a template approval queue and per-message billing. Fonnte needs
 * a phone number and a QR scan, takes free-form text, and bills a flat monthly
 * subscription.
 *
 * The cost is that it is UNOFFICIAL — it violates WhatsApp's terms, and Meta can
 * ban the sending number. Verification traffic is precisely the pattern their
 * spam detection looks for: many near-identical messages to people who never
 * messaged you first. Two consequences the rest of the code depends on:
 *
 *   - The sending number is DISPOSABLE. It must never be the number printed on
 *     receipts or given to customers as support; losing it should cost a
 *     re-scan, not a channel customers rely on.
 *   - The 60s cooldown and 10/day cap in routes/phone-verification.ts are part
 *     of the mitigation, not bureaucracy. They cap the burst rate this number is
 *     seen sending at, which is what the ban heuristics measure.
 *
 * Unconfigured is a supported state. Local development and any deploy without a
 * token logs the link instead of sending it, so the flow stays testable with no
 * provider at all. Callers check `whatsappConfigured()` before promising the
 * user a message.
 */

const FONNTE_ENDPOINT = "https://api.fonnte.com/send";

export function whatsappConfigured(): boolean {
  return !!process.env.FONNTE_TOKEN;
}

/**
 * Send the verification link to one number.
 *
 * Throws on a rejected send. The caller decides what that means — for the
 * verification endpoint it means "tell the user it failed and let them retry",
 * NOT a swallowed error that leaves them waiting for a message that never comes.
 */
export async function sendPhoneVerification(
  phone: string,
  name: string,
  token: string,
): Promise<void> {
  const link = `${FRONTEND_URL.replace(/\/$/, "")}/verify-phone?token=${token}`;

  if (!whatsappConfigured()) {
    // Not a silent no-op: without this line an unconfigured environment gives
    // the developer no way to finish the flow they are testing.
    console.warn(`[whatsapp] not configured — verification link for ${phone}: ${link}`);
    return;
  }

  const message = [
    `Halo ${name},`,
    "",
    "Ketuk link berikut untuk memverifikasi nomor WhatsApp pian di Ulun Pesan:",
    link,
    "",
    "Link berlaku 24 jam. Abaikan pesan ini kalau pian tidak merasa meminta.",
  ].join("\n");

  const res = await fetch(FONNTE_ENDPOINT, {
    method: "POST",
    headers: {
      // Fonnte's own scheme: the device token goes in Authorization bare, with
      // no "Bearer" prefix.
      Authorization: process.env.FONNTE_TOKEN as string,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      target: phone,
      message,
      // Belt-and-braces: our numbers are already canonical 628…, and naming the
      // country stops Fonnte re-reading a leading 62 as part of the subscriber
      // number.
      countryCode: "62",
    }),
  });

  const body = (await res.json().catch(() => null)) as { status?: boolean; reason?: string } | null;
  // Fonnte answers 200 with `status: false` for a rejected send — a dead device,
  // an exhausted quota, an invalid target. Checking res.ok alone would report
  // every one of those as a message on its way.
  if (!res.ok || body?.status === false) {
    throw new Error(`Fonnte send failed (${res.status}): ${body?.reason ?? "unknown"}`);
  }
}
