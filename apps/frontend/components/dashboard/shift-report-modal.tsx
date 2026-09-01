"use client";

import { useState } from "react";
import { Printer, X, ClipboardCheck } from "lucide-react";
import {
  AUTO_PRINT_SCRIPT,
  escapeHtml,
  escposBuilder,
  isAndroid,
  openAndroidPrintApp,
  printHtmlWindow,
  readPaperWidth,
  thermalPageCss,
  writePaperWidth,
  type PaperWidth,
} from "@/lib/escpos";

/**
 * The shift closing slip — "Laporan Penutupan Shift".
 *
 * Shape mirrors ShiftReport in apps/backend/src/lib/shift.ts. Every figure on
 * it is computed there; nothing on this side derives money from anything else,
 * so the screen and the paper can never disagree with the server about what a
 * shift took.
 */
export type ShiftReport = {
  shift: {
    id: number;
    cashierName: string;
    openedAt: string;
    closedAt: string | null;
    isOpen: boolean;
  };
  outlet: { name: string; address: string; phone: string; logo: string };
  drawer: {
    openingFloat: number;
    cashIn: number;
    cashOut: number;
    expectedCash: number;
    /** The part of the drawer that is tax owed. CASH sales only. */
    taxInDrawer: number;
    countedCash: number | null;
    variance: number | null;
    closingNote: string | null;
  };
  revenue: {
    gross: number;
    discount: number;
    /** After discount, before tax — what the business earned. */
    net: number;
    /** Collected for the tax office. Never part of `net`. */
    tax: number;
    /** What customers handed over: the figure the payment lines foot to. */
    collected: number;
    orderCount: number;
    itemCount: number;
  };
  payments: { method: string; label: string; amount: number; orderCount: number }[];
  cancelled: { count: number; amount: number };
  topProducts: { name: string; qty: number; amount: number }[];
};

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(n);

/** Signed, so a shortfall reads as one at a glance rather than as a total. */
const fmtSigned = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

/** Trim a product name so its price still lands inside the line width. */
const clip = (s: string, max: number) =>
  s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}.`;

/**
 * Build the slip as ESC/POS bytes.
 *
 * No logo raster here, unlike the customer receipt: this is an internal control
 * document, and the one thing that matters on it is that the numbers are
 * legible and unambiguous. A 24mm logo would push the whole thing further down
 * a roll the cashier is about to staple to a cash bag.
 *
 * Labels are chosen to fit 58mm paper — 32 characters total, and a rupiah value
 * eats up to 14 of them. "Total Penjualan Kotor" does not fit; "Penjualan
 * Kotor" does. The 80mm layout is the same text with more air around it, which
 * is deliberate: two printers in one shop should produce slips that read the
 * same way.
 */
function buildShiftEscposBase64(r: ShiftReport, paper: PaperWidth): string {
  const b = escposBuilder(paper);
  const { line, row, align, bold, size, divider } = b;

  // Trim the left side to whatever the value leaves free.
  //
  // row() pads to the line width but cannot shorten: hand it a label and a
  // value that together exceed 32 characters and the printer hard-wraps the
  // overflow onto its own line, which on a column of figures reads as a stray
  // number with no label. "TUNAI (CASH) (128x)" against a nine-figure total is
  // 35 characters, so this is reachable on a busy shift, not a theoretical
  // case. Same for a long product name, and for a cashier_name — that column
  // holds up to 100 characters.
  const fit = (left: string, right: string) =>
    row(clip(left, b.width - right.length - 1), right);

  b.init();

  align(1);
  bold(true);
  size(0x11);
  line(r.outlet.name);
  size(0x00);
  if (r.outlet.address) {
    bold(false);
    line(r.outlet.address);
  }
  if (r.outlet.phone) line(r.outlet.phone);
  bold(false);
  divider("=");
  bold(true);
  line("LAPORAN PENUTUPAN SHIFT");
  bold(false);
  // A slip printed mid-shift is a spot check, not a closing. Saying so on the
  // paper is what stops one being filed as the other.
  if (r.shift.isOpen) line("(SHIFT MASIH BERJALAN)");
  divider("=");

  align(0);
  row("Tanggal", fmtDate(r.shift.openedAt));
  row("Jam Buka", fmtTime(r.shift.openedAt));
  row("Jam Tutup", r.shift.closedAt ? fmtTime(r.shift.closedAt) : "-");
  // The name is the long side here, not the label (cashier_name is
  // varchar(100)), so this one clips the value.
  row("Kasir", clip(r.shift.cashierName, b.width - 6));
  row("No. Shift", `#${r.shift.id}`);
  divider();

  // ── 1. The drawer ────────────────────────────────────────────────────────
  bold(true);
  line("[ 1. RINGKASAN KAS LACI ]");
  bold(false);
  divider();
  row("Modal Awal", fmt(r.drawer.openingFloat));
  row("Tunai Masuk (+)", fmt(r.drawer.cashIn));
  row("Tunai Keluar (-)", fmt(r.drawer.cashOut));
  divider();
  bold(true);
  row("SALDO SISTEM", fmt(r.drawer.expectedCash));
  bold(false);
  // Break the till down when part of it is the tax office's. The count below
  // still reconciles against SALDO SISTEM — this only says how much of that
  // money is not the shop's, which is the figure whoever banks the takings
  // needs and had to work out by hand.
  if (r.drawer.taxInDrawer > 0) {
    row("  Pajak (disetor)", fmt(r.drawer.taxInDrawer));
    row("  Uang toko", fmt(r.drawer.expectedCash - r.drawer.taxInDrawer));
  }
  if (r.drawer.countedCash !== null) {
    row("UANG DI LACI", fmt(r.drawer.countedCash));
    divider();
    bold(true);
    // The only line on the slip anyone argues about, so it gets the emphasis.
    size(0x01);
    row("SELISIH", fmtSigned(r.drawer.variance ?? 0));
    size(0x00);
    bold(false);
    if (r.drawer.variance === 0) line("Laci cocok.");
    else if ((r.drawer.variance ?? 0) < 0) line("Uang laci KURANG.");
    else line("Uang laci LEBIH.");
  }
  line("");

  // ── 2. Revenue ───────────────────────────────────────────────────────────
  bold(true);
  line("[ 2. RINCIAN PENDAPATAN ]");
  bold(false);
  divider();
  row("Penjualan Kotor", fmt(r.revenue.gross));
  row("Diskon/Promo", `-${fmt(r.revenue.discount)}`);
  divider();
  bold(true);
  row("PENJUALAN NETTO", fmt(r.revenue.net));
  bold(false);
  // Tax is stated separately and never inside NETTO: it is money held for the
  // tax office, not takings. Printing it here is also what lets whoever files
  // the return read the figure straight off the slip.
  if (r.revenue.tax > 0) {
    row("Pajak Dipungut", fmt(r.revenue.tax));
    divider();
    bold(true);
    row("TOTAL DITERIMA", fmt(r.revenue.collected));
    bold(false);
  }
  row("Jumlah Transaksi", String(r.revenue.orderCount));
  row("Jumlah Item", String(r.revenue.itemCount));
  line("");

  // ── 3. Payment mix ───────────────────────────────────────────────────────
  bold(true);
  line("[ 3. METODE PEMBAYARAN ]");
  bold(false);
  divider();
  if (r.payments.length === 0) {
    line("Belum ada transaksi.");
  } else {
    for (const p of r.payments) {
      fit(`${p.label} (${p.orderCount}x)`, fmt(p.amount));
    }
    divider();
    bold(true);
    // Foots to what was TENDERED, not to net sales: the customer handed over
    // the tax as well, and these lines are what a cashier reconciles against
    // the cash in the drawer and the EDC settlement slips. A column that
    // doesn't foot is the first sign something is missing.
    row("TOTAL", fmt(r.revenue.collected));
    bold(false);
  }
  line("");

  // ── 4. What sold ─────────────────────────────────────────────────────────
  if (r.topProducts.length > 0) {
    bold(true);
    line("[ 4. PRODUK TERLARIS ]");
    bold(false);
    divider();
    for (const p of r.topProducts) {
      fit(`${p.qty}x ${p.name}`, fmt(p.amount));
    }
    line("");
  }

  // ── 5. Voids ─────────────────────────────────────────────────────────────
  if (r.cancelled.count > 0) {
    bold(true);
    line("[ 5. PEMBATALAN ]");
    bold(false);
    divider();
    fit(`Order dibatalkan (${r.cancelled.count}x)`, fmt(r.cancelled.amount));
    line("");
  }

  if (r.drawer.closingNote) {
    bold(true);
    line("Catatan:");
    bold(false);
    for (const l of wrap(r.drawer.closingNote, b.width)) line(l);
    line("");
  }

  // ── Signatures ───────────────────────────────────────────────────────────
  // The slip is only worth printing if someone signs it. Two names, because a
  // count nobody witnessed settles no argument.
  divider();
  line("");
  line("");
  row("  Kasir  ", "  Penyelia  ");
  line("");
  line("");
  row("(__________)", "(__________)");
  line("");

  align(1);
  line(
    `Dicetak ${new Date().toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`,
  );
  line("Dibuat oleh ulunpesan.com");

  b.finish();
  return b.toBase64();
}

/** Greedy word wrap; words longer than the line are hard-split, never dropped. */
function wrap(s: string, width: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const word of String(s ?? "").trim().split(/\s+/).filter(Boolean)) {
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
  return out;
}

/** Desktop/iOS fallback: the same layout as HTML, built from the same data. */
function buildShiftHtml(r: ShiftReport, paper: PaperWidth): string {
  const row = (l: string, v: string, cls = "sm") =>
    `<div class="row ${cls}"><span>${escapeHtml(l)}</span><span>${escapeHtml(v)}</span></div>`;
  const section = (t: string) => `<div class="b" style="margin-top:6px">${escapeHtml(t)}</div><div class="dv"></div>`;

  const drawerCount =
    r.drawer.countedCash === null
      ? ""
      : row("UANG DI LACI", fmt(r.drawer.countedCash)) +
        `<div class="dv"></div>` +
        row("SELISIH", fmtSigned(r.drawer.variance ?? 0), "b lg") +
        `<div class="c sm">${
          r.drawer.variance === 0
            ? "Laci cocok."
            : (r.drawer.variance ?? 0) < 0
              ? "Uang laci KURANG."
              : "Uang laci LEBIH."
        }</div>`;

  const paymentRows =
    r.payments.length === 0
      ? `<div class="sm">Belum ada transaksi.</div>`
      : r.payments
          .map((p) => row(`${p.label} (${p.orderCount}x)`, fmt(p.amount)))
          .join("") +
        `<div class="dv"></div>` +
        row("TOTAL", fmt(r.revenue.collected), "b");

  const topRows = r.topProducts.length
    ? section("[ 4. PRODUK TERLARIS ]") +
      r.topProducts.map((p) => row(`${p.qty}x ${p.name}`, fmt(p.amount))).join("")
    : "";

  const cancelRows = r.cancelled.count
    ? section("[ 5. PEMBATALAN ]") +
      row(`Order dibatalkan (${r.cancelled.count}x)`, fmt(r.cancelled.amount))
    : "";

  const noteRows = r.drawer.closingNote
    ? `<div class="dv"></div><div class="b sm">Catatan:</div><div class="sm">${escapeHtml(r.drawer.closingNote)}</div>`
    : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Penutupan Shift #${r.shift.id}</title>
<style>${thermalPageCss(paper)}
  .sig { display: flex; justify-content: space-between; margin-top: 14mm; }
  .sig span { width: 45%; text-align: center; border-top: 1px solid #000; padding-top: 2px; }
</style></head><body>
  <div class="c b lg">${escapeHtml(r.outlet.name)}</div>
  ${r.outlet.address ? `<div class="c sm">${escapeHtml(r.outlet.address)}</div>` : ""}
  ${r.outlet.phone ? `<div class="c sm">${escapeHtml(r.outlet.phone)}</div>` : ""}
  <div class="eq"></div>
  <div class="c b">LAPORAN PENUTUPAN SHIFT</div>
  ${r.shift.isOpen ? `<div class="c sm">(SHIFT MASIH BERJALAN)</div>` : ""}
  <div class="eq"></div>
  ${row("Tanggal", fmtDate(r.shift.openedAt))}
  ${row("Jam Buka", fmtTime(r.shift.openedAt))}
  ${row("Jam Tutup", r.shift.closedAt ? fmtTime(r.shift.closedAt) : "-")}
  ${row("Kasir", r.shift.cashierName)}
  ${row("No. Shift", `#${r.shift.id}`)}
  <div class="dv"></div>
  ${section("[ 1. RINGKASAN KAS LACI ]")}
  ${row("Modal Awal", fmt(r.drawer.openingFloat))}
  ${row("Tunai Masuk (+)", fmt(r.drawer.cashIn))}
  ${row("Tunai Keluar (-)", fmt(r.drawer.cashOut))}
  <div class="dv"></div>
  ${row("SALDO SISTEM", fmt(r.drawer.expectedCash), "b")}
  ${
    r.drawer.taxInDrawer > 0
      ? row("\u00a0\u00a0Pajak (disetor)", fmt(r.drawer.taxInDrawer)) +
        row("\u00a0\u00a0Uang toko", fmt(r.drawer.expectedCash - r.drawer.taxInDrawer))
      : ""
  }
  ${drawerCount}
  ${section("[ 2. RINCIAN PENDAPATAN ]")}
  ${row("Penjualan Kotor", fmt(r.revenue.gross))}
  ${row("Diskon/Promo", `-${fmt(r.revenue.discount)}`)}
  <div class="dv"></div>
  ${row("PENJUALAN NETTO", fmt(r.revenue.net), "b")}
  ${
    r.revenue.tax > 0
      ? row("Pajak Dipungut", fmt(r.revenue.tax)) +
        `<div class="dv"></div>` +
        row("TOTAL DITERIMA", fmt(r.revenue.collected), "b")
      : ""
  }
  ${row("Jumlah Transaksi", String(r.revenue.orderCount))}
  ${row("Jumlah Item", String(r.revenue.itemCount))}
  ${section("[ 3. METODE PEMBAYARAN ]")}
  ${paymentRows}
  ${topRows}
  ${cancelRows}
  ${noteRows}
  <div class="sig"><span>Kasir</span><span>Penyelia</span></div>
  <div class="dv"></div>
  <div class="c sm">Dicetak ${escapeHtml(
    new Date().toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  )}</div>
  <div class="c sm">Dibuat oleh ulunpesan.com</div>
  ${AUTO_PRINT_SCRIPT}
</body></html>`;
}

type Props = {
  report: ShiftReport;
  onClose: () => void;
  heading?: string;
};

export function ShiftReportModal({ report, onClose, heading }: Props) {
  const [paperWidth, setPaperWidth] = useState<PaperWidth>(readPaperWidth);

  const pickPaperWidth = (w: PaperWidth) => {
    setPaperWidth(w);
    writePaperWidth(w);
  };

  const handlePrint = () => {
    if (isAndroid()) {
      openAndroidPrintApp(buildShiftEscposBase64(report, paperWidth));
      return;
    }
    if (!printHtmlWindow(buildShiftHtml(report, paperWidth))) {
      alert("Popup diblokir. Izinkan popup untuk situs ini agar laporan bisa dicetak.");
    }
  };

  const { shift, drawer, revenue, payments, cancelled, topProducts } = report;
  const title = heading ?? (shift.isOpen ? "Ringkasan Shift Berjalan" : "Shift Ditutup");

  // Fixed white surface, like the receipt preview: this is a picture of a piece
  // of paper, and it stays a picture of a piece of paper in dark mode.
  const Row = ({
    label,
    value,
    strong,
    tone,
  }: {
    label: string;
    value: string;
    strong?: boolean;
    tone?: "good" | "bad";
  }) => (
    <div
      className={`flex justify-between gap-3 ${strong ? "font-bold text-sm" : "text-xs mb-1"}`}
    >
      <span className={`min-w-0 truncate ${strong ? "" : "text-gray-500"}`}>
        {label}
      </span>
      <span
        className={`shrink-0 ${
          tone === "bad" ? "text-rose-600" : tone === "good" ? "text-emerald-600" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2 text-blue-600">
            <ClipboardCheck className="h-5 w-5" />
            <span className="font-bold text-base">{title}</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1"
            aria-label="Tutup"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">
          <div className="font-mono text-[13px] text-gray-800">
            <div className="text-center mb-2">
              <p className="font-bold text-base uppercase tracking-wide">
                {report.outlet.name}
              </p>
              {report.outlet.address && (
                <p className="text-xs text-gray-500">{report.outlet.address}</p>
              )}
            </div>
            <div className="border-t-2 border-gray-400 my-2" />
            <p className="text-center font-bold text-xs">LAPORAN PENUTUPAN SHIFT</p>
            {shift.isOpen && (
              <p className="text-center text-[11px] text-amber-600">
                (shift masih berjalan)
              </p>
            )}
            <div className="border-t-2 border-gray-400 my-2" />

            <Row label="Tanggal" value={fmtDate(shift.openedAt)} />
            <Row label="Jam Buka" value={fmtTime(shift.openedAt)} />
            <Row
              label="Jam Tutup"
              value={shift.closedAt ? fmtTime(shift.closedAt) : "-"}
            />
            <Row label="Kasir" value={shift.cashierName} />
            <Row label="No. Shift" value={`#${shift.id}`} />

            <div className="border-t border-dashed border-gray-300 my-3" />
            <p className="font-bold text-xs mb-2">[ 1. RINGKASAN KAS LACI ]</p>
            <Row label="Modal Awal" value={fmt(drawer.openingFloat)} />
            <Row label="Tunai Masuk (+)" value={fmt(drawer.cashIn)} />
            <Row label="Tunai Keluar (-)" value={fmt(drawer.cashOut)} />
            <div className="border-t border-dashed border-gray-300 my-2" />
            <Row label="SALDO SISTEM" value={fmt(drawer.expectedCash)} strong />
            {drawer.taxInDrawer > 0 && (
              <>
                <Row label="\u00a0\u00a0Pajak (disetor)" value={fmt(drawer.taxInDrawer)} />
                <Row
                  label="\u00a0\u00a0Uang toko"
                  value={fmt(drawer.expectedCash - drawer.taxInDrawer)}
                />
              </>
            )}
            {drawer.countedCash !== null && (
              <>
                <div className="mt-1" />
                <Row label="UANG DI LACI" value={fmt(drawer.countedCash)} strong />
                <div className="border-t border-dashed border-gray-300 my-2" />
                <Row
                  label="SELISIH"
                  value={fmtSigned(drawer.variance ?? 0)}
                  strong
                  tone={drawer.variance === 0 ? "good" : "bad"}
                />
              </>
            )}

            <div className="border-t border-dashed border-gray-300 my-3" />
            <p className="font-bold text-xs mb-2">[ 2. RINCIAN PENDAPATAN ]</p>
            <Row label="Penjualan Kotor" value={fmt(revenue.gross)} />
            <Row label="Diskon/Promo" value={`-${fmt(revenue.discount)}`} />
            <div className="border-t border-dashed border-gray-300 my-2" />
            <Row label="PENJUALAN NETTO" value={fmt(revenue.net)} strong />
            {revenue.tax > 0 && (
              <>
                <div className="mt-1" />
                <Row label="Pajak Dipungut" value={fmt(revenue.tax)} />
                <div className="border-t border-dashed border-gray-300 my-2" />
                <Row label="TOTAL DITERIMA" value={fmt(revenue.collected)} strong />
              </>
            )}
            <div className="mt-1" />
            <Row label="Jumlah Transaksi" value={String(revenue.orderCount)} />
            <Row label="Jumlah Item" value={String(revenue.itemCount)} />

            <div className="border-t border-dashed border-gray-300 my-3" />
            <p className="font-bold text-xs mb-2">[ 3. METODE PEMBAYARAN ]</p>
            {payments.length === 0 ? (
              <p className="text-xs text-gray-500">Belum ada transaksi.</p>
            ) : (
              <>
                {payments.map((p) => (
                  <Row
                    key={p.method}
                    label={`${p.label} (${p.orderCount}x)`}
                    value={fmt(p.amount)}
                  />
                ))}
                <div className="border-t border-dashed border-gray-300 my-2" />
                <Row label="TOTAL" value={fmt(revenue.collected)} strong />
              </>
            )}

            {topProducts.length > 0 && (
              <>
                <div className="border-t border-dashed border-gray-300 my-3" />
                <p className="font-bold text-xs mb-2">[ 4. PRODUK TERLARIS ]</p>
                {topProducts.map((p) => (
                  <Row key={p.name} label={`${p.qty}x ${p.name}`} value={fmt(p.amount)} />
                ))}
              </>
            )}

            {cancelled.count > 0 && (
              <>
                <div className="border-t border-dashed border-gray-300 my-3" />
                <p className="font-bold text-xs mb-2">[ 5. PEMBATALAN ]</p>
                <Row
                  label={`Order dibatalkan (${cancelled.count}x)`}
                  value={fmt(cancelled.amount)}
                />
              </>
            )}

            {drawer.closingNote && (
              <>
                <div className="border-t border-dashed border-gray-300 my-3" />
                <p className="font-bold text-xs">Catatan:</p>
                <p className="text-xs whitespace-pre-wrap wrap-break-word">
                  {drawer.closingNote}
                </p>
              </>
            )}
          </div>
        </div>

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
            Tutup
          </button>
          <button
            onClick={handlePrint}
            className="flex-1 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
          >
            <Printer className="h-4 w-4" />
            Cetak
          </button>
        </div>
      </div>
    </div>
  );
}
