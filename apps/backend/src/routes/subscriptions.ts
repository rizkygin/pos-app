import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  adminsTable,
  subscriptionsTable,
  subscriptionPlansTable,
  subscriptionPaymentsTable,
  subscriptionEventsTable,
  subscriptionNotificationsTable,
  usersTable,
} from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { getOutletByUserId } from "../lib/outlet-id";
import {
  BANK_INFO,
  createPendingPayment,
  confirmPayment,
  rejectPayment,
  expireStalePayments,
  applyScheduledTierIfDue,
} from "../lib/subscription";
import { invalidateGate } from "../lib/outlet-access";
import { getUTCRangeFromLocalMonth } from "../lib/timezone";

const PROOF_DIR = path.join(process.cwd(), "uploads", "subscriptions");
const PROOF_URL_PREFIX = "/uploads/subscriptions/";

// Session (any logged-in user) or null + 401 sent.
async function getSessionUser(request: FastifyRequest, reply: FastifyReply) {
  const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
  if (!session?.user) {
    reply.status(401).send({ success: false, error: "Unauthorized" });
    return null;
  }
  return session.user;
}

// Subscriptions hang off the OWNER account: any authenticated user that owns an
// outlet. Mirrors the guard style used across owner routes.
async function getOwnerUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await getSessionUser(request, reply);
  if (!user) return null;
  const outlet = await getOutletByUserId(user.id);
  if (!outlet) {
    reply.status(403).send({ success: false, error: "No outlet found" });
    return null;
  }
  return user;
}

async function getAdminUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await getSessionUser(request, reply);
  if (!user) return null;
  const [admin] = await db
    .select({ id: adminsTable.id })
    .from(adminsTable)
    .where(eq(adminsTable.user_id, user.id))
    .limit(1);
  if (!admin) {
    reply.status(403).send({ success: false, error: "Forbidden" });
    return null;
  }
  return user;
}

export async function subscriptionRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------- merchant side
  app.get("/api/subscription-plans", async (request, reply) => {
    const user = await getSessionUser(request, reply);
    if (!user) return;
    const [plans, [sub]] = await Promise.all([
      db
        .select()
        .from(subscriptionPlansTable)
        .where(eq(subscriptionPlansTable.is_active, true))
        .orderBy(subscriptionPlansTable.sort_order, subscriptionPlansTable.interval),
      db
        .select({
          discount_pct: subscriptionsTable.discount_pct,
          discount_tier: subscriptionsTable.discount_tier,
          discount_interval: subscriptionsTable.discount_interval,
          discount_note: subscriptionsTable.discount_note,
        })
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.user_id, user.id))
        .limit(1),
    ]);
    // The caller's marketing deal (if any) so plan cards can render the
    // merchant's special price. NULL tier/interval scope = applies to any.
    const deal =
      sub && Number(sub.discount_pct) > 0
        ? {
            pct: Number(sub.discount_pct),
            tier: sub.discount_tier,
            interval: sub.discount_interval,
            note: sub.discount_note ?? "",
          }
        : null;
    return { success: true, data: plans, bank: BANK_INFO, deal };
  });

  app.get("/api/my-subscription", async (request, reply) => {
    const user = await getOwnerUser(request, reply);
    if (!user) return;
    let [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.user_id, user.id))
      .limit(1);
    // Apply a scheduled downgrade whose boundary has passed (lazy, cron-free).
    if (sub) sub = await applyScheduledTierIfDue(sub);
    const payments = sub
      ? await db
          .select({
            id: subscriptionPaymentsTable.id,
            tier: subscriptionPaymentsTable.tier,
            interval: subscriptionPaymentsTable.interval,
            amount_due: subscriptionPaymentsTable.amount_due,
            status: subscriptionPaymentsTable.status,
            proof_image: subscriptionPaymentsTable.proof_image,
            review_note: subscriptionPaymentsTable.review_note,
            expires_at: subscriptionPaymentsTable.expires_at,
            paid_at: subscriptionPaymentsTable.paid_at,
            period_end: subscriptionPaymentsTable.period_end,
            created_at: subscriptionPaymentsTable.createdAt,
          })
          .from(subscriptionPaymentsTable)
          .where(eq(subscriptionPaymentsTable.subscription_id, sub.id))
          .orderBy(desc(subscriptionPaymentsTable.createdAt))
          .limit(10)
      : [];
    return { success: true, data: { subscription: sub ?? null, payments }, bank: BANK_INFO };
  });

  // Create (or return the existing live) pending payment for a plan. The
  // response carries amount_due — the EXACT figure the merchant must transfer.
  app.post("/api/subscription-payments", async (request, reply) => {
    const user = await getOwnerUser(request, reply);
    if (!user) return;
    const { plan_id } = (request.body ?? {}) as { plan_id?: number };
    if (!plan_id) return reply.status(400).send({ success: false, error: "plan_id wajib diisi" });
    try {
      const { payment, subscription, reused } = await createPendingPayment(user.id, Number(plan_id));
      return reply.status(reused ? 200 : 201).send({
        success: true,
        data: { payment, subscription, reused },
        bank: BANK_INFO,
        instructions: `Transfer TEPAT ${Number(payment.amount_due).toLocaleString("id-ID")} (3 digit terakhir adalah kode unik Pian) ke ${BANK_INFO.bank} ${BANK_INFO.account_number} a.n. ${BANK_INFO.account_holder}, lalu unggah bukti transfer.`,
      });
    } catch (e) {
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
    if (!user) return;
    const id = Number((request.params as { id: string }).id);

    const [payment] = await db
      .select()
      .from(subscriptionPaymentsTable)
      .where(
        and(eq(subscriptionPaymentsTable.id, id), eq(subscriptionPaymentsTable.user_id, user.id)),
      )
      .limit(1);
    if (!payment) return reply.status(404).send({ success: false, error: "Pembayaran tidak ditemukan" });
    // A REJECTED payment is re-submittable: the merchant's money may already be
    // transferred (rejection is often just a bad screenshot), so a corrected
    // proof flips it back to pending for another admin review. Paid/expired
    // stay closed.
    const isResubmit = payment.status === "rejected";
    if (payment.status !== "pending" && !isResubmit)
      return reply.status(409).send({ success: false, error: "Pembayaran sudah diproses" });

    const file = await request.file();
    if (!file) return reply.status(400).send({ success: false, error: "Bukti transfer wajib diunggah" });

    const fields = file.fields as Record<string, { value?: string } | undefined>;
    const fieldValue = (name: string) => {
      const f = fields[name];
      return f && typeof f.value === "string" ? f.value.slice(0, 255) : "";
    };

    const buffer = await file.toBuffer();
    const filename = `proof-${id}-${Date.now()}.webp`;
    await fs.mkdir(PROOF_DIR, { recursive: true });
    // Keep proofs readable but bounded: fit inside 1200px, webp.
    await sharp(buffer)
      .resize(1200, 1600, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(path.join(PROOF_DIR, filename));

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(subscriptionPaymentsTable)
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
                status: "pending" as const,
                reviewed_by: null,
                reviewed_at: null,
                review_note: null,
                expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
              }
            : {}),
        })
        .where(eq(subscriptionPaymentsTable.id, id))
        .returning();

      if (isResubmit) {
        await tx.insert(subscriptionEventsTable).values({
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
    if (!user) return;
    const rows = await db
      .select()
      .from(subscriptionNotificationsTable)
      .where(
        and(
          eq(subscriptionNotificationsTable.user_id, user.id),
          eq(subscriptionNotificationsTable.channel, "in_app"),
        ),
      )
      .orderBy(desc(subscriptionNotificationsTable.created_at))
      .limit(20);
    return { success: true, data: rows };
  });

  // ---------------------------------------------------------------- admin side
  app.get("/api/admin/subscription-payments", async (request, reply) => {
    const admin = await getAdminUser(request, reply);
    if (!admin) return;
    const { status = "pending", page = "1", limit = "20" } = request.query as Record<string, string>;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));

    // Self-cleaning queue: void anything past its expiry before listing.
    await expireStalePayments();

    const statusFilter =
      status === "all"
        ? undefined
        : eq(
            subscriptionPaymentsTable.status,
            status as "pending" | "paid" | "rejected" | "expired" | "failed" | "refunded",
          );

    const [rows, [{ n: total }], [{ n: pendingCount }]] = await Promise.all([
      db
        .select({
          id: subscriptionPaymentsTable.id,
          user_id: subscriptionPaymentsTable.user_id,
          user_name: usersTable.name,
          user_email: usersTable.email,
          plan_name: subscriptionPlansTable.name,
          tier: subscriptionPaymentsTable.tier,
          interval: subscriptionPaymentsTable.interval,
          amount: subscriptionPaymentsTable.amount,
          unique_code: subscriptionPaymentsTable.unique_code,
          amount_due: subscriptionPaymentsTable.amount_due,
          status: subscriptionPaymentsTable.status,
          proof_image: subscriptionPaymentsTable.proof_image,
          sender_bank: subscriptionPaymentsTable.sender_bank,
          sender_name: subscriptionPaymentsTable.sender_name,
          transfer_date: subscriptionPaymentsTable.transfer_date,
          merchant_note: subscriptionPaymentsTable.merchant_note,
          review_note: subscriptionPaymentsTable.review_note,
          expires_at: subscriptionPaymentsTable.expires_at,
          paid_at: subscriptionPaymentsTable.paid_at,
          period_end: subscriptionPaymentsTable.period_end,
          created_at: subscriptionPaymentsTable.createdAt,
        })
        .from(subscriptionPaymentsTable)
        .innerJoin(usersTable, eq(usersTable.id, subscriptionPaymentsTable.user_id))
        .innerJoin(
          subscriptionPlansTable,
          eq(subscriptionPlansTable.id, subscriptionPaymentsTable.plan_id),
        )
        .where(statusFilter)
        .orderBy(desc(subscriptionPaymentsTable.createdAt))
        .limit(limitNum)
        .offset((pageNum - 1) * limitNum),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(subscriptionPaymentsTable)
        .where(statusFilter),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(subscriptionPaymentsTable)
        .where(eq(subscriptionPaymentsTable.status, "pending")),
    ]);

    return { success: true, data: rows, total, pendingCount, page: pageNum, limit: limitNum };
  });

  // Revenue accumulation — computed straight from PAID payments (the source of
  // truth; no shadow table to drift): totals, this/last month (by paid_at),
  // active subscriber count, and a 6-month trend.
  app.get("/api/admin/subscription-revenue", async (request, reply) => {
    const admin = await getAdminUser(request, reply);
    if (!admin) return;

    const paidAmount = sql<string>`coalesce(sum(${subscriptionPaymentsTable.amount_due}), 0)`;
    // "This month" is a local calendar month. new Date(y, m, 1) would use the
    // container's zone — UTC in the deployed image — so a payment made in the
    // first 7 hours of the 1st would be credited to the previous month.
    const { timezone = "Asia/Jakarta" } = request.query as Record<string, string>;
    const todayLocal = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const [localYear, localMonth] = todayLocal.split("-").map(Number);
    const monthsAgoStart = (n: number) => {
      const m = new Date(Date.UTC(localYear, localMonth - 1 - n, 1));
      const key = `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`;
      return getUTCRangeFromLocalMonth(key, timezone).startUTC;
    };
    const monthStart = monthsAgoStart(0);
    const lastMonthStart = monthsAgoStart(1);
    const trendStart = monthsAgoStart(5);

    const [[allTime], [thisMonth], [lastMonth], [subs], trendRows] = await Promise.all([
      db
        .select({ total: paidAmount, n: sql<number>`count(*)::int` })
        .from(subscriptionPaymentsTable)
        .where(eq(subscriptionPaymentsTable.status, "paid")),
      db
        .select({ total: paidAmount, n: sql<number>`count(*)::int` })
        .from(subscriptionPaymentsTable)
        .where(
          and(
            eq(subscriptionPaymentsTable.status, "paid"),
            sql`${subscriptionPaymentsTable.paid_at} >= ${monthStart}`,
          ),
        ),
      db
        .select({ total: paidAmount })
        .from(subscriptionPaymentsTable)
        .where(
          and(
            eq(subscriptionPaymentsTable.status, "paid"),
            sql`${subscriptionPaymentsTable.paid_at} >= ${lastMonthStart}`,
            sql`${subscriptionPaymentsTable.paid_at} < ${monthStart}`,
          ),
        ),
      db
        .select({
          active: sql<number>`count(*) filter (where ${subscriptionsTable.status} = 'active')::int`,
          trialing: sql<number>`count(*) filter (where ${subscriptionsTable.status} = 'trialing')::int`,
        })
        .from(subscriptionsTable),
      db
        .select({
          month: sql<string>`to_char(${subscriptionPaymentsTable.paid_at} AT TIME ZONE ${timezone}, 'YYYY-MM')`,
          total: paidAmount,
        })
        .from(subscriptionPaymentsTable)
        .where(
          and(
            eq(subscriptionPaymentsTable.status, "paid"),
            sql`${subscriptionPaymentsTable.paid_at} >= ${trendStart}`,
          ),
        )
        .groupBy(sql`to_char(${subscriptionPaymentsTable.paid_at} AT TIME ZONE ${timezone}, 'YYYY-MM')`)
        .orderBy(sql`to_char(${subscriptionPaymentsTable.paid_at} AT TIME ZONE ${timezone}, 'YYYY-MM')`),
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
    if (!admin) return;
    const body = (request.body ?? {}) as {
      email?: string;
      discount_pct?: number | string;
      tier?: string | null;
      interval?: string | null;
      note?: string;
    };
    const email = String(body.email ?? "").trim().toLowerCase();
    const pct = Number(body.discount_pct ?? 0);
    if (!email) return reply.status(400).send({ success: false, error: "Email merchant wajib diisi" });
    if (!(pct >= 0 && pct <= 100))
      return reply.status(400).send({ success: false, error: "Diskon harus 0–100%" });
    const TIERS = ["basic", "pro", "max_lite", "max"];
    const INTERVALS = ["monthly", "yearly"];
    const tier = body.tier && TIERS.includes(body.tier) ? body.tier : null;
    const interval = body.interval && INTERVALS.includes(body.interval) ? body.interval : null;

    const [merchant] = await db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    if (!merchant)
      return reply.status(404).send({ success: false, error: "Merchant tidak ditemukan" });

    const [sub] = await db
      .select({ id: subscriptionsTable.id })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.user_id, merchant.id))
      .limit(1);
    if (!sub)
      return reply.status(404).send({
        success: false,
        error: "Merchant belum punya data langganan — minta merchant membuka halaman Langganan dulu",
      });

    const [updated] = await db
      .update(subscriptionsTable)
      .set({
        discount_pct: String(pct),
        discount_tier: (pct > 0 ? tier : null) as any,
        discount_interval: (pct > 0 ? interval : null) as any,
        discount_note: pct > 0 ? String(body.note ?? "").slice(0, 255) : "",
        updatedAt: new Date(),
      })
      .where(eq(subscriptionsTable.id, sub.id))
      .returning();

    await db.insert(subscriptionEventsTable).values({
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
    if (!admin) return;
    const id = Number((request.params as { id: string }).id);
    try {
      const result = await confirmPayment(id, admin.id);
      // The merchant's cached gate must reflect the new plan immediately.
      invalidateGate(result.payment.user_id);
      return { success: true, data: result };
    } catch (e) {
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
    if (!admin) return;
    const id = Number((request.params as { id: string }).id);
    const { note = "" } = (request.body ?? {}) as { note?: string };
    try {
      const result = await rejectPayment(id, admin.id, String(note).slice(0, 500));
      return { success: true, data: result };
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (msg.includes("NOT_FOUND"))
        return reply.status(404).send({ success: false, error: "Pembayaran tidak ditemukan" });
      if (msg.includes("ALREADY_PROCESSED"))
        return reply.status(409).send({ success: false, error: "Pembayaran sudah diproses" });
      return reply.status(500).send({ success: false, error: msg });
    }
  });
}
