import type { MetadataRoute } from "next";
import { SERVER_API_URL } from "@/lib/api-url";

const BASE_URL = "https://ulunpesan.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: BASE_URL, changeFrequency: "daily", priority: 1 },
  ];

  // Public outlet menu pages — the actual content people search for. Public,
  // unauthenticated endpoint; no cookie forwarding needed (unlike serverFetch).
  try {
    const res = await fetch(`${SERVER_API_URL}/api/sitemap-outlets`, {
      next: { revalidate: 3600 },
    });
    if (res.ok) {
      const { data } = (await res.json()) as {
        data: { id: number; updatedAt: string | null }[];
      };
      for (const outlet of data) {
        entries.push({
          url: `${BASE_URL}/menu/${outlet.id}`,
          lastModified: outlet.updatedAt ?? undefined,
          changeFrequency: "weekly",
          priority: 0.8,
        });
      }
    }
  } catch {
    // Backend unreachable at build time: ship the homepage-only sitemap
    // rather than failing the whole build.
  }

  return entries;
}
