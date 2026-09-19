import { and, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db";
import {
  adminsTable,
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
  // Manajemen Meja: the floor plan, seating, waitlist and reservations. Apart
  // from `cashier` because the host at the door is often not the person on
  // the till — and a bill still settles through the cashier permission.
  "tables",
  // Dapur: the Kitchen Display. Its own key so a kitchen tablet can sign in
  // to the tickets and nothing else — no till, no floor.
  "kitchen",
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
  /**
   * The features of the PAID PLAN this owner actually sits on — empty while
   * they are on a trial (no plan chosen yet), and unaffected by expiry.
   *
   * `features` above is the entitlement: what the owner may DO right now, so a
   * trial gets everything and a dead subscription gets nothing. That is the
   * wrong question for anything whose answer must not move under an owner's
   * history — see usesCostLedger below, where a trial that grants `stock`
   * would put a merchant on ledger costing they have no way to maintain, and
   * an expiry would silently restate every closed month.
   */
  planFeatures: Record<string, unknown>;
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
  tableManagement: true,
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

  // Read once, used twice: the plan is what the owner PAYS FOR (planFeatures,
  // true even when expired), while `features` below is what they may use today.
  let planFeatures: Record<string, unknown> = NO_FEATURES;
  if (sub.plan_id) {
    const [plan] = await db
      .select({ features: subscriptionPlansTable.features })
      .from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.id, sub.plan_id))
      .limit(1);
    planFeatures = (plan?.features as Record<string, unknown>) ?? NO_FEATURES;
  }

  let features: Record<string, unknown> = NO_FEATURES;
  if (alive && sub.status === "trialing") features = TRIAL_FEATURES;
  else if (alive && sub.plan_id) features = planFeatures;

  const gate: SubscriptionGate = {
    alive,
    status: sub.status,
    features,
    planFeatures,
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

/**
 * Is this owner's COST LEDGER worth reading? Decides where every HPP / laba
 * kotor figure comes from — see lib/cogs.ts.
 *
 * products.avg_cost is a running weighted average that only means anything
 * where it is MAINTAINED: received stock, opname, production. Migration 0063
 * seeded it from the hand-typed buying_price for every product that existed,
 * and on a plan without the Stok page nothing has moved it since. That seed is
 * a price per PACK — a sack, a crate, a carton — while a recipe consumes in
 * pieces, so a sale of one item costed through the ledger reads as twenty
 * sacks. Live example: outlet 44 sold Rp 550.000 of rice and the report booked
 * Rp 11.000.000 of HPP against it, a headline laba kotor of minus twenty
 * million. The same seed reads zero for anything created after 0063, and a
 * sale then books cost_change 0.00 — a real zero, which outranks the frozen
 * buying-price fallback and shows a 100% margin.
 *
 * So: only plans that include `stock` cost from the ledger. Everyone else — and
 * that includes a TRIAL, which grants `stock` it gives no way to maintain —
 * costs from the buying price frozen on the line when it sold.
 *
 * Read off planFeatures, not features, on purpose: an owner whose subscription
 * lapses keeps the costing basis their history was written under, instead of
 * having every closed month restated on the day they stop paying.
 */
export function usesCostLedger(gate: SubscriptionGate): boolean {
  return gate.planFeatures.stock === true;
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
// employees, settings). A list admits anyone holding ANY of the permissions —
// for a route two pages share, like a table's bill, which the host and the
// cashier both edit.
export async function requireOutletAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  perm: EmployeePermission | "owner" | readonly EmployeePermission[],
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
  // The permission that let them in, which is also the one the plan gate below
  // is asked about.
  const granted =
    typeof perm === "string"
      ? perm === "owner"
        ? access.isOwner
          ? perm
          : null
        : hasPermission(access, perm)
          ? perm
          : null
      : (perm.find((p) => hasPermission(access, p)) ?? null);
  if (!granted) {
    reply.status(403).send({ success: false, error: "Akses fitur ini belum diizinkan pemilik" });
    return null;
  }
  const gate = await getSubscriptionGate(access.outlet.user_id);
  const blocked = gateBlocks(gate, granted, request.method);
  if (blocked) {
    reply.status(403).send({ success: false, error: blocked, code: gate.alive ? "PLAN_FEATURE" : "SUBSCRIPTION_EXPIRED" });
    return null;
  }
  return { ...access, userId: session.user.id, gate };
}

/**
 * Guard for a route that names its outlet in the URL rather than reading the
 * active-outlet cookie: the outlet's OWNER, or a platform admin.
 *
 * `requireOutletAccess` resolves whichever outlet the caller is currently
 * switched to, which is right for the dashboard but wrong — and unsafe — for a
 * link someone can be sent: getOutletAccess() falls back to the caller's FIRST
 * outlet when the requested id isn't theirs, so an owner of outlet 7 asking for
 * outlet 43 would silently be served their own data under someone else's id.
 * The identity check below is what makes the URL mean what it says.
 *
 * Platform admins are resolved FIRST and by a different path, because they
 * typically own no outlet at all — getOutletAccess() returns null for them, so
 * the owner branch below can never let them through for any outlet. They get
 * the named outlet directly. `isOwner` stays honest (false when they are merely
 * an admin) and `isPlatformAdmin` says how they got in, so a page can disclose
 * that it is showing another merchant's books.
 *
 * Employees never pass, regardless of their permission map.
 */
export async function requireOutletOwnerOrAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  outletId: number,
): Promise<
  (OutletAccess & { userId: string; gate: SubscriptionGate; isPlatformAdmin: boolean }) | null
> {
  const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
  if (!session?.user) {
    reply.status(401).send({ success: false, error: "Unauthorized" });
    return null;
  }

  // A row in `admins` IS the admin role everywhere in this codebase — /api/me
  // and routes/admin.ts both test exactly this, with no deleted_at filter.
  // Diverging here would make an account that passes the proxy's admin gate
  // fail this one, which is the kind of split nobody can debug from a 403.
  const [admin] = await db
    .select({ id: adminsTable.id })
    .from(adminsTable)
    .where(eq(adminsTable.user_id, session.user.id))
    .limit(1);

  if (admin) {
    const [outlet] = await db
      .select()
      .from(outletsTable)
      .where(eq(outletsTable.id, outletId))
      .limit(1);
    if (!outlet) {
      reply.status(404).send({ success: false, error: "Outlet tidak ditemukan" });
      return null;
    }
    // The gate belongs to the outlet's OWNER, never to the admin reading it.
    const gate = await getSubscriptionGate(outlet.user_id);
    return {
      outlet,
      isOwner: outlet.user_id === session.user.id,
      permissions: null,
      employeeId: null,
      userId: session.user.id,
      gate,
      isPlatformAdmin: true,
    };
  }

  const access = await getOutletAccess(session.user.id, outletId);
  if (!access || !access.isOwner || access.outlet.id !== outletId) {
    reply.status(403).send({ success: false, error: "Halaman ini hanya untuk pemilik outlet" });
    return null;
  }
  const gate = await getSubscriptionGate(access.outlet.user_id);
  return { ...access, userId: session.user.id, gate, isPlatformAdmin: false };
}
