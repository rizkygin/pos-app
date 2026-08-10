import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { adminsTable, customersTable, couriersTable, outletsTable, employeesTable, usersTable } from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { getSubscriptionGate } from "../lib/outlet-access";
import { normalizeIndonesianPhone, formatIndonesianPhone } from "../lib/utils/phone";

type Role = "admin" | "customer" | "courier" | "owner";

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
function phoneCooldownEndsAt(changedAt: Date | null): Date | null {
  if (!changedAt) return null;
  const endsAt = changedAt.getTime() + PHONE_CHANGE_COOLDOWN_MS;
  return endsAt > Date.now() ? new Date(endsAt) : null;
}

// Resolve the caller's role + profile row for the current session. Mirrors the
// former frontend lib/utils/get-role.ts probe so RSC pages and proxy.ts (admin
// gate) no longer touch the DB directly.
export async function meRoutes(app: FastifyInstance) {
  app.get("/api/me", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ role: null, data: null });

    const userId = session.user.id;

    // Contact state travels with every role, so the dashboard layout can gate on
    // it without a second round-trip. Only customers are gated today, but the
    // number is equally real for a courier or an owner.
    const [contact] = await db
      .select({ phone: usersTable.phone, phoneVerified: usersTable.phone_verified })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    const phone = {
      phone: contact?.phone ?? null,
      phoneVerified: contact?.phoneVerified ?? false,
    };

    const probes: { role: Role; row: () => Promise<unknown> }[] = [
      { role: "admin", row: () => db.query.adminsTable.findFirst({ where: eq(adminsTable.user_id, userId) }) },
      { role: "customer", row: () => db.query.customersTable.findFirst({ where: eq(customersTable.user_id, userId) }) },
      { role: "courier", row: () => db.query.couriersTable.findFirst({ where: eq(couriersTable.user_id, userId) }) },
      { role: "owner", row: () => db.query.outletsTable.findFirst({ where: eq(outletsTable.user_id, userId) }) },
    ];

    for (const probe of probes) {
      const data = await probe.row();
      if (data) {
        // Owners carry their subscription gate so the frontend can screen
        // plan-bound pages (Faktur/Stok/...) without extra round-trips.
        if (probe.role === "owner") {
          const gate = await getSubscriptionGate(userId);
          return reply.send({ role: probe.role, data, gate, ...phone });
        }
        return reply.send({ role: probe.role, data, ...phone });
      }
    }

    // Fifth role: an ACTIVE outlet employee. data carries the permission map +
    // outlet so the frontend can gate the sidebar/pages without extra calls.
    const [employment] = await db
      .select({ employee: employeesTable, outlet: outletsTable })
      .from(employeesTable)
      .innerJoin(outletsTable, eq(outletsTable.id, employeesTable.outlet_id))
      .where(and(eq(employeesTable.user_id, userId), eq(employeesTable.is_active, true)))
      .limit(1);
    if (employment) {
      const gate = await getSubscriptionGate(employment.outlet.user_id);
      return reply.send({
        role: "employee",
        gate,
        ...phone,
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
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const [row] = await db
      .select({
        phone: usersTable.phone,
        changedAt: usersTable.phone_changed_at,
        verified: usersTable.phone_verified,
      })
      .from(usersTable)
      .where(eq(usersTable.id, session.user.id))
      .limit(1);

    const nextChangeAt = phoneCooldownEndsAt(row?.changedAt ?? null);

    return reply.send({
      success: true,
      phone: row?.phone ?? null,
      phoneVerified: row?.verified ?? false,
      // Local 08… form for display; the column holds canonical 628…
      phoneDisplay: row?.phone ? formatIndonesianPhone(row.phone) : null,
      canChange: nextChangeAt === null,
      nextChangeAt: nextChangeAt?.toISOString() ?? null,
    });
  });

  app.post("/api/me/phone", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const phone = normalizeIndonesianPhone((request.body as { phone?: unknown })?.phone);
    if (!phone) {
      return reply.status(400).send({
        success: false,
        error: "Nomor WhatsApp tidak valid. Pakai nomor Indonesia, minimal 11 angka.",
      });
    }

    const [row] = await db
      .select({ phone: usersTable.phone, changedAt: usersTable.phone_changed_at })
      .from(usersTable)
      .where(eq(usersTable.id, session.user.id))
      .limit(1);
    if (!row) return reply.status(404).send({ success: false, error: "User tidak ditemukan" });

    // Comparing canonical forms, so re-saving "0812-3456-7890" over
    // "08123456789" is correctly seen as the same number and doesn't burn the
    // month. Nothing changed means nothing to rate-limit.
    if (row.phone === phone) {
      return reply.send({ success: true, phone, phoneDisplay: formatIndonesianPhone(phone) });
    }

    const nextChangeAt = phoneCooldownEndsAt(row.changedAt ?? null);
    if (nextChangeAt) {
      return reply.status(429).send({
        success: false,
        error: "Nomor WhatsApp hanya bisa diubah sekali sebulan.",
        nextChangeAt: nextChangeAt.toISOString(),
      });
    }

    // A new number is an unproven number: carrying the old flag over would let
    // anyone verify once and then swap in a number they don't own.
    await db
      .update(usersTable)
      .set({ phone, phone_changed_at: new Date(), phone_verified: false })
      .where(eq(usersTable.id, session.user.id));

    return reply.send({
      success: true,
      phone,
      phoneDisplay: formatIndonesianPhone(phone),
      nextChangeAt: new Date(Date.now() + PHONE_CHANGE_COOLDOWN_MS).toISOString(),
    });
  });
}
