import { and, eq, inArray, sql } from 'drizzle-orm';
import { Resend } from 'resend';
import { db } from '../db';
import {
  subscriptionsTable,
  subscriptionPlansTable,
  subscriptionPaymentsTable,
  subscriptionEventsTable,
  subscriptionNotificationsTable,
  usersTable,
} from '../db/schema';

// ============================================================================
// Subscription billing service (platform revenue — see schema.ts).
// MANUAL FLOW IS LIVE: merchant creates a pending payment (unique transfer
// amount), transfers, uploads proof; admin confirms → period extends. A future
// Xendit webhook calls the SAME confirmPayment transition — do not fork it.
// ============================================================================

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Where merchants transfer to. Set real values in env (local .env + Railway
// backend service); these fallbacks are obviously fake on purpose.
export const BANK_INFO = {
  bank: process.env.SUBSCRIPTION_BANK_NAME ?? 'BCA',
  account_number: process.env.SUBSCRIPTION_BANK_ACCOUNT ?? '8585422386',
  account_holder: process.env.SUBSCRIPTION_BANK_HOLDER ?? 'PUTRI PINANDITA',
};

// Pending manual payments are void after this many days unpaid.
const PAYMENT_EXPIRY_DAYS = 3;

const FROM = 'Ulun Pesan <noreply@mail.ulunpesan.com>';
const resend = new Resend(process.env.RESEND_API_KEY);

const rupiah = (v: number | string) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(v) || 0);

// Calendar-aware period math: monthly = +1 month, yearly = +12. JS setMonth
// handles year rollover; end-of-month drift (Jan 31 → Feb 28/Mar 3) is
// acceptable for this product.
function addInterval(from: Date, interval: 'monthly' | 'yearly') {
  const d = new Date(from);
  d.setMonth(d.getMonth() + (interval === 'monthly' ? 1 : 12));
  return d;
}

// Tier ladder for upgrade/downgrade decisions and the day-count convention
// used to price remaining time (Model 2 credit-to-days conversion).
const TIER_RANK: Record<string, number> = { basic: 0, pro: 1, max_lite: 2, max: 3 };
const PERIOD_DAYS: Record<'monthly' | 'yearly', number> = { monthly: 30, yearly: 365 };
const DAY_MS = 24 * 60 * 60 * 1000;

async function logEvent(
  tx: Tx,
  ev: {
    subscription_id: number;
    user_id: string;
    payment_id?: number | null;
    type: string;
    actor?: 'system' | 'admin' | 'merchant';
    actor_id?: string | null;
    detail?: unknown;
  },
) {
  const [row] = await tx
    .insert(subscriptionEventsTable)
    .values({
      subscription_id: ev.subscription_id,
      user_id: ev.user_id,
      payment_id: ev.payment_id ?? null,
      type: ev.type,
      actor: ev.actor ?? 'system',
      actor_id: ev.actor_id ?? null,
      detail: ev.detail ?? null,
    })
    .returning();
  return row;
}

async function enqueueNotification(
  tx: Tx,
  n: {
    user_id: string;
    subscription_id?: number | null;
    event_id?: number | null;
    channel: 'email' | 'in_app';
    type: string;
    title: string;
    body: string;
    payload?: unknown;
  },
) {
  const [row] = await tx
    .insert(subscriptionNotificationsTable)
    .values({ ...n, payload: n.payload ?? null, status: 'pending' })
    .returning();
  return row;
}

// Structured data for the receipt email; stored on the notification row's
// payload column so the email template renders from fields, not prose.
type ReceiptPayload = {
  receipt_no: string;
  plan_label: string;
  interval: 'monthly' | 'yearly';
  amount: string; // base plan price
  discount_pct: number; // marketing deal applied to this payment (0 = none)
  bonus_days: number; // upgrade conversion: remaining old-plan value as days
  unique_code: number;
  amount_due: string; // what was actually transferred
  paid_at: string; // ISO
  period_start: string; // ISO
  period_end: string; // ISO
};

const tglID = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

// Invoice-style (kwitansi) HTML for the payment-confirmed email. Table-based
// layout + inline styles only — email clients ignore stylesheets.
function receiptEmailHtml(r: ReceiptPayload) {
  const row = (label: string, value: string, bold = false) => `
    <tr>
      <td style="padding:6px 0;color:#71717a;font-size:13px;">${label}</td>
      <td align="right" style="padding:6px 0;font-size:13px;${bold ? 'font-weight:700;' : ''}">${value}</td>
    </tr>`;

  return `
  <div style="background:#f4f4f5;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr>
        <td style="background:linear-gradient(135deg,#f43f5e,#db2777);padding:24px 28px;">
          <table role="presentation" width="100%"><tr>
            <td style="color:#ffffff;font-size:20px;font-weight:800;">Ulun Pesan</td>
            <td align="right">
              <span style="display:inline-block;background:#ffffff;color:#16a34a;font-size:12px;font-weight:800;letter-spacing:1px;padding:4px 12px;border-radius:999px;">LUNAS</span>
            </td>
          </tr></table>
          <p style="margin:10px 0 0;color:rgba(255,255,255,.85);font-size:13px;">Kwitansi Pembayaran Langganan</p>
          <p style="margin:2px 0 0;color:rgba(255,255,255,.7);font-size:12px;font-family:monospace;">${r.receipt_no}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${row('Paket', `${r.plan_label} · ${r.interval === 'monthly' ? 'Bulanan' : 'Tahunan'}`)}
            ${row('Periode aktif', `${tglID(r.period_start)} – ${tglID(r.period_end)}`)}
            ${row('Tanggal pembayaran', tglID(r.paid_at))}
            ${row('Metode', 'Transfer bank (manual)')}
            <tr><td colspan="2" style="border-top:1px solid #e4e4e7;padding-top:12px;"></td></tr>
            ${row('Harga paket', rupiah(r.amount))}
            ${
              r.discount_pct > 0
                ? row(
                    `Diskon (${r.discount_pct}%)`,
                    `-${rupiah(Math.round(Number(r.amount) * (r.discount_pct / 100)))}`,
                  )
                : ''
            }
            ${row('Kode unik', String(r.unique_code))}
            ${r.bonus_days > 0 ? row('Konversi sisa masa aktif', `+${r.bonus_days} hari`) : ''}
            <tr>
              <td style="padding:10px 0;border-top:1px solid #e4e4e7;font-size:14px;font-weight:800;">Total dibayar</td>
              <td align="right" style="padding:10px 0;border-top:1px solid #e4e4e7;font-size:16px;font-weight:800;color:#f43f5e;">${rupiah(r.amount_due)}</td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:12px;color:#71717a;line-height:1.6;">
            Terima kasih! Langganan Pian aktif sampai <b>${tglID(r.period_end)}</b>.
            Simpan email ini sebagai bukti pembayaran yang sah.
          </p>
        </td>
      </tr>
      <tr>
        <td style="background:#fafafa;padding:14px 28px;border-top:1px solid #e4e4e7;">
          <p style="margin:0;font-size:11px;color:#a1a1aa;">Email otomatis dari Ulun Pesan — balasan tidak dipantau.</p>
        </td>
      </tr>
    </table>
  </div>`;
}

// Best-effort immediate email delivery for one outbox row. Never throws: on
// failure the row stays 'failed' for a future dispatcher/retry to pick up.
export async function trySendEmailNotification(notificationId: number) {
  try {
    const [n] = await db
      .select({
        id: subscriptionNotificationsTable.id,
        user_id: subscriptionNotificationsTable.user_id,
        title: subscriptionNotificationsTable.title,
        body: subscriptionNotificationsTable.body,
        status: subscriptionNotificationsTable.status,
        channel: subscriptionNotificationsTable.channel,
        type: subscriptionNotificationsTable.type,
        payload: subscriptionNotificationsTable.payload,
        email: usersTable.email,
      })
      .from(subscriptionNotificationsTable)
      .innerJoin(usersTable, eq(usersTable.id, subscriptionNotificationsTable.user_id))
      .where(eq(subscriptionNotificationsTable.id, notificationId))
      .limit(1);
    if (!n || n.channel !== 'email' || n.status !== 'pending') return;

    // payment_confirmed carries a receipt payload → render the kwitansi
    // template; every other type falls back to the plain-paragraph email.
    const html =
      n.type === 'payment_confirmed' && n.payload
        ? receiptEmailHtml(n.payload as ReceiptPayload)
        : `<p>${n.body ?? ''}</p><p style="color:#888;font-size:12px">Email otomatis dari Ulun Pesan — balasan tidak dipantau.</p>`;

    const { error } = await resend.emails.send({
      from: FROM,
      to: n.email,
      subject: n.title ?? 'Ulun Pesan',
      html,
    });
    await db
      .update(subscriptionNotificationsTable)
      .set(error ? { status: 'failed' } : { status: 'sent', sent_at: new Date() })
      .where(eq(subscriptionNotificationsTable.id, notificationId));
  } catch {
    await db
      .update(subscriptionNotificationsTable)
      .set({ status: 'failed' })
      .where(eq(subscriptionNotificationsTable.id, notificationId))
      .catch(() => {});
  }
}

// One subscription row per owner. First-ever creation grants the plan's trial
// (access now, before any payment is confirmed); later calls just return the row.
async function getOrCreateSubscription(
  tx: Tx,
  userId: string,
  plan: { id: number; tier: 'basic' | 'pro' | 'max_lite' | 'max'; trial_days: number },
) {
  const [existing] = await tx
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.user_id, userId))
    .limit(1);
  if (existing) return { sub: existing, created: false };

  const now = new Date();
  const trialEnd =
    plan.trial_days > 0 ? new Date(now.getTime() + plan.trial_days * 24 * 60 * 60 * 1000) : null;
  const [sub] = await tx
    .insert(subscriptionsTable)
    .values({
      user_id: userId,
      plan_id: plan.id,
      tier: plan.tier,
      status: trialEnd ? 'trialing' : 'expired',
      trial_ends_at: trialEnd,
      current_period_start: trialEnd ? now : null,
      current_period_end: trialEnd,
    })
    .returning();
  await logEvent(tx, {
    subscription_id: sub.id,
    user_id: userId,
    type: trialEnd ? 'trial_started' : 'subscription_created',
    actor: 'merchant',
    actor_id: userId,
    detail: trialEnd ? { trial_days: plan.trial_days } : null,
  });
  return { sub, created: true };
}

// Marketing deal resolution: a subscription's discount applies to a plan only
// when its (optional) tier/interval scope matches — NULL scope means "any".
export function effectiveDiscountPct(
  sub: {
    discount_pct: string | null;
    discount_tier: string | null;
    discount_interval: string | null;
  },
  plan: { tier: string; interval: string },
) {
  const pct = Number(sub.discount_pct ?? 0);
  if (!(pct > 0)) return 0;
  if (sub.discount_tier && sub.discount_tier !== plan.tier) return 0;
  if (sub.discount_interval && sub.discount_interval !== plan.interval) return 0;
  return Math.min(100, pct);
}

// Merchant picks a plan → returns the pending payment carrying the unique
// transfer amount (amount_due = discounted plan price + 3-digit unique code) so
// the admin can match the bank mutation at a glance. Idempotent per plan: an
// existing still-valid pending payment for the same plan AND same deal is
// returned as-is; switching plans (or a deal change) expires the old one.
export async function createPendingPayment(userId: string, planId: number) {
  const [plan] = await db
    .select()
    .from(subscriptionPlansTable)
    .where(and(eq(subscriptionPlansTable.id, planId), eq(subscriptionPlansTable.is_active, true)))
    .limit(1);
  if (!plan) throw new Error('PLAN_NOT_FOUND');

  return db.transaction(async (tx) => {
    const { sub } = await getOrCreateSubscription(tx, userId, plan);

    const pendings = await tx
      .select()
      .from(subscriptionPaymentsTable)
      .where(
        and(
          eq(subscriptionPaymentsTable.subscription_id, sub.id),
          eq(subscriptionPaymentsTable.status, 'pending'),
        ),
      );
    // Apply the merchant's marketing deal (if it matches this plan).
    const discountPct = effectiveDiscountPct(sub, plan);
    const discountedPrice = Math.round(Number(plan.price) * (1 - discountPct / 100));

    const now = new Date();
    for (const p of pendings) {
      if (
        p.plan_id === plan.id &&
        Number(p.discount_pct) === discountPct &&
        (!p.expires_at || p.expires_at > now)
      ) {
        return { payment: p, subscription: sub, reused: true };
      }
      // Different plan, changed deal, or stale: void it so only one live
      // quote (with a current price) exists.
      await tx
        .update(subscriptionPaymentsTable)
        .set({ status: 'expired' })
        .where(eq(subscriptionPaymentsTable.id, p.id));
    }

    // Unique-amount matching: retry codes until amount_due collides with no
    // other LIVE pending payment (confirmed/old ones don't matter).
    let uniqueCode = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = Math.floor(Math.random() * 900) + 100; // 100..999
      const [clash] = await tx
        .select({ id: subscriptionPaymentsTable.id })
        .from(subscriptionPaymentsTable)
        .where(
          and(
            eq(subscriptionPaymentsTable.status, 'pending'),
            eq(subscriptionPaymentsTable.amount_due, String(discountedPrice + candidate)),
          ),
        )
        .limit(1);
      if (!clash) {
        uniqueCode = candidate;
        break;
      }
    }
    if (!uniqueCode) throw new Error('UNIQUE_CODE_EXHAUSTED');

    const [payment] = await tx
      .insert(subscriptionPaymentsTable)
      .values({
        subscription_id: sub.id,
        user_id: userId,
        plan_id: plan.id,
        tier: plan.tier,
        interval: plan.interval,
        currency: plan.currency,
        amount: plan.price,
        discount_pct: String(discountPct),
        unique_code: uniqueCode,
        amount_due: String(discountedPrice + uniqueCode),
        method: 'manual_transfer',
        status: 'pending',
        expires_at: new Date(now.getTime() + PAYMENT_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      })
      .returning();

    await logEvent(tx, {
      subscription_id: sub.id,
      user_id: userId,
      payment_id: payment.id,
      type: 'payment_submitted',
      actor: 'merchant',
      actor_id: userId,
      detail: { plan: plan.name, amount_due: payment.amount_due },
    });

    return { payment, subscription: sub, reused: false };
  });
}

// THE core transition (shared by manual admin confirm now and the Xendit
// webhook later): pending → paid, then apply Model 2 tier-change semantics:
//   - fresh/expired sub, or paying during TRIAL, or SAME tier → period stacks
//     after max(now, current_period_end); tier applies immediately. (Trial days
//     are free, so they carry no conversion value — they simply keep running.)
//   - UPGRADE (higher rank) → applies NOW; the remaining paid days convert to
//     bonus days at the new plan's daily rate (base catalog prices, 30/365-day
//     convention), so no one gets free higher-tier time and no one loses money.
//   - DOWNGRADE (lower rank) → the new period stacks after the current one and
//     the tier flip is SCHEDULED (next_* columns) for the old period's end.
// Idempotent: a non-pending payment throws ALREADY_PROCESSED.
export async function confirmPayment(paymentId: number, adminUserId: string) {
  const result = await db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(subscriptionPaymentsTable)
      .where(eq(subscriptionPaymentsTable.id, paymentId))
      .for('update')
      .limit(1);
    if (!payment) throw new Error('NOT_FOUND');
    if (payment.status !== 'pending') throw new Error('ALREADY_PROCESSED');

    const [sub] = await tx
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, payment.subscription_id))
      .for('update')
      .limit(1);
    if (!sub) throw new Error('SUBSCRIPTION_NOT_FOUND');

    const now = new Date();
    const live = !!sub.current_period_end && sub.current_period_end > now;
    const isTrial = live && sub.status === 'trialing';
    const curRank = sub.tier ? (TIER_RANK[sub.tier] ?? -1) : -1;
    const newRank = TIER_RANK[payment.tier] ?? 0;

    let base: Date;
    let periodEnd: Date;
    let bonusDays = 0;
    let applyTierNow = true;
    let scheduleDowngrade = false;

    if (!live || isTrial || newRank === curRank || curRank === -1) {
      // Fresh start, trial top-up, or same-tier renewal: stack, tier now.
      base = live ? sub.current_period_end! : now;
      periodEnd = addInterval(base, payment.interval);
    } else if (newRank > curRank) {
      // UPGRADE: remaining PAID time → bonus days at the new tier's daily rate.
      // The future can be heterogeneous (e.g. a pro segment + a scheduled basic
      // month), so each unconsumed paid segment is valued at ITS OWN plan's
      // rate, then stamped converted_at so a later upgrade can't count it
      // twice. Trial days have no payment row → naturally worth zero.
      const segments = await tx
        .select({
          id: subscriptionPaymentsTable.id,
          amount: subscriptionPaymentsTable.amount,
          interval: subscriptionPaymentsTable.interval,
          period_start: subscriptionPaymentsTable.period_start,
          period_end: subscriptionPaymentsTable.period_end,
        })
        .from(subscriptionPaymentsTable)
        .where(
          and(
            eq(subscriptionPaymentsTable.subscription_id, sub.id),
            eq(subscriptionPaymentsTable.status, 'paid'),
            sql`${subscriptionPaymentsTable.period_end} > now()`,
            sql`${subscriptionPaymentsTable.converted_at} IS NULL`,
          ),
        );
      let remainingValue = 0;
      for (const seg of segments) {
        if (!seg.period_start || !seg.period_end) continue;
        const from = Math.max(seg.period_start.getTime(), now.getTime());
        const days = Math.max(0, (seg.period_end.getTime() - from) / DAY_MS);
        remainingValue += days * (Number(seg.amount) / PERIOD_DAYS[seg.interval]);
      }
      if (segments.length) {
        await tx
          .update(subscriptionPaymentsTable)
          .set({ converted_at: now })
          .where(
            inArray(
              subscriptionPaymentsTable.id,
              segments.map((s) => s.id),
            ),
          );
      }
      const newDaily = Number(payment.amount) / PERIOD_DAYS[payment.interval];
      bonusDays = newDaily > 0 ? Math.max(0, Math.round(remainingValue / newDaily)) : 0;
      base = now;
      periodEnd = new Date(addInterval(now, payment.interval).getTime() + bonusDays * DAY_MS);
    } else {
      // DOWNGRADE: paid time is honored to the end; tier flips at the boundary.
      base = sub.current_period_end!;
      periodEnd = addInterval(base, payment.interval);
      applyTierNow = false;
      scheduleDowngrade = true;
    }

    const [paid] = await tx
      .update(subscriptionPaymentsTable)
      .set({
        status: 'paid',
        paid_at: now,
        reviewed_by: adminUserId,
        reviewed_at: now,
        period_start: base,
        period_end: periodEnd,
      })
      .where(eq(subscriptionPaymentsTable.id, paymentId))
      .returning();

    const [updatedSub] = await tx
      .update(subscriptionsTable)
      .set({
        plan_id: applyTierNow ? payment.plan_id : sub.plan_id,
        tier: applyTierNow ? payment.tier : sub.tier,
        status: 'active',
        // Stacking cases keep the running period's start; fresh/upgrade reset it.
        current_period_start: base <= now ? base : (sub.current_period_start ?? base),
        current_period_end: periodEnd,
        // A renewal/upgrade overrides any previously scheduled downgrade.
        next_plan_id: scheduleDowngrade ? payment.plan_id : null,
        next_tier: scheduleDowngrade ? payment.tier : null,
        next_tier_at: scheduleDowngrade ? sub.current_period_end : null,
        cancel_at_period_end: false,
        canceled_at: null,
        updatedAt: now,
      })
      .where(eq(subscriptionsTable.id, sub.id))
      .returning();

    const event = await logEvent(tx, {
      subscription_id: sub.id,
      user_id: payment.user_id,
      payment_id: paymentId,
      type: 'payment_confirmed',
      actor: 'admin',
      actor_id: adminUserId,
      detail: {
        amount_due: payment.amount_due,
        period_end: periodEnd.toISOString(),
        change: scheduleDowngrade ? 'downgrade_scheduled' : bonusDays > 0 ? 'upgrade' : 'renewal',
        bonus_days: bonusDays,
      },
    });

    const TIER_LABEL: Record<string, string> = {
      basic: 'Basic',
      pro: 'Pro',
      max_lite: 'Max Lite',
      max: 'Max',
    };
    // Human-facing receipt number, stable per payment: KW/SUB/<year>/<id>.
    const receipt: ReceiptPayload = {
      receipt_no: `KW/SUB/${now.getFullYear()}/${String(paymentId).padStart(4, '0')}`,
      plan_label: TIER_LABEL[payment.tier] ?? payment.tier,
      interval: payment.interval,
      amount: payment.amount,
      discount_pct: Number(payment.discount_pct ?? 0),
      bonus_days: bonusDays,
      unique_code: payment.unique_code,
      amount_due: payment.amount_due,
      paid_at: now.toISOString(),
      period_start: base.toISOString(),
      period_end: periodEnd.toISOString(),
    };

    const tglAkhir = periodEnd.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const body = scheduleDowngrade
      ? `Pembayaran ${rupiah(payment.amount_due)} (${receipt.plan_label} ${payment.interval === 'monthly' ? 'Bulanan' : 'Tahunan'}) sudah kami terima. Paket ${receipt.plan_label} aktif mulai ${base.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })} setelah paket Pian saat ini berakhir, sampai ${tglAkhir}. Terima kasih!`
      : `Pembayaran ${rupiah(payment.amount_due)} (${receipt.plan_label} ${payment.interval === 'monthly' ? 'Bulanan' : 'Tahunan'}) sudah kami terima. Langganan Pian aktif sampai ${tglAkhir}${bonusDays > 0 ? ` (termasuk konversi sisa masa aktif +${bonusDays} hari)` : ''}. Terima kasih!`;
    await enqueueNotification(tx, {
      user_id: payment.user_id,
      subscription_id: sub.id,
      event_id: event.id,
      channel: 'in_app',
      type: 'payment_confirmed',
      title: 'Pembayaran dikonfirmasi',
      body,
      payload: receipt,
    });
    const emailNotif = await enqueueNotification(tx, {
      user_id: payment.user_id,
      subscription_id: sub.id,
      event_id: event.id,
      channel: 'email',
      type: 'payment_confirmed',
      title: `Kwitansi pembayaran Ulun Pesan — ${receipt.receipt_no}`,
      body,
      payload: receipt,
    });

    return { payment: paid, subscription: updatedSub, emailNotificationId: emailNotif.id };
  });

  // Outside the tx: best-effort delivery; the outbox row survives a failure.
  void trySendEmailNotification(result.emailNotificationId);
  return result;
}

// pending → rejected with a reason; no period change. Merchant is notified so
// they can re-submit or contact support.
export async function rejectPayment(paymentId: number, adminUserId: string, note: string) {
  const result = await db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(subscriptionPaymentsTable)
      .where(eq(subscriptionPaymentsTable.id, paymentId))
      .for('update')
      .limit(1);
    if (!payment) throw new Error('NOT_FOUND');
    if (payment.status !== 'pending') throw new Error('ALREADY_PROCESSED');

    const now = new Date();
    const [rejected] = await tx
      .update(subscriptionPaymentsTable)
      .set({ status: 'rejected', reviewed_by: adminUserId, reviewed_at: now, review_note: note })
      .where(eq(subscriptionPaymentsTable.id, paymentId))
      .returning();

    const event = await logEvent(tx, {
      subscription_id: payment.subscription_id,
      user_id: payment.user_id,
      payment_id: paymentId,
      type: 'payment_rejected',
      actor: 'admin',
      actor_id: adminUserId,
      detail: { note },
    });

    const body = `Pembayaran ${rupiah(payment.amount_due)} ditolak${note ? `: ${note}` : ''}. Silakan periksa kembali bukti transfer Pian atau hubungi kami.`;
    await enqueueNotification(tx, {
      user_id: payment.user_id,
      subscription_id: payment.subscription_id,
      event_id: event.id,
      channel: 'in_app',
      type: 'payment_rejected',
      title: 'Pembayaran ditolak',
      body,
    });
    const emailNotif = await enqueueNotification(tx, {
      user_id: payment.user_id,
      subscription_id: payment.subscription_id,
      event_id: event.id,
      channel: 'email',
      type: 'payment_rejected',
      title: 'Pembayaran langganan Ulun Pesan ditolak',
      body,
    });

    return { payment: rejected, emailNotificationId: emailNotif.id };
  });

  void trySendEmailNotification(result.emailNotificationId);
  return result;
}

// Lazily apply a scheduled downgrade once its boundary passes — called on
// subscription reads (my-subscription now, the gating middleware later), so no
// cron is needed. Returns the row unchanged when nothing is due.
export async function applyScheduledTierIfDue<
  T extends {
    id: number;
    user_id: string;
    next_plan_id: number | null;
    next_tier: 'basic' | 'pro' | 'max_lite' | 'max' | null;
    next_tier_at: Date | null;
  },
>(sub: T): Promise<T> {
  if (!sub.next_tier || !sub.next_tier_at || sub.next_tier_at > new Date()) return sub;
  const [updated] = await db
    .update(subscriptionsTable)
    .set({
      tier: sub.next_tier,
      plan_id: sub.next_plan_id,
      next_plan_id: null,
      next_tier: null,
      next_tier_at: null,
      updatedAt: new Date(),
    })
    .where(eq(subscriptionsTable.id, sub.id))
    .returning();
  await db.insert(subscriptionEventsTable).values({
    subscription_id: sub.id,
    user_id: sub.user_id,
    type: 'tier_downgraded',
    actor: 'system',
    detail: { to: sub.next_tier, scheduled_for: sub.next_tier_at.toISOString() },
  });
  return updated as T;
}

// Lazy sweep: void pending payments past their expiry. Called from the admin
// list endpoint so the queue self-cleans without a cron.
export async function expireStalePayments() {
  await db
    .update(subscriptionPaymentsTable)
    .set({ status: 'expired' })
    .where(
      and(
        eq(subscriptionPaymentsTable.status, 'pending'),
        sql`${subscriptionPaymentsTable.expires_at} < now()`,
      ),
    );
}
