"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)({ path: '.env' });
const node_postgres_1 = require("drizzle-orm/node-postgres");
const pg_1 = require("pg");
const schema_1 = require("./schema");
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
const db = (0, node_postgres_1.drizzle)({ client: pool });
async function clearTestData() {
    console.log('Clearing test data...');
    // ratings → orderDetails → orders, cashFlows → cashIn/cashOutDetail
    await db.delete(schema_1.ratingsTable);
    console.log('✓ ratings cleared');
    await db.delete(schema_1.cashFlows);
    console.log('✓ cashFlows cleared');
    await db.delete(schema_1.orderDetailsTable);
    console.log('✓ orderDetails cleared');
    await db.delete(schema_1.ordersTable);
    console.log('✓ orders cleared');
    await db.delete(schema_1.cashInDetailTable);
    console.log('✓ cashInDetail cleared');
    await db.delete(schema_1.cashOutDetailTable);
    console.log('✓ cashOutDetail cleared');
    // Reset review counts
    await db.update(schema_1.customersTable).set({ review_count: 0 });
    await db.update(schema_1.couriersTable).set({ review_count: 0 });
    await db.update(schema_1.outletsTable).set({ review_count: 0 });
    console.log('✓ review_count reset to 0 for customers, couriers, outlets');
    console.log('Done.');
    await pool.end();
}
clearTestData().catch((err) => {
    console.error(err);
    process.exit(1);
});
