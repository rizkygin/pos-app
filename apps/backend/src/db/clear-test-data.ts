import { config } from 'dotenv';
config({ path: '.env' });

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq, sql } from 'drizzle-orm';
import {
  ratingsTable,
  cashFlows,
  cashInDetailTable,
  cashOutDetailTable,
  orderDetailsTable,
  ordersTable,
  customersTable,
  couriersTable,
  outletsTable,
} from './schema';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool });

async function clearTestData() {
  console.log('Clearing test data...');

  // ratings → orderDetails → orders, cashFlows → cashIn/cashOutDetail
  await db.delete(ratingsTable);
  console.log('✓ ratings cleared');

  await db.delete(cashFlows);
  console.log('✓ cashFlows cleared');

  await db.delete(orderDetailsTable);
  console.log('✓ orderDetails cleared');

  await db.delete(ordersTable);
  console.log('✓ orders cleared');

  await db.delete(cashInDetailTable);
  console.log('✓ cashInDetail cleared');

  await db.delete(cashOutDetailTable);
  console.log('✓ cashOutDetail cleared');

  // Reset review counts
  await db.update(customersTable).set({ review_count: 0 });
  await db.update(couriersTable).set({ review_count: 0 });
  await db.update(outletsTable).set({ review_count: 0 });
  console.log('✓ review_count reset to 0 for customers, couriers, outlets');

  console.log('Done.');
  await pool.end();
}

clearTestData().catch((err) => {
  console.error(err);
  process.exit(1);
});
