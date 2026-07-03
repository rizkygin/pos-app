import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
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
    ],
  },
  allowedDevOrigins: ['192.168.1.7', 'breeder-enduring-manpower.ngrok-free.dev'],
  devIndicators: false,
  async headers() {
    return [
      {
        // Static downloadable binaries (e.g. thermalbridge.apk) — Next's default
        // for /public is "no-cache, must-revalidate", so every request (incl.
        // repeat downloads across outlets) re-hits this single origin container.
        // Filenames here are re-copied manually on update (no content hash), so
        // cache for a week rather than marking immutable forever.
        source: "/downloads/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=604800" },
        ],
      },
    ];
  },
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
