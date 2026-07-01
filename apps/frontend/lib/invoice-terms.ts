// The owner's standing invoice Terms & Conditions. Stored in the browser
// (localStorage) rather than the database — it's a per-device business default
// that prints on every invoice, not per-invoice data.
const KEY = 'pos_sales_terms';

export function getSalesTerms(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function setSalesTerms(value: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* storage full / unavailable — ignore */
  }
}
