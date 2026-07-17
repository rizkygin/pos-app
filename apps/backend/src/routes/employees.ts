import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  employeesTable,
  usersTable,
  session as sessionTable,
  account as accountTable,
  subscriptionsTable,
  subscriptionPlansTable,
} from "../db/schema";
import { auth } from "../auth";
import {
  requireOutletAccess,
  EMPLOYEE_PERMISSIONS,
} from "../lib/outlet-access";

// Employees without a subscription (or on a plan without the key) get the
// Basic allowance — matches the seeded features.maxEmployees floor.
const DEFAULT_MAX_EMPLOYEES = 1;

// Keep only known permission keys, coerced to booleans.
function sanitizePermissions(input: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (input && typeof input === "object") {
    for (const key of EMPLOYEE_PERMISSIONS) {
      out[key] = (input as Record<string, unknown>)[key] === true;
    }
  }
  return out;
}

// The owner's plan-defined active-employee cap.
async function maxEmployeesFor(ownerUserId: string): Promise<number> {
  const [row] = await db
    .select({ features: subscriptionPlansTable.features })
    .from(subscriptionsTable)
    .innerJoin(
      subscriptionPlansTable,
      eq(subscriptionPlansTable.id, subscriptionsTable.plan_id),
    )
    .where(eq(subscriptionsTable.user_id, ownerUserId))
    .limit(1);
  const cap = Number((row?.features as Record<string, unknown>)?.maxEmployees);
  return Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_MAX_EMPLOYEES;
}

// Kill every session of a user (deactivation / password reset must bite now,
// not at natural session expiry).
async function revokeSessions(userId: string) {
  await db.delete(sessionTable).where(eq(sessionTable.userId, userId));
}

export async function employeeRoutes(app: FastifyInstance) {
  // All /api/employees* endpoints are OWNER-only by construction.

  app.get("/api/employees", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "owner");
    if (!access) return;
    const rows = await db
      .select({
        id: employeesTable.id,
        user_id: employeesTable.user_id,
        name: usersTable.name,
        email: usersTable.email,
        permissions: employeesTable.permissions,
        is_active: employeesTable.is_active,
        created_at: employeesTable.createdAt,
      })
      .from(employeesTable)
      .innerJoin(usersTable, eq(usersTable.id, employeesTable.user_id))
      .where(eq(employeesTable.outlet_id, access.outlet.id))
      .orderBy(employeesTable.id);
    const max = await maxEmployeesFor(access.outlet.user_id);
    const active = rows.filter((r) => r.is_active).length;
    return { success: true, data: rows, max_employees: max, active_count: active };
  });

  // Create: owner supplies name/email/password → a real better-auth account +
  // the employment row. Cap counts ACTIVE employees only.
  app.post("/api/employees", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "owner");
    if (!access) return;
    const body = (request.body ?? {}) as {
      name?: string;
      email?: string;
      password?: string;
      permissions?: unknown;
    };
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!name || !email)
      return reply.status(400).send({ success: false, error: "Nama dan email wajib diisi" });
    if (password.length < 8)
      return reply.status(400).send({ success: false, error: "Password minimal 8 karakter" });

    const [{ n: activeCount }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(employeesTable)
      .where(
        and(eq(employeesTable.outlet_id, access.outlet.id), eq(employeesTable.is_active, true)),
      );
    const max = await maxEmployeesFor(access.outlet.user_id);
    if (activeCount >= max)
      return reply.status(409).send({
        success: false,
        error: `Paket Pian dibatasi ${max} karyawan aktif — upgrade paket untuk menambah`,
      });

    // Reject emails that already belong to any account: silently hijacking an
    // existing user (possibly another outlet's owner!) into employment is not
    // acceptable; the owner should use a fresh email per staff account.
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    if (existing)
      return reply
        .status(409)
        .send({ success: false, error: "Email sudah terpakai akun lain — gunakan email lain" });

    let newUserId: string;
    try {
      const res = await auth.api.signUpEmail({ body: { email, password, name } });
      newUserId = res.user.id;
    } catch (e) {
      return reply.status(500).send({
        success: false,
        error: `Gagal membuat akun: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    const [employee] = await db
      .insert(employeesTable)
      .values({
        outlet_id: access.outlet.id,
        user_id: newUserId,
        permissions: sanitizePermissions(body.permissions),
        is_active: true,
      })
      .returning();
    return reply.status(201).send({ success: true, data: employee });
  });

  // Update permissions and/or active flag. Reactivation re-checks the cap;
  // deactivation revokes the employee's sessions immediately.
  app.patch("/api/employees/:id", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "owner");
    if (!access) return;
    const id = Number((request.params as { id: string }).id);
    const body = (request.body ?? {}) as { permissions?: unknown; is_active?: boolean };

    const [employee] = await db
      .select()
      .from(employeesTable)
      .where(and(eq(employeesTable.id, id), eq(employeesTable.outlet_id, access.outlet.id)))
      .limit(1);
    if (!employee)
      return reply.status(404).send({ success: false, error: "Karyawan tidak ditemukan" });

    const patch: Partial<typeof employeesTable.$inferInsert> = { updatedAt: new Date() };
    if (body.permissions !== undefined) patch.permissions = sanitizePermissions(body.permissions);
    if (typeof body.is_active === "boolean" && body.is_active !== employee.is_active) {
      if (body.is_active) {
        const [{ n }] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(employeesTable)
          .where(
            and(
              eq(employeesTable.outlet_id, access.outlet.id),
              eq(employeesTable.is_active, true),
            ),
          );
        const max = await maxEmployeesFor(access.outlet.user_id);
        if (n >= max)
          return reply.status(409).send({
            success: false,
            error: `Paket Pian dibatasi ${max} karyawan aktif`,
          });
      }
      patch.is_active = body.is_active;
    }

    const [updated] = await db
      .update(employeesTable)
      .set(patch)
      .where(eq(employeesTable.id, id))
      .returning();
    if (patch.is_active === false) await revokeSessions(employee.user_id);
    return { success: true, data: updated };
  });

  // Owner resets a staff password (staff often can't do email flows). Hash with
  // better-auth's own hasher so login verification matches, then force re-login.
  app.post("/api/employees/:id/reset-password", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "owner");
    if (!access) return;
    const id = Number((request.params as { id: string }).id);
    const { password } = (request.body ?? {}) as { password?: string };
    if (!password || password.length < 8)
      return reply.status(400).send({ success: false, error: "Password minimal 8 karakter" });

    const [employee] = await db
      .select()
      .from(employeesTable)
      .where(and(eq(employeesTable.id, id), eq(employeesTable.outlet_id, access.outlet.id)))
      .limit(1);
    if (!employee)
      return reply.status(404).send({ success: false, error: "Karyawan tidak ditemukan" });

    const ctx = await auth.$context;
    const hashed = await ctx.password.hash(password);
    await db
      .update(accountTable)
      .set({ password: hashed })
      .where(eq(accountTable.userId, employee.user_id));
    await revokeSessions(employee.user_id);
    return { success: true };
  });
}
