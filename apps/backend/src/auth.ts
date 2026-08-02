import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { usersTable, session, account, verification } from "./db/schema";
import { Resend } from "resend";
import {
  APP_ENV,
  COOKIE_DOMAIN,
  COOKIE_SECURE,
  FRONTEND_ORIGINS,
  FRONTEND_URL,
} from "./lib/app-env";

const resend = new Resend(process.env.RESEND_API_KEY);
// Sender for all transactional mail. mail.ulunpesan.com is a dedicated sending
// subdomain (verified in Resend, DNS records at name.com) so email reputation
// stays isolated from the root domain. If Resend un-verifies it, every send is
// rejected.
const FROM = "Ulun Pesan <noreply@mail.ulunpesan.com>";
// Cookie attributes and addresses both come from APP_ENV now (see lib/app-env),
// so "which world is this" is answered in one place instead of by four
// variables that have to agree. Explicit env still overrides, which is what
// docker-compose and a laptop rely on.
const cookieSecure = COOKIE_SECURE;
const cookieDomain = COOKIE_DOMAIN;

// Both email links are handled by the backend first (to burn the token), then
// redirected to a `callbackURL`. better-auth resolves a relative callbackURL
// against the BACKEND origin — so the caller-supplied "/dashboard" or
// "/reset-password" would land the user on api.ulunpesan.com, a 404. Force an
// absolute frontend URL instead; trustedOrigins already allows it.
function withFrontendCallback(url: string, landing: string) {
  const parsed = new URL(url);
  parsed.searchParams.set("callbackURL", `${FRONTEND_URL}${landing}`);
  return parsed.toString();
}

// The ?verified=1 marker tells the page it was reached from a real verification
// attempt: better-auth appends &error=<code> on failure and nothing at all on
// success, so without a marker a plain visit to /verify-email would look
// exactly like a successful one.
const VERIFY_EMAIL_LANDING = "/verify-email?verified=1";
// The reset callback needs no marker — success carries ?token=<token> and
// failure carries ?error=INVALID_TOKEN, so the two are already distinguishable.
const RESET_PASSWORD_LANDING = "/reset-password";

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
          <a href="${withFrontendCallback(url, RESET_PASSWORD_LANDING)}" style="display:inline-block;padding:12px 24px;background:#f43f5e;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">Reset Password</a>
          <p>If you didn't request this, ignore this email.</p>
        `,
      });
    },
  },
  emailVerification: {
    // Fire on sign-up. requireEmailVerification stays off, so an unverified
    // account can still sign in — verification is a confirmation step, not a
    // gate (turning it into a gate would lock out every existing account).
    sendOnSignUp: true,
    // Merchants often open the link on a different device than they signed up
    // on; signing them in there saves a second login.
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, url }) => {
      await resend.emails.send({
        from: FROM,
        to: user.email,
        subject: "Verify your email address",
        html: `
          <p>Hi ${user.name},</p>
          <p>Click the link below to verify your email address. This link expires in 24 hours.</p>
          <a href="${withFrontendCallback(url, VERIFY_EMAIL_LANDING)}" style="display:inline-block;padding:12px 24px;background:#f43f5e;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">Verify Email</a>
          <p>If you didn't create an account, ignore this email.</p>
        `,
      });
    },
  },
  // "Remember me": 30-day sessions (default is 7) with a rolling refresh —
  // any visit at least a day after the last refresh extends the session, so
  // active merchants effectively stay signed in.
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  // Every one of these paths spends a Resend send on someone else's inbox, so
  // they get a tighter budget than better-auth's built-in 3-per-60s default.
  // Keyed per client IP (resolved from x-forwarded-for behind Railway's edge),
  // stored in memory — fine while the backend runs as a single instance; a
  // second replica would give each its own counters.
  rateLimit: {
    // better-auth only rate-limits in production by default. AUTH_RATE_LIMIT=true
    // forces it on locally so the flow can be exercised end to end.
    // Dev counts as production here: a rate limit that only exists in prod is a
    // rate limit nobody has ever tested.
    enabled: process.env.AUTH_RATE_LIMIT === "true" || APP_ENV !== "local",
    customRules: {
      "/send-verification-email": { window: 300, max: 3 },
      "/forget-password": { window: 300, max: 3 },
      "/request-password-reset": { window: 300, max: 3 },
    },
  },
  // Derived, not hardcoded: a dev deployment that trusts only the production
  // origins rejects its own login redirects.
  trustedOrigins: FRONTEND_ORIGINS,
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
