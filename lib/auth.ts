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
  ],
  advanced: {
    cookies: {
      session_token: {
        name: "auth_session",
        attributes: {
          sameSite: "lax",
          secure: true,
          path: "/"
        }
      }
    }
  }
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
