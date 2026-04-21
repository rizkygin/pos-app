import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/src/db";
import { usersTable, session, account, verification } from "@/src/db/schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: usersTable,
      session: session,
      account: account,
      verification: verification,
    },
  }),
  emailAndPassword: { enabled: true },
});

