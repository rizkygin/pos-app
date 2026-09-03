"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPLOYEE_PERMISSIONS = void 0;
exports.parseActiveOutletId = parseActiveOutletId;
exports.getOutletAccess = getOutletAccess;
exports.hasPermission = hasPermission;
exports.invalidateGate = invalidateGate;
exports.getSubscriptionGate = getSubscriptionGate;
exports.hasFeature = hasFeature;
exports.gateBlocks = gateBlocks;
exports.requireOutletAccess = requireOutletAccess;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const subscription_1 = require("./subscription");
const auth_1 = require("../auth");
const web_headers_1 = require("./web-headers");
// ============================================================================
// Outlet access resolution: replaces the old "this user OWNS an outlet"
// assumption with "owner OR active employee of one". Every outlet-scoped route
// group declares the employee permission it requires; owners implicitly pass
// every check. This is also the layer subscription gating will plug into.
// ============================================================================
// The full page-level permission catalog. Owner UI renders one toggle per key;
// routes require one of these. Adding a page = add a key here + a toggle label
// in the frontend — no migration (permissions is a json map).
exports.EMPLOYEE_PERMISSIONS = [
    "cashier",
    "activeOrders",
    "products",
    "stock",
    "salesInvoice",
    "purchaseInvoice",
    "reports",
    "cashflow",
];
// Multi-outlet: the owner's ACTIVE outlet is chosen by the `active_outlet`
// cookie (set by POST /api/outlets/active); an unowned/absent value falls back
// to their first outlet. Employees are bound to one outlet — no cookie.
function parseActiveOutletId(request) {
    const cookie = request.headers.cookie ?? "";
    const m = /(?:^|;\s*)active_outlet=(\d+)/.exec(cookie);
    return m ? Number(m[1]) : null;
}
// Resolve how (if at all) a user may act on an outlet: their own outlet
// (preferring `preferredOutletId` when they own it), otherwise an ACTIVE
// employment. Returns null when neither exists.
async function getOutletAccess(userId, preferredOutletId) {
    const owned = await db_1.db
        .select()
        .from(schema_1.outletsTable)
        .where((0, drizzle_orm_1.eq)(schema_1.outletsTable.user_id, userId))
        .orderBy(schema_1.outletsTable.id);
    if (owned.length) {
        const own = owned.find((o) => o.id === preferredOutletId) ?? owned[0];
        return { outlet: own, isOwner: true, permissions: null, employeeId: null };
    }
    const [emp] = await db_1.db
        .select({ employee: schema_1.employeesTable, outlet: schema_1.outletsTable })
        .from(schema_1.employeesTable)
        .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.outletsTable.id, schema_1.employeesTable.outlet_id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.employeesTable.user_id, userId), (0, drizzle_orm_1.eq)(schema_1.employeesTable.is_active, true)))
        .limit(1);
    if (!emp)
        return null;
    return {
        outlet: emp.outlet,
        isOwner: false,
        permissions: emp.employee.permissions ?? {},
        employeeId: emp.employee.id,
    };
}
function hasPermission(access, perm) {
    if (access.isOwner)
        return true;
    return access.permissions?.[perm] === true;
}
// Full access during trials — showcase everything, cap at the top tier's limits.
const TRIAL_FEATURES = {
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
};
const NO_FEATURES = {};
const GATE_TTL_MS = 60_000;
const gateCache = new Map();
function invalidateGate(ownerUserId) {
    gateCache.delete(ownerUserId);
}
async function getSubscriptionGate(ownerUserId) {
    const hit = gateCache.get(ownerUserId);
    if (hit && Date.now() - hit.at < GATE_TTL_MS)
        return hit.gate;
    let [sub] = await db_1.db
        .select()
        .from(schema_1.subscriptionsTable)
        .where((0, drizzle_orm_1.eq)(schema_1.subscriptionsTable.user_id, ownerUserId))
        .limit(1);
    if (!sub) {
        // First-ever touch of a gated route without a subscription: start the
        // standard 14-day trial so a brand-new owner is never read-only on day 0.
        const now = new Date();
        const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
        [sub] = await db_1.db
            .insert(schema_1.subscriptionsTable)
            .values({
            user_id: ownerUserId,
            status: "trialing",
            trial_ends_at: trialEnd,
            current_period_start: now,
            current_period_end: trialEnd,
        })
            .onConflictDoNothing({ target: schema_1.subscriptionsTable.user_id })
            .returning();
        if (!sub) {
            [sub] = await db_1.db
                .select()
                .from(schema_1.subscriptionsTable)
                .where((0, drizzle_orm_1.eq)(schema_1.subscriptionsTable.user_id, ownerUserId))
                .limit(1);
        }
    }
    sub = await (0, subscription_1.applyScheduledTierIfDue)(sub);
    const now = new Date();
    const alive = (sub.status === "trialing" || sub.status === "active") &&
        !!sub.current_period_end &&
        sub.current_period_end > now;
    let features = NO_FEATURES;
    if (alive && sub.status === "trialing")
        features = TRIAL_FEATURES;
    else if (alive && sub.plan_id) {
        const [plan] = await db_1.db
            .select({ features: schema_1.subscriptionPlansTable.features })
            .from(schema_1.subscriptionPlansTable)
            .where((0, drizzle_orm_1.eq)(schema_1.subscriptionPlansTable.id, sub.plan_id))
            .limit(1);
        features = plan?.features ?? NO_FEATURES;
    }
    const gate = {
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
const PERM_FEATURE = {
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
function hasFeature(gate, flag) {
    return gate.features[flag] === true;
}
// Gate verdict for one request: null = allowed, otherwise the error message.
// Reads stay open when expired (read-only mode); plan-feature boundaries apply
// to reads too (a Basic owner shouldn't browse Faktur at all).
function gateBlocks(gate, perm, method) {
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
async function requireOutletAccess(request, reply, perm) {
    const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
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
