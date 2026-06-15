import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    domains: ['images.unsplash.com', "images.unsplash.com"],
  },
  allowedDevOrigins: ['192.168.1.7', 'breeder-enduring-manpower.ngrok-free.dev']
};

export default nextConfig;
