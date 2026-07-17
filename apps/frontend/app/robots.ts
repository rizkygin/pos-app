import type { MetadataRoute } from "next";

// /dashboard is a private, authenticated area — noindex on its layout is the
// real guarantee (see app/dashboard/layout.tsx); this disallow just keeps
// crawlers from wasting budget trying. /menu/[outlet_id] is the actual public
// content (customer-facing outlet pages) and stays open.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/reset-password", "/register-role"],
    },
    sitemap: "https://ulunpesan.com/sitemap.xml",
  };
}
