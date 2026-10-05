// Platform-admin management. This script is the ONLY way an account becomes or
// stops being an admin — no API route can do either (see lib/admin-access.ts).
//
// Lives under src/ so tsc emits it into dist and it ships in the backend image.
// In a deployed container, run it with plain node:
//   node dist/scripts/admin-access.js list
//   node dist/scripts/admin-access.js grant <email>
//   node dist/scripts/admin-access.js revoke <email>
//   node dist/scripts/admin-access.js reset-2fa <email>
// Locally: npm run admin -- <command> [email]
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { adminsTable, session, twoFactor, usersTable } from '../db/schema'
import { recordAdminActivity } from '../lib/admin-activity'

const [command, email] = process.argv.slice(2)

const USAGE = `Usage: node dist/scripts/admin-access.js <command> [email]

  list               every admin, live and removed, with two-factor status
  grant <email>      make an existing account an admin (or restore a removed one)
  revoke <email>     remove admin rights and sign the account out everywhere
  reset-2fa <email>  lost phone AND backup codes: clear two-factor so the account
                     can enrol again; also signs it out everywhere`

function fail(message: string): never {
    console.error(`❌ ${message}`)
    process.exit(1)
}

async function findUser(address: string | undefined) {
    if (!address) fail(USAGE)
    const [user] = await db
        .select({
            id: usersTable.id,
            email: usersTable.email,
            name: usersTable.name,
            twoFactorEnabled: usersTable.twoFactorEnabled,
        })
        .from(usersTable)
        .where(sql`lower(${usersTable.email}) = ${address.trim().toLowerCase()}`)
    if (!user) fail(`No account with email ${address}`)
    return user
}

// Deleting the rows IS signing out: every request re-reads the session from the
// database (no cookie cache is configured in auth.ts), so a cookie whose row is
// gone stops working on the very next request.
async function signOutEverywhere(userId: string) {
    const removed = await db.delete(session).where(eq(session.userId, userId)).returning({ id: session.id })
    return removed.length
}

// Script actions go in the admin activity log like everything else, with no
// admin account behind them.
function logScript(action: string, email: string, detail?: Record<string, unknown>) {
    return recordAdminActivity({ adminUserId: null, adminEmail: 'script', action: `script.${action}`, target: email, detail })
}

async function list() {
    const rows = await db
        .select({
            email: usersTable.email,
            name: usersTable.name,
            twoFactorEnabled: usersTable.twoFactorEnabled,
            createdAt: adminsTable.createdAt,
            deletedAt: adminsTable.deletedAt,
        })
        .from(adminsTable)
        .innerJoin(usersTable, eq(usersTable.id, adminsTable.user_id))
        .orderBy(adminsTable.createdAt)

    if (rows.length === 0) return console.log('No admins.')
    for (const row of rows) {
        const state = row.deletedAt ? `REMOVED ${row.deletedAt.toISOString()}` : 'active'
        const tfa = row.twoFactorEnabled ? '2FA on' : '2FA NOT SET UP'
        console.log(`${row.email.padEnd(36)} ${state.padEnd(34)} ${tfa}`)
    }
}

async function grant(address: string | undefined) {
    const user = await findUser(address)
    const [existing] = await db.select().from(adminsTable).where(eq(adminsTable.user_id, user.id))

    if (existing && !existing.deletedAt) {
        console.log(`ℹ️  ${user.email} is already an admin.`)
    } else if (existing) {
        // admins.email is unique across removed rows too, so a returning admin
        // gets their old row back rather than a second one.
        await db.update(adminsTable).set({ deletedAt: null, updatedAt: new Date() }).where(eq(adminsTable.id, existing.id))
        await logScript('grant', user.email, { restored: true })
        console.log(`✅ Restored admin rights for ${user.email}.`)
    } else {
        await db.insert(adminsTable).values({ user_id: user.id, email: user.email, name: user.name })
        await logScript('grant', user.email)
        console.log(`✅ ${user.email} is now an admin.`)
    }

    if (!user.twoFactorEnabled) {
        console.log('   Admin pages stay locked until they set up two-factor at /dashboard/admin/security.')
    }
}

async function revoke(address: string | undefined) {
    const user = await findUser(address)
    const updated = await db
        .update(adminsTable)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(adminsTable.user_id, user.id), isNull(adminsTable.deletedAt)))
        .returning({ id: adminsTable.id })
    if (updated.length === 0) fail(`${user.email} is not an active admin.`)

    const sessions = await signOutEverywhere(user.id)
    await logScript('revoke', user.email, { sessionsEnded: sessions })
    console.log(`✅ Removed admin rights from ${user.email} and ended ${sessions} session(s).`)
}

async function resetTwoFactor(address: string | undefined) {
    const user = await findUser(address)
    await db.delete(twoFactor).where(eq(twoFactor.userId, user.id))
    await db.update(usersTable).set({ twoFactorEnabled: false }).where(eq(usersTable.id, user.id))
    // A lost phone may be a stolen phone. Whoever holds a live session for this
    // account must prove the password again.
    const sessions = await signOutEverywhere(user.id)
    await logScript('reset-2fa', user.email, { sessionsEnded: sessions })
    console.log(`✅ Two-factor cleared for ${user.email}; ended ${sessions} session(s).`)
    console.log('   Sign in with the password, then set it up again at /dashboard/admin/security.')
}

const main = async () => {
    switch (command) {
        case 'list':
            await list()
            break
        case 'grant':
            await grant(email)
            break
        case 'revoke':
            await revoke(email)
            break
        case 'reset-2fa':
            await resetTwoFactor(email)
            break
        default:
            fail(USAGE)
    }
    process.exit(0)
}

main().catch((err) => {
    console.error('❌ Error:', err)
    process.exit(1)
})
