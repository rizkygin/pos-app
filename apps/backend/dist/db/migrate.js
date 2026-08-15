"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/db/migrate.ts
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)({ path: '.env' });
(0, dotenv_1.config)({ path: '../../.env' });
const node_postgres_1 = require("drizzle-orm/node-postgres");
const migrator_1 = require("drizzle-orm/node-postgres/migrator");
const pg_1 = require("pg");
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
const db = (0, node_postgres_1.drizzle)({ client: pool });
(0, migrator_1.migrate)(db, { migrationsFolder: './drizzle', migrationsTable: '__drizzle_migrations', migrationsSchema: 'public' })
    .then(() => console.log('Migration success'))
    .catch((err) => console.error('Migration failed:', err))
    .finally(() => pool.end());
