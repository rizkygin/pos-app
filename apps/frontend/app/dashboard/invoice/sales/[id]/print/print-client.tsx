"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Printer, Loader2, Sparkles, Layout, ScrollText } from "lucide-react";
import { API_URL } from "@/lib/api-url";
import { resolveOutletImage } from "@/lib/image-src";
import { getSalesTerms } from "@/lib/invoice-terms";

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
  notes: string | null;
  items: Item[];
  outlet: Outlet;
};

type Theme = "modern" | "classic" | "elegant";
const THEME_KEY = "pos_invoice_theme";
const MODERN_COLOR_KEY = "pos_invoice_modern_color";
const ELEGANT_C1_KEY = "pos_invoice_elegant_c1";
const ELEGANT_C2_KEY = "pos_invoice_elegant_c2";
const DEFAULT_MODERN = "#0d9488"; // teal-600
const DEFAULT_C1 = "#f43f5e"; // rose-500
const DEFAULT_C2 = "#4f46e5"; // indigo-600

const THEMES: { key: Theme; label: string; icon: typeof Layout }[] = [
  { key: "modern", label: "Modern", icon: Layout },
  { key: "classic", label: "Klasik", icon: ScrollText },
  { key: "elegant", label: "Elegan", icon: Sparkles },
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

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-zinc-500" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
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

        <table className="mt-6 w-full text-sm">
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
                <td className="px-3 py-2.5 text-right tabular-nums">{rupiah(it.unit_price)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{discLabel(it.discount_pct)}</td>
                <td className="px-3 py-2.5 text-right font-medium tabular-nums">{rupiah(it.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

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
            {Number(inv.amount_paid) > 0 && Number(inv.amount_paid) < Number(inv.total) && (
              <Row label="Dibayar" value={rupiah(inv.amount_paid)} muted />
            )}
          </div>
        </div>

        <Footer inv={inv} terms={terms} accent={accent} />
      </div>
    </div>
  );
}

/* ─────────────────────────────── Classic (unchanged) ────────────────── */
function ClassicInvoice({ inv, terms }: { inv: Invoice; terms: string }) {
  return (
    <div className="border-[3px] border-double border-zinc-900 bg-white p-6 font-serif text-zinc-900 md:p-8">
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc(inv.outlet)} alt={inv.outlet.name} className="mx-auto size-14 object-contain" />
        <h1 className="mt-2 text-2xl font-bold uppercase tracking-[0.2em]">{inv.outlet.name}</h1>
        <p className="text-xs text-zinc-600">{inv.outlet.address}</p>
        <p className="text-xs text-zinc-600">
          {inv.outlet.phone}
          {inv.outlet.email ? ` · ${inv.outlet.email}` : ""}
        </p>
      </div>

      <div className="my-4 border-t-2 border-zinc-900" />
      <p className="text-center text-sm font-bold uppercase tracking-[0.35em]">Faktur Penjualan</p>

      <div className="mt-5 flex justify-between text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Kepada</p>
          <p className="font-semibold">{inv.party_name || "—"}</p>
        </div>
        <div className="text-right">
          <p>No: <span className="font-semibold">{inv.number}</span></p>
          <p>Tanggal: {tgl(inv.issue_date)}</p>
          <p>Jatuh tempo: {tgl(inv.due_date)}</p>
          {inv.status === "paid" && <p className="mt-1 font-bold uppercase text-zinc-900">— Lunas —</p>}
        </div>
      </div>

      <table className="mt-5 w-full border-collapse text-sm">
        <thead>
          <tr className="border-y-2 border-zinc-900 text-left uppercase">
            <th className="px-2 py-2 font-semibold">Keterangan</th>
            <th className="px-2 py-2 text-right font-semibold">Qty</th>
            <th className="px-2 py-2 text-right font-semibold">Harga</th>
            <th className="px-2 py-2 text-right font-semibold">Diskon</th>
            <th className="px-2 py-2 text-right font-semibold">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {inv.items.map((it) => (
            <tr key={it.id} className="border-b border-zinc-300">
              <td className="px-2 py-2">{it.description}</td>
              <td className="px-2 py-2 text-right tabular-nums">{Number(it.quantity)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{rupiah(it.unit_price)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{discLabel(it.discount_pct)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{rupiah(it.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex justify-end">
        <div className="w-full max-w-[240px] space-y-1 text-sm">
          <Row label="Subtotal" value={rupiah(inv.subtotal)} />
          {Number(inv.discount) > 0 && <Row label="Diskon" value={`-${rupiah(inv.discount)}`} />}
          <Row label={`Pajak (${Number(inv.tax_rate)}%)`} value={rupiah(inv.tax_amount)} />
          <div className="flex justify-between border-y-2 border-zinc-900 py-1 text-base font-bold">
            <span>Total</span>
            <span className="tabular-nums">{rupiah(inv.total)}</span>
          </div>
        </div>
      </div>

      {terms.trim() && (
        <div className="mt-6 text-[11px] leading-relaxed text-zinc-600">
          <p className="font-semibold uppercase tracking-wide">Syarat &amp; Ketentuan</p>
          <p className="mt-1 whitespace-pre-wrap">{terms}</p>
        </div>
      )}

      <div className="mt-10 flex justify-end">
        <div className="text-center text-sm">
          <p>Hormat kami,</p>
          <div className="mt-12 border-t border-zinc-900 px-6" />
          <p className="mt-1 font-semibold">{inv.outlet.name}</p>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── Elegant ────────────────────────────── */
function ElegantInvoice({ inv, terms, c1, c2 }: { inv: Invoice; terms: string; c1: string; c2: string }) {
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
          </div>
        </div>

        <table className="mt-6 w-full text-sm">
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
                <td className="py-2.5">{it.description}</td>
                <td className="py-2.5 text-right tabular-nums">{Number(it.quantity)}</td>
                <td className="py-2.5 text-right tabular-nums">{rupiah(it.unit_price)}</td>
                <td className="py-2.5 text-right tabular-nums">{discLabel(it.discount_pct)}</td>
                <td className="py-2.5 text-right font-medium tabular-nums">{rupiah(it.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 flex justify-end">
          <div className="w-full max-w-[260px] space-y-1.5 rounded-2xl p-4 text-sm" style={{ backgroundImage: `linear-gradient(135deg, ${c1}14, ${c2}14)` }}>
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
          </div>
        </div>

        <Footer inv={inv} terms={terms} accent={c2} />
        <p className="mt-6 text-center font-serif text-sm italic" style={{ color: c2 }}>
          Terima kasih atas kepercayaan Anda ✨
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
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }
          #invoice-print img { display: block !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="mx-auto max-w-2xl p-4 md:p-6">
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
          </div>

          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
          >
            <Printer className="size-4" /> Cetak / Simpan PDF
          </button>
        </div>

        <div id="invoice-print">
          {theme === "classic" ? (
            <ClassicInvoice inv={inv} terms={terms} />
          ) : theme === "elegant" ? (
            <ElegantInvoice inv={inv} terms={terms} c1={c1} c2={c2} />
          ) : (
            <ModernInvoice inv={inv} terms={terms} accent={modernColor} />
          )}
        </div>
      </div>
    </>
  );
}
