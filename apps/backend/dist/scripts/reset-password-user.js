"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Lives under src/ — NOT a top-level scripts/ dir — so tsc emits it into dist
// and it ships inside the backend image. rootDir is "src", and the Dockerfile
// copies only src/, so anything outside is invisible in a deployed container.
//
// Run it there with plain node, no tsx (the runtime stage installs --omit=dev):
//   node dist/scripts/reset-password-user.js <email> <newPassword>
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../auth");
const email = process.argv[2];
const newPassword = process.argv[3];
if (!email || !newPassword) {
    console.error('❌ Usage: node dist/scripts/reset-password-user.js <email> <newPassword>');
    process.exit(1);
}
const main = async () => {
    const [user] = await db_1.db.select().from(schema_1.usersTable).where((0, drizzle_orm_1.eq)(schema_1.usersTable.email, email));
    // Check before hashing: an unknown id used to fall through to an UPDATE that
    // matched no rows, print "reset successfully", then crash on user[0].email.
    if (!user) {
        console.error(`❌ No user with email ${email}`);
        process.exit(1);
    }
    const ctx = await auth_1.auth.$context;
    const hashedPassword = await ctx.password.hash(newPassword);
    // Only the credential row: a user who also signed in with an OAuth provider
    // has other account rows, and stamping a password hash onto those corrupts
    // them. The original updated every account row for the user.
    const updated = await db_1.db
        .update(schema_1.account)
        .set({ password: hashedPassword })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.account.userId, user.id), (0, drizzle_orm_1.eq)(schema_1.account.providerId, 'credential')))
        .returning({ id: schema_1.account.id });
    if (updated.length === 0) {
        console.error(`❌ ${user.email} has no credential account — nothing to reset.`);
        process.exit(1);
    }
    console.log('✅ Password reset for:', user.email);
    process.exit(0);
};
main().catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
});
