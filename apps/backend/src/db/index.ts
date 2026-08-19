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

// The pool everything normal runs on: cashier, orders, auth, invoices.
// pg's default max is 10.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
})

/**
 * Query logging. `logger: true` fires on EVERY query — auth session lookups,
 * feature flags, the lot — which buries the one statement you are actually
 * reading. SQL_LOG narrows it to queries whose text matches:
 *
 *   SQL_LOG=off                     silence
 *   SQL_LOG=invoices                only statements mentioning "invoices"
 *   SQL_LOG=invoices|order_details  either one (it is a regex)
 *   unset                           log everything, as before
 *
 * Params are printed under the statement so you can paste a real query into
 * psql rather than one full of $1, $2.
 */
const sqlLog = process.env.SQL_LOG
const logger =
    sqlLog === 'off'
        ? false
        : sqlLog
          ? {
                logQuery(query: string, params: unknown[]) {
                    if (!new RegExp(sqlLog, 'i').test(query)) return
                    console.log('\n\x1b[36m%s\x1b[0m', query)
                    if (params.length) console.log('\x1b[90mparams:\x1b[0m', params)
                },
            }
          : true

export const db = drizzle({ client: pool, schema: { ...schema, ...relations }, logger })

/**
 * A deliberately tiny SECOND pool, used only by the segmented sales reports.
 *
 * Reports are the only queries in this app slow enough to hold a connection for
 * a noticeable time — they aggregate a whole 3-month window. On the shared pool
 * that is a real hazard: ten owners opening reports at the same moment take all
 * ten connections, and the eleventh request queues in Node before it ever
 * reaches Postgres. Measured: an unrelated query goes from 0.07s to 1.05s the
 * moment the pool saturates. That eleventh request is not another report — it
 * is a cashier ringing up a sale, or someone logging in.
 *
 * So reports get their own box and can never draw from the main one. Twenty
 * simultaneous reports now means REPORTS_POOL_MAX run and the rest wait in the
 * report queue, while all ten main connections stay free. The feature degrades
 * itself instead of degrading checkout — a slow report is an annoyance, a
 * blocked cashier is a lost sale.
 *
 * The cap is the point, not the extra capacity. Raising it trades that
 * guarantee back for report throughput, so raise it only with a reason.
 */
const REPORT_POOL_MAX = Number(process.env.REPORTS_POOL_MAX ?? 2)

const reportPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: REPORT_POOL_MAX,
    // Server-side kill switch. Measured worst case is ~0.5s at 100k orders in
    // the window, so anything still running at 15s is pathological — and
    // without this it would camp on one of the two connections indefinitely.
    // Env-tunable so the 503-on-timeout path can actually be exercised.
    statement_timeout: Number(process.env.REPORTS_STATEMENT_TIMEOUT_MS ?? 15_000),
    // How long a report waits for a free connection before giving up. Failing
    // with "sedang sibuk" beats a browser tab hanging forever.
    connectionTimeoutMillis: 10_000,
    // Names the connections in pg_stat_activity, so a DBA looking at a busy
    // database can see at a glance that it is reports.
    application_name: 'pos-reports',
})

// logger off on purpose: the report SQL is long and fully parameterised, and at
// one log line per query it drowns the request log it shares with everything else.
export const reportDb = drizzle({ client: reportPool, schema: { ...schema, ...relations }, logger: false })