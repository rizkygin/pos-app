import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { usersTable, session, account, verification } from "./db/schema";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
// Sender for all transactional mail. mail.ulunpesan.com is a dedicated sending
// subdomain (verified in Resend, DNS records at name.com) so email reputation
// stays isolated from the root domain. If Resend un-verifies it, every send is
// rejected.
const FROM = "Ulun Pesan <noreply@mail.ulunpesan.com>";
const isProduction = process.env.NODE_ENV === "production";

// Cookie attributes are env-driven so a production build can still be run over
// plain HTTP locally (e.g. docker-compose). Defaults preserve prod behaviour.
// Local override: COOKIE_SECURE=false and COOKIE_DOMAIN= (empty) -> host-only,
// non-secure cookie that browsers accept on http://localhost.
const cookieSecure = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === "true"
  : isProduction;
const cookieDomain =
  process.env.COOKIE_DOMAIN ?? (isProduction ? ".ulunpesan.com" : undefined);

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
          secure: cookieSecure,
          path: "/",
          // Same parent domain in prod (frontend on ulunpesan.com, backend on
          // api.ulunpesan.com) so the session cookie is readable by both.
          ...(cookieDomain ? { domain: cookieDomain } : {}),
        },
      },
    },
  },
});

export async function getSessionFromHeaders(headers: Headers) {
  return auth.api.getSession({ headers });
}
