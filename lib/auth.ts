import { betterAuth, type Session, type User } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/src/db";
import { usersTable, session, account, verification } from "@/src/db/schema";
import { cache } from "react";
import { headers } from "next/headers";
import { nextCookies } from "better-auth/next-js";
import { redirect } from "next/navigation";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = "POS App <noreply@yourdomain.com>";

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
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      await resend.emails.send({
        from: FROM,
        to: user.email,
        subject: "Reset your password",
        html: `
          <p>Hi ${user.name},</p>
          <p>Click the link below to reset your password. This link expires in 1 hour.</p>
          <a href="${url}" style="display:inline-block;padding:12px 24px;background:#f43f5e;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">Reset Password</a>
          <p>If you didn't request this, ignore this email.</p>
        `,
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await resend.emails.send({
        from: FROM,
        to: user.email,
        subject: "Verify your email address",
        html: `
          <p>Hi ${user.name},</p>
          <p>Click the link below to verify your email address.</p>
          <a href="${url}" style="display:inline-block;padding:12px 24px;background:#f43f5e;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">Verify Email</a>
          <p>If you didn't create an account, ignore this email.</p>
        `,
      });
    },
  },
  trustedOrigins: [
    "https://ulunpesan.com",
    "https://www.ulunpesan.com",
  ],
  plugins: [
    nextCookies()
  ],
  advanced: {
    cookies: {
      session_token: {
        name: "auth_session",
        attributes: {
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
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
