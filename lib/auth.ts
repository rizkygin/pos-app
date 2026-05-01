import { betterAuth, type Session, type User } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/src/db";
import { usersTable, session, account, verification } from "@/src/db/schema";
import { cache } from "react";
import { headers } from "next/headers";
import { nextCookies } from "better-auth/next-js";
import { redirect } from "next/navigation";


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
  plugins: [
    nextCookies()
  ]
});

export const getSession = cache(async () => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    redirect('/')
  }

  return session;
});
