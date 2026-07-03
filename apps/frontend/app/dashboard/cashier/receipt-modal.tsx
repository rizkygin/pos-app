"use client";

import { useState } from "react";
import { Printer, X, CheckCircle } from "lucide-react";
import { resolveOutletImage } from "@/lib/image-src";

type ReceiptItem = {
    product_name: string;
    quantity: number;
    price: string;
    price_mark_down: string;
};

export type ReceiptData = {
    orderId: string;
    customerName: string;
    items: ReceiptItem[];
    subtotal: number;
    discountAmount: number;
    discountLabel: string;
    total: number;
    paymentMethod: 'cash' | 'non_cash';
    amountPaid: number;
    changeDue: number;
    date: Date;
    outletName: string;
    outletAddress: string;
    outletPhone: string;
    outletLogo: string;
    cashierName: string;
};

type Props = {
    data: ReceiptData;
    onClose: () => void;
};

const fmt = (n: number) =>
    new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(n);

const esc = (s: string) =>
    String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

// Which thermal paper the printer takes; picked in the modal, remembered per device.
type PaperWidth = "58" | "80";
const PAPER_KEY = "pos_paper_width";
// Font A characters per line: 32 on 58mm paper, 48 on 80mm.
const LINE_CHARS: Record<PaperWidth, number> = { "58": 32, "80": 48 };

// Rasterize the outlet logo into an ESC/POS "GS v 0" raster block (1-bit).
// Throws when the logo can't be loaded or read (missing, CORS-tainted canvas);
// the caller treats that as "print without a logo".
async function buildLogoEscposBytes(src: string): Promise<number[]> {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new window.Image();
        el.crossOrigin = "anonymous";
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("logo load failed"));
        el.src = src;
    });

    const width = 192; // dots (~24mm at 203dpi) — header-sized on both papers
    const height = Math.max(8, Math.round(((img.height || width) / (img.width || width)) * width));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas 2d context");
    // Composite over white so transparent pixels print as paper, not black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
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

    align(1);
    if (logoBytes.length) {
        push(...logoBytes);
        push(0x0a);
    }
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
    divider();

    for (const item of data.items) {
        const isDiscount = !!item.price_mark_down && item.price_mark_down !== "0";
        const unit = parseFloat(isDiscount ? item.price_mark_down : item.price);
        const sub = unit * item.quantity;
        bold(true);
        line(item.product_name);
        bold(false);
        row(`${item.quantity} x ${fmt(unit)}`, fmt(sub));
    }
    divider();

    row("Subtotal", fmt(data.subtotal));
    if (data.discountAmount > 0) row(data.discountLabel, `-${fmt(data.discountAmount)}`);
    bold(true);
    size(0x01); // double height for the total
    row("TOTAL", fmt(data.total));
    size(0x00);
    bold(false);
    divider();

    if (data.paymentMethod === "non_cash") {
        row("Pembayaran", "Non-Tunai");
    } else {
        row("Tunai", fmt(data.amountPaid));
        row("Kembali", fmt(data.changeDue));
    }
    divider();

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

export function ReceiptModal({ data, onClose }: Props) {
    const shortId = data.orderId.split("-")[0].toUpperCase();

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
    // over to the print window). Monospace; auto-prints then closes.
    const printViaBrowser = () => {
        const mm = `${paperWidth}mm`;
        const itemsHtml = data.items
            .map((item) => {
                const isDiscount = !!item.price_mark_down && item.price_mark_down !== "0";
                const original = parseFloat(item.price);
                const unit = parseFloat(isDiscount ? item.price_mark_down : item.price);
                const sub = unit * item.quantity;
                return `<div class="item"><div class="name">${esc(item.product_name)}</div>` +
                    `<div class="row"><span>${item.quantity} x ${fmt(unit)}${isDiscount ? ` <s>${fmt(original)}</s>` : ""}</span><span>${fmt(sub)}</span></div></div>`;
            })
            .join("");

        const paymentHtml =
            data.paymentMethod === "non_cash"
                ? `<div class="row b"><span>Pembayaran</span><span>Non-Tunai</span></div>`
                : `<div class="row"><span>Tunai</span><span>${fmt(data.amountPaid)}</span></div>` +
                  `<div class="row b"><span>Kembali</span><span>${fmt(data.changeDue)}</span></div>`;

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
  s { text-decoration: line-through; }
  .logo { display: block; margin: 0 auto 2mm; width: 20mm; height: 20mm; object-fit: contain; }
</style></head><body>
  ${logoSrc ? `<img class="logo" src="${logoSrc}" alt="">` : ""}
  <div class="c b lg">${esc(data.outletName)}</div>
  ${data.outletAddress ? `<div class="c sm">${esc(data.outletAddress)}</div>` : ""}
  ${data.outletPhone ? `<div class="c sm">${esc(data.outletPhone)}</div>` : ""}
  <div class="dv"></div>
  <div class="row sm"><span>Order #</span><span class="b">${shortId}</span></div>
  <div class="row sm"><span>Tanggal</span><span>${data.date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</span></div>
  <div class="row sm"><span>Jam</span><span>${data.date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span></div>
  <div class="row sm"><span>Kasir</span><span>${esc(data.cashierName)}</span></div>
  ${data.customerName ? `<div class="row sm"><span>Pelanggan</span><span>${esc(data.customerName)}</span></div>` : ""}
  <div class="dv"></div>
  ${itemsHtml}
  <div class="dv"></div>
  <div class="row sm"><span>Subtotal</span><span>${fmt(data.subtotal)}</span></div>
  ${data.discountAmount > 0 ? `<div class="row sm"><span>${esc(data.discountLabel)}</span><span>-${fmt(data.discountAmount)}</span></div>` : ""}
  <div class="row b lg"><span>TOTAL</span><span>${fmt(data.total)}</span></div>
  <div class="dv"></div>
  ${paymentHtml}
  <div class="dv"></div>
  <div class="c sm">Terima kasih!</div>
  <div class="c sm">Silakan datang kembali ^^</div>
  <div class="dv"></div>
  <div class="c sm">Dibuat oleh ulunpesan.com</div>
  <script>window.onload=function(){window.focus();window.print();window.onafterprint=function(){window.close();};setTimeout(function(){try{window.close();}catch(e){}},2000);};</script>
</body></html>`;

        const w = window.open("", "_blank", "width=360,height=640");
        if (!w) {
            alert("Popup diblokir. Izinkan popup untuk situs ini agar struk bisa dicetak.");
            return;
        }
        w.document.write(html);
        w.document.close();
    };

    // Prefer ThermalBridge, fall back to RawBT. Navigating to a custom scheme
    // nobody handles is a silent no-op in Android Chrome, so "installed" is
    // detected by the tab being backgrounded (app opened) before the timer fires.
    const openPrintApp = (thermalBridgeUrl: string, rawbtUrl: string) => {
        const onHide = () => {
            if (document.hidden) {
                window.clearTimeout(timer);
                document.removeEventListener("visibilitychange", onHide);
            }
        };
        const timer = window.setTimeout(() => {
            document.removeEventListener("visibilitychange", onHide);
            window.location.href = rawbtUrl;
        }, 1500);
        document.addEventListener("visibilitychange", onHide);
        window.location.href = thermalBridgeUrl;
    };

    // Android: hand the raw ESC/POS bytes to ThermalBridge
    // (thermalbridge://print?data=<base64url>, back=1 returns to the browser
    // after printing) or RawBT (rawbt:base64,<base64>) — either relays them to
    // the paired Bluetooth/USB thermal printer. Other platforms have no such
    // handler, so use the browser print dialog.
    const handlePrint = async () => {
        if (/android/i.test(navigator.userAgent)) {
            let logoBytes: number[] = [];
            if (logoSrc) {
                try {
                    logoBytes = await buildLogoEscposBytes(logoSrc);
                } catch {
                    // Logo unavailable (load/CORS failure) — print without it.
                }
            }
            const b64 = buildReceiptEscposBase64(data, paperWidth, logoBytes);
            // base64url: query-string safe ("+" would decode to a space).
            const b64url = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
            openPrintApp(`thermalbridge://print?back=1&data=${b64url}`, `rawbt:base64,${b64}`);
        } else {
            printViaBrowser();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col max-h-[90vh]">
                {/* Modal header */}
                <div className="flex items-center justify-between px-5 py-4 border-b">
                    <div className="flex items-center gap-2 text-green-600">
                        <CheckCircle className="h-5 w-5" />
                        <span className="font-bold text-base">Order Placed!</span>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Receipt body — scrollable */}
                <div className="overflow-y-auto flex-1 px-5 py-4">
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
                        <div className="flex justify-between font-bold text-sm">
                            <span>TOTAL</span>
                            <span className="text-blue-600">{fmt(data.total)}</span>
                        </div>

                        <div className="border-t border-dashed border-gray-300 my-3" />

                        {/* Payment */}
                        {data.paymentMethod === 'non_cash' ? (
                            <div className="flex justify-between font-bold text-sm">
                                <span>Payment</span>
                                <span className="text-blue-600">Non-Cash</span>
                            </div>
                        ) : (
                            <>
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-gray-500">Cash</span>
                                    <span>{fmt(data.amountPaid)}</span>
                                </div>
                                <div className="flex justify-between font-bold text-sm">
                                    <span>Change</span>
                                    <span className="text-emerald-600">{fmt(data.changeDue)}</span>
                                </div>
                            </>
                        )}

                        <div className="border-t border-dashed border-gray-300 my-3" />

                        {/* Footer */}
                        <p className="text-center text-xs text-gray-400">Thank you for your purchase!</p>
                        <p className="text-center text-xs text-gray-400">Please come again 🙏</p>
                    </div>
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
                        onClick={onClose}
                        className="flex-1 h-11 rounded-xl border-2 font-semibold text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                        Close
                    </button>
                    <button
                        onClick={handlePrint}
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
