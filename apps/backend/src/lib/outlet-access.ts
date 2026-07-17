import { and, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db";
import { employeesTable, outletsTable } from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "./web-headers";

// ============================================================================
// Outlet access resolution: replaces the old "this user OWNS an outlet"
// assumption with "owner OR active employee of one". Every outlet-scoped route
// group declares the employee permission it requires; owners implicitly pass
// every check. This is also the layer subscription gating will plug into.
// ============================================================================

// The full page-level permission catalog. Owner UI renders one toggle per key;
// routes require one of these. Adding a page = add a key here + a toggle label
// in the frontend — no migration (permissions is a json map).
export const EMPLOYEE_PERMISSIONS = [
  "cashier",
  "activeOrders",
  "products",
  "stock",
  "salesInvoice",
  "purchaseInvoice",
  "reports",
  "cashflow",
] as const;
export type EmployeePermission = (typeof EMPLOYEE_PERMISSIONS)[number];

export type OutletAccess = {
  outlet: typeof outletsTable.$inferSelect;
  isOwner: boolean;
  // null for owners (= all); the stored map for employees.
  permissions: Record<string, boolean> | null;
  employeeId: number | null;
};

// Resolve how (if at all) a user may act on an outlet: their own outlet first,
// otherwise an ACTIVE employment. Returns null when neither exists.
export async function getOutletAccess(userId: string): Promise<OutletAccess | null> {
  const [own] = await db
    .select()
    .from(outletsTable)
    .where(eq(outletsTable.user_id, userId))
    .limit(1);
  if (own) return { outlet: own, isOwner: true, permissions: null, employeeId: null };

  const [emp] = await db
    .select({ employee: employeesTable, outlet: outletsTable })
    .from(employeesTable)
    .innerJoin(outletsTable, eq(outletsTable.id, employeesTable.outlet_id))
    .where(and(eq(employeesTable.user_id, userId), eq(employeesTable.is_active, true)))
    .limit(1);
  if (!emp) return null;
  return {
    outlet: emp.outlet,
    isOwner: false,
    permissions: emp.employee.permissions ?? {},
    employeeId: emp.employee.id,
  };
}

export function hasPermission(access: OutletAccess, perm: EmployeePermission): boolean {
  if (access.isOwner) return true;
  return access.permissions?.[perm] === true;
}

// Route-guard helper: session -> access -> permission, sending the matching
// error itself (mirrors the getOwnerOutlet pattern used across routes).
// `perm: "owner"` restricts to the actual owner (billing, employees, settings).
export async function requireOutletAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  perm: EmployeePermission | "owner",
): Promise<(OutletAccess & { userId: string }) | null> {
  const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
  if (!session?.user) {
    reply.status(401).send({ success: false, error: "Unauthorized" });
    return null;
  }
  const access = await getOutletAccess(session.user.id);
  if (!access) {
    reply.status(403).send({ success: false, error: "No outlet found" });
    return null;
  }
  if (perm === "owner" ? !access.isOwner : !hasPermission(access, perm)) {
    reply.status(403).send({ success: false, error: "Akses fitur ini belum diizinkan pemilik" });
    return null;
  }
  return { ...access, userId: session.user.id };
}
