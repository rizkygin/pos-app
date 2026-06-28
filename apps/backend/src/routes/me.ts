import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { adminsTable, customersTable, couriersTable, outletsTable } from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";

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
      if (data) return reply.send({ role: probe.role, data });
    }

    return reply.send({ role: null, data: null });
  });
}
