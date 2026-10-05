import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db";
import { adminStepUpTable } from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "./web-headers";
import { hasAdminRow } from "./admin-rows";
import { markAdminRequest } from "./admin-activity";

export { getAdminRow, hasAdminRow } from "./admin-rows";

// ============================================================================
// The ONE platform-admin check. Every admin route, the /api/me role probe and
// the admin path through requireOutletOwnerOrAdmin go through here, so a rule
// added here applies everywhere at once.
//
// A request has admin rights when ALL hold:
//   1. a LIVE `admins` row (deleted_at null). Setting deleted_at is how an
//      admin is removed — see scripts/admin-access.ts, which also signs them
//      out everywhere.
//   2. two-factor finished (users.two_factor_enabled), else ADMIN_2FA_REQUIRED
//      and the frontend proxy sends them to /dashboard/admin/security.
//   3. the session was signed in within ADMIN_SESSION_MAX_AGE_MS, else
//      ADMIN_SESSION_EXPIRED and the frontend sends them to sign in again.
//      The session itself lives on (30 days) — only its admin rights lapse,
//      so an admin who also owns an outlet keeps using that.
// Risky actions add `{ stepUp: true }`: the password must have been re-entered
// on this session within STEP_UP_WINDOW_MS (POST /api/admin/reauth), else
// ADMIN_REAUTH_REQUIRED and the admin pages ask for it and retry.
//
// Nothing in the API can create an admins row. Keep it that way: granting is
// the server-side script only.
// ============================================================================

export type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
type SessionUser = AuthSession["user"];

export const ADMIN_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const STEP_UP_WINDOW_MS = 15 * 60 * 1000;

export const ADMIN_2FA_REQUIRED = "ADMIN_2FA_REQUIRED";
export const ADMIN_SESSION_EXPIRED = "ADMIN_SESSION_EXPIRED";
export const ADMIN_REAUTH_REQUIRED = "ADMIN_REAUTH_REQUIRED";

/** When this session's admin rights lapse: a fixed time after sign-in. */
export function adminSessionExpiresAt(session: AuthSession) {
  return new Date(new Date(session.session.createdAt).getTime() + ADMIN_SESSION_MAX_AGE_MS);
}

export function isAdminSessionExpired(session: AuthSession) {
  return adminSessionExpiresAt(session).getTime() <= Date.now();
}

/** Full admin rights for this session: live row, 2FA, and signed in recently. */
export async function isAdminSession(session: AuthSession) {
  return (
    !!session.user.twoFactorEnabled &&
    !isAdminSessionExpired(session) &&
    (await hasAdminRow(session.user.id))
  );
}

/** Until when the password re-check on this session counts, or null. */
export async function stepUpValidUntil(sessionId: string) {
  const [row] = await db
    .select({ confirmedAt: adminStepUpTable.confirmed_at })
    .from(adminStepUpTable)
    .where(eq(adminStepUpTable.session_id, sessionId))
    .limit(1);
  if (!row?.confirmedAt) return null;
  const until = new Date(row.confirmedAt.getTime() + STEP_UP_WINDOW_MS);
  return until.getTime() > Date.now() ? until : null;
}

function deny(reply: FastifyReply, status: number, text: string, code?: string) {
  reply.status(status).send({ success: false, error: text, message: text, ...(code ? { code } : {}) });
  return null;
}

/**
 * requireAdmin, but returns the whole session (for routes that need the
 * session id or sign-in time). Same checks, same marking.
 */
export async function requireAdminSession(
  request: FastifyRequest,
  reply: FastifyReply,
  opts: { stepUp?: boolean } = {},
): Promise<AuthSession | null> {
  const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
  if (!session?.user) return deny(reply, 401, "Unauthorized");

  if (!(await hasAdminRow(session.user.id))) return deny(reply, 403, "Forbidden");

  if (!session.user.twoFactorEnabled) {
    return deny(reply, 403, "Aktifkan verifikasi dua langkah dulu untuk memakai menu admin.", ADMIN_2FA_REQUIRED);
  }

  if (isAdminSessionExpired(session)) {
    return deny(reply, 401, "Sesi admin sudah lewat 12 jam. Silakan masuk ulang.", ADMIN_SESSION_EXPIRED);
  }

  if (opts.stepUp && !(await stepUpValidUntil(session.session.id))) {
    return deny(reply, 403, "Tindakan ini perlu konfirmasi password dulu.", ADMIN_REAUTH_REQUIRED);
  }

  markAdminRequest(request, {
    userId: session.user.id,
    email: session.user.email,
    sessionId: session.session.id,
  });
  return session;
}

/**
 * Route guard. Returns the session user when the request holds admin rights;
 * otherwise sends 401/403 and returns null, so the caller just `return`s:
 *
 *   const admin = await requireAdmin(request, reply);
 *   if (!admin) return;
 *
 * Risky actions pass `{ stepUp: true }`. A request that passes is marked for
 * the activity log (lib/admin-activity).
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  opts: { stepUp?: boolean } = {},
): Promise<SessionUser | null> {
  const session = await requireAdminSession(request, reply, opts);
  return session?.user ?? null;
}
