"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Printer, Loader2 } from "lucide-react";
import { API_URL } from "@/lib/api-url";
import { resolveOutletImage } from "@/lib/image-src";

type Item = { id: number; description: string; quantity: string; unit_price: string; line_total: string };
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

const rupiah = (v: number | string) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(
    Number(v) || 0,
  );
const tgl = (d: string | null) => (d ? new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }) : "—");

export function PrintClient() {
  const params = useParams();
  const id = params?.id as string;
  const [inv, setInv] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);

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
      {/* Print isolation: only #invoice-print is visible when printing. */}
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
        <div className="no-print mb-4 flex justify-end">
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
          >
            <Printer className="size-4" /> Cetak / Simpan PDF
          </button>
        </div>

        <div id="invoice-print" className="rounded-xl border bg-white p-6 text-zinc-900 md:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={
                  inv.outlet.avatar && inv.outlet.avatar !== "avatar.png"
                    ? resolveOutletImage(inv.outlet.avatar)
                    : "/icons/icon-192x192.png"
                }
                alt={inv.outlet.name}
                className="size-14 shrink-0 rounded-lg border border-zinc-200 object-contain"
              />
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
              <p className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Faktur</p>
              <p className="font-mono text-sm font-bold">{inv.number}</p>
              {inv.status === "paid" && (
                <p className="mt-1 inline-block rounded border border-green-500 px-2 py-0.5 text-[11px] font-bold uppercase text-green-600">
                  Lunas
                </p>
              )}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 text-xs">
            <div>
              <p className="text-zinc-400">Ditagihkan kepada</p>
              <p className="font-medium">{inv.party_name || "—"}</p>
            </div>
            <div className="text-right">
              <p className="text-zinc-400">Tanggal: {tgl(inv.issue_date)}</p>
              <p className="text-zinc-400">Jatuh tempo: {tgl(inv.due_date)}</p>
            </div>
          </div>

          <table className="mt-6 w-full text-sm">
            <thead>
              <tr className="border-y text-left text-[11px] uppercase tracking-wide text-zinc-400">
                <th className="py-2 font-medium">Item</th>
                <th className="py-2 text-right font-medium">Qty</th>
                <th className="py-2 text-right font-medium">Harga</th>
                <th className="py-2 text-right font-medium">Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {inv.items.map((it) => (
                <tr key={it.id} className="border-b">
                  <td className="py-2">{it.description}</td>
                  <td className="py-2 text-right tabular-nums">{Number(it.quantity)}</td>
                  <td className="py-2 text-right tabular-nums">{rupiah(it.unit_price)}</td>
                  <td className="py-2 text-right tabular-nums">{rupiah(it.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 ml-auto w-full max-w-[220px] space-y-1 text-sm">
            <div className="flex justify-between text-zinc-500">
              <span>Subtotal</span>
              <span className="tabular-nums">{rupiah(inv.subtotal)}</span>
            </div>
            {Number(inv.discount) > 0 && (
              <div className="flex justify-between text-zinc-500">
                <span>Diskon</span>
                <span className="tabular-nums">-{rupiah(inv.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-zinc-500">
              <span>Pajak ({Number(inv.tax_rate)}%)</span>
              <span className="tabular-nums">{rupiah(inv.tax_amount)}</span>
            </div>
            <div className="flex justify-between border-t pt-1 text-base font-bold">
              <span>Total</span>
              <span className="tabular-nums">{rupiah(inv.total)}</span>
            </div>
            {Number(inv.amount_paid) > 0 && Number(inv.amount_paid) < Number(inv.total) && (
              <div className="flex justify-between text-zinc-500">
                <span>Dibayar</span>
                <span className="tabular-nums">{rupiah(inv.amount_paid)}</span>
              </div>
            )}
          </div>

          {inv.notes && <p className="mt-6 text-xs text-zinc-500">Catatan: {inv.notes}</p>}
          <p className="mt-8 text-center text-[11px] text-zinc-400">Terima kasih atas pesanan Anda.</p>
        </div>
      </div>
    </>
  );
}
