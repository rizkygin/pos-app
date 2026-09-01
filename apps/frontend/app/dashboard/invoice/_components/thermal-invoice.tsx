"use client";

import { useEffect, useState } from "react";
import { Receipt, Ruler, Usb, Loader2 } from "lucide-react";
import { resolveOutletImage } from "@/lib/image-src";
import {
  forgetUsbPrinter,
  getPairedPrinter,
  isWebUsbSupported,
  pairUsbPrinter,
  printBytesOverUsb,
} from "@/lib/webusb-printer";

/* Thermal (58/80mm) rendering of a sales invoice.

   Deliberately separate from the cashier's ReceiptModal: that one prints an
   order (pager, kitchen notes, cash/change), this one prints an *invoice*
   (number, due date, per-line discounts, DP and remaining balance). The two
   share nothing but the ESC/POS transport, and the layouts drift apart the
   moment either is edited.

   Terms & conditions are omitted on purpose — on 32/48-char paper they run to
   a hand-length of receipt for text nobody reads off a till roll. They stay on
   the A4 themes. */

type Item = {
  id: number;
  description: string;
  quantity: string;
  unit_price: string;
  discount_pct: string;
  line_total: string;
};

export type ThermalInvoice = {
  number: string;
  status: string;
  party_name: string | null;
  issue_date: string;
  due_date: string | null;
  subtotal: string;
  tax_rate: string;
  tax_amount: string;
  discount: string;
  total: string;
  amount_paid: string;
  down_payment: string;
  created_by_name?: string | null;
  notes: string | null;
  items: Item[];
  outlet: { name: string; address: string; phone: string; email: string; avatar: string };
};

const fmt = (v: number | string) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(
    Number(v) || 0,
  );
const tgl = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const escapeHtml = (s: string) =>
  String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

type PaperWidth = "58" | "80";
// Same device-level preference the cashier receipt uses: one printer per device.
const PAPER_KEY = "pos_paper_width";
// Font A characters per line at 12 dots each. 58mm heads are 384 dots
// everywhere, so 32 is exact. 80mm is a guess by construction — heads are 512
// or 576 depending on the model and nothing in ESC/POS reports which — so this
// is a MEASURED default, not a derived one: 48 clipped, and so did the 42 that
// 512/12 predicts. A real printer chopped every row at column 40 (counted back
// from three right-aligned values on one receipt), which means ~24 dots go
// somewhere unaccounted for. `GS L 0 0` did not recover them, so it is not a
// stored left margin; whatever it is, 40 is what actually reaches paper.
//
// Guessing low costs a blank strip on the right of a wider printer. Guessing
// high costs the totals column. The stepper below is the real answer for any
// printer this default is wrong for.
//
// Raw USB is where this shows: RawBT/ThermalBridge re-render the text to their
// own printer profile and hide the mismatch, the bulk endpoint does not.
const LINE_CHARS: Record<PaperWidth, number> = { "58": 32, "80": 40 };
// ...and where the default is wrong, the operator overrides it per paper width
// rather than waiting on a deploy: the ruler print says what this printer is,
// this remembers it. Bounds are the plausible range for 203dpi Font A.
const CHARS_KEY = (p: PaperWidth) => `pos_line_chars_${p}`;
const MIN_CHARS = 24;
const MAX_CHARS = 56;
// Full print-head width in dots at 203dpi (only the 58mm figure is relied on —
// see LINE_CHARS for why the 80mm figure can't be trusted).
const PAPER_DOTS: Record<PaperWidth, number> = { "58": 384, "80": 576 };
// Printable width, which is NOT the roll width: a 58mm roll prints 48mm (384
// dots at 8/mm) and an 80mm roll prints 72mm (576). Laying the page out at the
// roll's own width overflows the head by 6-8mm and the driver clips it off the
// right edge — or silently shrinks the whole receipt to fit.
const PRINT_MM: Record<PaperWidth, number> = { "58": 48, "80": 72 };
// ...and like the column count, this is a per-device setting in practice. The
// driver's own hardware left margin shifts the page right by a few millimetres,
// so the width that actually reaches paper is narrower than the head's spec —
// and no browser API reports it. The ruler print measures it; this remembers it.
const MM_KEY = (p: PaperWidth) => `pos_print_mm_${p}`;
const MIN_MM = 30;
const MAX_MM = 80;

/* What the invoice's money block reduces to on paper: the DP is credited even
   on a draft (it's agreed but not yet booked, so amount_paid is still 0). */
function creditedAmounts(inv: ThermalInvoice) {
  const paid = Number(inv.amount_paid) || 0;
  const dp = Number(inv.down_payment) || 0;
  const credited = Math.max(paid, inv.status === "draft" ? dp : 0);
  return { dp, credited, beyondDp: Math.max(0, credited - dp), remaining: Math.max(0, Number(inv.total) - credited) };
}

const statusLabel = (status: string) =>
  status === "paid" ? "LUNAS" : status === "partial" ? "DP DITERIMA" : "";

const logoSrcOf = (inv: ThermalInvoice) => {
  const a = inv.outlet.avatar;
  return a && a !== "avatar.png" && a !== "/avatar.png" ? resolveOutletImage(a) : null;
};

// Rasterize the outlet logo into an ESC/POS "GS v 0" block (1-bit).
//
// 58mm: the bitmap spans the full head width with the logo centered in white
// padding, because ESC a centering of rasters is firmware-dependent (some
// boards rotate the row buffer and smear the image). 384 dots is near-universal
// for that head so the assumption holds. 80mm heads are 512 or 576 depending on
// the model, so there the raster is only as wide as the logo and ESC a does the
// centering against whatever width the printer actually knows.
//
// Throws if the logo can't be loaded/read; the caller prints without it.
async function buildLogoEscposBytes(src: string, paper: PaperWidth): Promise<number[]> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new window.Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("logo load failed"));
    el.src = src;
  });

  const logoWidth = 192; // dots (~24mm at 203dpi)
  const width = paper === "80" ? logoWidth : PAPER_DOTS[paper];
  const height = Math.max(8, Math.round(((img.height || logoWidth) / (img.width || logoWidth)) * logoWidth));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas 2d context");
  // Composite over white so transparent pixels print as paper, not black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, (width - logoWidth) / 2, 0, logoWidth, height);
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
        if (lum < 160) byte |= 0x80 >> bit;
      }
      out.push(byte);
    }
  }
  return out;
}

// Greedy word wrap; words longer than the line are hard-split rather than
// left to the printer's own mid-word chop.
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

/* A character ruler printed 60 columns wide — wider than any head — so the
   operator can read off where the paper actually stops.

   ESC/POS has no query for printable width and 80mm heads ship as 512 or 576
   dots depending on the model, so LINE_CHARS is otherwise a guess: 48 clips a
   512-dot head, 42 clips anything narrower still, and both look the same from
   here. This prints the answer instead. */
function buildRulerEscposBytes(paper: PaperWidth, lineChars: number): number[] {
  const MAX = 60;
  const bytes: number[] = [];
  const push = (...b: number[]) => bytes.push(...b);
  const line = (s = "") => {
    for (const ch of s) push(ch.charCodeAt(0));
    push(0x0a);
  };
  const cols = Array.from({ length: MAX }, (_, i) => i + 1);

  push(0x1b, 0x40); // initialize
  push(0x1d, 0x4c, 0x00, 0x00); // left margin 0 — measure the head, not a margin
  push(0x1b, 0x61, 0x00); // align left
  push(0x1b, 0x45, 1);
  line("TES LEBAR KERTAS");
  push(0x1b, 0x45, 0);
  line(`Setelan sekarang: ${paper}mm, ${lineChars} kolom`);
  line();
  line(cols.map((c) => String(c % 10)).join(""));
  line(cols.map((c) => (c % 10 === 0 ? String((c / 10) % 10) : " ")).join(""));
  line();
  line("Baris atas = satuan, bawah = puluhan.");
  line("Kolom terakhir yang tercetak = lebar");
  line("printer ini.");
  push(0x0a, 0x0a, 0x0a);
  push(0x1d, 0x56, 0x00); // full cut
  return bytes;
}

// Build the ESC/POS invoice. The same byte stream feeds all three transports:
// ThermalBridge/RawBT on Android (base64 in a URL) and WebUSB on desktop.
function buildInvoiceEscposBytes(
  inv: ThermalInvoice,
  paper: PaperWidth,
  logoBytes: number[] = [],
  lineChars = LINE_CHARS[paper],
): number[] {
  const LINE = lineChars;
  const ESC = 0x1b;
  const GS = 0x1d;
  const bytes: number[] = [];
  const push = (...b: number[]) => bytes.push(...b);

  // ESC/POS's default codepage is ASCII-ish: normalize nbsp, strip diacritics,
  // and replace anything else so btoa() never throws on the result.
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
  const align = (n: 0 | 1 | 2) => push(ESC, 0x61, n);
  const bold = (on: boolean) => push(ESC, 0x45, on ? 1 : 0);
  const size = (n: number) => push(GS, 0x21, n); // 0x00 normal, 0x01 tall, 0x11 double
  const divider = () => line("-".repeat(LINE));
  const row = (left: string, right: string) => {
    const l = ascii(left);
    const r = ascii(right);
    const gap = Math.max(1, LINE - l.length - r.length);
    line(l + " ".repeat(gap) + r);
  };

  push(ESC, 0x40); // initialize
  // GS L 0 0: left margin to zero. Memory-switch margins are NOT cleared by
  // ESC @ on much firmware, and a margin shifts every line right until its tail
  // falls off the head — indistinguishable from printing too many characters.
  push(GS, 0x4c, 0x00, 0x00);

  if (logoBytes.length) {
    align(paper === "80" ? 1 : 0); // see buildLogoEscposBytes
    push(...logoBytes);
    push(0x0a);
  }

  align(1);
  bold(true);
  size(0x11);
  line(inv.outlet.name);
  size(0x00);
  bold(false);
  if (inv.outlet.address) for (const l of wrapText(inv.outlet.address, LINE)) line(l);
  if (inv.outlet.phone) line(inv.outlet.phone);
  if (inv.outlet.email) line(inv.outlet.email);
  line("");
  bold(true);
  line("FAKTUR PENJUALAN");
  bold(false);
  divider();

  align(0);
  row("No. Faktur", inv.number);
  row("Tanggal", tgl(inv.issue_date));
  if (inv.due_date) row("Jatuh tempo", tgl(inv.due_date));
  if (inv.party_name) row("Kepada", inv.party_name);
  if (inv.created_by_name) row("Dibuat oleh", inv.created_by_name);
  divider();

  for (const it of inv.items) {
    const qty = Number(it.quantity);
    const disc = Number(it.discount_pct) || 0;
    bold(true);
    for (const l of wrapText(it.description, LINE)) line(l);
    bold(false);
    row(`${qty} x ${fmt(it.unit_price)}`, fmt(it.line_total));
    if (disc > 0) line(`  (diskon ${disc}%)`);
  }
  divider();

  row("Subtotal", fmt(inv.subtotal));
  if (Number(inv.discount) > 0) row("Diskon", `-${fmt(inv.discount)}`);
  if (Number(inv.tax_amount) > 0 || Number(inv.tax_rate) > 0)
    row(`Pajak (${Number(inv.tax_rate)}%)`, fmt(inv.tax_amount));
  bold(true);
  size(0x01); // double height for the total
  row("TOTAL", fmt(inv.total));
  size(0x00);
  bold(false);

  const { dp, beyondDp, remaining, credited } = creditedAmounts(inv);
  if (credited > 0) {
    divider();
    if (dp > 0) row("Uang Muka (DP)", `-${fmt(dp)}`);
    if (beyondDp > 0) row("Dibayar", `-${fmt(beyondDp)}`);
    bold(true);
    row("SISA TAGIHAN", fmt(remaining));
    bold(false);
  }

  const badge = statusLabel(inv.status);
  if (badge) {
    divider();
    align(1);
    bold(true);
    line(`*** ${badge} ***`);
    bold(false);
    align(0);
  }

  if (inv.notes) {
    divider();
    bold(true);
    line("Catatan:");
    bold(false);
    for (const l of wrapText(inv.notes, LINE)) line(l);
  }

  // Syarat & Ketentuan intentionally not printed here — see the file header.

  divider();
  align(1);
  line("Terima kasih!");
  line("");
  line("Dibuat oleh ulunpesan.com");

  push(0x0a, 0x0a, 0x0a); // feed before cut
  push(GS, 0x56, 0x00); // full cut

  return bytes;
}

const toBase64 = (bytes: number[]) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b & 0xff);
  return btoa(bin);
};

// Desktop/iOS fallback: a self-contained receipt-width page built from the same
// data (the A4 markup wouldn't carry over to a print window), auto-printed.
function printViaBrowser(inv: ThermalInvoice, paper: PaperWidth, widthMm: number) {
  const mm = `${widthMm}mm`;
  const logo = logoSrcOf(inv);
  const { dp, beyondDp, remaining, credited } = creditedAmounts(inv);
  const badge = statusLabel(inv.status);

  const itemsHtml = inv.items
    .map((it) => {
      const disc = Number(it.discount_pct) || 0;
      return (
        `<div class="item"><div class="name">${escapeHtml(it.description)}</div>` +
        `<div class="row"><span>${Number(it.quantity)} x ${fmt(it.unit_price)}</span><span>${fmt(it.line_total)}</span></div>` +
        (disc > 0 ? `<div class="sm">&nbsp;&nbsp;(diskon ${disc}%)</div>` : "") +
        `</div>`
      );
    })
    .join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Faktur ${escapeHtml(inv.number)}</title>
<style>
  @page { size: ${mm} auto; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${mm}; }
  /* Horizontal padding comes out of the printable width, so keep it thin: the
     head starts at the left edge of what it can print, not of the paper. */
  body { font-family: 'Courier New', monospace; font-size: 11px; line-height: 1.35; color: #000; padding: 3mm 1mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .c { text-align: center; }
  .b { font-weight: bold; }
  .lg { font-size: 14px; }
  .sm { font-size: 10px; }
  .dv { border-top: 1px dashed #000; margin: 5px 0; }
  .row { display: flex; justify-content: space-between; gap: 6px; }
  .row span:last-child { text-align: right; white-space: nowrap; }
  .item { margin: 3px 0; }
  .item .name { font-weight: bold; word-break: break-word; }
  /* Centered via a full-width wrapper: auto margins on the img alone drift on
     print engines that size the replaced element before @page width applies. */
  .logo-wrap { width: 100%; text-align: center; margin-bottom: 2mm; }
  .logo { display: inline-block; width: 20mm; height: 20mm; object-fit: contain; }
</style></head><body>
  ${logo ? `<div class="logo-wrap"><img class="logo" src="${logo}" alt=""></div>` : ""}
  <div class="c b lg">${escapeHtml(inv.outlet.name)}</div>
  ${inv.outlet.address ? `<div class="c sm">${escapeHtml(inv.outlet.address)}</div>` : ""}
  ${inv.outlet.phone ? `<div class="c sm">${escapeHtml(inv.outlet.phone)}</div>` : ""}
  ${inv.outlet.email ? `<div class="c sm">${escapeHtml(inv.outlet.email)}</div>` : ""}
  <div class="c b" style="margin-top:4px">FAKTUR PENJUALAN</div>
  <div class="dv"></div>
  <div class="row sm"><span>No. Faktur</span><span class="b">${escapeHtml(inv.number)}</span></div>
  <div class="row sm"><span>Tanggal</span><span>${tgl(inv.issue_date)}</span></div>
  ${inv.due_date ? `<div class="row sm"><span>Jatuh tempo</span><span>${tgl(inv.due_date)}</span></div>` : ""}
  ${inv.party_name ? `<div class="row sm"><span>Kepada</span><span>${escapeHtml(inv.party_name)}</span></div>` : ""}
  ${inv.created_by_name ? `<div class="row sm"><span>Dibuat oleh</span><span>${escapeHtml(inv.created_by_name)}</span></div>` : ""}
  <div class="dv"></div>
  ${itemsHtml}
  <div class="dv"></div>
  <div class="row sm"><span>Subtotal</span><span>${fmt(inv.subtotal)}</span></div>
  ${Number(inv.discount) > 0 ? `<div class="row sm"><span>Diskon</span><span>-${fmt(inv.discount)}</span></div>` : ""}
  ${Number(inv.tax_amount) > 0 || Number(inv.tax_rate) > 0 ? `<div class="row sm"><span>Pajak (${Number(inv.tax_rate)}%)</span><span>${fmt(inv.tax_amount)}</span></div>` : ""}
  <div class="row b lg"><span>TOTAL</span><span>${fmt(inv.total)}</span></div>
  ${
    credited > 0
      ? `<div class="dv"></div>` +
        (dp > 0 ? `<div class="row sm"><span>Uang Muka (DP)</span><span>-${fmt(dp)}</span></div>` : "") +
        (beyondDp > 0 ? `<div class="row sm"><span>Dibayar</span><span>-${fmt(beyondDp)}</span></div>` : "") +
        `<div class="row b"><span>SISA TAGIHAN</span><span>${fmt(remaining)}</span></div>`
      : ""
  }
  ${badge ? `<div class="dv"></div><div class="c b">*** ${badge} ***</div>` : ""}
  ${inv.notes ? `<div class="dv"></div><div class="b sm">Catatan:</div><div class="sm" style="word-break:break-word">${escapeHtml(inv.notes)}</div>` : ""}
  <div class="dv"></div>
  <div class="c sm">Terima kasih!</div>
  <div class="c sm">Dibuat oleh ulunpesan.com</div>
  <script>window.onload=function(){window.focus();window.print();window.onafterprint=function(){window.close();};setTimeout(function(){try{window.close();}catch(e){}},2000);};</script>
</body></html>`;

  const w = window.open("", "_blank", "width=360,height=640");
  if (!w) {
    alert("Popup diblokir. Izinkan popup untuk situs ini agar faktur bisa dicetak.");
    return;
  }
  w.document.write(html);
  w.document.close();
}

/* The browser route's ruler: a 100mm millimetre scale, printed through the same
   dialog the receipt goes through, so it is measured under the same driver,
   paper size and scaling. Read off the last number that reached the paper and
   that is the width the receipt may use. */
function printRulerViaBrowser(paper: PaperWidth, widthMm: number) {
  const MAX = 100;
  const ticks = Array.from({ length: MAX + 1 }, (_, i) => {
    const h = i % 10 === 0 ? 8 : i % 5 === 0 ? 5 : 3;
    return `<div class="t" style="left:${i}mm;height:${h}mm"></div>`;
  }).join("");
  const labels = Array.from({ length: MAX / 10 + 1 }, (_, i) => {
    const mm = i * 10;
    return `<div class="l" style="left:${mm}mm">${mm}</div>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Tes lebar cetak</title>
<style>
  @page { size: ${MAX}mm auto; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${MAX}mm; }
  body { font-family: 'Courier New', monospace; font-size: 10px; color: #000; padding: 3mm 0 0 0; }
  .h { font-weight: bold; padding-bottom: 2mm; }
  .s { padding: 0 0 2mm 0; }
  .r { position: relative; height: 14mm; width: ${MAX}mm; border-top: 0.3mm solid #000; }
  .t { position: absolute; top: 0; width: 0; border-left: 0.25mm solid #000; }
  .l { position: absolute; top: 9mm; font-size: 8px; transform: translateX(-50%); }
</style></head><body>
  <div class="h">TES LEBAR CETAK</div>
  <div class="s">Setelan sekarang: ${paper}mm, ${widthMm}mm</div>
  <div class="r">${ticks}${labels}</div>
  <div class="s">Angka terakhir yang tercetak = lebar<br>cetak printer ini (mm).</div>
  <script>window.onload=function(){window.focus();window.print();window.onafterprint=function(){window.close();};setTimeout(function(){try{window.close();}catch(e){}},2000);};</script>
</body></html>`;

  const w = window.open("", "_blank", "width=360,height=640");
  if (!w) {
    alert("Popup diblokir. Izinkan popup untuk situs ini agar tes bisa dicetak.");
    return;
  }
  w.document.write(html);
  w.document.close();
}

// Prefer ThermalBridge, fall back to RawBT. Navigating to a scheme nobody
// handles is a silent no-op in Android Chrome, so "installed" is detected by
// the page losing focus before the timer fires: ThermalBridge's print popup
// only blurs the page, a full app switch also hides it — watch for either.
function openPrintApp(thermalBridgeUrl: string, rawbtUrl: string) {
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
}

/* One line of the print menu: icon, label, and a hint explaining which
   transport it uses — the difference between these rows is not guessable from
   the label alone. */
function MenuRow({
  icon,
  label,
  hint,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent disabled:opacity-60"
    >
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-[11px] text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

/* The thermal half of the print menu: paper-width picker, the ThermalBridge /
   browser-dialog route, and — where the browser supports it — direct USB.
   Rendered inside the print popover in the invoice toolbar. */
export function ThermalPrintOptions({ inv }: { inv: ThermalInvoice }) {
  const [paper, setPaper] = useState<PaperWidth>(() => {
    if (typeof window === "undefined") return "80";
    return window.localStorage.getItem(PAPER_KEY) === "58" ? "58" : "80";
  });
  // Per-paper override, falling back to the default for that width.
  const readChars = (w: PaperWidth) => {
    if (typeof window === "undefined") return LINE_CHARS[w];
    const stored = Number(window.localStorage.getItem(CHARS_KEY(w)));
    return stored >= MIN_CHARS && stored <= MAX_CHARS ? stored : LINE_CHARS[w];
  };
  const [lineChars, setLineChars] = useState<number>(() => readChars(paper));

  const readMm = (w: PaperWidth) => {
    if (typeof window === "undefined") return PRINT_MM[w];
    const stored = Number(window.localStorage.getItem(MM_KEY(w)));
    return stored >= MIN_MM && stored <= MAX_MM ? stored : PRINT_MM[w];
  };
  const [widthMm, setWidthMm] = useState<number>(() => readMm(paper));

  const pickPaper = (w: PaperWidth) => {
    setPaper(w);
    setLineChars(readChars(w)); // each width remembers its own printer
    setWidthMm(readMm(w));
    try {
      window.localStorage.setItem(PAPER_KEY, w);
    } catch {
      /* ignore */
    }
  };

  const nudgeMm = (delta: number) => {
    const next = Math.min(MAX_MM, Math.max(MIN_MM, widthMm + delta));
    setWidthMm(next);
    try {
      window.localStorage.setItem(MM_KEY(paper), String(next));
    } catch {
      /* ignore */
    }
  };

  const nudgeChars = (delta: number) => {
    const next = Math.min(MAX_CHARS, Math.max(MIN_CHARS, lineChars + delta));
    setLineChars(next);
    try {
      window.localStorage.setItem(CHARS_KEY(paper), String(next));
    } catch {
      /* ignore */
    }
  };

  const isAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
  // Resolved after mount: `isSecureContext`/`navigator.usb` don't exist during
  // SSR, and rendering the button on the server would hydrate-mismatch.
  const [usbAvailable, setUsbAvailable] = useState(false);
  const [usbPaired, setUsbPaired] = useState(false);
  const [usbBusy, setUsbBusy] = useState(false);
  // Shown after a picker closes empty-handed: the printer-class filter hides
  // every board that misdeclares itself, and the wider picker needs a click of
  // its own to have a user gesture to open on.
  const [offerAllDevices, setOfferAllDevices] = useState(false);

  useEffect(() => {
    // Android already has ThermalBridge/RawBT; a second raw path there would
    // only be a way to get it wrong.
    if (isAndroid || !isWebUsbSupported()) return;
    let live = true;
    // Both flags are set from the same async callback: enumeration is the only
    // thing that decides whether the button reads "Hubungkan" or "Cetak", and
    // flipping availability first would render it in the wrong state.
    getPairedPrinter()
      .catch(() => null) // enumeration blocked by policy — the picker still works
      .then((d) => {
        if (!live) return;
        setUsbAvailable(true);
        setUsbPaired(!!d);
      });
    return () => {
      live = false;
    };
  }, [isAndroid]);

  // The ESC/POS byte stream, logo included when it can be rasterized.
  const buildBytes = async () => {
    let logoBytes: number[] = [];
    const logo = logoSrcOf(inv);
    if (logo) {
      try {
        logoBytes = await buildLogoEscposBytes(logo, paper);
      } catch {
        // Logo unavailable (load/CORS failure) — print without it.
      }
    }
    return buildInvoiceEscposBytes(inv, paper, logoBytes, lineChars);
  };

  const handlePrint = async () => {
    if (!isAndroid) {
      printViaBrowser(inv, paper, widthMm);
      return;
    }
    const b64 = toBase64(await buildBytes());
    // base64url: query-string safe ("+" would decode to a space).
    const b64url = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    openPrintApp(`thermalbridge://print?back=1&data=${b64url}`, `rawbt:base64,${b64}`);
  };

  /* Pair (if needed) and send. Both USB payloads — the invoice and the width
     ruler — go through here so the gesture and error handling stay in one
     place. */
  const runUsb = async (makeBytes: () => Promise<number[]> | number[], allDevices = false) => {
    setUsbBusy(true);
    try {
      // requestDevice needs the user gesture, so pairing happens inline on the
      // first print rather than behind a separate "connect" step. Exactly one
      // picker per click — the gesture is spent on the first requestDevice.
      let device = allDevices ? null : await getPairedPrinter();
      if (!device) {
        device = await pairUsbPrinter(allDevices);
        if (!device) {
          // Closed without a pick. If the narrow filter was in play, the list
          // may simply have been empty — offer the wide one.
          setOfferAllDevices(!allDevices);
          return;
        }
      }
      await printBytesOverUsb(device, await makeBytes());
      setUsbPaired(true);
      setOfferAllDevices(false);
    } catch (e) {
      // Every realistic failure here is operator-actionable; the lib phrases
      // them in Indonesian already.
      const msg = e instanceof Error ? e.message : "Gagal mencetak ke printer USB.";
      // Only drop the pairing when the device handle is genuinely dead. Revoking
      // on any failure (a busy interface, a stalled transfer) means the picker
      // reopens on every retry while the grant was never the problem.
      if ((e as { deviceGone?: boolean })?.deviceGone) {
        await forgetUsbPrinter();
        setUsbPaired(false);
      }
      alert(msg);
    } finally {
      setUsbBusy(false);
    }
  };

  const handleUsbPrint = (allDevices = false) => runUsb(buildBytes, allDevices);
  /* Measure the route this device actually prints by — a ruler from the wrong
     transport measures the wrong thing, which is the whole reason this took as
     long as it did. USB only when it is genuinely paired and working. */
  const handleRulerTest = async () => {
    if (!isAndroid && !usbPaired) {
      printRulerViaBrowser(paper, widthMm);
      return;
    }
    if (usbPaired) {
      await runUsb(() => buildRulerEscposBytes(paper, lineChars));
      return;
    }
    const b64 = toBase64(buildRulerEscposBytes(paper, lineChars));
    const b64url = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    openPrintApp(`thermalbridge://print?back=1&data=${b64url}`, `rawbt:base64,${b64}`);
  };

  return (
    <>
      {/* Paper width first: it's read at click time and applies to both rows. */}
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-xs text-muted-foreground">Lebar kertas</span>
        <div className="flex items-center gap-1 rounded-lg border p-0.5">
          {(["58", "80"] as const).map((w) => (
            <button
              key={w}
              onClick={() => pickPaper(w)}
              className={`rounded-md px-2 py-1 text-xs font-bold transition-colors ${
                paper === w ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {w}mm
            </button>
          ))}
        </div>
      </div>

      {/* Two routes, two units, and a device can have both: the print dialog lays
          out in millimetres, raw ESC/POS counts characters. Each is shown only
          where it can do anything. */}
      {!isAndroid && (
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-xs text-muted-foreground">Lebar cetak</span>
          <div className="flex items-center gap-1 rounded-lg border p-0.5">
            <button
              onClick={() => nudgeMm(-1)}
              disabled={widthMm <= MIN_MM}
              aria-label="Kurangi Lebar cetak"
              className="rounded-md px-2 py-1 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              −
            </button>
            <span className="w-8 text-center text-xs font-bold tabular-nums">{widthMm}mm</span>
            <button
              onClick={() => nudgeMm(1)}
              disabled={widthMm >= MAX_MM}
              aria-label="Tambah Lebar cetak"
              className="rounded-md px-2 py-1 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              +
            </button>
          </div>
        </div>
      )}
      {(isAndroid || usbAvailable) && (
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-xs text-muted-foreground">Kolom cetak</span>
          <div className="flex items-center gap-1 rounded-lg border p-0.5">
            <button
              onClick={() => nudgeChars(-1)}
              disabled={lineChars <= MIN_CHARS}
              aria-label="Kurangi Kolom cetak"
              className="rounded-md px-2 py-1 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              −
            </button>
            <span className="w-8 text-center text-xs font-bold tabular-nums">{lineChars}</span>
            <button
              onClick={() => nudgeChars(1)}
              disabled={lineChars >= MAX_CHARS}
              aria-label="Tambah Kolom cetak"
              className="rounded-md px-2 py-1 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              +
            </button>
          </div>
        </div>
      )}

      <MenuRow
        icon={<Receipt className="size-4" />}
        label="Struk thermal"
        hint={isAndroid ? "Kirim ke ThermalBridge / RawBT" : "Lewat dialog cetak, kertas " + paper + "mm"}
        onClick={handlePrint}
      />

      {usbAvailable && (
        <MenuRow
          icon={usbBusy ? <Loader2 className="size-4 animate-spin" /> : <Usb className="size-4" />}
          label={usbPaired ? "Cetak langsung ke USB" : "Hubungkan printer USB"}
          hint={usbPaired ? "ESC/POS, tanpa dialog" : "Pilih printer sekali, lalu langsung cetak"}
          onClick={() => handleUsbPrint()}
          disabled={usbBusy}
        />
      )}
      {usbAvailable && offerAllDevices && (
        <MenuRow
          icon={<Usb className="size-4" />}
          label="Printer tidak muncul?"
          hint="Tampilkan semua perangkat USB, bukan hanya kelas printer"
          onClick={() => handleUsbPrint(true)}
          disabled={usbBusy}
        />
      )}
      <MenuRow
          icon={<Ruler className="size-4" />}
          label="Tes lebar kertas"
          hint="Cetak penggaris — untuk menyetel lebar cetak"
          onClick={handleRulerTest}
          disabled={usbBusy}
      />
      {usbAvailable && usbPaired && (
        <button
          onClick={async () => {
            await forgetUsbPrinter();
            setUsbPaired(false);
          }}
          className="px-2 text-left text-[11px] text-muted-foreground hover:text-foreground"
        >
          Lupakan printer USB
        </button>
      )}
    </>
  );
}
