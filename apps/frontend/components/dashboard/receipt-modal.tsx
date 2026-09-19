"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Printer, X, CheckCircle } from "lucide-react";
import { resolveOutletImage } from "@/lib/image-src";
import { posPaymentLabel } from "@/lib/pos-payment";
import { buildOrderLabelBatch, openOrderLabelApp, type OrderLabel } from "@/lib/labelbridge";

/** How long the closing receipt takes to fly into `flyToRef`. */
const FLIGHT_MS = 700;

type ReceiptAddon = {
    product_name: string;
    /** Per unit of the parent line, as the cashier picked it. */
    quantity: number;
    /** Per-unit rupiah. 0 is a real add-on, not a missing one. */
    price: number;
};

type ReceiptItem = {
    product_name: string;
    quantity: number;
    price: string;
    price_mark_down: string;
    /**
     * Kitchen instruction for this line ("jangan pedas"). Device-local: it rides
     * along to the printer and is never persisted with the order.
     */
    note?: string | null;
    /**
     * Add-ons chosen for this line. Printed indented UNDER the item, never
     * folded into its price — the customer should be able to read what each
     * part cost, and the kitchen needs to see them as separate instructions.
     */
    addons?: ReceiptAddon[] | null;
    /** Product variant if this item is a variant ("Large", "Extra Hot"). */
    variant_name?: string | null;
};

export type ReceiptData = {
    orderId: string;
    customerName: string;
    items: ReceiptItem[];
    subtotal: number;
    discountAmount: number;
    discountLabel: string;
    /**
     * Counter tax (PB1 / PPN). Omitted entirely when the outlet charges none —
     * a "Pajak Rp 0" line on a receipt invites the question of why it's there.
     *
     * `total` is what the customer pays, tax included. Under INCLUSIVE pricing
     * the tax is already inside the item prices, so the line is printed as a
     * disclosure ("termasuk") and adds nothing to the total; under exclusive it
     * was added on top. taxInclusive is what tells the reader which.
     */
    taxLabel?: string;
    taxAmount?: number;
    taxInclusive?: boolean;
    /**
     * Membership. Each piece is omitted when it didn't happen, because a
     * receipt that prints "Poin dipakai 0" invites the customer to ask why.
     *
     * The discounts are their own lines under the manual one rather than
     * folded into it: a customer should be able to see what the code was worth
     * and what their points were worth, and the printed numbers still sum to
     * TOTAL either way.
     */
    memberName?: string;
    memberTier?: string;
    promoCode?: string;
    promoDiscount?: number;
    pointsRedeemed?: number;
    pointsDiscount?: number;
    /** Credited by this sale, and the balance it left. */
    pointsEarned?: number;
    pointsBalance?: number;
    total: number;
    /**
     * Delivery orders only. The cashier (counter sale) omits it and no ongkir
     * line is printed.
     */
    deliveryFee?: number;
    /**
     * Omitted by the Order Lobby's pickup slip: a courier handout is proof of
     * what's being delivered, and the money hasn't been collected at that point.
     * When absent the whole cash/change block is skipped rather than printing a
     * misleading "Kembali Rp 0".
     */
    paymentMethod?: string;
    amountPaid?: number;
    changeDue?: number;
    date: Date;
    outletName: string;
    outletAddress: string;
    outletPhone: string;
    outletLogo: string;
    cashierName: string;
    /**
     * Number written on the buzzer/pager handed to the customer, so staff know
     * which one to ring when the food is up. Device-local like the notes below.
     */
    pagerNumber?: string;
    /** Whole-order kitchen instruction, printed at the foot of the kitchen ticket. */
    orderNote?: string;
};

type Props = {
    data: ReceiptData;
    onClose: () => void;
    /** Modal title. "Order Placed!" is wrong for a courier pickup slip. */
    heading?: string;
    /**
     * "kitchen" prints the prep ticket instead of the customer receipt: no logo,
     * no prices, no discounts, no totals — just who it's for, the pager number,
     * what to make, and the notes. Money on a kitchen ticket is noise the cooks
     * have to read past, and it invites the ticket being handed over as a bill.
     */
    variant?: "customer" | "kitchen";
    /**
     * Where the receipt goes when it's done with: on close, and after a print
     * that was actually handed off, the card shrinks into this element before
     * `onClose` fires. Without it the modal closes on the spot and printing
     * leaves it open, as it always has.
     */
    flyToRef?: RefObject<HTMLElement | null>;
};

/** The ghost's starting rect plus the transform that lands it on the target. */
type Flight = { top: number; left: number; width: number; height: number; transform: string };

const fmt = (n: number) =>
    new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(n);

const esc = (s: string) =>
    String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

// Which thermal paper the printer takes; picked in the modal, remembered per device.
type PaperWidth = "58" | "80";
const PAPER_KEY = "pos_paper_width";
// Font A characters per line: 32 on 58mm paper, 48 on 80mm.
const LINE_CHARS: Record<PaperWidth, number> = { "58": 32, "80": 48 };

// Full print-head width in dots at 203dpi. Only the 58mm entry is relied on:
// 384 is near-universal for that head, whereas the nominal 576 for 80mm is not
// (many are 512), which is why the 80mm logo isn't padded to it.
const PAPER_DOTS: Record<PaperWidth, number> = { "58": 384, "80": 576 };

// A logo pixel prints black below this luminance (0-255). Shared by the raster
// and inkBounds so the crop is taken around exactly what reaches the paper.
const INK_LUM = 160;

/**
 * Bounding box of the logo's actual ink, in source pixels.
 *
 * Uploaded logos are routinely a small mark sitting in a large transparent or
 * white square. That padding is not free: it rasterizes into the GS v 0 block
 * as blank rows that still cost a full bytesPerRow each on the wire, and the
 * wire is the constraint (see buildLogoEscposBytes). Cropping to the ink first
 * is what stops a padded square PNG from tripling the payload.
 *
 * "Ink" means exactly what the raster will print: composited over white, then
 * darker than INK_LUM. A looser test would count a pale shadow or glow that
 * never reaches paper, and centering that wider box shifts the printed mark
 * away from the shadow's side.
 *
 * Throws on a CORS-tainted canvas, like the caller's own getImageData.
 */
function inkBounds(img: HTMLImageElement) {
    const w = img.naturalWidth || img.width || 1;
    const h = img.naturalHeight || img.height || 1;
    const scratch = document.createElement("canvas");
    scratch.width = w;
    scratch.height = h;
    const sctx = scratch.getContext("2d");
    if (!sctx) return { sx: 0, sy: 0, sw: w, sh: h };
    // Same white ground as the raster, so faint alpha reads as the paper it prints as.
    sctx.fillStyle = "#fff";
    sctx.fillRect(0, 0, w, h);
    sctx.drawImage(img, 0, 0);
    const { data } = sctx.getImageData(0, 0, w, h);
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            if (lum >= INK_LUM) continue; // prints as paper
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    // Nothing dark enough to print: use it as given.
    if (maxX < 0) return { sx: 0, sy: 0, sw: w, sh: h };
    return { sx: minX, sy: minY, sw: maxX - minX + 1, sh: maxY - minY + 1 };
}

// Rasterize the outlet logo into an ESC/POS "GS v 0" raster block (1-bit).
//
// On 58mm the bitmap spans the full paper width with the logo centered in white
// padding: ESC a centering is firmware-dependent for raster images (cheap
// boards rotate the row buffer instead of padding it, smearing the logo), so
// the centering is baked into the pixels and the printer has nothing to shift.
// 384 dots is near-universal for a 58mm head, so that assumption holds.
//
// On 80mm it doesn't: plenty of "80mm" printers ship a 512-dot head rather than
// the nominal 576, and padding to the wrong width pushes the logo off-center by
// however far the guess missed (right-of-center on a 512-dot head, hard against
// the right edge if the paper setting is wrong altogether). So 80mm emits a
// raster only as wide as the logo and lets ESC a center it against the width
// the printer actually knows — a 192-dot block leaves real margin either side,
// so the row-buffer-rotation quirk above has nothing to smear.
//
// Throws when the logo can't be loaded or read (missing, CORS-tainted canvas);
// the caller treats that as "print without a logo".
async function buildLogoEscposBytes(src: string, paper: PaperWidth): Promise<number[]> {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new window.Image();
        el.crossOrigin = "anonymous";
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("logo load failed"));
        el.src = src;
    });

    // Crop to the logo's ink before scaling — see inkBounds.
    const { sx, sy, sw, sh } = inkBounds(img);

    const logoWidth = 192; // dots (~24mm at 203dpi) — header-sized on both papers
    // Hard ceiling on the raster's height. The printer's input buffer is a few
    // KB and the Bluetooth write is paced rather than flow-controlled, so an
    // oversized GS v 0 block overruns the buffer mid-transfer, drops the RFCOMM
    // link, and leaves the logo on the paper with the whole receipt missing
    // under it. A tall logo is scaled down to fit, never cropped.
    const MAX_LOGO_ROWS = 128;
    const naturalRows = (sh / sw) * logoWidth;
    // Keep the drawn width a multiple of 8: bytesPerRow below divides by 8.
    // Round DOWN: rounding up can push the height past MAX_LOGO_ROWS, and the
    // clamp below would then squash the logo instead of scaling it.
    const drawWidth =
        naturalRows <= MAX_LOGO_ROWS
            ? logoWidth
            : Math.max(8, Math.floor((logoWidth * MAX_LOGO_ROWS) / naturalRows / 8) * 8);
    const height = Math.max(8, Math.min(MAX_LOGO_ROWS, Math.round((sh / sw) * drawWidth)));

    // 58mm: pad to the full head width and bake the centering into the pixels.
    // 80mm: no padding, the printer centers the block itself (see above).
    const width = paper === "80" ? drawWidth : PAPER_DOTS[paper];
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas 2d context");
    // Composite over white so transparent pixels print as paper, not black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, sx, sy, sw, sh, (width - drawWidth) / 2, 0, drawWidth, height);
    const { data: px } = ctx.getImageData(0, 0, width, height);

    const bytesPerRow = width / 8;
    const out: number[] = [
        0x1d, 0x76, 0x30, 0x00, // GS v 0, normal scale
        bytesPerRow & 0xff, bytesPerRow >> 8,
        height & 0xff, height >> 8,
    ];
    for (let y = 0; y < height; y++) {
        for (let bx = 0; bx < bytesPerRow; bx++) {
            let byte = 0;
            for (let bit = 0; bit < 8; bit++) {
                const i = (y * width + bx * 8 + bit) * 4;
                const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
                if (lum < INK_LUM) byte |= 0x80 >> bit;
            }
            out.push(byte);
        }
    }
    return out;
}

// Build an ESC/POS receipt and return it base64-encoded for RawBT
// (link: `rawbt:base64,<data>`). RawBT forwards these raw bytes to the printer.
function buildReceiptEscposBase64(data: ReceiptData, paper: PaperWidth, logoBytes: number[] = []): string {
    const LINE = LINE_CHARS[paper];
    const ESC = 0x1b;
    const GS = 0x1d;
    const bytes: number[] = [];
    const push = (...b: number[]) => bytes.push(...b);

    // ESC/POS default codepage is ASCII-ish: normalize nbsp, strip diacritics,
    // and replace anything non-printable-ASCII so btoa() never throws.
    const ascii = (s: string) =>
        String(s ?? "")
            .replace(/ /g, " ")
            .normalize("NFKD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/[^\x20-\x7e]/g, "?");
    const text = (s: string) => {
        for (const ch of ascii(s)) push(ch.charCodeAt(0));
    };
    const line = (s = "") => {
        text(s);
        push(0x0a);
    };
    const align = (n: 0 | 1 | 2) => push(ESC, 0x61, n); // 0 left, 1 center, 2 right
    const bold = (on: boolean) => push(ESC, 0x45, on ? 1 : 0);
    const size = (n: number) => push(GS, 0x21, n); // 0x00 normal, 0x11 double, 0x01 tall
    const divider = () => line("-".repeat(LINE));
    // Label left, value right-justified on the same 32-char line.
    const row = (left: string, right: string) => {
        const l = ascii(left);
        const r = ascii(right);
        const gap = Math.max(1, LINE - l.length - r.length);
        line(l + " ".repeat(gap) + r);
    };

    push(ESC, 0x40); // initialize
    push(GS, 0x4c, 0x00, 0x00); // GS L 0 0 — zero left margin; some firmware defaults this nonzero, shifting the raster logo (and everything after it) right of where align() expects

    if (logoBytes.length) {
        // 58mm: left-aligned on purpose. The bitmap already spans the full
        // paper width with the logo centered in white padding, so ESC a
        // centering has nothing to do here — and firmware that "centers" a
        // raster by rotating the row buffer would shift it off-center instead.
        // 80mm: the bitmap is only as wide as the logo (the head width can't be
        // assumed there), so the printer has to do the centering.
        align(paper === "80" ? 1 : 0);
        // One byte at a time: push(...logoBytes) spreads the whole raster as
        // call arguments, which is a RangeError once the logo gets big.
        for (const b of logoBytes) bytes.push(b);
        push(0x0a);
    }
    align(1);
    bold(true);
    size(0x11);
    line(data.outletName);
    size(0x00);
    bold(false);
    if (data.outletAddress) line(data.outletAddress);
    if (data.outletPhone) line(data.outletPhone);
    divider();

    align(0);
    const shortId = data.orderId.split("-")[0].toUpperCase();
    row("Order #", shortId);
    row("Tanggal", data.date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }));
    row("Jam", data.date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }));
    row("Kasir", data.cashierName);
    if (data.customerName) row("Pelanggan", data.customerName);
    // Also on the customer's copy: if they mislay the buzzer, the number is
    // still in their hand.
    if (data.pagerNumber) row("Pager", data.pagerNumber);
    divider();

    for (const item of data.items) {
        const isDiscount = !!item.price_mark_down && item.price_mark_down !== "0";
        const original = parseFloat(item.price);
        const unit = parseFloat(isDiscount ? item.price_mark_down : item.price);
        bold(true);
        line(item.product_name);
        bold(false);
        if (item.variant_name) {
            line(`  ${item.variant_name}`);
        }
        if (isDiscount) {
            // Original price up top, discount subtracted below, so the item
            // nets to unit*qty and the printed numbers sum to Subtotal.
            row(`${item.quantity} x ${fmt(original)}`, fmt(original * item.quantity));
            row("  Diskon item", `-${fmt((original - unit) * item.quantity)}`);
        } else {
            row(`${item.quantity} x ${fmt(unit)}`, fmt(unit * item.quantity));
        }
        // Indented under the item, priced separately, so the printed numbers
        // still sum to Subtotal. A free add-on prints without a price rather
        // than as "Rp 0" — the customer only needs to see they got it.
        for (const a of item.addons ?? []) {
            const total = a.price * a.quantity * item.quantity;
            if (total > 0) row(`  + ${a.product_name}`, fmt(total));
            else line(`  + ${a.product_name}`);
        }
    }
    divider();

    row("Subtotal", fmt(data.subtotal));
    if (data.discountAmount > 0) row(data.discountLabel, `-${fmt(data.discountAmount)}`);
    // Membership discounts, each on its own line so the printed numbers still
    // sum to TOTAL and the customer can see what each one saved them.
    if (data.promoDiscount) row(`Promo ${data.promoCode ?? ""}`.trim(), `-${fmt(data.promoDiscount)}`);
    if (data.pointsDiscount) {
        row(`Poin (${(data.pointsRedeemed ?? 0).toLocaleString("id-ID")})`, `-${fmt(data.pointsDiscount)}`);
    }
    if (data.deliveryFee) row("Ongkos kirim", fmt(data.deliveryFee));
    if (data.taxAmount !== undefined && data.taxLabel) {
        // Inclusive tax is a disclosure, not a charge: it is already inside the
        // subtotal above, so it is marked rather than printed as another line
        // the customer would expect to see added into TOTAL.
        row(
            data.taxInclusive ? `${data.taxLabel} (termasuk)` : data.taxLabel,
            fmt(data.taxAmount),
        );
    }
    bold(true);
    size(0x01); // double height for the total
    row("TOTAL", fmt(data.total));
    size(0x00);
    bold(false);
    divider();

    if (data.paymentMethod) {
        // Only a cash sale has money tendered and change given. Everything else
        // names the method instead — a "Kembali Rp 0" under a QRIS payment
        // reads as a receipt for a transaction that didn't happen that way.
        if (data.paymentMethod === "cash") {
            row("Tunai", fmt(data.amountPaid ?? 0));
            row("Kembali", fmt(data.changeDue ?? 0));
        } else {
            row("Pembayaran", posPaymentLabel(data.paymentMethod));
        }
        divider();
    }

    // The member's own block, last, because it is about the next visit rather
    // than this bill. Printed whenever a member was attached, even if they
    // earned nothing — "you are recognised here" is the point of it.
    if (data.memberName) {
        align(0);
        row("Member", data.memberTier ? `${data.memberName} (${data.memberTier})` : data.memberName);
        if (data.pointsEarned) row("Poin didapat", `+${data.pointsEarned.toLocaleString("id-ID")}`);
        if (data.pointsBalance !== undefined) {
            row("Sisa poin", data.pointsBalance.toLocaleString("id-ID"));
        }
        divider();
    }

    align(1);
    line("Terima kasih!");
    line("Silakan datang kembali ^^");
    line("");
    line("Dibuat oleh ulunpesan.com");

    push(0x0a, 0x0a, 0x0a); // feed before cut
    push(GS, 0x56, 0x00); // full cut

    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b & 0xff);
    return btoa(bin);
}

// Greedy word wrap so a long note doesn't get chopped mid-word by the printer's
// own hard wrap. Words longer than the line are hard-split rather than dropped.
function wrapText(s: string, width: number): string[] {
    const out: string[] = [];
    for (const paragraph of String(s ?? "").split(/\r?\n/)) {
        let current = "";
        for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
            let w = word;
            while (w.length > width) {
                if (current) {
                    out.push(current);
                    current = "";
                }
                out.push(w.slice(0, width));
                w = w.slice(width);
            }
            if (!current) current = w;
            else if (current.length + 1 + w.length <= width) current += ` ${w}`;
            else {
                out.push(current);
                current = w;
            }
        }
        if (current) out.push(current);
    }
    return out;
}

// Kitchen prep ticket: the same ESC/POS transport as the receipt, but a
// deliberately money-free layout. Everything on it exists to answer "what do I
// cook and who gets it" — pager number, customer, items, notes. Quantities are
// printed double-height because that's the one field a misread ruins.
function buildKitchenEscposBase64(data: ReceiptData, paper: PaperWidth): string {
    const LINE = LINE_CHARS[paper];
    const ESC = 0x1b;
    const GS = 0x1d;
    const bytes: number[] = [];
    const push = (...b: number[]) => bytes.push(...b);

    const ascii = (s: string) =>
        String(s ?? "")
            .replace(/ /g, " ")
            .normalize("NFKD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/[^\x20-\x7e]/g, "?");
    const text = (s: string) => {
        for (const ch of ascii(s)) push(ch.charCodeAt(0));
    };
    const line = (s = "") => {
        text(s);
        push(0x0a);
    };
    const align = (n: 0 | 1 | 2) => push(ESC, 0x61, n);
    const bold = (on: boolean) => push(ESC, 0x45, on ? 1 : 0);
    const size = (n: number) => push(GS, 0x21, n);
    const divider = () => line("-".repeat(LINE));
    const row = (left: string, right: string) => {
        const l = ascii(left);
        const r = ascii(right);
        const gap = Math.max(1, LINE - l.length - r.length);
        line(l + " ".repeat(gap) + r);
    };

    push(ESC, 0x40); // initialize
    push(GS, 0x4c, 0x00, 0x00); // GS L 0 0 — zero left margin, see buildReceiptEscposBase64

    align(1);
    bold(true);
    size(0x11);
    line("PESANAN DAPUR");
    size(0x00);
    bold(false);

    if (data.pagerNumber) {
        // The single most-scanned field on the ticket: quadruple size, centered.
        bold(true);
        size(0x22);
        line(`PAGER ${data.pagerNumber}`);
        size(0x00);
        bold(false);
    }
    divider();

    align(0);
    row("Jam", data.date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }));
    row("Kasir", data.cashierName);
    if (data.customerName) row("Pelanggan", data.customerName);
    divider();

    for (const item of data.items) {
        bold(true);
        size(0x01); // double height — quantity is the field a misread ruins
        line(`${item.quantity}x ${item.product_name}`);
        size(0x00);
        bold(false);
        if (item.variant_name) {
            line(`  ${item.variant_name}`);
        }
        // Add-ons before the free-text note: they are the structured part of
        // "what to make", and no prices — money on a kitchen ticket is noise.
        for (const a of item.addons ?? []) {
            const each = a.quantity > 1 ? `${a.quantity}x ` : "";
            for (const l of wrapText(`+ ${each}${a.product_name}`, LINE - 4)) line(`   ${l}`);
        }
        if (item.note) {
            // Indented so a note can never be mistaken for another item.
            for (const l of wrapText(item.note, LINE - 4)) line(`   * ${l}`);
        }
    }

    if (data.orderNote) {
        divider();
        bold(true);
        line("CATATAN:");
        bold(false);
        for (const l of wrapText(data.orderNote, LINE)) line(l);
    }

    push(0x0a, 0x0a, 0x0a);
    push(GS, 0x56, 0x00); // full cut

    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b & 0xff);
    return btoa(bin);
}

/**
 * "Print Labels" (LabelBridge) is HIDDEN pending a test on a real label
 * printer — it was shipped untested, and a button that silently does nothing is
 * worse than no button. Everything behind it is left wired up (the handler, the
 * batch builder, the deep link), so flipping this to true is the whole
 * re-enable. Delete the flag once the flow is verified on a device.
 */
const SHOW_ORDER_LABELS: boolean = false;

export function ReceiptModal({ data, onClose, heading = "Order Placed!", variant = "customer", flyToRef }: Props) {
    const isKitchen = variant === "kitchen";
    const shortId = data.orderId.split("-")[0].toUpperCase();

    // ── Exit flight: the card leaves as a text-free ghost that shrinks into
    // `flyToRef`, so the cashier sees where the order went (and where to find
    // it again for a reprint). The real modal is gone the moment it starts.
    const cardRef = useRef<HTMLDivElement>(null);
    const ghostRef = useRef<HTMLDivElement>(null);
    const [flight, setFlight] = useState<Flight | null>(null);
    const flightTimerRef = useRef<number | undefined>(undefined);

    const flyAway = () => {
        if (flight) return;
        const card = cardRef.current;
        const target = flyToRef?.current;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!card || !target || reduced) {
            onClose();
            return;
        }
        const from = card.getBoundingClientRect();
        const to = target.getBoundingClientRect();
        // A target with no box (display:none, detached) has nowhere to land.
        if (!to.width || !from.width) {
            onClose();
            return;
        }
        const dx = to.left + to.width / 2 - (from.left + from.width / 2);
        const dy = to.top + to.height / 2 - (from.top + from.height / 2);
        setFlight({
            top: from.top,
            left: from.left,
            width: from.width,
            height: from.height,
            transform: `translate(${dx}px, ${dy}px) scale(${to.width / from.width}) rotate(-8deg)`,
        });
        flightTimerRef.current = window.setTimeout(onClose, FLIGHT_MS);
    };

    // Once the ghost has painted at the card's rect, point it at the target.
    // Two frames: the first only guarantees the start position is committed;
    // setting the transform in it would let the browser skip the transition.
    useEffect(() => {
        if (!flight) return;
        let second = 0;
        const first = requestAnimationFrame(() => {
            second = requestAnimationFrame(() => {
                const ghost = ghostRef.current;
                if (!ghost) return;
                ghost.style.transform = flight.transform;
                ghost.style.opacity = "0.15";
            });
        });
        return () => {
            cancelAnimationFrame(first);
            cancelAnimationFrame(second);
        };
    }, [flight]);

    useEffect(() => () => window.clearTimeout(flightTimerRef.current), []);

    const handlePrintOrderLabels = () => {
        const orderLabels: OrderLabel[] = data.items.map((item) => ({
            orderId: data.orderId,
            customerName: data.customerName,
            productName: item.product_name,
            variant: item.variant_name || null,
            addons: item.addons?.map(a => a.product_name) || null,
            date: data.date,
            outletName: data.outletName,
            logoUrl: data.outletLogo && data.outletLogo !== 'avatar.png' ? data.outletLogo : null,
        }));
        const batch = buildOrderLabelBatch(orderLabels);
        openOrderLabelApp(batch);
    };

    // Outlet logo, or null while it's still the placeholder avatar.
    const logoSrc =
        data.outletLogo && data.outletLogo !== "avatar.png" && data.outletLogo !== "/avatar.png"
            ? resolveOutletImage(data.outletLogo)
            : null;

    // Paper width for this device's printer, persisted so it's a one-time pick.
    const [paperWidth, setPaperWidth] = useState<PaperWidth>(() => {
        if (typeof window === "undefined") return "80";
        return window.localStorage.getItem(PAPER_KEY) === "58" ? "58" : "80";
    });
    const pickPaperWidth = (w: PaperWidth) => {
        setPaperWidth(w);
        try {
            window.localStorage.setItem(PAPER_KEY, w);
        } catch {}
    };

    // Desktop/iOS fallback: a self-contained, thermal-sized receipt built from
    // the data (NOT from the Tailwind-styled modal markup, which wouldn't carry
    // over to the print window). Monospace; auto-prints then closes. Returns
    // false when the popup was blocked and nothing printed.
    const printViaBrowser = (): boolean => {
        const mm = `${paperWidth}mm`;
        const itemsHtml = data.items
            .map((item) => {
                const isDiscount = !!item.price_mark_down && item.price_mark_down !== "0";
                const original = parseFloat(item.price);
                const unit = parseFloat(isDiscount ? item.price_mark_down : item.price);
                // Mirrors the ESC/POS layout: original price up top, discount
                // subtracted below, so the printed numbers sum to Subtotal.
                const priceRows = isDiscount
                    ? `<div class="row"><span>${item.quantity} x ${fmt(original)}</span><span>${fmt(original * item.quantity)}</span></div>` +
                      `<div class="row"><span>&nbsp;&nbsp;Diskon item</span><span>-${fmt((original - unit) * item.quantity)}</span></div>`
                    : `<div class="row"><span>${item.quantity} x ${fmt(unit)}</span><span>${fmt(unit * item.quantity)}</span></div>`;
                // Indented under the item and priced separately, mirroring the
                // ESC/POS layout so both slips read the same.
                const addonRows = (item.addons ?? [])
                    .map((a) => {
                        const total = a.price * a.quantity * item.quantity;
                        return total > 0
                            ? `<div class="row addon"><span>+ ${esc(a.product_name)}</span><span>${fmt(total)}</span></div>`
                            : `<div class="row addon"><span>+ ${esc(a.product_name)}</span><span></span></div>`;
                    })
                    .join("");
                const variantRow = item.variant_name ? `<div class="variant">${esc(item.variant_name)}</div>` : "";
                return `<div class="item"><div class="name">${esc(item.product_name)}</div>${variantRow}${priceRows}${addonRows}</div>`;
            })
            .join("");

        // No payment method (Order Lobby pickup slip) -> skip the block entirely,
        // including its divider, rather than printing a misleading zero.
        const paymentHtml = !data.paymentMethod
            ? ""
            : (data.paymentMethod === "cash"
                  ? `<div class="row"><span>Tunai</span><span>${fmt(data.amountPaid ?? 0)}</span></div>` +
                    `<div class="row b"><span>Kembali</span><span>${fmt(data.changeDue ?? 0)}</span></div>`
                  : `<div class="row b"><span>Pembayaran</span><span>${esc(posPaymentLabel(data.paymentMethod))}</span></div>`) +
              `<div class="dv"></div>`;

        // Mirrors the ESC/POS member block: about the next visit, not this
        // bill, so it sits after the payment and before the thank-you.
        const memberHtml = !data.memberName
            ? ""
            : `<div class="row sm"><span>Member</span><span class="b">${esc(
                  data.memberTier ? `${data.memberName} (${data.memberTier})` : data.memberName,
              )}</span></div>` +
              (data.pointsEarned
                  ? `<div class="row sm"><span>Poin didapat</span><span>+${data.pointsEarned.toLocaleString("id-ID")}</span></div>`
                  : "") +
              (data.pointsBalance !== undefined
                  ? `<div class="row sm"><span>Sisa poin</span><span>${data.pointsBalance.toLocaleString("id-ID")}</span></div>`
                  : "") +
              `<div class="dv"></div>`;

        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Struk #${shortId}</title>
<style>
  @page { size: ${mm} auto; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${mm}; }
  body { font-family: 'Courier New', monospace; font-size: 11px; line-height: 1.35; color: #000; padding: 3mm 2mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .c { text-align: center; }
  .b { font-weight: bold; }
  .lg { font-size: 14px; }
  .sm { font-size: 10px; }
  .dv { border-top: 1px dashed #000; margin: 5px 0; }
  .row { display: flex; justify-content: space-between; gap: 6px; }
  .row span:last-child { text-align: right; white-space: nowrap; }
  .item { margin: 3px 0; }
  .item .name { font-weight: bold; word-break: break-word; }
  .item .variant { padding-left: 3mm; font-size: 10px; }
  .item .addon { padding-left: 3mm; }
  /* Centered via a full-width text-align wrapper: auto margins on the img
     alone drift on some print engines, which size the replaced element
     before the @page width applies. */
  .logo-wrap { width: 100%; text-align: center; margin-bottom: 2mm; }
  .logo { display: inline-block; width: 20mm; height: 20mm; object-fit: contain; }
</style></head><body>
  ${logoSrc ? `<div class="logo-wrap"><img class="logo" src="${logoSrc}" alt=""></div>` : ""}
  <div class="c b lg">${esc(data.outletName)}</div>
  ${data.outletAddress ? `<div class="c sm">${esc(data.outletAddress)}</div>` : ""}
  ${data.outletPhone ? `<div class="c sm">${esc(data.outletPhone)}</div>` : ""}
  <div class="dv"></div>
  <div class="row sm"><span>Order #</span><span class="b">${shortId}</span></div>
  <div class="row sm"><span>Tanggal</span><span>${data.date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</span></div>
  <div class="row sm"><span>Jam</span><span>${data.date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span></div>
  <div class="row sm"><span>Kasir</span><span>${esc(data.cashierName)}</span></div>
  ${data.customerName ? `<div class="row sm"><span>Pelanggan</span><span>${esc(data.customerName)}</span></div>` : ""}
  ${data.pagerNumber ? `<div class="row sm"><span>Pager</span><span class="b">${esc(data.pagerNumber)}</span></div>` : ""}
  <div class="dv"></div>
  ${itemsHtml}
  <div class="dv"></div>
  <div class="row sm"><span>Subtotal</span><span>${fmt(data.subtotal)}</span></div>
  ${data.discountAmount > 0 ? `<div class="row sm"><span>${esc(data.discountLabel)}</span><span>-${fmt(data.discountAmount)}</span></div>` : ""}
  ${data.promoDiscount ? `<div class="row sm"><span>Promo ${esc(data.promoCode ?? "")}</span><span>-${fmt(data.promoDiscount)}</span></div>` : ""}
  ${data.pointsDiscount ? `<div class="row sm"><span>Poin (${(data.pointsRedeemed ?? 0).toLocaleString("id-ID")})</span><span>-${fmt(data.pointsDiscount)}</span></div>` : ""}
  ${data.deliveryFee ? `<div class="row sm"><span>Ongkos kirim</span><span>${fmt(data.deliveryFee)}</span></div>` : ""}
  ${data.taxAmount !== undefined && data.taxLabel ? `<div class="row sm"><span>${esc(data.taxLabel)}${data.taxInclusive ? " (termasuk)" : ""}</span><span>${fmt(data.taxAmount)}</span></div>` : ""}
  <div class="row b lg"><span>TOTAL</span><span>${fmt(data.total)}</span></div>
  <div class="dv"></div>
  ${paymentHtml}
  ${memberHtml}
  <div class="c sm">Terima kasih!</div>
  <div class="c sm">Silakan datang kembali ^^</div>
  <div class="dv"></div>
  <div class="c sm">Dibuat oleh ulunpesan.com</div>
  <script>window.onload=function(){window.focus();window.print();window.onafterprint=function(){window.close();};setTimeout(function(){try{window.close();}catch(e){}},2000);};</script>
</body></html>`;

        const w = window.open("", "_blank", "width=360,height=640");
        if (!w) {
            alert("Popup diblokir. Izinkan popup untuk situs ini agar struk bisa dicetak.");
            return false;
        }
        w.document.write(html);
        w.document.close();
        return true;
    };

    // Desktop/iOS fallback for the kitchen ticket. Mirrors the ESC/POS layout
    // above: no logo, no prices, no totals.
    const printKitchenViaBrowser = (): boolean => {
        const mm = `${paperWidth}mm`;
        const itemsHtml = data.items
            .map(
                (item) =>
                    `<div class="item"><div class="name">${item.quantity}x ${esc(item.product_name)}</div>` +
                    (item.variant_name ? `<div class="variant">${esc(item.variant_name)}</div>` : "") +
                    (item.addons ?? [])
                        .map(
                            (a) =>
                                `<div class="addon">+ ${a.quantity > 1 ? `${a.quantity}x ` : ""}${esc(a.product_name)}</div>`,
                        )
                        .join("") +
                    (item.note ? `<div class="note">* ${esc(item.note)}</div>` : "") +
                    `</div>`,
            )
            .join("");

        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Dapur${data.pagerNumber ? ` #${esc(data.pagerNumber)}` : ""}</title>
<style>
  @page { size: ${mm} auto; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${mm}; }
  body { font-family: 'Courier New', monospace; font-size: 12px; line-height: 1.35; color: #000; padding: 3mm 2mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .c { text-align: center; }
  .b { font-weight: bold; }
  .lg { font-size: 15px; }
  .xl { font-size: 26px; letter-spacing: 1px; }
  .sm { font-size: 11px; }
  .dv { border-top: 1px dashed #000; margin: 5px 0; }
  .row { display: flex; justify-content: space-between; gap: 6px; }
  .row span:last-child { text-align: right; white-space: nowrap; }
  .item { margin: 4px 0; }
  .item .name { font-weight: bold; font-size: 15px; word-break: break-word; }
  .item .variant { padding-left: 4mm; font-size: 12px; word-break: break-word; }
  .item .note { padding-left: 4mm; word-break: break-word; }
  .item .addon { padding-left: 4mm; word-break: break-word; }
</style></head><body>
  <div class="c b lg">PESANAN DAPUR</div>
  ${data.pagerNumber ? `<div class="c b xl">PAGER ${esc(data.pagerNumber)}</div>` : ""}
  <div class="dv"></div>
  <div class="row sm"><span>Jam</span><span>${data.date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span></div>
  <div class="row sm"><span>Kasir</span><span>${esc(data.cashierName)}</span></div>
  ${data.customerName ? `<div class="row sm"><span>Pelanggan</span><span>${esc(data.customerName)}</span></div>` : ""}
  <div class="dv"></div>
  ${itemsHtml}
  ${data.orderNote ? `<div class="dv"></div><div class="b">CATATAN:</div><div>${esc(data.orderNote)}</div>` : ""}
  <script>window.onload=function(){window.focus();window.print();window.onafterprint=function(){window.close();};setTimeout(function(){try{window.close();}catch(e){}},2000);};</script>
</body></html>`;

        const w = window.open("", "_blank", "width=360,height=640");
        if (!w) {
            alert("Popup diblokir. Izinkan popup untuk situs ini agar struk bisa dicetak.");
            return false;
        }
        w.document.write(html);
        w.document.close();
        return true;
    };

    // Prefer ThermalBridge, fall back to RawBT. Navigating to a custom scheme
    // nobody handles is a silent no-op in Android Chrome, so "installed" is
    // detected by the page losing focus before the timer fires: ThermalBridge's
    // print popup only blurs the page (it stays visible underneath), while a
    // full app switch also hides it — watch for either.
    const openPrintApp = (thermalBridgeUrl: string, rawbtUrl: string) => {
        const cancel = () => {
            window.clearTimeout(timer);
            window.removeEventListener("blur", cancel);
            document.removeEventListener("visibilitychange", onVisibility);
        };
        const onVisibility = () => {
            if (document.hidden) cancel();
        };
        const timer = window.setTimeout(() => {
            window.removeEventListener("blur", cancel);
            document.removeEventListener("visibilitychange", onVisibility);
            window.location.href = rawbtUrl;
        }, 1500);
        window.addEventListener("blur", cancel);
        document.addEventListener("visibilitychange", onVisibility);
        window.location.href = thermalBridgeUrl;
    };

    // Android: hand the raw ESC/POS bytes to ThermalBridge
    // (thermalbridge://print?data=<base64url>, back=1 returns to the browser
    // after printing) or RawBT (rawbt:base64,<base64>) — either relays them to
    // the paired Bluetooth/USB thermal printer. Other platforms have no such
    // handler, so use the browser print dialog. Resolves to whether the job was
    // handed off — a blocked popup is the one way it isn't.
    const handlePrint = async (): Promise<boolean> => {
        if (/android/i.test(navigator.userAgent)) {
            // Kitchen ticket carries no logo, so it skips the raster step entirely.
            if (isKitchen) {
                const b64 = buildKitchenEscposBase64(data, paperWidth);
                const b64url = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
                openPrintApp(`thermalbridge://print?back=1&data=${b64url}`, `rawbt:base64,${b64}`);
                return true;
            }
            let logoBytes: number[] = [];
            if (logoSrc) {
                try {
                    logoBytes = await buildLogoEscposBytes(logoSrc, paperWidth);
                } catch {
                    // Logo unavailable (load/CORS failure) — print without it.
                }
            }
            const b64 = buildReceiptEscposBase64(data, paperWidth, logoBytes);
            // base64url: query-string safe ("+" would decode to a space).
            const b64url = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
            openPrintApp(`thermalbridge://print?back=1&data=${b64url}`, `rawbt:base64,${b64}`);
            return true;
        }
        return isKitchen ? printKitchenViaBrowser() : printViaBrowser();
    };

    // With a destination, a printed receipt is done with and files itself away
    // (it can be reprinted from there). Without one, the modal stays up as it
    // always has, ready for a second copy.
    const printAndFile = async () => {
        const handedOff = await handlePrint();
        if (handedOff && flyToRef) flyAway();
    };

    if (flight) {
        // Stand-in for the card on its way out: the same white sheet, no text.
        // Starts exactly over the card, so the swap is invisible.
        return (
            <div
                ref={ghostRef}
                aria-hidden
                className="fixed z-50 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl pointer-events-none"
                style={{
                    top: flight.top,
                    left: flight.left,
                    width: flight.width,
                    height: flight.height,
                    transition: `transform ${FLIGHT_MS}ms cubic-bezier(.6,.02,.3,1), opacity ${FLIGHT_MS}ms cubic-bezier(.7,0,.9,.6)`,
                }}
            >
                <div className="h-14 bg-green-600" />
                <div className="space-y-3 p-5">
                    <div className="h-3 w-2/3 rounded-full bg-gray-200" />
                    <div className="h-3 w-full rounded-full bg-gray-200" />
                    <div className="h-3 w-5/6 rounded-full bg-gray-200" />
                    <div className="h-3 w-full rounded-full bg-gray-200" />
                    <div className="h-3 w-1/2 rounded-full bg-gray-200" />
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div ref={cardRef} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col max-h-[90vh]">
                {/* Modal header */}
                <div className="flex items-center justify-between px-5 py-4 border-b">
                    <div className="flex items-center gap-2 text-green-600">
                        <CheckCircle className="h-5 w-5" />
                        <span className="font-bold text-base">{heading}</span>
                    </div>
                    <button onClick={flyAway} className="text-gray-400 hover:text-gray-600 p-1">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Receipt body — scrollable */}
                <div className="overflow-y-auto flex-1 px-5 py-4">
                    {isKitchen ? (
                        <div className="font-mono text-[13px] text-gray-800">
                            <p className="text-center font-bold text-base tracking-wide">PESANAN DAPUR</p>
                            {data.pagerNumber && (
                                <p className="text-center font-black text-3xl tracking-wider mt-1">
                                    PAGER {data.pagerNumber}
                                </p>
                            )}

                            <div className="border-t border-dashed border-gray-300 my-3" />

                            <div className="flex justify-between text-xs mb-1">
                                <span className="text-gray-500">Time</span>
                                <span>{data.date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span>
                            </div>
                            <div className="flex justify-between text-xs mb-1">
                                <span className="text-gray-500">Cashier</span>
                                <span>{data.cashierName}</span>
                            </div>
                            {data.customerName && (
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-gray-500">Customer</span>
                                    <span className="font-semibold">{data.customerName}</span>
                                </div>
                            )}

                            <div className="border-t border-dashed border-gray-300 my-3" />

                            <div className="space-y-2">
                                {data.items.map((item, i) => (
                                    <div key={i}>
                                        <p className="font-bold text-[15px] leading-tight">
                                            {item.quantity}x {item.product_name}
                                        </p>
                                        {(item.addons ?? []).map((a, j) => (
                                            <p key={j} className="pl-4 text-xs text-gray-700">
                                                + {a.quantity > 1 ? `${a.quantity}x ` : ""}
                                                {a.product_name}
                                            </p>
                                        ))}
                                        {item.note && (
                                            <p className="pl-4 text-xs text-gray-600">* {item.note}</p>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {data.orderNote && (
                                <>
                                    <div className="border-t border-dashed border-gray-300 my-3" />
                                    <p className="font-bold text-xs">CATATAN:</p>
                                    <p className="text-xs whitespace-pre-wrap wrap-break-word">{data.orderNote}</p>
                                </>
                            )}
                        </div>
                    ) : (
                    <div id="receipt-printable" className="font-mono text-[13px] text-gray-800">
                        {/* Outlet header */}
                        <div className="text-center mb-3">
                            {logoSrc && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={logoSrc}
                                    alt=""
                                    className="mx-auto mb-2 h-16 w-16 rounded-full object-cover border"
                                />
                            )}
                            <p className="font-bold text-base uppercase tracking-wide">{data.outletName}</p>
                            <p className="text-xs text-gray-500">{data.outletAddress}</p>
                            <p className="text-xs text-gray-500">{data.outletPhone}</p>
                        </div>

                        <div className="border-t border-dashed border-gray-300 my-3" />

                        {/* Order meta */}
                        <div className="flex justify-between text-xs mb-1">
                            <span className="text-gray-500">Order #</span>
                            <span className="font-bold">{shortId}</span>
                        </div>
                        <div className="flex justify-between text-xs mb-1">
                            <span className="text-gray-500">Date</span>
                            <span>{data.date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</span>
                        </div>
                        <div className="flex justify-between text-xs mb-1">
                            <span className="text-gray-500">Time</span>
                            <span>{data.date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <div className="flex justify-between text-xs mb-1">
                            <span className="text-gray-500">Cashier</span>
                            <span>{data.cashierName}</span>
                        </div>
                        {data.customerName && (
                            <div className="flex justify-between text-xs mb-1">
                                <span className="text-gray-500">Customer</span>
                                <span className="font-semibold">{data.customerName}</span>
                            </div>
                        )}
                        {data.pagerNumber && (
                            <div className="flex justify-between text-xs mb-1">
                                <span className="text-gray-500">Pager</span>
                                <span className="font-bold">{data.pagerNumber}</span>
                            </div>
                        )}

                        <div className="border-t border-dashed border-gray-300 my-3" />

                        {/* Items */}
                        <div className="space-y-2">
                            {data.items.map((item, i) => {
                                const isDiscount = item.price_mark_down && item.price_mark_down !== "0";
                                const originalPrice = parseFloat(item.price);
                                const unitPrice = parseFloat(isDiscount ? item.price_mark_down : item.price);
                                const subtotal = unitPrice * item.quantity;
                                const itemDiscount = isDiscount ? (originalPrice - unitPrice) * item.quantity : 0;
                                return (
                                    <div key={i}>
                                        <p className="font-semibold text-[13px] leading-tight">{item.product_name}</p>
                                        {item.variant_name && (
                                            <p className="text-xs text-gray-500 italic">{item.variant_name}</p>
                                        )}
                                        <div className="flex justify-between text-xs text-gray-500">
                                            <span>
                                                {item.quantity} × {fmt(unitPrice)}
                                                {isDiscount && (
                                                    <span className="ml-1 line-through text-gray-400">{fmt(originalPrice)}</span>
                                                )}
                                            </span>
                                            <span className="font-semibold text-gray-800">{fmt(subtotal)}</span>
                                        </div>
                                        {isDiscount && (
                                            <div className="flex justify-between text-[11px] text-rose-500">
                                                <span>Item discount</span>
                                                <span>-{fmt(itemDiscount)}</span>
                                            </div>
                                        )}
                                        {(item.addons ?? []).map((a, j) => {
                                            const addonTotal = a.price * a.quantity * item.quantity;
                                            return (
                                                <div
                                                    key={j}
                                                    className="flex justify-between pl-3 text-[11px] text-gray-500"
                                                >
                                                    <span>+ {a.product_name}</span>
                                                    {addonTotal > 0 && <span>{fmt(addonTotal)}</span>}
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </div>

                        <div className="border-t border-dashed border-gray-300 my-3" />

                        {/* Totals */}
                        <div className="flex justify-between text-xs mb-1">
                            <span className="text-gray-500">Subtotal</span>
                            <span>{fmt(data.subtotal)}</span>
                        </div>
                        <div className="flex justify-between text-xs mb-2">
                            <span className="text-gray-500">{data.discountLabel}</span>
                            <span className={data.discountAmount > 0 ? 'text-rose-500' : ''}>
                                {data.discountAmount > 0 ? '-' : ''}{fmt(data.discountAmount)}
                            </span>
                        </div>
                        {data.promoDiscount ? (
                            <div className="flex justify-between text-xs mb-2">
                                <span className="text-gray-500">Promo {data.promoCode}</span>
                                <span className="text-rose-500">-{fmt(data.promoDiscount)}</span>
                            </div>
                        ) : null}
                        {data.pointsDiscount ? (
                            <div className="flex justify-between text-xs mb-2">
                                <span className="text-gray-500">
                                    Poin ({(data.pointsRedeemed ?? 0).toLocaleString('id-ID')})
                                </span>
                                <span className="text-rose-500">-{fmt(data.pointsDiscount)}</span>
                            </div>
                        ) : null}
                        {data.deliveryFee ? (
                            <div className="flex justify-between text-xs mb-2">
                                <span className="text-gray-500">Ongkos kirim</span>
                                <span>{fmt(data.deliveryFee)}</span>
                            </div>
                        ) : null}
                        {data.taxAmount !== undefined && data.taxLabel && (
                            <div className="flex justify-between text-xs mb-2">
                                <span className="text-gray-500">
                                    {data.taxLabel}
                                    {data.taxInclusive ? ' (termasuk)' : ''}
                                </span>
                                <span>{fmt(data.taxAmount)}</span>
                            </div>
                        )}
                        <div className="flex justify-between font-bold text-sm">
                            <span>TOTAL</span>
                            <span className="text-blue-600">{fmt(data.total)}</span>
                        </div>

                        <div className="border-t border-dashed border-gray-300 my-3" />

                        {/* Payment — omitted for a courier pickup slip (see ReceiptData). */}
                        {data.paymentMethod && (
                            <>
                                {data.paymentMethod !== 'cash' ? (
                                    <div className="flex justify-between font-bold text-sm">
                                        <span>Payment</span>
                                        <span className="text-blue-600">
                                            {posPaymentLabel(data.paymentMethod)}
                                        </span>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-gray-500">Cash</span>
                                            <span>{fmt(data.amountPaid ?? 0)}</span>
                                        </div>
                                        <div className="flex justify-between font-bold text-sm">
                                            <span>Change</span>
                                            <span className="text-emerald-600">{fmt(data.changeDue ?? 0)}</span>
                                        </div>
                                    </>
                                )}
                                <div className="border-t border-dashed border-gray-300 my-3" />
                            </>
                        )}

                        {/* Member block: about the next visit, so it sits after
                            the payment, exactly as both printed slips have it. */}
                        {data.memberName && (
                            <>
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-gray-500">Member</span>
                                    <span className="font-semibold">
                                        {data.memberName}
                                        {data.memberTier ? ` (${data.memberTier})` : ''}
                                    </span>
                                </div>
                                {data.pointsEarned ? (
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className="text-gray-500">Poin didapat</span>
                                        <span className="font-semibold text-amber-600">
                                            +{data.pointsEarned.toLocaleString('id-ID')}
                                        </span>
                                    </div>
                                ) : null}
                                {data.pointsBalance !== undefined && (
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className="text-gray-500">Sisa poin</span>
                                        <span className="font-semibold">
                                            {data.pointsBalance.toLocaleString('id-ID')}
                                        </span>
                                    </div>
                                )}
                                <div className="border-t border-dashed border-gray-300 my-3" />
                            </>
                        )}

                        {/* Footer */}
                        <p className="text-center text-xs text-gray-400">Thank you for your purchase!</p>
                        <p className="text-center text-xs text-gray-400">Please come again 🙏</p>
                    </div>
                    )}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between px-5 pt-3 border-t">
                    <span className="text-xs text-gray-500">Lebar kertas printer</span>
                    <div className="flex rounded-lg border overflow-hidden">
                        {(["58", "80"] as const).map((w) => (
                            <button
                                key={w}
                                onClick={() => pickPaperWidth(w)}
                                className={`px-3 py-1 text-xs font-semibold transition-colors ${
                                    paperWidth === w
                                        ? "bg-blue-600 text-white"
                                        : "bg-white text-gray-500 hover:bg-gray-50"
                                }`}
                            >
                                {w}mm
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex gap-3 px-5 py-4">
                    <button
                        onClick={flyAway}
                        className="flex-1 h-11 rounded-xl border-2 font-semibold text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                        Close
                    </button>
                    {SHOW_ORDER_LABELS && !isKitchen && (
                        <button
                            onClick={handlePrintOrderLabels}
                            className="flex-1 h-11 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
                        >
                            <Printer className="h-4 w-4" />
                            Print Labels
                        </button>
                    )}
                    <button
                        onClick={printAndFile}
                        className="flex-1 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
                    >
                        <Printer className="h-4 w-4" />
                        Print
                    </button>
                </div>
            </div>
        </div>
    );
}
