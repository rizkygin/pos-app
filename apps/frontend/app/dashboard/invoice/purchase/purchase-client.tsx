"use client";

import { useEffect, useMemo, useState } from "react";
import { ShoppingBag, Plus, Trash2, Loader2, ArrowLeft, CheckCircle2, Wallet, Ban, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/app/dashboard/reports/data-table";
import { API_URL } from "@/lib/api-url";
import {
  getPurchaseColumns,
  type PurchaseRow,
  PURCHASE_STATUS_STYLE,
  PURCHASE_STATUS_LABEL,
} from "./columns";

type Supplier = { id: number; name: string };
type Product = { id: string; product_name: string; price: string; buying_price: string };
type LineItem = { product_id: string; description: string; quantity: string; unit_price: string };
type DetailItem = { id: number; description: string; quantity: string; unit_price: string; line_total: string };
type DetailInvoice = PurchaseRow & {
  subtotal: string;
  tax_rate: string;
  tax_amount: string;
  discount: string;
  down_payment: string;
  notes: string | null;
  items: DetailItem[];
};

const rupiah = (v: number | string) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(
    Number(v) || 0,
  );

const emptyItem: LineItem = { product_id: "", description: "", quantity: "1", unit_price: "0" };

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
    down_payment: "0",
    notes: "",
    items: [{ ...emptyItem }] as LineItem[],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
    setForm({ supplier_id: "", due_date: "", tax_rate: "0", down_payment: "0", notes: "", items: [{ ...emptyItem }] });
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

  // ----- totals preview (mirrors backend computeTotals, non-inclusive) -----
  const totals = useMemo(() => {
    const subtotal = form.items.reduce(
      (s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0),
      0,
    );
    const taxAmount = (subtotal * Number(form.tax_rate || 0)) / 100;
    return { subtotal, taxAmount, total: subtotal + taxAmount };
  }, [form.items, form.tax_rate]);

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
          down_payment: Number(form.down_payment || 0),
          notes: form.notes,
          items: items.map((it) => ({
            product_id: it.product_id || null,
            description: it.description,
            quantity: Number(it.quantity),
            unit_price: Number(it.unit_price),
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

  const action = async (id: number, kind: "post" | "pay" | "void") => {
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
                    <th className="px-3 py-2 text-right font-medium">Harga</th>
                    <th className="px-3 py-2 text-right font-medium">Jumlah</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((it) => (
                    <tr key={it.id} className="border-b last:border-0">
                      <td className="px-3 py-2">{it.description}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(it.quantity)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{rupiah(it.unit_price)}</td>
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
                    DP dicatat sebagai kas keluar saat faktur diposting.
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

        <div className="rounded-xl border">
          <div className="grid grid-cols-12 gap-2 border-b px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <div className="col-span-5">Produk</div>
            <div className="col-span-2 text-right">Qty</div>
            <div className="col-span-2 text-right">Harga</div>
            <div className="col-span-2 text-right">Subtotal</div>
            <div className="col-span-1" />
          </div>
          {form.items.map((it, i) => (
            <div key={i} className="grid grid-cols-12 items-center gap-2 px-3 py-2">
              <div className="col-span-5">
                <select
                  value={it.product_id}
                  onChange={(e) => onPickProduct(i, e.target.value)}
                  className="h-8 w-full rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">— Pilih produk —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.product_name}
                    </option>
                  ))}
                </select>
              </div>
              <Input
                className="col-span-2 text-right"
                type="number"
                value={it.quantity}
                onChange={(e) => setItem(i, { quantity: e.target.value })}
              />
              <Input
                className="col-span-2 text-right"
                type="number"
                value={it.unit_price}
                onChange={(e) => setItem(i, { unit_price: e.target.value })}
              />
              <div className="col-span-2 text-right text-sm tabular-nums">
                {rupiah(Number(it.quantity || 0) * Number(it.unit_price || 0))}
              </div>
              <div className="col-span-1 text-right">
                <Button variant="ghost" size="icon-sm" onClick={() => removeItem(i)}>
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
          <div className="px-3 py-2">
            <Button variant="outline" size="sm" onClick={addItem}>
              <Plus className="size-3.5" /> Tambah Item
            </Button>
          </div>
        </div>

        <div className="ml-auto w-full max-w-xs space-y-3">
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

          <div className="space-y-1 text-sm">
            <Row label="Subtotal" value={rupiah(totals.subtotal)} />
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
