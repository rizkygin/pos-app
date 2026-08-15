/**
 * Display-side counterpart to the backend's lib/utils/phone.ts.
 *
 * Only the formatting half lives here. Normalisation stays server-side on
 * purpose — it is a validation rule, and a copy in the browser would be a second
 * definition of what a valid number is, free to drift from the one the database
 * actually enforces.
 */

/** Canonical 628… back to the local 08… form Indonesian readers expect. */
export function formatIndonesianPhone(canonical: string): string {
  return canonical.startsWith('62') ? `0${canonical.slice(2)}` : canonical;
}
