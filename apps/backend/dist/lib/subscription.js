"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BANK_INFO = void 0;
exports.trySendEmailNotification = trySendEmailNotification;
exports.effectiveDiscountPct = effectiveDiscountPct;
exports.createPendingPayment = createPendingPayment;
exports.confirmPayment = confirmPayment;
exports.rejectPayment = rejectPayment;
exports.applyScheduledTierIfDue = applyScheduledTierIfDue;
exports.expireStalePayments = expireStalePayments;
const drizzle_orm_1 = require("drizzle-orm");
const resend_1 = require("resend");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
// Where merchants transfer to. Set real values in env (local .env + Railway
// backend service); these fallbacks are obviously fake on purpose.
exports.BANK_INFO = {
    bank: process.env.SUBSCRIPTION_BANK_NAME ?? 'BCA',
    account_number: process.env.SUBSCRIPTION_BANK_ACCOUNT ?? '8585422386',
    account_holder: process.env.SUBSCRIPTION_BANK_HOLDER ?? 'PUTRI PINANDITA',
};
// Pending manual payments are void after this many days unpaid.
const PAYMENT_EXPIRY_DAYS = 3;
const FROM = 'Ulun Pesan <noreply@mail.ulunpesan.com>';
const resend = new resend_1.Resend(process.env.RESEND_API_KEY);
const rupiah = (v) => new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
}).format(Number(v) || 0);
// Calendar-aware period math: monthly = +1 month, yearly = +12. JS setMonth
// handles year rollover; end-of-month drift (Jan 31 → Feb 28/Mar 3) is
// acceptable for this product.
function addInterval(from, interval) {
    const d = new Date(from);
    d.setMonth(d.getMonth() + (interval === 'monthly' ? 1 : 12));
    return d;
}
// Tier ladder for upgrade/downgrade decisions and the day-count convention
// used to price remaining time (Model 2 credit-to-days conversion).
const TIER_RANK = { basic: 0, pro: 1, max_lite: 2, max: 3 };
const PERIOD_DAYS = { monthly: 30, yearly: 365 };
const DAY_MS = 24 * 60 * 60 * 1000;
async function logEvent(tx, ev) {
    const [row] = await tx
        .insert(schema_1.subscriptionEventsTable)
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
async function enqueueNotification(tx, n) {
    const [row] = await tx
        .insert(schema_1.subscriptionNotificationsTable)
        .values({ ...n, payload: n.payload ?? null, status: 'pending' })
        .returning();
    return row;
}
const tglID = (iso) => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
// Invoice-style (kwitansi) HTML for the payment-confirmed email. Table-based
// layout + inline styles only — email clients ignore stylesheets.
function receiptEmailHtml(r) {
    const row = (label, value, bold = false) => `
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
            ${r.discount_pct > 0
        ? row(`Diskon (${r.discount_pct}%)`, `-${rupiah(Math.round(Number(r.amount) * (r.discount_pct / 100)))}`)
        : ''}
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
async function trySendEmailNotification(notificationId) {
    try {
        const [n] = await db_1.db
            .select({
            id: schema_1.subscriptionNotificationsTable.id,
            user_id: schema_1.subscriptionNotificationsTable.user_id,
            title: schema_1.subscriptionNotificationsTable.title,
            body: schema_1.subscriptionNotificationsTable.body,
            status: schema_1.subscriptionNotificationsTable.status,
            channel: schema_1.subscriptionNotificationsTable.channel,
            type: schema_1.subscriptionNotificationsTable.type,
            payload: schema_1.subscriptionNotificationsTable.payload,
            email: schema_1.usersTable.email,
        })
            .from(schema_1.subscriptionNotificationsTable)
            .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.usersTable.id, schema_1.subscriptionNotificationsTable.user_id))
            .where((0, drizzle_orm_1.eq)(schema_1.subscriptionNotificationsTable.id, notificationId))
            .limit(1);
        if (!n || n.channel !== 'email' || n.status !== 'pending')
            return;
        // payment_confirmed carries a receipt payload → render the kwitansi
        // template; every other type falls back to the plain-paragraph email.
        const html = n.type === 'payment_confirmed' && n.payload
            ? receiptEmailHtml(n.payload)
            : `<p>${n.body ?? ''}</p><p style="color:#888;font-size:12px">Email otomatis dari Ulun Pesan — balasan tidak dipantau.</p>`;
        const { error } = await resend.emails.send({
            from: FROM,
            to: n.email,
            subject: n.title ?? 'Ulun Pesan',
            html,
        });
        await db_1.db
            .update(schema_1.subscriptionNotificationsTable)
            .set(error ? { status: 'failed' } : { status: 'sent', sent_at: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.subscriptionNotificationsTable.id, notificationId));
    }
    catch {
        await db_1.db
            .update(schema_1.subscriptionNotificationsTable)
            .set({ status: 'failed' })
            .where((0, drizzle_orm_1.eq)(schema_1.subscriptionNotificationsTable.id, notificationId))
            .catch(() => { });
    }
}
// One subscription row per owner. First-ever creation grants the plan's trial
// (access now, before any payment is confirmed); later calls just return the row.
async function getOrCreateSubscription(tx, userId, plan) {
    const [existing] = await tx
        .select()
        .from(schema_1.subscriptionsTable)
        .where((0, drizzle_orm_1.eq)(schema_1.subscriptionsTable.user_id, userId))
        .limit(1);
    if (existing)
        return { sub: existing, created: false };
    const now = new Date();
    const trialEnd = plan.trial_days > 0 ? new Date(now.getTime() + plan.trial_days * 24 * 60 * 60 * 1000) : null;
    const [sub] = await tx
        .insert(schema_1.subscriptionsTable)
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
function effectiveDiscountPct(sub, plan) {
    const pct = Number(sub.discount_pct ?? 0);
    if (!(pct > 0))
        return 0;
    if (sub.discount_tier && sub.discount_tier !== plan.tier)
        return 0;
    if (sub.discount_interval && sub.discount_interval !== plan.interval)
        return 0;
    return Math.min(100, pct);
}
// Merchant picks a plan → returns the pending payment carrying the unique
// transfer amount (amount_due = discounted plan price + 3-digit unique code) so
// the admin can match the bank mutation at a glance. Idempotent per plan: an
// existing still-valid pending payment for the same plan AND same deal is
// returned as-is; switching plans (or a deal change) expires the old one.
async function createPendingPayment(userId, planId) {
    const [plan] = await db_1.db
        .select()
        .from(schema_1.subscriptionPlansTable)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.subscriptionPlansTable.id, planId), (0, drizzle_orm_1.eq)(schema_1.subscriptionPlansTable.is_active, true)))
        .limit(1);
    if (!plan)
        throw new Error('PLAN_NOT_FOUND');
    return db_1.db.transaction(async (tx) => {
        const { sub } = await getOrCreateSubscription(tx, userId, plan);
        const pendings = await tx
            .select()
            .from(schema_1.subscriptionPaymentsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.subscription_id, sub.id), (0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.status, 'pending')));
        // Apply the merchant's marketing deal (if it matches this plan).
        const discountPct = effectiveDiscountPct(sub, plan);
        const discountedPrice = Math.round(Number(plan.price) * (1 - discountPct / 100));
        const now = new Date();
        for (const p of pendings) {
            if (p.plan_id === plan.id &&
                Number(p.discount_pct) === discountPct &&
                (!p.expires_at || p.expires_at > now)) {
                return { payment: p, subscription: sub, reused: true };
            }
            // Different plan, changed deal, or stale: void it so only one live
            // quote (with a current price) exists.
            await tx
                .update(schema_1.subscriptionPaymentsTable)
                .set({ status: 'expired' })
                .where((0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.id, p.id));
        }
        // Unique-amount matching: retry codes until amount_due collides with no
        // other LIVE pending payment (confirmed/old ones don't matter).
        let uniqueCode = 0;
        for (let attempt = 0; attempt < 8; attempt++) {
            const candidate = Math.floor(Math.random() * 900) + 100; // 100..999
            const [clash] = await tx
                .select({ id: schema_1.subscriptionPaymentsTable.id })
                .from(schema_1.subscriptionPaymentsTable)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.status, 'pending'), (0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.amount_due, String(discountedPrice + candidate))))
                .limit(1);
            if (!clash) {
                uniqueCode = candidate;
                break;
            }
        }
        if (!uniqueCode)
            throw new Error('UNIQUE_CODE_EXHAUSTED');
        const [payment] = await tx
            .insert(schema_1.subscriptionPaymentsTable)
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
async function confirmPayment(paymentId, adminUserId) {
    const result = await db_1.db.transaction(async (tx) => {
        const [payment] = await tx
            .select()
            .from(schema_1.subscriptionPaymentsTable)
            .where((0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.id, paymentId))
            .for('update')
            .limit(1);
        if (!payment)
            throw new Error('NOT_FOUND');
        if (payment.status !== 'pending')
            throw new Error('ALREADY_PROCESSED');
        const [sub] = await tx
            .select()
            .from(schema_1.subscriptionsTable)
            .where((0, drizzle_orm_1.eq)(schema_1.subscriptionsTable.id, payment.subscription_id))
            .for('update')
            .limit(1);
        if (!sub)
            throw new Error('SUBSCRIPTION_NOT_FOUND');
        const now = new Date();
        const live = !!sub.current_period_end && sub.current_period_end > now;
        const isTrial = live && sub.status === 'trialing';
        const curRank = sub.tier ? (TIER_RANK[sub.tier] ?? -1) : -1;
        const newRank = TIER_RANK[payment.tier] ?? 0;
        let base;
        let periodEnd;
        let bonusDays = 0;
        let applyTierNow = true;
        let scheduleDowngrade = false;
        if (!live || isTrial || newRank === curRank || curRank === -1) {
            // Fresh start, trial top-up, or same-tier renewal: stack, tier now.
            base = live ? sub.current_period_end : now;
            periodEnd = addInterval(base, payment.interval);
        }
        else if (newRank > curRank) {
            // UPGRADE: remaining PAID time → bonus days at the new tier's daily rate.
            // The future can be heterogeneous (e.g. a pro segment + a scheduled basic
            // month), so each unconsumed paid segment is valued at ITS OWN plan's
            // rate, then stamped converted_at so a later upgrade can't count it
            // twice. Trial days have no payment row → naturally worth zero.
            const segments = await tx
                .select({
                id: schema_1.subscriptionPaymentsTable.id,
                amount: schema_1.subscriptionPaymentsTable.amount,
                interval: schema_1.subscriptionPaymentsTable.interval,
                period_start: schema_1.subscriptionPaymentsTable.period_start,
                period_end: schema_1.subscriptionPaymentsTable.period_end,
            })
                .from(schema_1.subscriptionPaymentsTable)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.subscription_id, sub.id), (0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.status, 'paid'), (0, drizzle_orm_1.sql) `${schema_1.subscriptionPaymentsTable.period_end} > now()`, (0, drizzle_orm_1.sql) `${schema_1.subscriptionPaymentsTable.converted_at} IS NULL`));
            let remainingValue = 0;
            for (const seg of segments) {
                if (!seg.period_start || !seg.period_end)
                    continue;
                const from = Math.max(seg.period_start.getTime(), now.getTime());
                const days = Math.max(0, (seg.period_end.getTime() - from) / DAY_MS);
                remainingValue += days * (Number(seg.amount) / PERIOD_DAYS[seg.interval]);
            }
            if (segments.length) {
                await tx
                    .update(schema_1.subscriptionPaymentsTable)
                    .set({ converted_at: now })
                    .where((0, drizzle_orm_1.inArray)(schema_1.subscriptionPaymentsTable.id, segments.map((s) => s.id)));
            }
            const newDaily = Number(payment.amount) / PERIOD_DAYS[payment.interval];
            bonusDays = newDaily > 0 ? Math.max(0, Math.round(remainingValue / newDaily)) : 0;
            base = now;
            periodEnd = new Date(addInterval(now, payment.interval).getTime() + bonusDays * DAY_MS);
        }
        else {
            // DOWNGRADE: paid time is honored to the end; tier flips at the boundary.
            base = sub.current_period_end;
            periodEnd = addInterval(base, payment.interval);
            applyTierNow = false;
            scheduleDowngrade = true;
        }
        const [paid] = await tx
            .update(schema_1.subscriptionPaymentsTable)
            .set({
            status: 'paid',
            paid_at: now,
            reviewed_by: adminUserId,
            reviewed_at: now,
            period_start: base,
            period_end: periodEnd,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.id, paymentId))
            .returning();
        const [updatedSub] = await tx
            .update(schema_1.subscriptionsTable)
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
            .where((0, drizzle_orm_1.eq)(schema_1.subscriptionsTable.id, sub.id))
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
        const TIER_LABEL = {
            basic: 'Basic',
            pro: 'Pro',
            max_lite: 'Max Lite',
            max: 'Max',
        };
        // Human-facing receipt number, stable per payment: KW/SUB/<year>/<id>.
        const receipt = {
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
async function rejectPayment(paymentId, adminUserId, note) {
    const result = await db_1.db.transaction(async (tx) => {
        const [payment] = await tx
            .select()
            .from(schema_1.subscriptionPaymentsTable)
            .where((0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.id, paymentId))
            .for('update')
            .limit(1);
        if (!payment)
            throw new Error('NOT_FOUND');
        if (payment.status !== 'pending')
            throw new Error('ALREADY_PROCESSED');
        const now = new Date();
        const [rejected] = await tx
            .update(schema_1.subscriptionPaymentsTable)
            .set({ status: 'rejected', reviewed_by: adminUserId, reviewed_at: now, review_note: note })
            .where((0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.id, paymentId))
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
async function applyScheduledTierIfDue(sub) {
    if (!sub.next_tier || !sub.next_tier_at || sub.next_tier_at > new Date())
        return sub;
    const [updated] = await db_1.db
        .update(schema_1.subscriptionsTable)
        .set({
        tier: sub.next_tier,
        plan_id: sub.next_plan_id,
        next_plan_id: null,
        next_tier: null,
        next_tier_at: null,
        updatedAt: new Date(),
    })
        .where((0, drizzle_orm_1.eq)(schema_1.subscriptionsTable.id, sub.id))
        .returning();
    await db_1.db.insert(schema_1.subscriptionEventsTable).values({
        subscription_id: sub.id,
        user_id: sub.user_id,
        type: 'tier_downgraded',
        actor: 'system',
        detail: { to: sub.next_tier, scheduled_for: sub.next_tier_at.toISOString() },
    });
    return updated;
}
// Lazy sweep: void pending payments past their expiry. Called from the admin
// list endpoint so the queue self-cleans without a cron.
async function expireStalePayments() {
    await db_1.db
        .update(schema_1.subscriptionPaymentsTable)
        .set({ status: 'expired' })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.subscriptionPaymentsTable.status, 'pending'), (0, drizzle_orm_1.sql) `${schema_1.subscriptionPaymentsTable.expires_at} < now()`));
}
