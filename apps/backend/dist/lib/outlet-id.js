"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOutletByUserId = getOutletByUserId;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
async function getOutletByUserId(userId) {
    const [outlet] = await db_1.db
        .select()
        .from(schema_1.outletsTable)
        .where((0, drizzle_orm_1.eq)(schema_1.outletsTable.user_id, userId))
        .limit(1);
    return outlet ?? null;
}
