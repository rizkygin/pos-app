/**
 * One canonical shape for Indonesian mobile numbers.
 *
 * People type the same number half a dozen ways — 0812-3456-7890, +62 812 3456
 * 7890, (0812) 34567890, 62812.3456.7890. Stored as typed, those are six
 * different strings for one phone: you cannot match on them, dedupe them, or
 * build a wa.me link without guessing.
 *
 * Canonical form is `628xxxxxxxxx` — international, no plus, no separators.
 * Chosen because it is what WhatsApp's own links require (wa.me/62812…), so the
 * stored value is directly usable rather than needing conversion at every call
 * site. Display code is free to render it back as 08… for Indonesian readers.
 */
export function normalizeIndonesianPhone(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;

  // Everything that isn't a digit goes: dashes, spaces, dots, brackets, the
  // leading plus. This is the whole point — the separators carry no meaning.
  let digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;

  // Three ways the country code shows up, reduced to the bare subscriber
  // number. An Indonesian mobile always starts with 8 once the prefix is gone,
  // which is also what makes stripping "62" unambiguous: no valid national
  // number begins with 62.
  if (digits.startsWith("62")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.slice(1);

  if (!digits.startsWith("8")) return null;

  // Length is checked on the subscriber part. 10 digits here is 11 in the 08…
  // form everyone recognises, which is the documented minimum; 13 covers the
  // longest real Indonesian mobile numbers.
  if (digits.length < 10 || digits.length > 13) return null;

  return `62${digits}`;
}

/** Canonical 628… back to the local 08… form people actually read. */
export function formatIndonesianPhone(canonical: string): string {
  return canonical.startsWith("62") ? `0${canonical.slice(2)}` : canonical;
}
