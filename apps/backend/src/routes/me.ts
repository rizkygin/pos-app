import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { adminsTable, customersTable, couriersTable, outletsTable, employeesTable } from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { getSubscriptionGate } from "../lib/outlet-access";

type Role = "admin" | "customer" | "courier" | "owner";

// Resolve the caller's role + profile row for the current session. Mirrors the
// former frontend lib/utils/get-role.ts probe so RSC pages and proxy.ts (admin
// gate) no longer touch the DB directly.
export async function meRoutes(app: FastifyInstance) {
  app.get("/api/me", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ role: null, data: null });

    const userId = session.user.id;

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
          return reply.send({ role: probe.role, data, gate });
        }
        return reply.send({ role: probe.role, data });
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
}
