"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("./index");
const drizzle_orm_1 = require("drizzle-orm");
async function testConnection() {
    try {
        const result = await index_1.db.execute((0, drizzle_orm_1.sql) `SELECT 1`);
        console.log('✅ Database connected successfully!');
        console.log('Result:', result);
    }
    catch (error) {
        console.error('❌ Database connection failed!');
        console.error(error);
    }
    finally {
        process.exit(0);
    }
}
testConnection();
