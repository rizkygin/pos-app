import { config } from 'dotenv'
config({ path: '.env' })
config({ path: '../../.env' })

import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'
import * as relations from './relation'

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing in the environment. Make sure your .env file is loaded properly.')
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
})

export const db = drizzle({ client: pool, schema: { ...schema, ...relations }, logger: true })