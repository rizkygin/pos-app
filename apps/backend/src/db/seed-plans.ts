import { config } from 'dotenv';
config({ path: '.env' });
config({ path: '../../.env' });

import { db } from './index';
import { subscriptionPlansTable } from './schema';

// Ulun Pesan subscription catalog (platform revenue — see the subscription
// billing section in schema.ts). IDEMPOTENT: upserts on the unique
// (tier, interval) index, so it is safe to run in production and re-run after a
// price change. Prices in IDR. Yearly = a lower per-month base * 12 * 0.9 (a 10%
// annual discount), per the pricing sheet.
const plans = [
  { tier: 'basic', interval: 'monthly', name: 'Basic Bulanan', price: 30000, sort_order: 10 },
  { tier: 'basic', interval: 'yearly', name: 'Basic Tahunan', price: 324000, sort_order: 10 },
  { tier: 'pro', interval: 'monthly', name: 'Pro Bulanan', price: 80000, sort_order: 20 },
  { tier: 'pro', interval: 'yearly', name: 'Pro Tahunan', price: 756000, sort_order: 20 },
  { tier: 'max_lite', interval: 'monthly', name: 'Max Lite Bulanan', price: 110000, sort_order: 30 },
  { tier: 'max_lite', interval: 'yearly', name: 'Max Lite Tahunan', price: 1080000, sort_order: 30 },
  { tier: 'max', interval: 'monthly', name: 'Max Bulanan', price: 200000, sort_order: 40 },
  { tier: 'max', interval: 'yearly', name: 'Max Tahunan', price: 1944000, sort_order: 40 },
] as const;

// cashierShift / pager / tax are the counter features that start at Max Lite:
// opening a shift (drawer float + closing count) and the buzzer number with its
// kitchen ticket. Both are false on basic/pro and true from max_lite up, which
// is what "minimum Max Lite" means here — there is no tier ORDERING anywhere in
// this system, only these per-plan flags, so a tier's entitlements are read off
// its own row and nothing has to know that max outranks max_lite.
//
// Re-run this seed after changing them: the gate reads subscription_plans
// .features live (see getSubscriptionGate), so an upsert here reprices every
// existing subscriber immediately, with no migration and no backfill.
//
// Feature caps per tier — read by the gating middleware. The same caps apply
// to a tier's monthly and yearly plan. desktopCashier gates the native cashier
// app; salesInvoice/purchaseInvoice/stock gate the Faktur & Stok suite.
const featuresByTier: Record<string, Record<string, unknown>> = {
  basic: { maxOutlets: 1, maxEmployees: 1, desktopCashier: false, customerCanOrder: true, salesInvoice: false, purchaseInvoice: false, stock: false, cashflow: true, report: true, reportInvoice: false, cashierShift: false, pager: false, tax: false },
  pro: { maxOutlets: 1, maxEmployees: 3, desktopCashier: false, customerCanOrder: true, salesInvoice: true, purchaseInvoice: true, stock: false, cashflow: true, report: true, reportInvoice: false, cashierShift: false, pager: false, tax: false },
  max_lite: { maxOutlets: 2, maxEmployees: 5, desktopCashier: true, customerCanOrder: true, salesInvoice: true, purchaseInvoice: true, stock: true, cashflow: true, report: true, reportInvoice: true, cashierShift: true, pager: true, tax: true },
  max: { maxOutlets: 3, maxEmployees: 5, desktopCashier: true, customerCanOrder: true, salesInvoice: true, purchaseInvoice: true, stock: true, cashflow: true, report: true, reportInvoice: true, cashierShift: true, pager: true, tax: true },
};

// PLACEHOLDER trial length (same for all plans). Adjust per tier if desired.
const TRIAL_DAYS = 14;

async function main() {
  for (const p of plans) {
    const values = {
      name: p.name,
      price: String(p.price),
      currency: 'IDR',
      trial_days: TRIAL_DAYS,
      features: featuresByTier[p.tier],
      sort_order: p.sort_order,
      is_active: true,
    };
    await db
      .insert(subscriptionPlansTable)
      .values({ tier: p.tier, interval: p.interval, ...values })
      .onConflictDoUpdate({
        target: [subscriptionPlansTable.tier, subscriptionPlansTable.interval],
        set: { ...values, updatedAt: new Date() },
      });
    console.log(`  upserted ${p.tier}/${p.interval} = Rp ${p.price.toLocaleString('id-ID')}`);
  }
  console.log(`Seeded ${plans.length} subscription plans.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
