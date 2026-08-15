"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.timestamps = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
exports.timestamps = {
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: (0, pg_core_1.timestamp)("deleted_at", { withTimezone: true }),
};
