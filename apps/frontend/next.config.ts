import type { NextConfig } from "next";
import path from "node:path";
import { resolveAppUrls } from "./lib/app-env.mjs";

// Resolved at BUILD time on purpose: NEXT_PUBLIC_* is inlined into the client
// bundle, so the environment has to be known before compilation rather than
// read from the container at boot. APP_ENV (or RAILWAY_ENVIRONMENT_NAME) is the
// single input; every address below follows from it.
const { appEnv, apiUrl, siteUrl, internalApiUrl, apiHost } = resolveAppUrls();

console.log(`[env] building for ${appEnv} — api=${apiUrl} site=${siteUrl}`);

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_API_URL: apiUrl,
    NEXT_PUBLIC_SITE_URL: siteUrl,
    API_URL_INTERNAL: internalApiUrl,
    NEXT_PUBLIC_APP_ENV: appEnv,
  },
  // Emit a self-contained .next/standalone server with only the traced
  // node_modules, so the Docker runtime stage needs no `npm install`.
  output: "standalone",
  // Trace from the monorepo root so hoisted workspace deps are included.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  images: {
    remotePatterns: [
      { hostname: "images.unsplash.com", pathname: "/**" },
      // Backend serves user-uploaded files (avatars, products, ads) from its own origin.
      { protocol: "http", hostname: "localhost", port: "4000", pathname: "/**" },
      { protocol: "https", hostname: "api.ulunpesan.com", pathname: "/**" },
      // Whichever backend THIS build talks to — a dev build serving images from
      // api-dev would otherwise be blocked by next/image.
      { protocol: "https", hostname: apiHost, pathname: "/**" },
    ],
  },
  allowedDevOrigins: ['192.168.1.7', 'breeder-enduring-manpower.ngrok-free.dev'],
  devIndicators: false,
  experimental: {
    // The dashboard is auth-gated, so every page is dynamically rendered. By
    // default `staleTimes.dynamic` is 0, meaning the client router caches dynamic
    // pages for 0s and refetches/re-renders on every navigation (incl. back/forward)
    // -> laggy clicks. Caching the rendered segment client-side makes revisits
    // instant. router.refresh() after mutations still busts the cache for fresh data.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
    // Prefetch the full dynamic page content on hover (not just the shell), so the
    // first click into a route feels instant too, not only revisits.
    dynamicOnHover: true,
  },
};

export default nextConfig;
