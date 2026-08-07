// Lives under src/ — NOT a top-level scripts/ dir — so tsc emits it into dist
// and it ships inside the backend image. rootDir is "src", and the Dockerfile
// copies only src/, so anything outside is invisible in a deployed container.
//
// Run it there with plain node, no tsx (the runtime stage installs --omit=dev):
//   node dist/scripts/reset-password-user.js <userId> <newPassword>
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { account, usersTable } from '../db/schema'
import { auth } from '../auth'

const userId = process.argv[2]
const newPassword = process.argv[3]

if (!userId || !newPassword) {
    console.error('❌ Usage: node dist/scripts/reset-password-user.js <userId> <newPassword>')
    process.exit(1)
}

const main = async () => {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId))
    // Check before hashing: an unknown id used to fall through to an UPDATE that
    // matched no rows, print "reset successfully", then crash on user[0].email.
    if (!user) {
        console.error(`❌ No user with id ${userId}`)
        process.exit(1)
    }

    const ctx = await auth.$context
    const hashedPassword = await ctx.password.hash(newPassword)

    // Only the credential row: a user who also signed in with an OAuth provider
    // has other account rows, and stamping a password hash onto those corrupts
    // them. The original updated every account row for the user.
    const updated = await db
        .update(account)
        .set({ password: hashedPassword })
        .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
        .returning({ id: account.id })

    if (updated.length === 0) {
        console.error(`❌ ${user.email} has no credential account — nothing to reset.`)
        process.exit(1)
    }

    console.log('✅ Password reset for:', user.email)
    process.exit(0)
}

main().catch((err) => {
    console.error('❌ Error:', err)
    process.exit(1)
})
