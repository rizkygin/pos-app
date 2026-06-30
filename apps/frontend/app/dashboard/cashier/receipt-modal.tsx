"use client";

import { Printer, X, CheckCircle } from "lucide-react";

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

export function ReceiptModal({ data, onClose }: Props) {
    const shortId = data.orderId.split("-")[0].toUpperCase();

    // Build a self-contained, thermal-sized receipt from the data (NOT from the
    // Tailwind-styled modal markup, which wouldn't carry over to the print window).
    // Sized for 58mm thermal paper; monospace; auto-prints then closes.
    const handlePrint = () => {
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
  @page { size: 58mm auto; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 58mm; }
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
</style></head><body>
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
  <div class="c sm">Thank you for you purchase</div>
  <div class="c sm">Please came again ^^</div>
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
                <div className="flex gap-3 px-5 py-4 border-t">
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
