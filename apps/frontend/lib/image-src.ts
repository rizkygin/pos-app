import { API_URL } from "@/lib/api-url";

const DEFAULT_IMAGE = "/avatar.png";

// Resolves a stored product image value to a usable <img>/next-Image src.
// Handles every historical format plus new backend-served uploads:
//   - "" / "avatar.png" / "/avatar.png"   -> default avatar (frontend public)
//   - "http(s)://..."                     -> as-is
//   - "/uploads/products/X.webp"          -> backend origin (new uploads)
//   - "/products/X.webp"                  -> legacy frontend public path
//   - "X.webp" (bare filename)            -> legacy frontend public path
export function resolveProductImage(image?: string | null): string {
  if (!image || image === "avatar.png" || image === "/avatar.png") return DEFAULT_IMAGE;
  if (image.startsWith("http")) return image;
  if (image.startsWith("/uploads/")) return `${API_URL}${image}`;
  if (image.startsWith("/products/")) return image;
  return `/products/${image}`;
}

// Same idea for ad banner images (legacy bare names live under /ads/).
export function resolveBannerImage(image?: string | null): string {
  if (!image) return DEFAULT_IMAGE;
  if (image.startsWith("http")) return image;
  if (image.startsWith("/uploads/")) return `${API_URL}${image}`;
  if (image.startsWith("/ads/")) return image;
  return `/ads/${image}`;
}
