"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ShoppingBag, Plus, Trash2, Loader2, ArrowLeft, CheckCircle2, Wallet, Ban, Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/app/dashboard/reports/data-table";
import { API_URL } from "@/lib/api-url";
import { LocalDateTime } from "@/components/local-datetime";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  PaymentMethodPicker,
  PaymentMethodBadge,
  methodMeta,
  type PaymentMethod,
} from "../_components/payment-method";
import {
  getPurchaseColumns,
  type PurchaseRow,
  PURCHASE_STATUS_STYLE,
  PURCHASE_STATUS_LABEL,
} from "./columns";

type Supplier = { id: number; name: string };
type Product = { id: string; product_name: string; price: string; buying_price: string; unit: string };
type LineItem = {
  product_id: string;
  description: string;
  quantity: string;
  unit_price: string;
  // Percentage (0-100), mirrors invoiceItems.discount_pct — the only discount
  // shape the backend stores for a line. Reduces this line before the
  // invoice-level Rp discount and tax.
  discount_pct: string;
};
// `unit` is joined from the product, so it's null on product-less lines.
type DetailItem = {
  id: number;
  description: string;
  quantity: string;
  unit: string | null;
  unit_price: string;
  discount_pct: string;
  line_total: string;
};
type DetailInvoice = PurchaseRow & {
  subtotal: string;
  tax_rate: string;
  tax_amount: string;
  discount: string;
  down_payment: string;
  down_payment_method: PaymentMethod;
  notes: string | null;
  created_by_name?: string | null;
  items: DetailItem[];
  // One row per payment actually made (DP booked on post + installments).
  payments?: InvoicePayment[];
};
type InvoicePayment = {
  id: number;
  amount: string;
  method: PaymentMethod;
  created_at: string;
};

const rupiah = (v: number | string) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(
    Number(v) || 0,
  );

const emptyItem: LineItem = {
  product_id: "",
  description: "",
  quantity: "1",
  unit_price: "0",
  discount_pct: "0",
};

export function PurchaseClient() {
  const [view, setView] = useState<"list" | "create" | "detail">("list");
  const [invoices, setInvoices] = useState<PurchaseRow[]>([]);
  const [detail, setDetail] = useState<DetailInvoice | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [form, setForm] = useState({
    supplier_id: "",
    due_date: "",
    tax_rate: "0",
    // Invoice-level Rp discount, subtracted after the per-line discounts —
    // same shape and same order of operations as the sales invoice form.
    discount: "0",
    down_payment: "0",
    down_payment_method: "cash" as PaymentMethod,
    notes: "",
    items: [{ ...emptyItem }] as LineItem[],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Payment sheet: purchase settles the whole remaining balance in one go, so
  // the only thing to ask is how the money left the business.
  const [payTarget, setPayTarget] = useState<{ id: number; number: string; remaining: number } | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [paying, setPaying] = useState(false);

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/purchase-invoices`, { credentials: "include" });
      const json = await res.json();
      if (json.success) setInvoices(json.data);
    } finally {
      setLoading(false);
    }
  };

  const fetchFormData = async () => {
    const [sRes, pRes] = await Promise.all([
      fetch(`${API_URL}/api/suppliers`, { credentials: "include" }),
      fetch(`${API_URL}/api/products/mine`, { credentials: "include" }),
    ]);
    const sJson = await sRes.json();
    const pJson = await pRes.json();
    if (sJson.success) setSuppliers(sJson.data);
    setProducts(pJson.products ?? []);
  };

  useEffect(() => {
    fetchInvoices();
  }, []);

  const openCreate = async () => {
    setForm({
      supplier_id: "",
      due_date: "",
      tax_rate: "0",
      discount: "0",
      down_payment: "0",
      down_payment_method: "cash",
      notes: "",
      items: [{ ...emptyItem }],
    });
    setError("");
    await fetchFormData();
    setView("create");
  };

  // ----- line item helpers -----
  const setItem = (i: number, patch: Partial<LineItem>) =>
    setForm((f) => ({ ...f, items: f.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) }));
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, { ...emptyItem }] }));
  const removeItem = (i: number) =>
    setForm((f) => ({ ...f, items: f.items.length > 1 ? f.items.filter((_, idx) => idx !== i) : f.items }));
  const onPickProduct = (i: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    setItem(i, {
      product_id: productId,
      description: p?.product_name ?? "",
      unit_price: p ? p.buying_price || "0" : "0",
    });
  };
  // Clamped to 0-100 on the way in, same as the sales form: a discount can't
  // exceed the line, and the backend clamps again regardless.
  const setDiscPct = (i: number, raw: string) => {
    const cleaned = raw.replace(/[^\d.]/g, "");
    setItem(i, { discount_pct: cleaned === "" ? "" : String(Math.min(100, Math.max(0, Number(cleaned) || 0))) });
  };

  // ----- totals preview (mirrors backend computeTotals, non-inclusive) -----
  const totals = useMemo(() => {
    const lineTotals = form.items.map((it) => {
      const qty = Number(it.quantity || 0);
      const price = Number(it.unit_price || 0);
      const discPct = Math.min(100, Math.max(0, Number(it.discount_pct || 0)));
      return qty * price * (1 - discPct / 100);
    });
    const subtotal = lineTotals.reduce((s, v) => s + v, 0);
    const discount = Math.min(Number(form.discount || 0), subtotal);
    const base = Math.max(0, subtotal - discount);
    const taxAmount = (base * Number(form.tax_rate || 0)) / 100;
    return { subtotal, discount, taxAmount, total: base + taxAmount };
  }, [form.items, form.tax_rate, form.discount]);

  // DP clamped to [0, total] — mirrors the backend clamp so the preview matches.
  const dpAmount = Math.max(0, Math.min(Number(form.down_payment || 0), totals.total));

  const save = async () => {
    const items = form.items.filter((it) => Number(it.quantity) > 0);
    if (items.length === 0) {
      setError("Tambahkan minimal satu item dengan jumlah lebih dari 0.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/purchase-invoices`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: form.supplier_id ? Number(form.supplier_id) : null,
          due_date: form.due_date || null,
          tax_rate: Number(form.tax_rate || 0),
          discount: Number(form.discount || 0),
          down_payment: Number(form.down_payment || 0),
          down_payment_method: form.down_payment_method,
          notes: form.notes,
          items: items.map((it) => ({
            product_id: it.product_id || null,
            description: it.description,
            quantity: Number(it.quantity),
            unit_price: Number(it.unit_price),
            discount_pct: Number(it.discount_pct || 0),
          })),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || "Gagal menyimpan faktur.");
        return;
      }
      setView("list");
      await fetchInvoices();
    } catch {
      setError("Terjadi kesalahan jaringan.");
    } finally {
      setSaving(false);
    }
  };

  const submitPay = async () => {
    if (!payTarget) return;
    setPaying(true);
    try {
      await fetch(`${API_URL}/api/purchase-invoices/${payTarget.id}/pay`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: payMethod }),
      });
      const paidId = payTarget.id;
      setPayTarget(null);
      await fetchInvoices();
      if (view === "detail" && detail?.id === paidId) await openDetail(detail);
    } finally {
      setPaying(false);
    }
  };

  const action = async (id: number, kind: "post" | "pay" | "void") => {
    // Paying asks how the money left first; post/void have nothing to ask.
    if (kind === "pay") {
      const inv = invoices.find((i) => i.id === id) ?? (detail?.id === id ? detail : null);
      setPayTarget(
        inv
          ? {
              id,
              number: inv.number,
              remaining: Math.max(0, +(Number(inv.total) - Number(inv.amount_paid)).toFixed(2)),
            }
          : null,
      );
      setPayMethod("cash");
      return;
    }
    setBusyId(id);
    try {
      await fetch(`${API_URL}/api/purchase-invoices/${id}/${kind}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      await fetchInvoices();
      if (view === "detail" && detail?.id === id) await openDetail(detail);
    } finally {
      setBusyId(null);
    }
  };

  // Opens a read-only detail of one invoice. Takes the list row so the supplier
  // name (joined in the list query, not the detail one) carries over.
  const openDetail = async (row: PurchaseRow) => {
    setView("detail");
    setDetailLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/purchase-invoices/${row.id}`, { credentials: "include" });
      const json = await res.json();
      if (json.success) setDetail({ ...json.data, supplier_name: row.supplier_name });
    } finally {
      setDetailLoading(false);
    }
  };

  // ===================================================================== detail
  // Payment sheet — rendered in both the list and detail views so "Bayar" works
  // from either place.
  const paySheet = (
    <Sheet open={payTarget !== null} onOpenChange={(open) => !open && setPayTarget(null)}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Catat Pembayaran</SheetTitle>
          <SheetDescription>
            {payTarget && payTarget.remaining <= 0
              ? `Faktur ${payTarget.number} — tidak ada sisa tagihan.`
              : `Faktur ${payTarget?.number} — melunasi sisa tagihan ${payTarget ? rupiah(payTarget.remaining) : ""}.`}
          </SheetDescription>
        </SheetHeader>
        {payTarget && (
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {payTarget.remaining <= 0 ? (
              <p className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50 px-3 py-2 text-[13px] leading-relaxed text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-200">
                Tidak ada tagihan tersisa — faktur ini akan langsung ditandai{" "}
                <span className="font-semibold">Lunas</span>, tanpa mencatat kas keluar.
              </p>
            ) : (
              <>
                <PaymentMethodPicker value={payMethod} onChange={setPayMethod} />
                <p className="text-[11px] text-muted-foreground">
                  Selain tunai, pembayaran dicatat sebagai transaksi non-tunai di arus kas.
                </p>
              </>
            )}
          </div>
        )}
        <SheetFooter className="border-t">
          <Button
            onClick={submitPay}
            disabled={paying}
            className="w-full bg-green-600 text-white hover:bg-green-700"
          >
            {paying && <Loader2 className="size-4 animate-spin" />}
            {payTarget && payTarget.remaining <= 0 ? "Tandai Lunas" : "Catat Pembayaran"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );

  if (view === "detail") {
    return (
      <div className="p-4 md:p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              setDetail(null);
              setView("list");
            }}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">Detail Faktur Pembelian</h1>
        </div>

        {detailLoading || !detail ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-5">
            <div className="flex items-start justify-between rounded-xl border bg-card p-4">
              <div className="space-y-0.5">
                <p className="font-mono text-sm font-semibold">{detail.number}</p>
                <p className="text-xs text-muted-foreground">
                  Supplier: {detail.supplier_name || detail.party_name || "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Jatuh tempo:{" "}
                  {detail.due_date ? new Date(detail.due_date).toLocaleDateString("id-ID") : "—"}
                </p>
                {detail.created_by_name && (
                  <p className="text-xs text-muted-foreground">Dibuat oleh: {detail.created_by_name}</p>
                )}
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PURCHASE_STATUS_STYLE[detail.status]}`}
              >
                {PURCHASE_STATUS_LABEL[detail.status]}
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 font-medium">UoM</th>
                    <th className="px-3 py-2 text-right font-medium">Harga</th>
                    <th className="px-3 py-2 text-right font-medium">Diskon</th>
                    <th className="px-3 py-2 text-right font-medium">Jumlah</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((it) => (
                    <tr key={it.id} className="border-b last:border-0">
                      <td className="px-3 py-2">{it.description}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(it.quantity)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{it.unit || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{rupiah(it.unit_price)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {Number(it.discount_pct) > 0 ? `${Number(it.discount_pct)}%` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{rupiah(it.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums">{rupiah(detail.subtotal)}</span>
              </div>
              {Number(detail.discount) > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Diskon</span>
                  <span className="tabular-nums">-{rupiah(detail.discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-muted-foreground">
                <span>Pajak ({Number(detail.tax_rate)}%)</span>
                <span className="tabular-nums">{rupiah(detail.tax_amount)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{rupiah(detail.total)}</span>
              </div>
              {/* Draft: the DP is only agreed, not yet booked as cash-out — show
                  it plus the outstanding balance so the owner knows what's due. */}
              {detail.status === "draft" && Number(detail.down_payment) > 0 && (
                <>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Uang Muka (DP)</span>
                    <span className="tabular-nums">-{rupiah(detail.down_payment)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-amber-600 dark:text-amber-400">
                    <span>Sisa Tagihan</span>
                    <span className="tabular-nums">
                      {rupiah(Math.max(0, Number(detail.total) - Number(detail.down_payment)))}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    DP dicatat sebagai kas keluar ({methodMeta(detail.down_payment_method).label}) saat
                    faktur diposting.
                  </p>
                </>
              )}
              {/* Posted onward: DP is folded into amount_paid. Break it out as its
                  own line, then show any payment beyond the DP. */}
              {detail.status !== "draft" && Number(detail.down_payment) > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Uang Muka (DP)</span>
                  <span className="tabular-nums">-{rupiah(detail.down_payment)}</span>
                </div>
              )}
              {Number(detail.amount_paid) - Number(detail.down_payment) > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Dibayar</span>
                  <span className="tabular-nums">
                    -{rupiah(Number(detail.amount_paid) - Number(detail.down_payment))}
                  </span>
                </div>
              )}
              {Number(detail.amount_paid) > 0 && Number(detail.total) - Number(detail.amount_paid) > 0 && (
                <div className="flex justify-between font-semibold text-amber-600 dark:text-amber-400">
                  <span>Sisa Tagihan</span>
                  <span className="tabular-nums">
                    {rupiah(Number(detail.total) - Number(detail.amount_paid))}
                  </span>
                </div>
              )}
            </div>

            {(detail.payments?.length ?? 0) > 0 && (
              <div className="rounded-2xl border bg-muted/20 p-4">
                <h3 className="text-sm font-semibold">Riwayat Pembayaran</h3>
                <ul className="mt-2 divide-y">
                  {detail.payments!.map((pmt, i) => (
                    <li key={pmt.id} className="flex items-center gap-2 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {i === 0 && Number(detail.down_payment) > 0 ? "Uang Muka (DP)" : `Pembayaran ${i + 1}`}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          <LocalDateTime value={pmt.created_at} />
                        </p>
                      </div>
                      <PaymentMethodBadge method={pmt.method} />
                      <span className="w-28 shrink-0 text-right font-semibold tabular-nums">
                        {rupiah(pmt.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              {busyId === detail.id ? (
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              ) : (
                <>
                  {detail.status === "draft" && (
                    <Button variant="outline" onClick={() => action(detail.id, "post")}>
                      <CheckCircle2 className="size-4" /> Posting
                    </Button>
                  )}
                  {(detail.status === "posted" || detail.status === "partial") && (
                    <Button
                      className="bg-green-600 text-white hover:bg-green-700"
                      onClick={() => action(detail.id, "pay")}
                    >
                      <Wallet className="size-4" /> Bayar
                    </Button>
                  )}
                  {detail.status !== "void" && (
                    <a
                      href={`/dashboard/invoice/purchase/${detail.id}/print`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="outline">
                        <Printer className="size-4" /> Cetak / PDF
                      </Button>
                    </a>
                  )}
                  {detail.status !== "void" && (
                    <Button
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => action(detail.id, "void")}
                    >
                      <Ban className="size-4" /> Batalkan
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
        {paySheet}
      </div>
    );
  }

  // ===================================================================== create
  if (view === "create") {
    return (
      <div className="p-4 md:p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={() => setView("list")}>
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">Faktur Pembelian Baru</h1>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
            Supplier
            <select
              value={form.supplier_id}
              onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}
              className="h-8 w-full rounded-md border bg-background px-2 text-sm text-foreground"
            >
              <option value="">— Pilih supplier —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
            Jatuh tempo
            <Input
              type="date"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />
          </label>
          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
            Pajak (%)
            <Input
              type="number"
              value={form.tax_rate}
              onChange={(e) => setForm({ ...form, tax_rate: e.target.value })}
            />
          </label>
        </div>

        <div className="overflow-x-auto rounded-xl border">
          <div className="flex min-w-180 items-center gap-2 border-b px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <div className="min-w-0 flex-1">Produk</div>
            <div className="w-12">UoM</div>
            <div className="w-20 text-right">Qty</div>
            <div className="w-28 text-right">Harga</div>
            <div className="w-16 text-right">Disk. %</div>
            <div className="w-28 text-right">Subtotal</div>
            <div className="w-8" />
          </div>
          {form.items.map((it, i) => {
            const discPct = Math.min(100, Math.max(0, Number(it.discount_pct || 0)));
            const lineTotal = Number(it.quantity || 0) * Number(it.unit_price || 0) * (1 - discPct / 100);
            return (
              <div key={i} className="flex min-w-180 items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <ProductAutocomplete
                    products={products}
                    value={it.product_id}
                    onSelect={(id) => onPickProduct(i, id)}
                  />
                </div>
                {/* Read-only: the unit belongs to the product, so picking the
                    product is what sets it. Blank until one is chosen. */}
                <div className="w-12 truncate text-sm text-muted-foreground">
                  {products.find((p) => p.id === it.product_id)?.unit || "—"}
                </div>
                <Input
                  className="w-20 text-right"
                  type="number"
                  value={it.quantity}
                  onChange={(e) => setItem(i, { quantity: e.target.value })}
                />
                <Input
                  className="w-28 text-right"
                  type="number"
                  value={it.unit_price}
                  onChange={(e) => setItem(i, { unit_price: e.target.value })}
                />
                <Input
                  className="w-16 text-right"
                  inputMode="numeric"
                  placeholder="0"
                  value={it.discount_pct}
                  onChange={(e) => setDiscPct(i, e.target.value)}
                />
                <div className="w-28 text-right text-sm tabular-nums">{rupiah(lineTotal)}</div>
                <div className="w-8 text-right">
                  <Button variant="ghost" size="icon-sm" onClick={() => removeItem(i)}>
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}
          <div className="px-3 py-2">
            <Button variant="outline" size="sm" onClick={addItem}>
              <Plus className="size-3.5" /> Tambah Item
            </Button>
          </div>
        </div>

        <div className="ml-auto w-full max-w-xs space-y-3">
          <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
            <span>Diskon Faktur (Rp)</span>
            <Input
              type="number"
              value={form.discount}
              onChange={(e) => setForm({ ...form, discount: e.target.value })}
            />
            <span className="text-[10px] text-muted-foreground">
              Diskon keseluruhan dari supplier, di luar diskon per-item.
            </span>
          </label>
          <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Wallet className="size-3.5" /> Uang Muka / DP (Rp)
            </span>
            <Input
              type="number"
              value={form.down_payment}
              onChange={(e) => setForm({ ...form, down_payment: e.target.value })}
            />
            <span className="text-[10px] text-muted-foreground">
              Dicatat otomatis sebagai kas keluar pertama saat faktur diposting.
            </span>
          </label>
          {dpAmount > 0 && (
            <PaymentMethodPicker
              value={form.down_payment_method}
              onChange={(v) => setForm({ ...form, down_payment_method: v })}
              label="Metode Pembayaran DP"
            />
          )}

          <div className="space-y-1 text-sm">
            <Row label="Subtotal" value={rupiah(totals.subtotal)} />
            {totals.discount > 0 && <Row label="Diskon" value={`-${rupiah(totals.discount)}`} />}
            <Row label={`Pajak (${form.tax_rate || 0}%)`} value={rupiah(totals.taxAmount)} />
            <Row label="Total" value={rupiah(totals.total)} bold />
            {dpAmount > 0 && (
              <>
                <Row label="Uang Muka (DP)" value={`-${rupiah(dpAmount)}`} />
                <Row label="Sisa" value={rupiah(totals.total - dpAmount)} bold />
              </>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setView("list")} disabled={saving}>
            Batal
          </Button>
          <Button onClick={save} disabled={saving} className="bg-teal-600 text-white hover:bg-teal-700">
            {saving && <Loader2 className="size-4 animate-spin" />}
            Simpan sebagai Draft
          </Button>
        </div>
      </div>
    );
  }

  // ======================================================================= list
  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <ShoppingBag className="size-5 text-teal-600 dark:text-teal-400" />
            Faktur Pembelian
          </h1>
          <p className="text-sm text-muted-foreground">
            Draft → Posting (stok bertambah) → Bayar (kas keluar tercatat).
          </p>
        </div>
        <Button onClick={openCreate} className="bg-teal-600 text-white hover:bg-teal-700">
          <Plus className="size-4" />
          Buat Faktur Pembelian
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : invoices.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 px-6 py-16 text-center">
          <ShoppingBag className="size-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">Belum ada faktur pembelian</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Buat faktur pembelian pertama untuk mulai mencatat pembelian stok dari supplier.
          </p>
        </div>
      ) : (
        <DataTable
          columns={getPurchaseColumns({ busyId, onAction: action })}
          data={invoices.slice((page - 1) * limit, page * limit)}
          page={page}
          limit={limit}
          count={invoices.length}
          setPage={setPage}
          setLimit={setLimit}
          onRowClick={(row) => openDetail(row)}
        />
      )}
      {paySheet}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "border-t pt-1 font-semibold" : "text-muted-foreground"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

// A type-to-filter product field, replacing what used to be a plain <select>.
// A native dropdown makes an owner scroll a flat, unsorted list of everything
// in the catalogue to find one item; this narrows as they type and still
// degrades to "browse everything" when the field is empty.
function ProductAutocomplete({
  products,
  value,
  onSelect,
}: {
  products: Product[];
  value: string;
  onSelect: (productId: string) => void;
}) {
  const selected = products.find((p) => p.id === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Rendered through a portal (below), so its own z-index can't help it escape
  // an ancestor's clip — the row list scrolls horizontally in a box with
  // overflow-x-auto, and per the CSS spec that silently forces overflow-y to
  // 'auto' too, so a plain absolutely-positioned dropdown got cut off at the
  // table's border no matter how high z went. Tracking the input's own
  // viewport rect and painting the list at document.body sidesteps both the
  // clipping and any stacking-context ceiling from an ancestor.
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  // What's actually shown in the field: the typed filter while open, the
  // selected product's name while closed. Never both at once — reopening
  // starts from blank so retyping doesn't fight the old query.
  const displayValue = open ? query : selected?.product_name ?? "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? products.filter((p) => p.product_name.toLowerCase().includes(q)) : products;
    return list.slice(0, 30); // enough to scroll, not enough to jank on a big catalogue
  }, [products, query]);

  // Reset the highlighted row wherever the list can change out from under it —
  // set directly at each call site instead of syncing via an effect, since
  // there is no external system here to synchronize with.
  const retarget = (next: string) => {
    setQuery(next);
    setActiveIndex(0);
  };

  const measure = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left, width: r.width });
  };

  // The portal is an external system relative to this component (a DOM node
  // outside React's tree, positioned from the live layout) — an effect
  // syncing to it while open is exactly what effects are for, unlike the
  // in-tree state reset above.
  useEffect(() => {
    if (!open) return;
    measure();
    // Capture phase so this also catches the row list's own horizontal
    // scroll, not just the window's.
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  const pick = (p: Product) => {
    onSelect(p.id);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={displayValue}
          placeholder="Cari produk…"
          onFocus={() => {
            setOpen(true);
            retarget("");
          }}
          onChange={(e) => {
            retarget(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (filtered[activeIndex]) pick(filtered[activeIndex]);
            } else if (e.key === "Escape") {
              setOpen(false);
              setQuery("");
              inputRef.current?.blur();
            }
          }}
          onBlur={() => setOpen(false)}
          className="h-8 w-full pl-7 text-sm"
        />
      </div>
      {open &&
        rect &&
        createPortal(
          <div
            style={{ position: "fixed", top: rect.top, left: rect.left, width: Math.max(rect.width, 224) }}
            className="z-50 max-h-56 overflow-y-auto rounded-md border bg-popover shadow-md"
          >
            {filtered.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-muted-foreground">Tidak ada produk cocok.</div>
            ) : (
              filtered.map((p, idx) => (
                <button
                  type="button"
                  key={p.id}
                  // preventDefault keeps focus on the input, so this fires
                  // instead of the blur above swallowing the click.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(p)}
                  className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm transition-colors ${
                    idx === activeIndex ? "bg-muted" : "hover:bg-muted/60"
                  } ${p.id === value ? "font-semibold" : ""}`}
                >
                  <span className="truncate">{p.product_name}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{p.unit}</span>
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
