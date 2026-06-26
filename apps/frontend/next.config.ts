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
};

export default nextConfig;
