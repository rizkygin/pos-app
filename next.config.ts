import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    domains: ['images.unsplash.com', "images.unsplash.com"],
  },
  allowedDevOrigins: ['192.168.1.7', 'breeder-enduring-manpower.ngrok-free.dev'],
  devIndicators: false,
  experimental: {
    serverActions: {
      bodySizeLimit: '6mb',
    },
  },
  // User-uploaded files live on a persistent volume mounted at public/uploads
  // (see Railway volume "pos-app-volume"); existing URLs/DB rows still
  // reference the old /products, /avatars, /ads paths, so route them through.
  async rewrites() {
    return [
      { source: '/products/:path*', destination: '/uploads/products/:path*' },
      { source: '/avatars/:path*', destination: '/uploads/avatars/:path*' },
      { source: '/ads/:path*', destination: '/uploads/ads/:path*' },
    ];
  },
};

export default nextConfig;
