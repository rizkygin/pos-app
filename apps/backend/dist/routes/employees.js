"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.employeeRoutes = employeeRoutes;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../auth");
const outlet_access_1 = require("../lib/outlet-access");
// Employees without a subscription (or on a plan without the key) get the
// Basic allowance — matches the seeded features.maxEmployees floor.
const DEFAULT_MAX_EMPLOYEES = 1;
// Keep only known permission keys, coerced to booleans.
function sanitizePermissions(input) {
    const out = {};
    if (input && typeof input === "object") {
        for (const key of outlet_access_1.EMPLOYEE_PERMISSIONS) {
            out[key] = input[key] === true;
        }
    }
    return out;
}
// The owner's plan-defined active-employee cap.
async function maxEmployeesFor(ownerUserId) {
    const [row] = await db_1.db
        .select({ features: schema_1.subscriptionPlansTable.features })
        .from(schema_1.subscriptionsTable)
        .innerJoin(schema_1.subscriptionPlansTable, (0, drizzle_orm_1.eq)(schema_1.subscriptionPlansTable.id, schema_1.subscriptionsTable.plan_id))
        .where((0, drizzle_orm_1.eq)(schema_1.subscriptionsTable.user_id, ownerUserId))
        .limit(1);
    const cap = Number(row?.features?.maxEmployees);
    return Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_MAX_EMPLOYEES;
}
// Kill every session of a user (deactivation / password reset must bite now,
// not at natural session expiry).
async function revokeSessions(userId) {
    await db_1.db.delete(schema_1.session).where((0, drizzle_orm_1.eq)(schema_1.session.userId, userId));
}
async function employeeRoutes(app) {
    // All /api/employees* endpoints are OWNER-only by construction.
    app.get("/api/employees", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "owner");
        if (!access)
            return;
        const rows = await db_1.db
            .select({
            id: schema_1.employeesTable.id,
            user_id: schema_1.employeesTable.user_id,
            name: schema_1.usersTable.name,
            email: schema_1.usersTable.email,
            permissions: schema_1.employeesTable.permissions,
            is_active: schema_1.employeesTable.is_active,
            created_at: schema_1.employeesTable.createdAt,
        })
            .from(schema_1.employeesTable)
            .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.usersTable.id, schema_1.employeesTable.user_id))
            .where((0, drizzle_orm_1.eq)(schema_1.employeesTable.outlet_id, access.outlet.id))
            .orderBy(schema_1.employeesTable.id);
        const max = await maxEmployeesFor(access.outlet.user_id);
        const active = rows.filter((r) => r.is_active).length;
        return { success: true, data: rows, max_employees: max, active_count: active };
    });
    // Create: owner supplies name/email/password → a real better-auth account +
    // the employment row. Cap counts ACTIVE employees only.
    app.post("/api/employees", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "owner");
        if (!access)
            return;
        const body = (request.body ?? {});
        const name = String(body.name ?? "").trim();
        const email = String(body.email ?? "").trim().toLowerCase();
        const password = String(body.password ?? "");
        if (!name || !email)
            return reply.status(400).send({ success: false, error: "Nama dan email wajib diisi" });
        if (password.length < 8)
            return reply.status(400).send({ success: false, error: "Password minimal 8 karakter" });
        const [{ n: activeCount }] = await db_1.db
            .select({ n: (0, drizzle_orm_1.sql) `count(*)::int` })
            .from(schema_1.employeesTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.employeesTable.outlet_id, access.outlet.id), (0, drizzle_orm_1.eq)(schema_1.employeesTable.is_active, true)));
        const max = await maxEmployeesFor(access.outlet.user_id);
        if (activeCount >= max)
            return reply.status(409).send({
                success: false,
                error: `Paket Pian dibatasi ${max} karyawan aktif — upgrade paket untuk menambah`,
            });
        // Reject emails that already belong to any account: silently hijacking an
        // existing user (possibly another outlet's owner!) into employment is not
        // acceptable; the owner should use a fresh email per staff account.
        const [existing] = await db_1.db
            .select({ id: schema_1.usersTable.id })
            .from(schema_1.usersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.usersTable.email, email))
            .limit(1);
        if (existing)
            return reply
                .status(409)
                .send({ success: false, error: "Email sudah terpakai akun lain — gunakan email lain" });
        let newUserId;
        try {
            const res = await auth_1.auth.api.signUpEmail({ body: { email, password, name } });
            newUserId = res.user.id;
        }
        catch (e) {
            return reply.status(500).send({
                success: false,
                error: `Gagal membuat akun: ${e instanceof Error ? e.message : String(e)}`,
            });
        }
        const [employee] = await db_1.db
            .insert(schema_1.employeesTable)
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
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "owner");
        if (!access)
            return;
        const id = Number(request.params.id);
        const body = (request.body ?? {});
        const [employee] = await db_1.db
            .select()
            .from(schema_1.employeesTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.employeesTable.id, id), (0, drizzle_orm_1.eq)(schema_1.employeesTable.outlet_id, access.outlet.id)))
            .limit(1);
        if (!employee)
            return reply.status(404).send({ success: false, error: "Karyawan tidak ditemukan" });
        const patch = { updatedAt: new Date() };
        if (body.permissions !== undefined)
            patch.permissions = sanitizePermissions(body.permissions);
        if (typeof body.is_active === "boolean" && body.is_active !== employee.is_active) {
            if (body.is_active) {
                const [{ n }] = await db_1.db
                    .select({ n: (0, drizzle_orm_1.sql) `count(*)::int` })
                    .from(schema_1.employeesTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.employeesTable.outlet_id, access.outlet.id), (0, drizzle_orm_1.eq)(schema_1.employeesTable.is_active, true)));
                const max = await maxEmployeesFor(access.outlet.user_id);
                if (n >= max)
                    return reply.status(409).send({
                        success: false,
                        error: `Paket Pian dibatasi ${max} karyawan aktif`,
                    });
            }
            patch.is_active = body.is_active;
        }
        const [updated] = await db_1.db
            .update(schema_1.employeesTable)
            .set(patch)
            .where((0, drizzle_orm_1.eq)(schema_1.employeesTable.id, id))
            .returning();
        if (patch.is_active === false)
            await revokeSessions(employee.user_id);
        return { success: true, data: updated };
    });
    // Owner resets a staff password (staff often can't do email flows). Hash with
    // better-auth's own hasher so login verification matches, then force re-login.
    app.post("/api/employees/:id/reset-password", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "owner");
        if (!access)
            return;
        const id = Number(request.params.id);
        const { password } = (request.body ?? {});
        if (!password || password.length < 8)
            return reply.status(400).send({ success: false, error: "Password minimal 8 karakter" });
        const [employee] = await db_1.db
            .select()
            .from(schema_1.employeesTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.employeesTable.id, id), (0, drizzle_orm_1.eq)(schema_1.employeesTable.outlet_id, access.outlet.id)))
            .limit(1);
        if (!employee)
            return reply.status(404).send({ success: false, error: "Karyawan tidak ditemukan" });
        const ctx = await auth_1.auth.$context;
        const hashed = await ctx.password.hash(password);
        await db_1.db
            .update(schema_1.account)
            .set({ password: hashed })
            .where((0, drizzle_orm_1.eq)(schema_1.account.userId, employee.user_id));
        await revokeSessions(employee.user_id);
        return { success: true };
    });
}
