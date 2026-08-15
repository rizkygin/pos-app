"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meRoutes = meRoutes;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../auth");
const web_headers_1 = require("../lib/web-headers");
const outlet_access_1 = require("../lib/outlet-access");
const phone_1 = require("../lib/utils/phone");
/**
 * How long a user must wait between phone-number changes.
 *
 * The number is a contact channel outlets and couriers rely on mid-delivery, and
 * on an account others have rated and transacted with — so it shouldn't be a
 * field someone can churn freely. 30 fixed days rather than a calendar month, so
 * the wait doesn't silently differ between February and July.
 */
const PHONE_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * When the cooldown expires, or null if a change is allowed right now.
 *
 * A null `changedAt` means the number has never been edited — the value came
 * from registration, or predates this feature — and that first correction is
 * free. Being stuck for a month with a number you fat-fingered at signup would
 * make you uncontactable for every order in between.
 */
function phoneCooldownEndsAt(changedAt) {
    if (!changedAt)
        return null;
    const endsAt = changedAt.getTime() + PHONE_CHANGE_COOLDOWN_MS;
    return endsAt > Date.now() ? new Date(endsAt) : null;
}
// Resolve the caller's role + profile row for the current session. Mirrors the
// former frontend lib/utils/get-role.ts probe so RSC pages and proxy.ts (admin
// gate) no longer touch the DB directly.
async function meRoutes(app) {
    app.get("/api/me", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ role: null, data: null });
        const userId = session.user.id;
        const probes = [
            { role: "admin", row: () => db_1.db.query.adminsTable.findFirst({ where: (0, drizzle_orm_1.eq)(schema_1.adminsTable.user_id, userId) }) },
            { role: "customer", row: () => db_1.db.query.customersTable.findFirst({ where: (0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, userId) }) },
            { role: "courier", row: () => db_1.db.query.couriersTable.findFirst({ where: (0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, userId) }) },
            { role: "owner", row: () => db_1.db.query.outletsTable.findFirst({ where: (0, drizzle_orm_1.eq)(schema_1.outletsTable.user_id, userId) }) },
        ];
        for (const probe of probes) {
            const data = await probe.row();
            if (data) {
                // Owners carry their subscription gate so the frontend can screen
                // plan-bound pages (Faktur/Stok/...) without extra round-trips.
                if (probe.role === "owner") {
                    const gate = await (0, outlet_access_1.getSubscriptionGate)(userId);
                    return reply.send({ role: probe.role, data, gate });
                }
                return reply.send({ role: probe.role, data });
            }
        }
        // Fifth role: an ACTIVE outlet employee. data carries the permission map +
        // outlet so the frontend can gate the sidebar/pages without extra calls.
        const [employment] = await db_1.db
            .select({ employee: schema_1.employeesTable, outlet: schema_1.outletsTable })
            .from(schema_1.employeesTable)
            .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.outletsTable.id, schema_1.employeesTable.outlet_id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.employeesTable.user_id, userId), (0, drizzle_orm_1.eq)(schema_1.employeesTable.is_active, true)))
            .limit(1);
        if (employment) {
            const gate = await (0, outlet_access_1.getSubscriptionGate)(employment.outlet.user_id);
            return reply.send({
                role: "employee",
                gate,
                data: {
                    id: employment.employee.id,
                    outlet_id: employment.outlet.id,
                    outlet_name: employment.outlet.name,
                    permissions: employment.employee.permissions ?? {},
                },
            });
        }
        return reply.send({ role: null, data: null });
    });
    /**
     * The caller's phone plus whether they're currently allowed to change it.
     *
     * The eligibility is computed here rather than in the browser: the client
     * would have to be told the cooldown length and trusted to apply it, and the
     * answer depends on server time anyway.
     */
    app.get("/api/me/phone", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false });
        const [row] = await db_1.db
            .select({ phone: schema_1.usersTable.phone, changedAt: schema_1.usersTable.phone_changed_at })
            .from(schema_1.usersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.usersTable.id, session.user.id))
            .limit(1);
        const nextChangeAt = phoneCooldownEndsAt(row?.changedAt ?? null);
        return reply.send({
            success: true,
            phone: row?.phone ?? null,
            // Local 08… form for display; the column holds canonical 628…
            phoneDisplay: row?.phone ? (0, phone_1.formatIndonesianPhone)(row.phone) : null,
            canChange: nextChangeAt === null,
            nextChangeAt: nextChangeAt?.toISOString() ?? null,
        });
    });
    app.post("/api/me/phone", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        const phone = (0, phone_1.normalizeIndonesianPhone)(request.body?.phone);
        if (!phone) {
            return reply.status(400).send({
                success: false,
                error: "Nomor WhatsApp tidak valid. Pakai nomor Indonesia, minimal 11 angka.",
            });
        }
        const [row] = await db_1.db
            .select({ phone: schema_1.usersTable.phone, changedAt: schema_1.usersTable.phone_changed_at })
            .from(schema_1.usersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.usersTable.id, session.user.id))
            .limit(1);
        if (!row)
            return reply.status(404).send({ success: false, error: "User tidak ditemukan" });
        // Comparing canonical forms, so re-saving "0812-3456-7890" over
        // "08123456789" is correctly seen as the same number and doesn't burn the
        // month. Nothing changed means nothing to rate-limit.
        if (row.phone === phone) {
            return reply.send({ success: true, phone, phoneDisplay: (0, phone_1.formatIndonesianPhone)(phone) });
        }
        const nextChangeAt = phoneCooldownEndsAt(row.changedAt ?? null);
        if (nextChangeAt) {
            return reply.status(429).send({
                success: false,
                error: "Nomor WhatsApp hanya bisa diubah sekali sebulan.",
                nextChangeAt: nextChangeAt.toISOString(),
            });
        }
        await db_1.db
            .update(schema_1.usersTable)
            .set({ phone, phone_changed_at: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.usersTable.id, session.user.id));
        return reply.send({
            success: true,
            phone,
            phoneDisplay: (0, phone_1.formatIndonesianPhone)(phone),
            nextChangeAt: new Date(Date.now() + PHONE_CHANGE_COOLDOWN_MS).toISOString(),
        });
    });
}
