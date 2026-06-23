import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
