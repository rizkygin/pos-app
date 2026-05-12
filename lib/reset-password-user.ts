import { db } from '@/src/db'
import { account, usersTable } from '@/src/db/schema'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'

const userId = process.argv[2]      // first argument
const newPassword = process.argv[3] // second argument

if (!userId || !newPassword) {
    console.error('❌ Usage: npx tsx lib/reset-password-user.ts <userId> <newPassword>')
    process.exit(1)
}

const main = async () => {
    const ctx = await auth.$context
    const hashedPassword = await ctx.password.hash(newPassword)
    const user = await db.select().from(usersTable).where(eq(usersTable.id, userId))
    console.log('✅ User:', user)
    await db.update(account)
        .set({ password: hashedPassword })
        .where(eq(account.userId, userId))

    console.log('✅ Password reset successfully for email:', user[0].email)
    console.log('✅ Hassing Password: ', hashedPassword);
    process.exit(0)
}

main().catch((err) => {
    console.error('❌ Error:', err)
    process.exit(1)
})