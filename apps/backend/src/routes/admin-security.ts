import type { FastifyInstance } from "fastify";
import { and, count, desc, eq, ilike, ne, or, type SQL } from "drizzle-orm";
import { isAPIError } from "better-auth/api";
import { db } from "../db";
import { adminActivityTable, adminStepUpTable, session } from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import {
  adminSessionExpiresAt,
  requireAdminSession,
  STEP_UP_WINDOW_MS,
  stepUpValidUntil,
} from "../lib/admin-access";
import { listAdminDevices, readDeviceCookie } from "../lib/admin-devices";

// Wrong passwords allowed on one session before the re-check locks for a while.
// The session already passed password + two-factor, so this only matters to
// someone who took over a live admin browser and is guessing.
const STEP_UP_MAX_FAILURES = 5;
const STEP_UP_LOCK_MS = 15 * 60 * 1000;

export async function adminSecurityRoutes(app: FastifyInstance) {
  /**
   * Password re-check for risky admin actions. On success the session may do
   * `{ stepUp: true }` actions for STEP_UP_WINDOW_MS. Logged automatically
   * (the password itself is redacted) with its status code, so failed tries
   * show up in the activity log too.
   */
  app.post("/api/admin/reauth", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const sessionId = admin.session.id;

    const { password } = (request.body ?? {}) as { password?: string };
    if (!password) return reply.status(400).send({ success: false, error: "Password wajib diisi." });

    const [state] = await db
      .select()
      .from(adminStepUpTable)
      .where(eq(adminStepUpTable.session_id, sessionId))
      .limit(1);

    const now = Date.now();
    if (state?.locked_until && state.locked_until.getTime() > now) {
      const minutes = Math.ceil((state.locked_until.getTime() - now) / 60_000);
      return reply
        .status(429)
        .send({ success: false, error: `Terlalu banyak password salah. Coba lagi ${minutes} menit lagi.` });
    }

    try {
      await auth.api.verifyPassword({ body: { password }, headers: toWebHeaders(request.headers) });
    } catch (err) {
      if (!isAPIError(err)) throw err;
      const failures = (state?.failed_count ?? 0) + 1;
      const locked = failures >= STEP_UP_MAX_FAILURES;
      const values = {
        failed_count: locked ? 0 : failures,
        locked_until: locked ? new Date(now + STEP_UP_LOCK_MS) : null,
      };
      await db
        .insert(adminStepUpTable)
        .values({ session_id: sessionId, ...values })
        .onConflictDoUpdate({ target: adminStepUpTable.session_id, set: values });
      return reply.status(locked ? 429 : 400).send({
        success: false,
        error: locked ? "Terlalu banyak password salah. Coba lagi 15 menit lagi." : "Password salah.",
      });
    }

    const values = { confirmed_at: new Date(now), failed_count: 0, locked_until: null };
    await db
      .insert(adminStepUpTable)
      .values({ session_id: sessionId, ...values })
      .onConflictDoUpdate({ target: adminStepUpTable.session_id, set: values });

    return { success: true, validUntil: new Date(now + STEP_UP_WINDOW_MS).toISOString() };
  });

  // Session limits + known browsers, for the Keamanan page.
  app.get("/api/admin/security", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const stepUpUntil = await stepUpValidUntil(admin.session.id);
    return {
      success: true,
      adminSessionExpiresAt: adminSessionExpiresAt(admin).toISOString(),
      stepUpValidUntil: stepUpUntil?.toISOString() ?? null,
      devices: await listAdminDevices(admin.user.id, readDeviceCookie(request.headers.cookie)),
    };
  });

  // Ends every session of this account except the one making the request.
  // Not behind the password re-check: it is the "someone else is in my
  // account" button, and the worst an intruder can do with it is sign out the
  // real admin, who signs straight back in.
  app.post("/api/admin/security/sign-out-others", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const ended = await db
      .delete(session)
      .where(and(eq(session.userId, admin.user.id), ne(session.id, admin.session.id)))
      .returning({ id: session.id });
    return { success: true, ended: ended.length };
  });

  // The activity log, newest first. A GET, so reading it is not itself logged.
  app.get("/api/admin/activity", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const { page = "1", limit = "50", q = "" } = request.query as Record<string, string>;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(200, Math.max(1, Number(limit) || 50));

    const conditions: SQL[] = [];
    const term = q.trim();
    if (term) {
      const like = `%${term}%`;
      conditions.push(
        or(
          ilike(adminActivityTable.action, like),
          ilike(adminActivityTable.target, like),
          ilike(adminActivityTable.admin_email, like),
        )!,
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(adminActivityTable)
        .where(where)
        .orderBy(desc(adminActivityTable.createdAt), desc(adminActivityTable.id))
        .limit(limitNum)
        .offset((pageNum - 1) * limitNum),
      db.select({ total: count() }).from(adminActivityTable).where(where),
    ]);

    return { success: true, data: rows, count: total };
  });
}
