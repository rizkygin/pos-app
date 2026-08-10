import { eq } from "drizzle-orm";
import { db } from "../../db";
import { usersTable } from "../../db/schema";

/**
 * Has this user proven their WhatsApp number?
 *
 * Backstop for the frontend gate (dashboard/layout.tsx renders
 * PhoneVerificationGate in place of every page for an unverified customer). It
 * lives server-side too because a customer can call the API directly and never
 * see that screen — the same reasoning that put the email check in
 * /api/orders/create.
 */
export async function hasVerifiedPhone(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ verified: usersTable.phone_verified })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return !!row?.verified;
}

/** The one refusal shape, so the frontend can branch on a single code. */
export const PHONE_NOT_VERIFIED = {
  success: false as const,
  error: "Verifikasi nomor WhatsApp pian dulu sebelum membuat pesanan.",
  code: "PHONE_NOT_VERIFIED" as const,
};
