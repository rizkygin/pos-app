/**
 * Seed a week of delivered orders for one courier, so the weekly earnings
 * chart on the courier dashboard has something to draw.
 *
 * Days are placed against the SAME week boundary the dashboard route computes
 * (Monday 00:00 on getUTCTime()'s shifted clock) — seeding on plain local dates
 * would drop orders into the neighbouring day and make the bars disagree with
 * the totals printed above them.
 *
 * Idempotent: every run deletes the orders it previously seeded (they carry a
 * marker in `note`) before inserting a fresh week, so the chart never
 * accumulates duplicate earnings.
 *
 * Usage (from apps/backend):
 *   npm run db:seed-courier-week
 *   npm run db:seed-courier-week -- --email=kurir.seed@example.com
 */
import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./index";
import {
  couriersTable,
  customersTable,
  ordersTable,
  outletsTable,
  usersTable,
} from "./schema";
import { getUTCTime } from "../lib/timezone";

function arg(name: string, fallback: string | null = null): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const EMAIL = arg("email");
const SEED_MARKER = "seed:courier-week";

// Fees per weekday, Mon→Sun. Deliberately uneven, with one empty day, so the
// chart shows a real shape instead of seven identical bars.
const WEEK: number[][] = [
  [12_000, 15_000, 9_000],
  [15_000, 20_000],
  [10_000, 10_000, 13_000, 18_000],
  [],
  [22_000, 17_000],
  [25_000, 30_000, 14_000, 12_000, 19_000],
  [11_000],
];

async function main() {
  const [courier] = EMAIL
    ? await db
        .select({ id: couriersTable.id, name: usersTable.name, email: usersTable.email })
        .from(couriersTable)
        .innerJoin(usersTable, eq(couriersTable.user_id, usersTable.id))
        .where(eq(usersTable.email, EMAIL))
        .limit(1)
    : await db
        .select({ id: couriersTable.id, name: usersTable.name, email: usersTable.email })
        .from(couriersTable)
        .innerJoin(usersTable, eq(couriersTable.user_id, usersTable.id))
        .limit(1);

  if (!courier) {
    console.error(
      EMAIL
        ? `No courier found for ${EMAIL}. Run: npm run db:seed-courier -- --email=${EMAIL} --status=approved`
        : "No couriers in the database. Run: npm run db:seed-courier -- --status=approved",
    );
    process.exit(1);
  }

  const [customer] = await db.select({ id: customersTable.id }).from(customersTable).limit(1);
  const [outlet] = await db.select({ id: outletsTable.id }).from(outletsTable).limit(1);

  if (!customer || !outlet) {
    console.error("Need at least one customer and one outlet. Run: npm run db:seed");
    process.exit(1);
  }

  // Same Monday the dashboard route uses, so bars and totals agree.
  const now = getUTCTime();
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const weekStart = new Date(now);
  weekStart.setUTCDate(now.getUTCDate() - daysSinceMonday);
  weekStart.setUTCHours(0, 0, 0, 0);

  const removed = await db
    .delete(ordersTable)
    .where(
      and(
        eq(ordersTable.courier_id, courier.id),
        sql`${ordersTable.note}::text like ${`%${SEED_MARKER}%`}`,
      ),
    )
    .returning({ id: ordersTable.id });

  const rows = [];
  for (let day = 0; day <= daysSinceMonday; day++) {
    for (const [i, fee] of WEEK[day].entries()) {
      // Spread through the working day rather than all at midnight — the same
      // timestamp is also what "today's earnings" reads.
      const at = new Date(weekStart.getTime() + day * 86_400_000);
      at.setUTCHours(9 + i, 15, 0, 0);
      rows.push({
        id: randomUUID(),
        customer_id: customer.id,
        courier_id: courier.id,
        outlet_id: outlet.id,
        fulfillment: "delivery" as const,
        status: "delivered" as const,
        delivery_fee: String(fee),
        note: { seed: SEED_MARKER },
        createdAt: at,
        updatedAt: at,
      });
    }
  }

  if (rows.length) await db.insert(ordersTable).values(rows);

  const total = rows.reduce((sum, r) => sum + Number(r.delivery_fee), 0);
  console.log(
    `Courier ${courier.name} <${courier.email}>: removed ${removed.length} previously seeded order(s), ` +
      `inserted ${rows.length} delivered order(s) across ${daysSinceMonday + 1} day(s) of this week ` +
      `(week starts ${weekStart.toISOString().slice(0, 10)}), total Rp${total.toLocaleString("id-ID")}.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
