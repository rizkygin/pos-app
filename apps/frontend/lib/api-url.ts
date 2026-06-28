// Browser-facing backend URL, inlined at build time. Used by client components.
export const API_URL = process.env.NEXT_PUBLIC_API_URL;

// Server-only backend base for RSC / middleware fetches. In a containerized
// deploy the browser reaches the backend at NEXT_PUBLIC_API_URL (a published
// host port), but server-side code inside the frontend container must reach it
// over the internal network — set API_URL_INTERNAL (e.g. http://backend:4000)
// there. Falls back to the public URL for local/non-container runs. Read at
// runtime (not a NEXT_PUBLIC_ var), so it must only be used server-side.
export const SERVER_API_URL =
  process.env.API_URL_INTERNAL ?? process.env.NEXT_PUBLIC_API_URL;
