/**
 * Which world this build belongs to, and the addresses that follow from it.
 *
 * Mirrors apps/backend/src/lib/app-env.ts. Kept as .mjs because next.config.ts
 * needs it at build time — NEXT_PUBLIC_* values are inlined into the client
 * bundle, so they must be resolved before a single byte is compiled, not read
 * at runtime like the backend can.
 *
 * The point is the same on both sides: APP_ENV (or Railway's own
 * RAILWAY_ENVIRONMENT_NAME) says production or development, and every URL is
 * derived. Explicit env still wins, which is how a laptop and docker-compose
 * keep working.
 */

/** @typedef {'production' | 'development' | 'local'} AppEnv */

/** @returns {AppEnv} */
export function detectAppEnv() {
  const raw = (process.env.APP_ENV ?? process.env.RAILWAY_ENVIRONMENT_NAME ?? '').toLowerCase();
  if (raw === 'production' || raw === 'prod') return 'production';
  if (raw === 'development' || raw === 'dev' || raw === 'staging') return 'development';
  // No Railway and no APP_ENV means a laptop. Defaulting to production here
  // would point local development at real customer data.
  return 'local';
}

const URLS = {
  production: {
    apiUrl: 'https://api.ulunpesan.com',
    siteUrl: 'https://www.ulunpesan.com',
  },
  development: {
    apiUrl: 'https://api-dev.ulunpesan.com',
    siteUrl: 'https://dev.ulunpesan.com',
  },
  local: {
    apiUrl: 'http://localhost:4000',
    siteUrl: 'http://localhost:3000',
  },
};

export function resolveAppUrls() {
  const appEnv = detectAppEnv();
  const derived = URLS[appEnv];

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? derived.apiUrl;

  return {
    appEnv,
    apiUrl,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? derived.siteUrl,
    // Server-side fetches may take a private-network shortcut; falls back to the
    // public URL, which is what every non-container run uses.
    internalApiUrl: process.env.API_URL_INTERNAL ?? apiUrl,
    /** Host of the API, for next/image remotePatterns. */
    apiHost: new URL(apiUrl).hostname,
  };
}
