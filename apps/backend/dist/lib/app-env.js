"use strict";
/**
 * One variable decides which world this process is in; every URL follows from
 * it.
 *
 * Before this, each deployment carried its own copy of FRONTEND_ORIGIN,
 * BETTER_AUTH_URL and COOKIE_DOMAIN. Four variables that must agree, set by
 * hand, in two services, per environment — and the failure mode when one drifts
 * is not a crash but a login that silently stops working, because the cookie
 * was scoped to a domain nobody is visiting.
 *
 * Now: APP_ENV (or Railway's own RAILWAY_ENVIRONMENT_NAME) says "production" or
 * "development", and the addresses are derived. Adding an environment means
 * adding a row to the table below, not remembering six variables.
 *
 * Every derived value can still be overridden explicitly. Local development
 * runs on localhost and a laptop is neither of these worlds, so the escape
 * hatch is not optional — it is the common case.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.COOKIE_SECURE = exports.COOKIE_DOMAIN = exports.AUTH_URL = exports.API_URL = exports.FRONTEND_URL = exports.FRONTEND_ORIGINS = exports.isProduction = exports.APP_ENV = void 0;
function detectEnv() {
    const raw = (process.env.APP_ENV ?? process.env.RAILWAY_ENVIRONMENT_NAME ?? "").toLowerCase();
    if (raw === "production" || raw === "prod")
        return "production";
    if (raw === "development" || raw === "dev" || raw === "staging")
        return "development";
    // No Railway, no APP_ENV: a laptop. Assuming production here would point a
    // developer's machine at real customer data, so the safe default is local.
    return "local";
}
exports.APP_ENV = detectEnv();
exports.isProduction = exports.APP_ENV === "production";
const URLS = {
    production: {
        // Apex AND www: listing only one leaves the other blocked by CORS in the
        // browser, which reads as "the site is down" to whoever typed it that way.
        frontendOrigins: ["https://ulunpesan.com", "https://www.ulunpesan.com"],
        apiUrl: "https://api.ulunpesan.com",
        cookieDomain: ".ulunpesan.com",
        cookieSecure: true,
    },
    development: {
        frontendOrigins: ["https://dev.ulunpesan.com"],
        apiUrl: "https://api-dev.ulunpesan.com",
        // Real subdomains of the same apex on purpose: a shared auth cookie cannot
        // be scoped to *.up.railway.app, which is on the Public Suffix List, so a
        // free Railway domain would break login in this environment entirely.
        cookieDomain: ".ulunpesan.com",
        cookieSecure: true,
    },
    local: {
        frontendOrigins: ["http://localhost:3000"],
        apiUrl: "http://localhost:4000",
        cookieDomain: undefined,
        cookieSecure: false,
    },
};
const derived = URLS[exports.APP_ENV];
/** Explicit env wins — local overrides and one-off deployments still work. */
exports.FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGIN
    ? process.env.FRONTEND_ORIGIN.split(",")
    : derived.frontendOrigins)
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
exports.FRONTEND_URL = exports.FRONTEND_ORIGINS[0];
exports.API_URL = process.env.PUBLIC_API_URL ?? derived.apiUrl;
exports.AUTH_URL = process.env.BETTER_AUTH_URL ?? exports.API_URL;
exports.COOKIE_DOMAIN = process.env.COOKIE_DOMAIN !== undefined
    ? process.env.COOKIE_DOMAIN || undefined // empty string means host-only
    : derived.cookieDomain;
exports.COOKIE_SECURE = process.env.COOKIE_SECURE !== undefined
    ? process.env.COOKIE_SECURE === "true"
    : derived.cookieSecure;
// Logged once at boot. When auth mysteriously stops working, the first question
// is always "which environment does this process think it is" — so it says so.
console.log(`[env] APP_ENV=${exports.APP_ENV} api=${exports.API_URL} frontend=${exports.FRONTEND_ORIGINS.join(",")} ` +
    `cookieDomain=${exports.COOKIE_DOMAIN ?? "(host-only)"} secure=${exports.COOKIE_SECURE}`);
