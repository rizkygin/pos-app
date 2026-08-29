"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Printer, Loader2, Sparkles, Layout, ScrollText, Terminal, ChevronDown, FileText } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { API_URL } from "@/lib/api-url";
import { resolveOutletImage } from "@/lib/image-src";
import { getSalesTerms } from "@/lib/invoice-terms";
import { ThermalPrintOptions } from "../../../_components/thermal-invoice";

type Item = { id: number; description: string; quantity: string; unit_price: string; discount_pct: string; line_total: string };

// "10%" when a line has a discount, otherwise an em dash.
const discLabel = (v: string) => (Number(v) > 0 ? `${Number(v)}%` : "—");
type Outlet = { name: string; address: string; phone: string; email: string; avatar: string };
type Invoice = {
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
  outlet: Outlet;
};

type Theme = "modern" | "classic" | "elegant" | "dotmatrix";
const THEME_KEY = "pos_invoice_theme";
const MODERN_COLOR_KEY = "pos_invoice_modern_color";
const ELEGANT_C1_KEY = "pos_invoice_elegant_c1";
const ELEGANT_C2_KEY = "pos_invoice_elegant_c2";
const ELEGANT_TOTAL_BG_KEY = "pos_invoice_elegant_total_bg";
const DEFAULT_MODERN = "#0d9488"; // teal-600
const DEFAULT_C1 = "#f43f5e"; // rose-500
const DEFAULT_C2 = "#4f46e5"; // indigo-600
// Matches the look of the old gradient tint (DEFAULT_C1 at ~8% over white).
const DEFAULT_TOTAL_BG = "#fef0f2";

const THEMES: { key: Theme; label: string; icon: typeof Layout }[] = [
  { key: "modern", label: "Modern", icon: Layout },
  { key: "classic", label: "Klasik", icon: ScrollText },
  { key: "elegant", label: "Elegan", icon: Sparkles },
  { key: "dotmatrix", label: "Dot Matrix", icon: Terminal },
];

const rupiah = (v: number | string) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(
    Number(v) || 0,
  );
const tgl = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }) : "—";

const logoSrc = (o: Outlet) =>
  o.avatar && o.avatar !== "avatar.png" ? resolveOutletImage(o.avatar) : "/icons/icon-192x192.png";

/* Blurred, semi-transparent owner logo behind the invoice content. */
function Watermark({ src }: { src: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="w-2/3 max-w-[320px] object-contain opacity-[0.14] blur-[2px]" />
    </div>
  );
}

/* Small "Powered by Ulun Pesan" credit shown at the bottom of every theme. */
function PoweredBy() {
  return (
    <div className="mt-8 flex items-center justify-center gap-1.5 text-zinc-400">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192x192.png" alt="Ulun Pesan" className="size-4 rounded object-contain" />
      <span className="text-[10px] font-medium tracking-wide">
        Powered by <span className="font-semibold text-zinc-500">Ulun Pesan</span>
      </span>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-zinc-500" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/* Payment breakdown under the Total in every theme: the down payment
   (down_payment) and any payment beyond it (amount_paid - down_payment) are
   separate rows, followed by the remaining balance. On a draft the DP isn't
   booked yet (amount_paid = 0) but the agreed DP still prints. */
function PaidRows({ inv }: { inv: Invoice }) {
  const paid = Number(inv.amount_paid);
  const dp = Number(inv.down_payment) || 0;
  const credited = Math.max(paid, inv.status === "draft" ? dp : 0);
  if (!(credited > 0)) return null;
  const beyondDp = Math.max(0, credited - dp);
  const remaining = Math.max(0, Number(inv.total) - credited);
  return (
    <>
      {dp > 0 && <Row label="Uang Muka (DP)" value={`-${rupiah(dp)}`} muted />}
      {beyondDp > 0 && <Row label="Dibayar" value={`-${rupiah(beyondDp)}`} muted />}
      {remaining > 0 && (
        <div className="flex justify-between font-bold">
          <span>Sisa Tagihan</span>
          <span className="tabular-nums">{rupiah(remaining)}</span>
        </div>
      )}
    </>
  );
}

function Footer({ inv, terms, accent }: { inv: Invoice; terms: string; accent: string }) {
  return (
    <>
      {inv.notes && <p className="mt-6 text-xs text-zinc-500">Catatan: {inv.notes}</p>}
      {terms.trim() && (
        <div className="mt-6 border-t border-zinc-100 pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: accent }}>
            Syarat &amp; Ketentuan
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-500">{terms}</p>
        </div>
      )}
    </>
  );
}

/* ─────────────────────────────── Modern ─────────────────────────────── */
function ModernInvoice({ inv, terms, accent }: { inv: Invoice; terms: string; accent: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white text-zinc-900">
      <div className="h-2 w-full" style={{ backgroundImage: `linear-gradient(90deg, ${accent}, ${accent}aa)` }} />
      <Watermark src={logoSrc(inv.outlet)} />
      <div className="relative z-10 p-6 md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoSrc(inv.outlet)} alt={inv.outlet.name} className="size-14 shrink-0 rounded-xl border border-zinc-200 object-contain" />
            <div>
              <h1 className="text-lg font-bold">{inv.outlet.name}</h1>
              <p className="text-xs text-zinc-500">{inv.outlet.address}</p>
              <p className="text-xs text-zinc-500">
                {inv.outlet.phone}
                {inv.outlet.email ? ` · ${inv.outlet.email}` : ""}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold uppercase tracking-widest" style={{ color: accent }}>
              Faktur
            </p>
            <p className="font-mono text-sm font-bold">{inv.number}</p>
            {inv.status === "paid" && (
              <p className="mt-1 inline-block rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold uppercase text-emerald-700">
                Lunas
              </p>
            )}
            {inv.status === "partial" && (
              <p className="mt-1 inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase text-amber-700">
                DP Diterima
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 rounded-xl bg-zinc-50/80 p-4 text-xs">
          <div>
            <p className="text-zinc-400">Ditagihkan kepada</p>
            <p className="text-sm font-semibold">{inv.party_name || "—"}</p>
          </div>
          <div className="text-right">
            <p className="text-zinc-500">Tanggal: <span className="font-medium text-zinc-700">{tgl(inv.issue_date)}</span></p>
            <p className="text-zinc-500">Jatuh tempo: <span className="font-medium text-zinc-700">{tgl(inv.due_date)}</span></p>
          </div>
        </div>

        {/* Wrap in a scroll container so the full table is reachable on narrow screens. */}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
                <th className="rounded-l-lg bg-zinc-50 px-3 py-2 font-medium">Item</th>
                <th className="bg-zinc-50 px-3 py-2 text-right font-medium">Qty</th>
                <th className="bg-zinc-50 px-3 py-2 text-right font-medium">Harga</th>
                <th className="bg-zinc-50 px-3 py-2 text-right font-medium">Diskon</th>
                <th className="rounded-r-lg bg-zinc-50 px-3 py-2 text-right font-medium">Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {inv.items.map((it) => (
                <tr key={it.id} className="border-b border-zinc-100">
                  <td className="px-3 py-2.5">{it.description}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{Number(it.quantity)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{rupiah(it.unit_price)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{discLabel(it.discount_pct)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums">{rupiah(it.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex justify-end">
          <div className="w-full max-w-[240px] space-y-1.5 text-sm">
            <Row label="Subtotal" value={rupiah(inv.subtotal)} muted />
            {Number(inv.discount) > 0 && <Row label="Diskon" value={`-${rupiah(inv.discount)}`} muted />}
            <Row label={`Pajak (${Number(inv.tax_rate)}%)`} value={rupiah(inv.tax_amount)} muted />
            <div
              className="mt-1 flex items-center justify-between rounded-xl px-3 py-2 text-white"
              style={{ backgroundColor: accent }}
            >
              <span className="text-sm font-semibold">Total</span>
              <span className="text-base font-black tabular-nums">{rupiah(inv.total)}</span>
            </div>
            <PaidRows inv={inv} />
          </div>
        </div>

        <Footer inv={inv} terms={terms} accent={accent} />
        <PoweredBy />
      </div>
    </div>
  );
}

/* ─────────────────────────────── Classic (unchanged) ────────────────── */
function ClassicInvoice({ inv, terms }: { inv: Invoice; terms: string }) {
  return (
    <div className="overflow-hidden border-[3px] border-double border-zinc-900 bg-white p-4 font-serif text-zinc-900 sm:p-6 md:p-8">
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc(inv.outlet)} alt={inv.outlet.name} className="mx-auto size-12 object-contain sm:size-14" />
        <h1 className="mt-2 text-lg font-bold uppercase tracking-[0.12em] sm:text-2xl sm:tracking-[0.2em]">
          {inv.outlet.name}
        </h1>
        <p className="text-[11px] text-zinc-600 sm:text-xs">{inv.outlet.address}</p>
        <p className="wrap-break-word text-[11px] text-zinc-600 sm:text-xs">
          {inv.outlet.phone}
          {inv.outlet.email ? ` · ${inv.outlet.email}` : ""}
        </p>
      </div>

      <div className="my-4 border-t-2 border-zinc-900" />
      <p className="text-center text-xs font-bold uppercase tracking-[0.2em] sm:text-sm sm:tracking-[0.35em]">
        Faktur Penjualan
      </p>

      <div className="mt-5 flex flex-col gap-3 text-sm sm:flex-row sm:justify-between sm:gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Kepada</p>
          <p className="font-semibold">{inv.party_name || "—"}</p>
        </div>
        <div className="sm:text-right">
          <p>No: <span className="font-semibold">{inv.number}</span></p>
          <p>Tanggal: {tgl(inv.issue_date)}</p>
          <p>Jatuh tempo: {tgl(inv.due_date)}</p>
              {inv.created_by_name && (
                <p className="text-zinc-400">Dibuat oleh: {inv.created_by_name}</p>
              )}
          {inv.status === "paid" && <p className="mt-1 font-bold uppercase text-zinc-900">— Lunas —</p>}
          {inv.status === "partial" && <p className="mt-1 font-bold uppercase text-zinc-900">— DP Diterima —</p>}
        </div>
      </div>

      {/* Horizontal scroll on small screens so the 5-col table never breaks the layout. */}
      <div className="mt-5 overflow-x-auto">
        <table className="w-full border-collapse text-xs sm:text-sm">
          <thead>
            <tr className="border-y-2 border-zinc-900 text-left uppercase">
              <th className="px-1.5 py-2 font-semibold sm:px-2">Keterangan</th>
              <th className="px-1.5 py-2 text-right font-semibold sm:px-2">Qty</th>
              <th className="px-1.5 py-2 text-right font-semibold sm:px-2">Harga</th>
              <th className="px-1.5 py-2 text-right font-semibold sm:px-2">Diskon</th>
              <th className="px-1.5 py-2 text-right font-semibold sm:px-2">Jumlah</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((it) => (
              <tr key={it.id} className="border-b border-zinc-300">
                <td className="px-1.5 py-2 sm:px-2">{it.description}</td>
                <td className="px-1.5 py-2 text-right tabular-nums sm:px-2">{Number(it.quantity)}</td>
                <td className="whitespace-nowrap px-1.5 py-2 text-right tabular-nums sm:px-2">{rupiah(it.unit_price)}</td>
                <td className="px-1.5 py-2 text-right tabular-nums sm:px-2">{discLabel(it.discount_pct)}</td>
                <td className="whitespace-nowrap px-1.5 py-2 text-right tabular-nums sm:px-2">{rupiah(it.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex justify-end">
        <div className="w-full space-y-1 text-sm sm:max-w-[240px]">
          <Row label="Subtotal" value={rupiah(inv.subtotal)} />
          {Number(inv.discount) > 0 && <Row label="Diskon" value={`-${rupiah(inv.discount)}`} />}
          <Row label={`Pajak (${Number(inv.tax_rate)}%)`} value={rupiah(inv.tax_amount)} />
          <div className="flex justify-between border-y-2 border-zinc-900 py-1 text-base font-bold">
            <span>Total</span>
            <span className="tabular-nums">{rupiah(inv.total)}</span>
          </div>
          <PaidRows inv={inv} />
        </div>
      </div>

      {terms.trim() && (
        <div className="mt-6 text-[11px] leading-relaxed text-zinc-600">
          <p className="font-semibold uppercase tracking-wide">Syarat &amp; Ketentuan</p>
          <p className="mt-1 whitespace-pre-wrap wrap-break-word">{terms}</p>
        </div>
      )}

      <div className="mt-10 flex justify-center sm:justify-end">
        <div className="text-center text-sm">
          <p>Hormat kami,</p>
          <div className="mt-12 border-t border-zinc-900 px-6" />
          <p className="mt-1 font-semibold">{inv.outlet.name}</p>
        </div>
      </div>

      <PoweredBy />
    </div>
  );
}

/* ─────────────────────────────── Elegant ────────────────────────────── */
function ElegantInvoice({ inv, terms, c1, c2, totalBg }: { inv: Invoice; terms: string; c1: string; c2: string; totalBg: string }) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-white text-zinc-900 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.2)]">
      {/* Gradient header band (owner's 2 colors) */}
      <div className="relative px-8 py-7 text-white" style={{ backgroundImage: `linear-gradient(135deg, ${c1}, ${c2})` }}>
        <div className="absolute -right-6 -top-8 size-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoSrc(inv.outlet)} alt={inv.outlet.name} className="size-14 shrink-0 rounded-2xl bg-white/90 object-contain p-1" />
            <div>
              <h1 className="font-serif text-2xl font-bold tracking-tight">{inv.outlet.name}</h1>
              <p className="text-xs text-white/80">{inv.outlet.address}</p>
              <p className="text-xs text-white/80">
                {inv.outlet.phone}
                {inv.outlet.email ? ` · ${inv.outlet.email}` : ""}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-serif text-2xl italic">Invoice</p>
            <p className="font-mono text-xs">{inv.number}</p>
            {inv.status === "paid" && (
              <p className="mt-1 inline-block rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-bold uppercase backdrop-blur">
                Lunas
              </p>
            )}
            {inv.status === "partial" && (
              <p className="mt-1 inline-block rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-bold uppercase backdrop-blur">
                DP Diterima
              </p>
            )}
          </div>
        </div>
      </div>


      <div className="relative z-10 p-8">
        <div className="flex items-center justify-between text-xs">
          <div>
            <p style={{ color: c1 }}>Ditagihkan kepada</p>
            <p className="text-sm font-semibold">{inv.party_name || "—"}</p>
          </div>
          <div className="text-right text-zinc-500">
            <p>Tanggal: {tgl(inv.issue_date)}</p>
            <p>Jatuh tempo: {tgl(inv.due_date)}</p>
              {inv.created_by_name && (
                <p className="text-zinc-400">Dibuat oleh: {inv.created_by_name}</p>
              )}
          </div>
        </div>

        {/* Wrap in a scroll container so the full table is reachable on narrow screens. */}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest" style={{ color: c1 }}>
                <th className="border-b-2 py-2 font-semibold" style={{ borderColor: `${c1}44` }}>Item</th>
                <th className="border-b-2 py-2 text-right font-semibold" style={{ borderColor: `${c1}44` }}>Qty</th>
                <th className="border-b-2 py-2 text-right font-semibold" style={{ borderColor: `${c1}44` }}>Harga</th>
                <th className="border-b-2 py-2 text-right font-semibold" style={{ borderColor: `${c1}44` }}>Diskon</th>
                <th className="border-b-2 py-2 text-right font-semibold" style={{ borderColor: `${c1}44` }}>Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {inv.items.map((it) => (
                <tr key={it.id} className="border-b border-zinc-100">
                  <td className="py-2.5 pr-3">{it.description}</td>
                  <td className="py-2.5 text-right tabular-nums">{Number(it.quantity)}</td>
                  <td className="whitespace-nowrap py-2.5 pl-3 text-right tabular-nums">{rupiah(it.unit_price)}</td>
                  <td className="py-2.5 pl-3 text-right tabular-nums">{discLabel(it.discount_pct)}</td>
                  <td className="whitespace-nowrap py-2.5 pl-3 text-right font-medium tabular-nums">{rupiah(it.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex justify-end">
          <div className="w-full max-w-[260px] space-y-1.5 rounded-2xl p-4 text-sm" style={{ backgroundColor: totalBg }}>
            <Row label="Subtotal" value={rupiah(inv.subtotal)} muted />
            {Number(inv.discount) > 0 && <Row label="Diskon" value={`-${rupiah(inv.discount)}`} muted />}
            <Row label={`Pajak (${Number(inv.tax_rate)}%)`} value={rupiah(inv.tax_amount)} muted />
            <div className="mt-1 flex items-center justify-between border-t pt-2" style={{ borderColor: `${c1}44` }}>
              <span className="font-serif text-base font-bold">Total</span>
              <span
                className="text-lg font-black tabular-nums"
                style={{
                  backgroundImage: `linear-gradient(90deg, ${c1}, ${c2})`,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                {rupiah(inv.total)}
              </span>
            </div>
            <PaidRows inv={inv} />
          </div>
        </div>

        <Footer inv={inv} terms={terms} accent={c2} />
        <p className="mt-6 text-center font-serif text-sm italic" style={{ color: c2 }}>
          Terima kasih atas kepercayaan Anda ✨
        </p>
        <PoweredBy />
      </div>
    </div>
  );
}

/* A row of "=" characters, clipped to the container width — the ASCII divider
   dot-matrix/POS software used before printers could draw real rules. */
function AsciiLine() {
  return <p className="overflow-hidden whitespace-nowrap text-[10px] leading-none">{"=".repeat(80)}</p>;
}

/* ─────────────────────────────── Dot Matrix ─────────────────────────────
   Styled after continuous-form invoices run off 9/24-pin impact printers
   (the kind still wired into a lot of Indonesian toko back offices):
   monospace throughout, pure black-on-white (a ribbon can't do gradients
   or rounded corners), ASCII "====" rules instead of drawn lines, and a
   perforated tractor-feed edge down each side. */
function DotMatrixInvoice({ inv, terms }: { inv: Invoice; terms: string }) {
  return (
    <div className="relative border-2 border-black bg-white font-mono text-black">
      {/* Sprocket-hole strips evoking tractor-feed paper. Purely decorative —
          real continuous stationery has these perforated off before use. */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-3 bg-repeat-y"
        style={{ backgroundImage: "radial-gradient(circle, #00000030 2px, transparent 2.5px)", backgroundSize: "100% 18px" }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-3 bg-repeat-y"
        style={{ backgroundImage: "radial-gradient(circle, #00000030 2px, transparent 2.5px)", backgroundSize: "100% 18px" }}
      />

      <div className="px-6 py-6 sm:px-8">
        <div className="text-center">
          <h1 className="text-base font-bold uppercase tracking-[0.15em] sm:text-lg">{inv.outlet.name}</h1>
          <p className="text-[11px] uppercase tracking-wide">{inv.outlet.address}</p>
          <p className="text-[11px] uppercase tracking-wide">
            {inv.outlet.phone}
            {inv.outlet.email ? ` - ${inv.outlet.email}` : ""}
          </p>
        </div>

        <AsciiLine />
        <p className="text-center text-sm font-bold uppercase tracking-[0.3em]">*** Faktur Penjualan ***</p>
        <p className="text-center text-[10px] uppercase tracking-widest text-zinc-500">Lembar : Asli - Untuk Pelanggan</p>
        <AsciiLine />

        <div className="mt-3 flex flex-col gap-1 text-xs sm:flex-row sm:justify-between">
          <div>
            <p>Kepada Yth.</p>
            <p className="font-bold uppercase">{inv.party_name || "—"}</p>
          </div>
          <div className="sm:text-right">
            <p>No. Faktur : <span className="font-bold">{inv.number}</span></p>
            <p>Tanggal&nbsp;&nbsp;&nbsp; : {tgl(inv.issue_date)}</p>
            <p>Jth. Tempo : {tgl(inv.due_date)}</p>
            {inv.created_by_name && <p>Kasir&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; : {inv.created_by_name}</p>}
          </div>
        </div>

        {(inv.status === "paid" || inv.status === "partial") && (
          <p className="mt-2 text-center text-xs font-bold uppercase tracking-widest">
            {inv.status === "paid" ? "[ L U N A S ]" : "[ DP DITERIMA ]"}
          </p>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-[11px] sm:text-xs">
            <thead>
              <tr className="border-y-2 border-black uppercase">
                <th className="border-r border-dashed border-black px-1.5 py-1 text-left font-bold">Keterangan</th>
                <th className="border-r border-dashed border-black px-1.5 py-1 text-right font-bold">Qty</th>
                <th className="border-r border-dashed border-black px-1.5 py-1 text-right font-bold">Harga</th>
                <th className="border-r border-dashed border-black px-1.5 py-1 text-right font-bold">Disk</th>
                <th className="px-1.5 py-1 text-right font-bold">Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {inv.items.map((it) => (
                <tr key={it.id} className="border-b border-dotted border-black">
                  <td className="border-r border-dashed border-black px-1.5 py-1">{it.description}</td>
                  <td className="border-r border-dashed border-black px-1.5 py-1 text-right tabular-nums">{Number(it.quantity)}</td>
                  <td className="whitespace-nowrap border-r border-dashed border-black px-1.5 py-1 text-right tabular-nums">{rupiah(it.unit_price)}</td>
                  <td className="border-r border-dashed border-black px-1.5 py-1 text-right tabular-nums">{discLabel(it.discount_pct)}</td>
                  <td className="whitespace-nowrap px-1.5 py-1 text-right tabular-nums">{rupiah(it.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex justify-end">
          <div className="w-full space-y-1 text-xs sm:max-w-[260px]">
            <Row label="SUBTOTAL" value={rupiah(inv.subtotal)} />
            {Number(inv.discount) > 0 && <Row label="DISKON" value={`-${rupiah(inv.discount)}`} />}
            <Row label={`PAJAK (${Number(inv.tax_rate)}%)`} value={rupiah(inv.tax_amount)} />
            <div className="flex justify-between border-y-4 border-double border-black py-1 text-sm font-bold">
              <span>TOTAL</span>
              <span className="tabular-nums">{rupiah(inv.total)}</span>
            </div>
            <PaidRows inv={inv} />
          </div>
        </div>

        <Footer inv={inv} terms={terms} accent="#000000" />

        <div className="mt-10 flex justify-end">
          <div className="text-center text-xs">
            <p>Hormat kami,</p>
            <div className="mt-12 border-t border-black px-8" />
            <p className="mt-1 font-bold uppercase">{inv.outlet.name}</p>
          </div>
        </div>

        <AsciiLine />
        <p className="text-center text-[9px] uppercase tracking-widest text-zinc-400">
          Dicetak oleh sistem - sah tanpa tanda tangan basah
        </p>
      </div>
    </div>
  );
}

export function PrintClient() {
  const params = useParams();
  const id = params?.id as string;
  const [inv, setInv] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [terms, setTerms] = useState("");
  const [theme, setTheme] = useState<Theme>("modern");
  const [modernColor, setModernColor] = useState(DEFAULT_MODERN);
  const [c1, setC1] = useState(DEFAULT_C1);
  const [c2, setC2] = useState(DEFAULT_C2);
  const [totalBg, setTotalBg] = useState(DEFAULT_TOTAL_BG);

  useEffect(() => {
    setTerms(getSalesTerms());
    try {
      const t = localStorage.getItem(THEME_KEY) as Theme | null;
      if (t) setTheme(t);
      const m = localStorage.getItem(MODERN_COLOR_KEY);
      if (m) setModernColor(m);
      const a = localStorage.getItem(ELEGANT_C1_KEY);
      if (a) setC1(a);
      const b = localStorage.getItem(ELEGANT_C2_KEY);
      if (b) setC2(b);
      const t2 = localStorage.getItem(ELEGANT_TOTAL_BG_KEY);
      if (t2) setTotalBg(t2);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/sales-invoices/${id}`, { credentials: "include" });
        const json = await res.json();
        if (json.success) setInv(json.data);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const persist = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  };
  const chooseTheme = (t: Theme) => {
    setTheme(t);
    persist(THEME_KEY, t);
  };

  // Browsers use document.title as the default "Save as PDF" filename. Set it to
  // [date][customer] (falling back to the outlet name if no customer was entered),
  // then restore the original title once the print dialog closes.
  const handlePrint = () => {
    if (!inv) return;
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const name = (inv.party_name?.trim() || inv.outlet.name || "Faktur")
      .replace(/[\\/:*?"<>|\r\n]+/g, " ") // strip filesystem-unsafe chars
      .trim();
    const prev = document.title;
    const restore = () => {
      document.title = prev;
      window.removeEventListener("afterprint", restore);
    };
    document.title = `${date}-${name}`;
    window.addEventListener("afterprint", restore);
    window.print();
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (!inv) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Faktur tidak ditemukan.</div>;
  }

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #invoice-print, #invoice-print * { visibility: visible !important; }
          #invoice-print {
            position: absolute; left: 0; top: 0; width: 100%; padding: 0; border: 0;
          }
          /* print-color-adjust is NOT inherited — apply it to every element so
             backgrounds, gradients, and the gradient-clipped Total (background-clip:text)
             render in the PDF exactly like the on-screen preview. */
          #invoice-print, #invoice-print * {
            -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
          }
          #invoice-print img { display: block !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="mx-auto w-full max-w-2xl p-4 md:p-6">
        {/* Toolbar (not printed): theme + colors + print */}
        <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-2xl border bg-card p-1">
              {THEMES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => chooseTheme(t.key)}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${
                    theme === t.key ? "bg-teal-600 text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <t.icon className="size-3.5" />
                  {t.label}
                </button>
              ))}
            </div>

            {/* Modern: 1 color */}
            {theme === "modern" && (
              <label className="flex items-center gap-1.5 rounded-2xl border bg-card px-2.5 py-1.5 text-xs font-bold">
                <span className="text-muted-foreground">Warna</span>
                <input
                  type="color"
                  value={modernColor}
                  onChange={(e) => {
                    setModernColor(e.target.value);
                    persist(MODERN_COLOR_KEY, e.target.value);
                  }}
                  className="size-6 cursor-pointer rounded-md border-0 bg-transparent p-0"
                />
              </label>
            )}

            {/* Elegant: 2 colors */}
            {theme === "elegant" && (
              <div className="flex items-center gap-1.5 rounded-2xl border bg-card px-2.5 py-1.5 text-xs font-bold">
                <span className="text-muted-foreground">Gradasi</span>
                <input
                  type="color"
                  value={c1}
                  onChange={(e) => {
                    setC1(e.target.value);
                    persist(ELEGANT_C1_KEY, e.target.value);
                  }}
                  className="size-6 cursor-pointer rounded-md border-0 bg-transparent p-0"
                />
                <input
                  type="color"
                  value={c2}
                  onChange={(e) => {
                    setC2(e.target.value);
                    persist(ELEGANT_C2_KEY, e.target.value);
                  }}
                  className="size-6 cursor-pointer rounded-md border-0 bg-transparent p-0"
                />
              </div>
            )}

            {/* Elegant: solid background of the totals box */}
            {theme === "elegant" && (
              <label className="flex items-center gap-1.5 rounded-2xl border bg-card px-2.5 py-1.5 text-xs font-bold">
                <span className="text-muted-foreground">Total</span>
                <input
                  type="color"
                  value={totalBg}
                  onChange={(e) => {
                    setTotalBg(e.target.value);
                    persist(ELEGANT_TOTAL_BG_KEY, e.target.value);
                  }}
                  className="size-6 cursor-pointer rounded-md border-0 bg-transparent p-0"
                />
              </label>
            )}
          </div>

          {/* All output routes live behind one button: A4 and the two thermal
              transports side by side made the toolbar wrap into a wall. */}
          <Popover>
            <PopoverTrigger className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700">
              <Printer className="size-4" /> Cetak
              <ChevronDown className="size-3.5 opacity-80" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 gap-1">
              <button
                onClick={handlePrint}
                className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent"
              >
                <FileText className="mt-0.5 size-4 text-muted-foreground" />
                <span>
                  <span className="block text-sm font-medium">Cetak / Simpan PDF</span>
                  <span className="block text-[11px] text-muted-foreground">Ukuran A4, sesuai tema di atas</span>
                </span>
              </button>

              <div className="my-1 border-t" />

              {/* Thermal (58/80mm) output — its own layout, terms omitted. */}
              <ThermalPrintOptions inv={inv} />
            </PopoverContent>
          </Popover>
        </div>

        <div id="invoice-print">
          {theme === "classic" ? (
            <ClassicInvoice inv={inv} terms={terms} />
          ) : theme === "elegant" ? (
            <ElegantInvoice inv={inv} terms={terms} c1={c1} c2={c2} totalBg={totalBg} />
          ) : theme === "dotmatrix" ? (
            <DotMatrixInvoice inv={inv} terms={terms} />
          ) : (
            <ModernInvoice inv={inv} terms={terms} accent={modernColor} />
          )}
        </div>
      </div>
    </>
  );
}
