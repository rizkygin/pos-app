"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)({ path: '.env' });
(0, dotenv_1.config)({ path: '../../.env' });
const drizzle_orm_1 = require("drizzle-orm");
const index_1 = require("./index");
const schema_1 = require("./schema");
// One-off GRANDFATHER backfill for gating launch: every existing outlet owner
// without a subscription row gets a 30-day trialing window (vs the standard 14
// for new signups) so nobody who has been using the app free gets surprised by
// read-only mode. Idempotent: owners who already have a row are skipped.
// Run against prod like seed-plans: DATABASE_URL=<DATABASE_PUBLIC_URL> npx tsx
// src/db/backfill-subscriptions.ts
const GRACE_DAYS = 30;
async function main() {
    const owners = await index_1.db
        .selectDistinct({ user_id: schema_1.outletsTable.user_id })
        .from(schema_1.outletsTable)
        .leftJoin(schema_1.subscriptionsTable, (0, drizzle_orm_1.eq)(schema_1.subscriptionsTable.user_id, schema_1.outletsTable.user_id))
        .where((0, drizzle_orm_1.isNull)(schema_1.subscriptionsTable.id));
    console.log(`${owners.length} owner(s) without a subscription`);
    const now = new Date();
    const end = new Date(now.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);
    for (const { user_id } of owners) {
        const [sub] = await index_1.db
            .insert(schema_1.subscriptionsTable)
            .values({
            user_id,
            status: 'trialing',
            trial_ends_at: end,
            current_period_start: now,
            current_period_end: end,
        })
            .onConflictDoNothing({ target: schema_1.subscriptionsTable.user_id })
            .returning();
        if (!sub)
            continue; // raced/already exists
        await index_1.db.insert(schema_1.subscriptionEventsTable).values({
            subscription_id: sub.id,
            user_id,
            type: 'trial_started',
            actor: 'system',
            detail: { grandfather: true, days: GRACE_DAYS },
        });
        await index_1.db.insert(schema_1.subscriptionNotificationsTable).values({
            user_id,
            subscription_id: sub.id,
            channel: 'in_app',
            type: 'grandfather_trial',
            title: 'Masa percobaan 30 hari dimulai',
            body: `Ulun Pesan kini berlangganan. Sebagai pengguna awal, Pian mendapat masa percobaan ${GRACE_DAYS} hari dengan semua fitur — pilih paket di halaman Langganan sebelum ${end.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}.`,
            status: 'pending',
        });
        console.log(`  backfilled ${user_id}`);
    }
    console.log('Done.');
    process.exit(0);
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
