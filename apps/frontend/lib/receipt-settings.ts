/**
 * Customer receipt (struk) settings, as the backend's lib/printer-settings.ts
 * serves them — keep the two in step. The owner edits them in Pengaturan
 * Outlet → Struk; the receipt reads them through ReceiptData.printSettings.
 *
 * Customer receipt only: the kitchen ticket, shift report and invoices ignore
 * them.
 */

export const RECEIPT_SHOW_KEYS = [
    'logo',
    'outletName',
    'address',
    'phone',
    'cashier',
    'customer',
    'pager',
    'table',
    'serviceType',
    'member',
    'savings',
    'headerNote',
    'footerNote',
    'qr',
] as const;

export type ReceiptShowKey = (typeof RECEIPT_SHOW_KEYS)[number];

export type ReceiptPrintSettings = {
    headerNote: string | null;
    footerNote: string | null;
    qrUrl: string | null;
    qrCaption: string | null;
    show: Record<ReceiptShowKey, boolean>;
};

// Same limits the backend enforces; the settings form counts against them.
export const NOTE_MAX_LINES = 5;
export const NOTE_MAX_CHARS = 200;
// Bounded by the printer, not taste: see QR_MAX_DOTS in receipt-modal.tsx.
export const QR_URL_MAX_CHARS = 100;
export const QR_CAPTION_MAX_CHARS = 40;

const allShown = () =>
    Object.fromEntries(RECEIPT_SHOW_KEYS.map((k) => [k, true])) as Record<ReceiptShowKey, boolean>;

/** What an outlet that never saved the section prints: the receipt as it always was. */
export const defaultReceiptSettings = (): ReceiptPrintSettings => ({
    headerNote: null,
    footerNote: null,
    qrUrl: null,
    qrCaption: null,
    show: allShown(),
});

/**
 * Whatever the receipt was handed, made whole. A receipt saved in the
 * cashier's localStorage before this existed has none, and a switch the
 * server didn't send stays on — missing never hides a line.
 */
export function resolveReceiptSettings(
    s: Partial<ReceiptPrintSettings> | null | undefined,
): ReceiptPrintSettings {
    const base = defaultReceiptSettings();
    if (!s) return base;
    return {
        headerNote: s.headerNote ?? null,
        footerNote: s.footerNote ?? null,
        qrUrl: s.qrUrl ?? null,
        qrCaption: s.qrCaption ?? null,
        show: { ...base.show, ...(s.show ?? {}) },
    };
}
