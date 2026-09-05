import { and, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db";
import {
  employeesTable,
  outletsTable,
  subscriptionsTable,
  subscriptionPlansTable,
} from "../db/schema";
import { applyScheduledTierIfDue } from "./subscription";
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

// Multi-outlet: the owner's ACTIVE outlet is chosen by the `active_outlet`
// cookie (set by POST /api/outlets/active); an unowned/absent value falls back
// to their first outlet. Employees are bound to one outlet — no cookie.
export function parseActiveOutletId(request: FastifyRequest): number | null {
  const cookie = request.headers.cookie ?? "";
  const m = /(?:^|;\s*)active_outlet=(\d+)/.exec(cookie);
  return m ? Number(m[1]) : null;
}

// Resolve how (if at all) a user may act on an outlet: their own outlet
// (preferring `preferredOutletId` when they own it), otherwise an ACTIVE
// employment. Returns null when neither exists.
export async function getOutletAccess(
  userId: string,
  preferredOutletId?: number | null,
): Promise<OutletAccess | null> {
  const owned = await db
    .select()
    .from(outletsTable)
    .where(eq(outletsTable.user_id, userId))
    .orderBy(outletsTable.id);
  if (owned.length) {
    const own = owned.find((o) => o.id === preferredOutletId) ?? owned[0];
    return { outlet: own, isOwner: true, permissions: null, employeeId: null };
  }

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

// ============================================================================
// Subscription gate: is the OWNER's subscription alive, and what does their
// plan include? Cached briefly (per-process) — every outlet-scoped request
// consults it. Trials see everything (that's what a trial is for); an expired
// subscription drops the outlet to READ-ONLY (writes blocked, data never
// hostage). Owners without any subscription row get a standard trial
// auto-created on first touch (existing owners are backfilled separately with
// the 30-day grandfather window).
// ============================================================================
export type SubscriptionGate = {
  alive: boolean;
  status: string;
  features: Record<string, unknown>;
  periodEnd: Date | null;
};

// Full access during trials — showcase everything, cap at the top tier's limits.
const TRIAL_FEATURES: Record<string, unknown> = {
  maxOutlets: 3,
  maxEmployees: 5,
  desktopCashier: true,
  cashierShift: true,
  pager: true,
  tax: true,
  customerCanOrder: true,
  salesInvoice: true,
  purchaseInvoice: true,
  stock: true,
  cashflow: true,
  report: true,
  reportInvoice: true,
  recipeExplorer: true,
  membership: true,
};
const NO_FEATURES: Record<string, unknown> = {};

const GATE_TTL_MS = 60_000;
const gateCache = new Map<string, { gate: SubscriptionGate; at: number }>();

export function invalidateGate(ownerUserId: string) {
  gateCache.delete(ownerUserId);
}

export async function getSubscriptionGate(ownerUserId: string): Promise<SubscriptionGate> {
  const hit = gateCache.get(ownerUserId);
  if (hit && Date.now() - hit.at < GATE_TTL_MS) return hit.gate;

  let [sub] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.user_id, ownerUserId))
    .limit(1);

  if (!sub) {
    // First-ever touch of a gated route without a subscription: start the
    // standard 14-day trial so a brand-new owner is never read-only on day 0.
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    [sub] = await db
      .insert(subscriptionsTable)
      .values({
        user_id: ownerUserId,
        status: "trialing",
        trial_ends_at: trialEnd,
        current_period_start: now,
        current_period_end: trialEnd,
      })
      .onConflictDoNothing({ target: subscriptionsTable.user_id })
      .returning();
    if (!sub) {
      [sub] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.user_id, ownerUserId))
        .limit(1);
    }
  }

  sub = await applyScheduledTierIfDue(sub);

  const now = new Date();
  const alive =
    (sub.status === "trialing" || sub.status === "active") &&
    !!sub.current_period_end &&
    sub.current_period_end > now;

  let features: Record<string, unknown> = NO_FEATURES;
  if (alive && sub.status === "trialing") features = TRIAL_FEATURES;
  else if (alive && sub.plan_id) {
    const [plan] = await db
      .select({ features: subscriptionPlansTable.features })
      .from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.id, sub.plan_id))
      .limit(1);
    features = (plan?.features as Record<string, unknown>) ?? NO_FEATURES;
  }

  const gate: SubscriptionGate = {
    alive,
    status: sub.status,
    features,
    periodEnd: sub.current_period_end,
  };
  gateCache.set(ownerUserId, { gate, at: Date.now() });
  return gate;
}

// Which plan feature (if any) a permission group needs. Unlisted groups
// (cashier, activeOrders, products) are included in every tier.
const PERM_FEATURE: Partial<Record<EmployeePermission, string>> = {
  salesInvoice: "salesInvoice",
  purchaseInvoice: "purchaseInvoice",
  stock: "stock",
  cashflow: "cashflow",
  reports: "report",
};

/**
 * Does the plan include one specific feature flag?
 *
 * PERM_FEATURE above maps a whole PERMISSION GROUP to a flag, which is the
 * right shape when a plan boundary lines up with a page ("Faktur", "Stok").
 * Some boundaries don't: opening a cashier shift is one action inside the
 * cashier page, and the rest of that page is in every tier. Gating it through
 * PERM_FEATURE would lock the whole till for a Basic merchant.
 *
 * An expired subscription is NOT a feature question — writes are already
 * blocked by gateBlocks, and reads stay open so data is never held hostage — so
 * this only answers "is it in the plan", never "is the plan alive".
 */
export function hasFeature(gate: SubscriptionGate, flag: string): boolean {
  return gate.features[flag] === true;
}

// Gate verdict for one request: null = allowed, otherwise the error message.
// Reads stay open when expired (read-only mode); plan-feature boundaries apply
// to reads too (a Basic owner shouldn't browse Faktur at all).
export function gateBlocks(
  gate: SubscriptionGate,
  perm: EmployeePermission | "owner",
  method: string,
): string | null {
  const isWrite = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  if (!gate.alive && isWrite) {
    return "Langganan berakhir — perpanjang di halaman Langganan untuk melanjutkan.";
  }
  if (perm !== "owner") {
    const flag = PERM_FEATURE[perm];
    if (flag && gate.alive && gate.features[flag] !== true) {
      return "Fitur ini tidak termasuk paket Pian — upgrade paket untuk membukanya.";
    }
  }
  return null;
}

// Route-guard helper: session -> access -> permission -> subscription gate,
// sending the matching error itself (mirrors the getOwnerOutlet pattern used
// across routes). `perm: "owner"` restricts to the actual owner (billing,
// employees, settings).
export async function requireOutletAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  perm: EmployeePermission | "owner",
): Promise<(OutletAccess & { userId: string; gate: SubscriptionGate }) | null> {
  const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
  if (!session?.user) {
    reply.status(401).send({ success: false, error: "Unauthorized" });
    return null;
  }
  const access = await getOutletAccess(session.user.id, parseActiveOutletId(request));
  if (!access) {
    reply.status(403).send({ success: false, error: "No outlet found" });
    return null;
  }
  if (perm === "owner" ? !access.isOwner : !hasPermission(access, perm)) {
    reply.status(403).send({ success: false, error: "Akses fitur ini belum diizinkan pemilik" });
    return null;
  }
  const gate = await getSubscriptionGate(access.outlet.user_id);
  const blocked = gateBlocks(gate, perm, request.method);
  if (blocked) {
    reply.status(403).send({ success: false, error: blocked, code: gate.alive ? "PLAN_FEATURE" : "SUBSCRIPTION_EXPIRED" });
    return null;
  }
  return { ...access, userId: session.user.id, gate };
}
