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

// Outlet avatar / cover images. Legacy bare names live at the public root
// ("/<name>"), matching the existing outlet-card / admin outlet helpers.
export function resolveOutletImage(image?: string | null): string {
  if (!image || image === "avatar.png") return DEFAULT_IMAGE;
  if (image.startsWith("http")) return image;
  if (image.startsWith("/uploads/")) return `${API_URL}${image}`;
  if (image.startsWith("/")) return image;
  return `/${image}`;
}

// True when the stored value points at a backend-served upload (/uploads/...).
// Next's image optimizer can't proxy these, so such <Image>s must set
// `unoptimized` (matches the outlet-avatar precedent in owner-setting.tsx).
export function isBackendImage(image?: string | null): boolean {
  return !!image && image.startsWith("/uploads/");
}

// Same idea for ad banner images (legacy bare names live under /ads/).
export function resolveBannerImage(image?: string | null): string {
  if (!image) return DEFAULT_IMAGE;
  if (image.startsWith("http")) return image;
  if (image.startsWith("/uploads/")) return `${API_URL}${image}`;
  if (image.startsWith("/ads/")) return image;
  return `/ads/${image}`;
}
