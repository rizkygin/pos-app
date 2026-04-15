// src/db/migrate.ts
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool });

migrate(db, { migrationsFolder: './drizzle' })
    .then(() => console.log('Migration success'))
    .catch((err) => console.error('Migration failed:', err))
    .finally(() => pool.end());