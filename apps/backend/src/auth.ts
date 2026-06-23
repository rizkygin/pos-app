import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { usersTable, session, account, verification } from "./db/schema";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = "POS App <noreply@yourdomain.com>";
const isProduction = process.env.NODE_ENV === "production";

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
    process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
  ],
  advanced: {
    cookies: {
      session_token: {
        name: "auth_session",
        attributes: {
          sameSite: "lax",
          secure: isProduction,
          path: "/",
          // Same parent domain in prod (frontend on ulunpesan.com, backend on
          // api.ulunpesan.com) so the session cookie is readable by both.
          ...(isProduction ? { domain: ".ulunpesan.com" } : {}),
        },
      },
    },
  },
});

export async function getSessionFromHeaders(headers: Headers) {
  return auth.api.getSession({ headers });
}
