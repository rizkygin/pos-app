"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriptionRoutes = subscriptionRoutes;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const sharp_1 = __importDefault(require("sharp"));
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../auth");
const web_headers_1 = require("../lib/web-headers");
const outlet_id_1 = require("../lib/outlet-id");
const subscription_1 = require("../lib/subscription");
const outlet_access_1 = require("../lib/outlet-access");
const timezone_1 = require("../lib/timezone");
const PROOF_DIR = node_path_1.default.join(process.cwd(), "uploads", "subscriptions");
const PROOF_URL_PREFIX = "/uploads/subscriptions/";
// Session (any logged-in user) or null + 401 sent.
async function getSessionUser(request, reply) {
    const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
    if (!session?.user) {
        reply.status(401).send({ success: false, error: "Unauthorized" });
        return null;
    }
    return session.user;
}
// Subscriptions hang off the OWNER account: any authenticated user that owns an
// outlet. Mirrors the guard style used across owner routes.
async function getOwnerUser(request, reply) {
    const user = await getSessionUser(request, reply);
    if (!user)
        return null;
    const outlet = await (0, outlet_id_1.getOutletByUserId)(user.id);
    if (!outlet) {
        reply.status(403).send({ success: false, error: "No outlet found" });
        return null;
    }
    return user;
}
async function getAdminUser(request, reply) {
    const user = await getSessionUser(request, reply);
    if (!user)
        return null;
    const [admin] = await db_1.db
        .select({ id: schema_1.adminsTable.id })
        .from(schema_1.adminsTable)
        .where((0, drizzle_orm_1.eq)(schema_1.adminsTable.user_id, user.id))
        .limit(1);
    if (!admin) {
        reply.status(403).send({ success: false, error: "Forbidden" });
        return null;
    }
    return user;
}
async function subscriptionRoutes(app) {
    // ------------------------------------------------------------- merchant side
    app.get("/api/subscription-plans", async (request, reply) => {
        const user = await getSessionUser(request, reply);
        if (!user)
            return;
        const [plans, [sub]] = await Promise.all([
            db_1.db
                .select()
                .from(schema_1.subscriptionPlansTable)
                .where((0, drizzle_orm_1.eq)(schema_1.subscriptionPlansTable.is_active, true))
                .orderBy(schema_1.subscriptionPlansTable.sort_order, schema_1.subscriptionPlansTable.interval),
            db_1.db
                .select({
                discount_pct: schema_1.subscriptionsTable.discount_pct,
                discount_tier: schema_1.subscriptionsTable.discount_tier,
                discount_interval: schema_1.subscriptionsTable.discount_interval,
                discount_note: schema_1.subscriptionsTable.discount_note,
            })
                .from(schema_1.subscriptionsTable)
                .where((0, drizzle_orm_1.eq)(schema_1.subscriptionsTable.user_id, user.id))
                .limit(1),
        ]);
        // The caller's marketing deal (if any) so plan cards can render the
        // merchant's special price. NULL tier/interval scope = applies to any.
        const deal = sub && Number(sub.discount_pct) > 0
            ? {
                pct: Number(sub.discount_pct),
                tier: sub.discount_tier,
                interval: sub.discount_interval,
                note: sub.discount_note ?? "",
            }
            : null;
        return { success: true, data: plans, bank: subscription_1.BANK_INFO, deal };
    });
    app.get("/api/my-subscription", async (request, reply) => {
        const user = await getOwnerUser(request, reply);
        if (!user)
            return;
        let [sub] = await db_1.db
            .select()
            .from(schema_1.subscriptionsTable)
            .where((0, drizzle_orm_1.eq)(schema_1.subscriptionsTable.user_id, user.id))
            .limit(1);
        // Apply a scheduled downgrade whose boundary has passed (lazy, cron-free).
        if (sub)
            sub = await (0, subscription_1.applyScheduledTierIfDue)(sub);
        const payments = sub
            ? await db_1.db
                .select({
                id: schema_1.subscriptionPaymentsTable.id,
                tier: schema_1.subscriptionPaymentsTable.tier,
                interval: schema_1.subscriptionPaymentsTable.interval,
                amount_due: schema_1.subscriptionPaymentsTable.amount_due,
                status: schema_1.subscriptionPaymentsTable.status,
                proof_image: schema_1.subscriptionPaymentsTable.proof_image,
                review_note: schema_1.subscriptionPaymentsTable.review_note,
                expires_at: schema_1.subscriptionPaymentsTable.expires_at,
                paid_at: schema_1.subscriptionPaymentsTable.paid_at,
                period_end: schema_1.subscriptionPaymentsTable.period_end,
                created_at: schema_1.subscriptionPaymentsTable.createdAt,
            })
                .from(schema_1.subscriptionPaymentsTable)
                .where((0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.subscription_id, sub.id))
                .orderBy((0, drizzle_orm_1.desc)(schema_1.subscriptionPaymentsTable.createdAt))
                .limit(10)
            : [];
        return { success: true, data: { subscription: sub ?? null, payments }, bank: subscription_1.BANK_INFO };
    });
    // Create (or return the existing live) pending payment for a plan. The
    // response carries amount_due — the EXACT figure the merchant must transfer.
    app.post("/api/subscription-payments", async (request, reply) => {
        const user = await getOwnerUser(request, reply);
        if (!user)
            return;
        const { plan_id } = (request.body ?? {});
        if (!plan_id)
            return reply.status(400).send({ success: false, error: "plan_id wajib diisi" });
        try {
            const { payment, subscription, reused } = await (0, subscription_1.createPendingPayment)(user.id, Number(plan_id));
            return reply.status(reused ? 200 : 201).send({
                success: true,
                data: { payment, subscription, reused },
                bank: subscription_1.BANK_INFO,
                instructions: `Transfer TEPAT ${Number(payment.amount_due).toLocaleString("id-ID")} (3 digit terakhir adalah kode unik Pian) ke ${subscription_1.BANK_INFO.bank} ${subscription_1.BANK_INFO.account_number} a.n. ${subscription_1.BANK_INFO.account_holder}, lalu unggah bukti transfer.`,
            });
        }
        catch (e) {
            const msg = String(e instanceof Error ? e.message : e);
            if (msg.includes("PLAN_NOT_FOUND"))
                return reply.status(404).send({ success: false, error: "Paket tidak ditemukan" });
            return reply.status(500).send({ success: false, error: msg });
        }
    });
    // Upload the transfer proof (multipart image + optional sender fields). Only
    // the payment's owner may attach, and only while it is pending.
    app.post("/api/subscription-payments/:id/proof", async (request, reply) => {
        const user = await getOwnerUser(request, reply);
        if (!user)
            return;
        const id = Number(request.params.id);
        const [payment] = await db_1.db
            .select()
            .from(schema_1.subscriptionPaymentsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.id, id), (0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.user_id, user.id)))
            .limit(1);
        if (!payment)
            return reply.status(404).send({ success: false, error: "Pembayaran tidak ditemukan" });
        // A REJECTED payment is re-submittable: the merchant's money may already be
        // transferred (rejection is often just a bad screenshot), so a corrected
        // proof flips it back to pending for another admin review. Paid/expired
        // stay closed.
        const isResubmit = payment.status === "rejected";
        if (payment.status !== "pending" && !isResubmit)
            return reply.status(409).send({ success: false, error: "Pembayaran sudah diproses" });
        const file = await request.file();
        if (!file)
            return reply.status(400).send({ success: false, error: "Bukti transfer wajib diunggah" });
        const fields = file.fields;
        const fieldValue = (name) => {
            const f = fields[name];
            return f && typeof f.value === "string" ? f.value.slice(0, 255) : "";
        };
        const buffer = await file.toBuffer();
        const filename = `proof-${id}-${Date.now()}.webp`;
        await promises_1.default.mkdir(PROOF_DIR, { recursive: true });
        // Keep proofs readable but bounded: fit inside 1200px, webp.
        await (0, sharp_1.default)(buffer)
            .resize(1200, 1600, { fit: "inside", withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(node_path_1.default.join(PROOF_DIR, filename));
        const updated = await db_1.db.transaction(async (tx) => {
            const [row] = await tx
                .update(schema_1.subscriptionPaymentsTable)
                .set({
                proof_image: `${PROOF_URL_PREFIX}${filename}`,
                sender_bank: fieldValue("sender_bank"),
                sender_name: fieldValue("sender_name"),
                merchant_note: fieldValue("merchant_note").slice(0, 500),
                transfer_date: new Date(),
                // Resubmit: back into the admin queue with a fresh expiry window;
                // the old review verdict is cleared (full history stays in events).
                ...(isResubmit
                    ? {
                        status: "pending",
                        reviewed_by: null,
                        reviewed_at: null,
                        review_note: null,
                        expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
                    }
                    : {}),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.id, id))
                .returning();
            if (isResubmit) {
                await tx.insert(schema_1.subscriptionEventsTable).values({
                    subscription_id: payment.subscription_id,
                    user_id: user.id,
                    payment_id: id,
                    type: "proof_resubmitted",
                    actor: "merchant",
                    actor_id: user.id,
                    detail: { previous_status: "rejected" },
                });
            }
            return row;
        });
        return { success: true, data: updated };
    });
    // Merchant's in-app notifications (subscription outbox rows, newest first).
    app.get("/api/my-subscription/notifications", async (request, reply) => {
        const user = await getOwnerUser(request, reply);
        if (!user)
            return;
        const rows = await db_1.db
            .select()
            .from(schema_1.subscriptionNotificationsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.subscriptionNotificationsTable.user_id, user.id), (0, drizzle_orm_1.eq)(schema_1.subscriptionNotificationsTable.channel, "in_app")))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.subscriptionNotificationsTable.created_at))
            .limit(20);
        return { success: true, data: rows };
    });
    // ---------------------------------------------------------------- admin side
    app.get("/api/admin/subscription-payments", async (request, reply) => {
        const admin = await getAdminUser(request, reply);
        if (!admin)
            return;
        const { status = "pending", page = "1", limit = "20" } = request.query;
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
        // Self-cleaning queue: void anything past its expiry before listing.
        await (0, subscription_1.expireStalePayments)();
        const statusFilter = status === "all"
            ? undefined
            : (0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.status, status);
        const [rows, [{ n: total }], [{ n: pendingCount }]] = await Promise.all([
            db_1.db
                .select({
                id: schema_1.subscriptionPaymentsTable.id,
                user_id: schema_1.subscriptionPaymentsTable.user_id,
                user_name: schema_1.usersTable.name,
                user_email: schema_1.usersTable.email,
                plan_name: schema_1.subscriptionPlansTable.name,
                tier: schema_1.subscriptionPaymentsTable.tier,
                interval: schema_1.subscriptionPaymentsTable.interval,
                amount: schema_1.subscriptionPaymentsTable.amount,
                unique_code: schema_1.subscriptionPaymentsTable.unique_code,
                amount_due: schema_1.subscriptionPaymentsTable.amount_due,
                status: schema_1.subscriptionPaymentsTable.status,
                proof_image: schema_1.subscriptionPaymentsTable.proof_image,
                sender_bank: schema_1.subscriptionPaymentsTable.sender_bank,
                sender_name: schema_1.subscriptionPaymentsTable.sender_name,
                transfer_date: schema_1.subscriptionPaymentsTable.transfer_date,
                merchant_note: schema_1.subscriptionPaymentsTable.merchant_note,
                review_note: schema_1.subscriptionPaymentsTable.review_note,
                expires_at: schema_1.subscriptionPaymentsTable.expires_at,
                paid_at: schema_1.subscriptionPaymentsTable.paid_at,
                period_end: schema_1.subscriptionPaymentsTable.period_end,
                created_at: schema_1.subscriptionPaymentsTable.createdAt,
            })
                .from(schema_1.subscriptionPaymentsTable)
                .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.usersTable.id, schema_1.subscriptionPaymentsTable.user_id))
                .innerJoin(schema_1.subscriptionPlansTable, (0, drizzle_orm_1.eq)(schema_1.subscriptionPlansTable.id, schema_1.subscriptionPaymentsTable.plan_id))
                .where(statusFilter)
                .orderBy((0, drizzle_orm_1.desc)(schema_1.subscriptionPaymentsTable.createdAt))
                .limit(limitNum)
                .offset((pageNum - 1) * limitNum),
            db_1.db
                .select({ n: (0, drizzle_orm_1.sql) `count(*)::int` })
                .from(schema_1.subscriptionPaymentsTable)
                .where(statusFilter),
            db_1.db
                .select({ n: (0, drizzle_orm_1.sql) `count(*)::int` })
                .from(schema_1.subscriptionPaymentsTable)
                .where((0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.status, "pending")),
        ]);
        return { success: true, data: rows, total, pendingCount, page: pageNum, limit: limitNum };
    });
    // Revenue accumulation — computed straight from PAID payments (the source of
    // truth; no shadow table to drift): totals, this/last month (by paid_at),
    // active subscriber count, and a 6-month trend.
    app.get("/api/admin/subscription-revenue", async (request, reply) => {
        const admin = await getAdminUser(request, reply);
        if (!admin)
            return;
        const paidAmount = (0, drizzle_orm_1.sql) `coalesce(sum(${schema_1.subscriptionPaymentsTable.amount_due}), 0)`;
        // "This month" is a local calendar month. new Date(y, m, 1) would use the
        // container's zone — UTC in the deployed image — so a payment made in the
        // first 7 hours of the 1st would be credited to the previous month.
        const { timezone = "Asia/Jakarta" } = request.query;
        const todayLocal = new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(new Date());
        const [localYear, localMonth] = todayLocal.split("-").map(Number);
        const monthsAgoStart = (n) => {
            const m = new Date(Date.UTC(localYear, localMonth - 1 - n, 1));
            const key = `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`;
            return (0, timezone_1.getUTCRangeFromLocalMonth)(key, timezone).startUTC;
        };
        const monthStart = monthsAgoStart(0);
        const lastMonthStart = monthsAgoStart(1);
        const trendStart = monthsAgoStart(5);
        const [[allTime], [thisMonth], [lastMonth], [subs], trendRows] = await Promise.all([
            db_1.db
                .select({ total: paidAmount, n: (0, drizzle_orm_1.sql) `count(*)::int` })
                .from(schema_1.subscriptionPaymentsTable)
                .where((0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.status, "paid")),
            db_1.db
                .select({ total: paidAmount, n: (0, drizzle_orm_1.sql) `count(*)::int` })
                .from(schema_1.subscriptionPaymentsTable)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.status, "paid"), (0, drizzle_orm_1.sql) `${schema_1.subscriptionPaymentsTable.paid_at} >= ${monthStart}`)),
            db_1.db
                .select({ total: paidAmount })
                .from(schema_1.subscriptionPaymentsTable)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.status, "paid"), (0, drizzle_orm_1.sql) `${schema_1.subscriptionPaymentsTable.paid_at} >= ${lastMonthStart}`, (0, drizzle_orm_1.sql) `${schema_1.subscriptionPaymentsTable.paid_at} < ${monthStart}`)),
            db_1.db
                .select({
                active: (0, drizzle_orm_1.sql) `count(*) filter (where ${schema_1.subscriptionsTable.status} = 'active')::int`,
                trialing: (0, drizzle_orm_1.sql) `count(*) filter (where ${schema_1.subscriptionsTable.status} = 'trialing')::int`,
            })
                .from(schema_1.subscriptionsTable),
            db_1.db
                .select({
                month: (0, drizzle_orm_1.sql) `to_char(${schema_1.subscriptionPaymentsTable.paid_at} AT TIME ZONE ${timezone}, 'YYYY-MM')`,
                total: paidAmount,
            })
                .from(schema_1.subscriptionPaymentsTable)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.status, "paid"), (0, drizzle_orm_1.sql) `${schema_1.subscriptionPaymentsTable.paid_at} >= ${trendStart}`))
                .groupBy((0, drizzle_orm_1.sql) `to_char(${schema_1.subscriptionPaymentsTable.paid_at} AT TIME ZONE ${timezone}, 'YYYY-MM')`)
                .orderBy((0, drizzle_orm_1.sql) `to_char(${schema_1.subscriptionPaymentsTable.paid_at} AT TIME ZONE ${timezone}, 'YYYY-MM')`),
        ]);
        return {
            success: true,
            data: {
                all_time: Number(allTime.total),
                all_time_count: allTime.n,
                this_month: Number(thisMonth.total),
                this_month_count: thisMonth.n,
                last_month: Number(lastMonth.total),
                active_subscribers: subs.active,
                trialing: subs.trialing,
                trend: trendRows.map((r) => ({ month: r.month, total: Number(r.total) })),
            },
        };
    });
    // Set (or clear, with discount_pct 0) a marketing deal on a merchant's
    // subscription, optionally scoped to one tier and/or interval. Looked up by
    // account email. Requires an existing subscription row — pre-creating one
    // here would silently burn the merchant's future trial.
    app.post("/api/admin/subscription-deals", async (request, reply) => {
        const admin = await getAdminUser(request, reply);
        if (!admin)
            return;
        const body = (request.body ?? {});
        const email = String(body.email ?? "").trim().toLowerCase();
        const pct = Number(body.discount_pct ?? 0);
        if (!email)
            return reply.status(400).send({ success: false, error: "Email merchant wajib diisi" });
        if (!(pct >= 0 && pct <= 100))
            return reply.status(400).send({ success: false, error: "Diskon harus 0–100%" });
        const TIERS = ["basic", "pro", "max_lite", "max"];
        const INTERVALS = ["monthly", "yearly"];
        const tier = body.tier && TIERS.includes(body.tier) ? body.tier : null;
        const interval = body.interval && INTERVALS.includes(body.interval) ? body.interval : null;
        const [merchant] = await db_1.db
            .select({ id: schema_1.usersTable.id, name: schema_1.usersTable.name })
            .from(schema_1.usersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.usersTable.email, email))
            .limit(1);
        if (!merchant)
            return reply.status(404).send({ success: false, error: "Merchant tidak ditemukan" });
        const [sub] = await db_1.db
            .select({ id: schema_1.subscriptionsTable.id })
            .from(schema_1.subscriptionsTable)
            .where((0, drizzle_orm_1.eq)(schema_1.subscriptionsTable.user_id, merchant.id))
            .limit(1);
        if (!sub)
            return reply.status(404).send({
                success: false,
                error: "Merchant belum punya data langganan — minta merchant membuka halaman Langganan dulu",
            });
        const [updated] = await db_1.db
            .update(schema_1.subscriptionsTable)
            .set({
            discount_pct: String(pct),
            discount_tier: (pct > 0 ? tier : null),
            discount_interval: (pct > 0 ? interval : null),
            discount_note: pct > 0 ? String(body.note ?? "").slice(0, 255) : "",
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.subscriptionsTable.id, sub.id))
            .returning();
        await db_1.db.insert(schema_1.subscriptionEventsTable).values({
            subscription_id: sub.id,
            user_id: merchant.id,
            type: pct > 0 ? "deal_set" : "deal_cleared",
            actor: "admin",
            actor_id: admin.id,
            detail: { discount_pct: pct, tier, interval, note: body.note ?? "" },
        });
        return { success: true, data: updated, merchant: { name: merchant.name, email } };
    });
    app.post("/api/admin/subscription-payments/:id/confirm", async (request, reply) => {
        const admin = await getAdminUser(request, reply);
        if (!admin)
            return;
        const id = Number(request.params.id);
        try {
            const result = await (0, subscription_1.confirmPayment)(id, admin.id);
            // The merchant's cached gate must reflect the new plan immediately.
            (0, outlet_access_1.invalidateGate)(result.payment.user_id);
            return { success: true, data: result };
        }
        catch (e) {
            const msg = String(e instanceof Error ? e.message : e);
            if (msg.includes("NOT_FOUND"))
                return reply.status(404).send({ success: false, error: "Pembayaran tidak ditemukan" });
            if (msg.includes("ALREADY_PROCESSED"))
                return reply.status(409).send({ success: false, error: "Pembayaran sudah diproses" });
            return reply.status(500).send({ success: false, error: msg });
        }
    });
    app.post("/api/admin/subscription-payments/:id/reject", async (request, reply) => {
        const admin = await getAdminUser(request, reply);
        if (!admin)
            return;
        const id = Number(request.params.id);
        const { note = "" } = (request.body ?? {});
        try {
            const result = await (0, subscription_1.rejectPayment)(id, admin.id, String(note).slice(0, 500));
            return { success: true, data: result };
        }
        catch (e) {
            const msg = String(e instanceof Error ? e.message : e);
            if (msg.includes("NOT_FOUND"))
                return reply.status(404).send({ success: false, error: "Pembayaran tidak ditemukan" });
            if (msg.includes("ALREADY_PROCESSED"))
                return reply.status(409).send({ success: false, error: "Pembayaran sudah diproses" });
            return reply.status(500).send({ success: false, error: msg });
        }
    });
}
