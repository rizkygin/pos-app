import { eq } from 'drizzle-orm';
import { db } from '../db';
import { outletPrinterSettingsTable } from '../db/schema';

/**
 * Customer receipt (struk) settings — see the "Receipt (struk) print settings"
 * section of db/schema.ts. The frontend's ReceiptPrintSettings in
 * receipt-modal.tsx mirrors PrinterSettings; keep the two in step.
 */

/** Switch name → column. Every switch is on unless the owner turned it off. */
const SHOW_COLUMNS = {
  logo: 'show_logo',
  outletName: 'show_outlet_name',
  address: 'show_address',
  phone: 'show_phone',
  cashier: 'show_cashier',
  customer: 'show_customer',
  pager: 'show_pager',
  table: 'show_table',
  serviceType: 'show_service_type',
  member: 'show_member',
  savings: 'show_savings',
  headerNote: 'show_header_note',
  footerNote: 'show_footer_note',
  qr: 'show_qr',
} as const;

type ShowKey = keyof typeof SHOW_COLUMNS;

export type PrinterSettings = {
  headerNote: string | null;
  footerNote: string | null;
  qrUrl: string | null;
  qrCaption: string | null;
  show: Record<ShowKey, boolean>;
};

// Mirrored by the settings form's counters. A note is a few lines under the
// header, not a menu: past this it starts to push the order off the paper.
export const NOTE_MAX_LINES = 5;
export const NOTE_MAX_CHARS = 200;
// The receipt prints the QR as a raster no taller than the logo (128 dots on
// 58mm — the Bluetooth buffer limit in receipt-modal.tsx). 100 characters is
// what still fits there at 3 dots per module, the smallest a phone reliably
// scans off thermal paper. A longer link needs a short link.
export const QR_URL_MAX_CHARS = 100;
export const QR_CAPTION_MAX_CHARS = 40;

const SHOW_KEYS = Object.keys(SHOW_COLUMNS) as ShowKey[];

const allShown = () =>
  Object.fromEntries(SHOW_KEYS.map((k) => [k, true])) as Record<ShowKey, boolean>;

/** What an outlet that never saved the section prints: today's receipt. */
const defaultPrinterSettings = (): PrinterSettings => ({
  headerNote: null,
  footerNote: null,
  qrUrl: null,
  qrCaption: null,
  show: allShown(),
});

type Row = typeof outletPrinterSettingsTable.$inferSelect;

function fromRow(row: Row): PrinterSettings {
  return {
    headerNote: row.header_note,
    footerNote: row.footer_note,
    qrUrl: row.qr_url,
    qrCaption: row.qr_caption,
    show: Object.fromEntries(SHOW_KEYS.map((k) => [k, row[SHOW_COLUMNS[k]]])) as Record<
      ShowKey,
      boolean
    >,
  };
}

/** An outlet's receipt settings, defaults when it has no row. */
export async function getPrinterSettings(outletId: number): Promise<PrinterSettings> {
  const [row] = await db
    .select()
    .from(outletPrinterSettingsTable)
    .where(eq(outletPrinterSettingsTable.outlet_id, outletId))
    .limit(1);
  return row ? fromRow(row) : defaultPrinterSettings();
}

type Parsed = { ok: true; settings: PrinterSettings } | { ok: false; error: string };

/**
 * A note as typed: line endings unified, each line trimmed (the receipt
 * centers it anyway), blank lines at either end dropped, tabs and other
 * control characters flattened — the printer would print them as "?".
 * Blank lines in the middle are kept: they are how an owner spaces
 * two blocks apart. Empty means no note.
 */
function parseNote(v: unknown, label: string): string | null | { error: string } {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return { error: `${label} tidak valid.` };
  const lines = v
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[\u0000-\u001f\u007f]/g, ' ').trim());
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length > NOTE_MAX_LINES) {
    return { error: `${label} maksimal ${NOTE_MAX_LINES} baris.` };
  }
  const text = lines.join('\n');
  if (text.length > NOTE_MAX_CHARS) {
    return { error: `${label} maksimal ${NOTE_MAX_CHARS} karakter.` };
  }
  return text === '' ? null : text;
}

/**
 * The QR link. A bare "instagram.com/kopikita" gets https:// in front of it —
 * that is what the owner meant, and a phone camera would otherwise read it as
 * plain text rather than a link. Anything that is not then a valid http(s)
 * URL is rejected rather than printed as a code that goes nowhere.
 */
function parseQrUrl(v: unknown): string | null | { error: string } {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return { error: 'Link QR tidak valid.' };
  let url = v.trim();
  if (url === '') return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
  if (url.length > QR_URL_MAX_CHARS) {
    return { error: `Link QR maksimal ${QR_URL_MAX_CHARS} karakter.` };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: 'Link QR tidak valid.' };
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname.includes('.')) {
    return { error: 'Link QR harus berupa alamat web, misalnya https://instagram.com/outletmu.' };
  }
  return url;
}

/**
 * The whole settings object from a PATCH body. It replaces what is saved, so a
 * switch the body leaves out goes back to its default (shown) rather than
 * keeping a value the form didn't send.
 */
export function parsePrinterSettings(body: unknown): Parsed {
  const b = (body ?? {}) as Record<string, unknown>;

  const headerNote = parseNote(b.headerNote, 'Catatan atas');
  if (headerNote && typeof headerNote === 'object') return { ok: false, error: headerNote.error };
  const footerNote = parseNote(b.footerNote, 'Catatan bawah');
  if (footerNote && typeof footerNote === 'object') return { ok: false, error: footerNote.error };
  const qrUrl = parseQrUrl(b.qrUrl);
  if (qrUrl && typeof qrUrl === 'object') return { ok: false, error: qrUrl.error };

  let qrCaption: string | null = null;
  if (typeof b.qrCaption === 'string') {
    const c = b.qrCaption.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (c.length > QR_CAPTION_MAX_CHARS) {
      return { ok: false, error: `Keterangan QR maksimal ${QR_CAPTION_MAX_CHARS} karakter.` };
    }
    qrCaption = c === '' ? null : c;
  }

  const rawShow = (b.show ?? {}) as Record<string, unknown>;
  const show = allShown();
  for (const k of SHOW_KEYS) {
    const v = rawShow[k];
    if (v === undefined) continue;
    if (typeof v !== 'boolean') return { ok: false, error: 'Pengaturan tampil/sembunyi tidak valid.' };
    show[k] = v;
  }

  return { ok: true, settings: { headerNote, footerNote, qrUrl, qrCaption, show } };
}

/** Create the outlet's row on first save, replace it after. */
export async function savePrinterSettings(outletId: number, s: PrinterSettings): Promise<void> {
  const values = {
    header_note: s.headerNote,
    footer_note: s.footerNote,
    qr_url: s.qrUrl,
    qr_caption: s.qrCaption,
    ...Object.fromEntries(SHOW_KEYS.map((k) => [SHOW_COLUMNS[k], s.show[k]])),
    updated_at: new Date(),
  };
  await db
    .insert(outletPrinterSettingsTable)
    .values({ outlet_id: outletId, ...values })
    .onConflictDoUpdate({ target: outletPrinterSettingsTable.outlet_id, set: values });
}
