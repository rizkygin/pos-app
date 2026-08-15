"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auth = void 0;
exports.getSessionFromHeaders = getSessionFromHeaders;
const better_auth_1 = require("better-auth");
const drizzle_1 = require("better-auth/adapters/drizzle");
const db_1 = require("./db");
const schema_1 = require("./db/schema");
const resend_1 = require("resend");
const app_env_1 = require("./lib/app-env");
const resend = new resend_1.Resend(process.env.RESEND_API_KEY);
// Sender for all transactional mail. mail.ulunpesan.com is a dedicated sending
// subdomain (verified in Resend, DNS records at name.com) so email reputation
// stays isolated from the root domain. If Resend un-verifies it, every send is
// rejected.
const FROM = "Ulun Pesan <noreply@mail.ulunpesan.com>";
// Cookie attributes and addresses both come from APP_ENV now (see lib/app-env),
// so "which world is this" is answered in one place instead of by four
// variables that have to agree. Explicit env still overrides, which is what
// docker-compose and a laptop rely on.
const cookieSecure = app_env_1.COOKIE_SECURE;
const cookieDomain = app_env_1.COOKIE_DOMAIN;
// Both email links are handled by the backend first (to burn the token), then
// redirected to a `callbackURL`. better-auth resolves a relative callbackURL
// against the BACKEND origin — so the caller-supplied "/dashboard" or
// "/reset-password" would land the user on api.ulunpesan.com, a 404. Force an
// absolute frontend URL instead; trustedOrigins already allows it.
function withFrontendCallback(url, landing) {
    const parsed = new URL(url);
    parsed.searchParams.set("callbackURL", `${app_env_1.FRONTEND_URL}${landing}`);
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
exports.auth = (0, better_auth_1.betterAuth)({
    database: (0, drizzle_1.drizzleAdapter)(db_1.db, {
        provider: "pg",
        schema: {
            user: schema_1.usersTable,
            session: schema_1.session,
            account: schema_1.account,
            verification: schema_1.verification,
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
    // Stored in memory — fine while the backend runs as a single instance; a
    // second replica would give each its own counters.
    //
    // IMPORTANT: keying is per client IP *only when an IP can be resolved*.
    // better-auth reads x-forwarded-for by default, but with no
    // `advanced.ipAddress.trustedProxies` set it refuses to trust a multi-hop
    // chain and returns null (a forged leftmost hop would otherwise let anyone
    // pick their own bucket). Every request then shares ONE bucket per path —
    // and the built-in 3-per-10s rule on /sign-in becomes three logins per ten
    // seconds for the whole customer base, which reads to a merchant as "the app
    // logged me out" / "it won't let me in". The limits below are sized to be
    // survivable in that shared-bucket state. See the TODO under advanced.
    rateLimit: {
        // better-auth only rate-limits in production by default. AUTH_RATE_LIMIT=true
        // forces it on locally so the flow can be exercised end to end.
        // Dev counts as production here: a rate limit that only exists in prod is a
        // rate limit nobody has ever tested.
        enabled: process.env.AUTH_RATE_LIMIT === "true" || app_env_1.APP_ENV !== "local",
        customRules: {
            // customRules are applied last and override better-auth's built-in
            // special rules, so these numbers win over the 3-per-10s default.
            // Sign-in: the default 3-per-10s is a per-user number being applied to
            // everyone at once. A shift-open with several outlets logging in
            // simultaneously trips it in normal use.
            "/sign-in": { window: 60, max: 20 },
            "/sign-in/*": { window: 60, max: 20 },
            // Called on every dashboard render (see frontend lib/auth.ts), so this
            // is the highest-volume auth path by an order of magnitude and does not
            // belong under the 100-per-10s default ceiling.
            "/get-session": { window: 60, max: 600 },
            // These three each spend a Resend send on someone else's inbox, so they
            // stay tight. Shared-bucket cost is accepted: the blast radius is "no
            // password resets for 5 minutes", which never blocks an active session.
            "/send-verification-email": { window: 300, max: 3 },
            "/forget-password": { window: 300, max: 3 },
            "/request-password-reset": { window: 300, max: 3 },
        },
    },
    // Derived, not hardcoded: a dev deployment that trusts only the production
    // origins rejects its own login redirects.
    trustedOrigins: app_env_1.FRONTEND_ORIGINS,
    advanced: {
        // TODO: set `ipAddress: { trustedProxies: [...] }` with Railway's edge
        // CIDR ranges. Until then getIp() cannot resolve a client through a
        // multi-hop x-forwarded-for and every rate limit above is a single shared
        // bucket rather than per-user (boot logs a one-time warning: "Rate
        // limiting could not determine a client IP"). The loosened /sign-in and
        // /get-session numbers are compensating for that and can come back down
        // once this is set — a wrong CIDR fails closed, so verify before shipping.
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
async function getSessionFromHeaders(headers) {
    return exports.auth.api.getSession({ headers });
}
