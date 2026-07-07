"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  Receipt,
  Plus,
  Minus,
  Trash2,
  Loader2,
  ArrowLeft,
  CheckCircle2,
  Wallet,
  Ban,
  Printer,
  Pencil,
  Search,
  ImageIcon,
  SlidersHorizontal,
  User,
  CalendarDays,
  Percent,
  Tag,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import { DataTable } from "@/app/dashboard/reports/data-table";
import { API_URL } from "@/lib/api-url";
import { resolveProductImage, isBackendImage } from "@/lib/image-src";
import { formatNumberInput, parseNumberInput } from "@/lib/utils/format";
import { getSalesTerms, setSalesTerms } from "@/lib/invoice-terms";
import {
  getSalesColumns,
  type SalesRow,
  SALES_STATUS_STYLE,
  SALES_STATUS_LABEL,
  isLateInvoice,
  lateDays,
} from "./columns";

type Product = { id: string; product_name: string; price: string; image: string; is_for_sale: boolean };
type CartItem = { product: Product; quantity: number; unit_price: string; discount_pct: string };
type DetailItem = {
  id: number;
  product_id: string | null;
  description: string;
  quantity: string;
  unit_price: string;
  discount_pct: string;
  line_total: string;
};
type DetailInvoice = SalesRow & {
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

export function SalesClient() {
  const [view, setView] = useState<"list" | "create" | "detail">("list");
  const [invoices, setInvoices] = useState<SalesRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  // Filter the list down to overdue invoices (past due date, not settled).
  const [showLateOnly, setShowLateOnly] = useState(false);
  // Free-text list filter: matches invoice number or customer name. The list
  // is paginated/filtered server-side; the raw input is debounced before it
  // becomes a query param so we don't refetch on every keystroke.
  const [listSearch, setListSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(listSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [listSearch]);
  // Server-computed totals: rows matching the current filters, and the
  // outlet-wide overdue aggregates for the warning banner.
  const [totalCount, setTotalCount] = useState(0);
  const [lateCount, setLateCount] = useState(0);
  const [lateOutstanding, setLateOutstanding] = useState(0);
  const [detail, setDetail] = useState<DetailInvoice | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Payment sheet: which invoice is being paid + the entered amount. Supports
  // down payment (uang muka) — any amount up to the remaining balance.
  const [payTarget, setPayTarget] = useState<{ id: number; number: string; total: number; paid: number } | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");

  // When set, the create view is in "edit" mode for this draft invoice id.
  const [editId, setEditId] = useState<number | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [party, setParty] = useState("");
  const [taxRate, setTaxRate] = useState("0");
  const [discount, setDiscount] = useState("0");
  // Uang muka (DP) agreed on the draft; booked as the first payment on post.
  const [downPayment, setDownPayment] = useState("0");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Standing Terms & Conditions — persisted per-device (localStorage), not in DB.
  const [terms, setTerms] = useState("");
  useEffect(() => {
    setTerms(getSalesTerms());
  }, []);

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (showLateOnly) params.set("late", "1");
      const res = await fetch(`${API_URL}/api/sales-invoices?${params}`, { credentials: "include" });
      const json = await res.json();
      if (json.success) {
        setInvoices(json.data);
        setTotalCount(json.count ?? json.data.length);
        setLateCount(json.late?.count ?? 0);
        setLateOutstanding(Number(json.late?.outstanding ?? 0));
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    fetchInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, debouncedSearch, showLateOnly]);

  const openCreate = async () => {
    setEditId(null);
    setCart([]);
    setParty("");
    setTaxRate("0");
    setDiscount("0");
    setDownPayment("0");
    setDueDate("");
    setError("");
    const res = await fetch(`${API_URL}/api/products/mine`, { credentials: "include" });
    const json = await res.json();
    setProducts(json.products ?? []);
    setView("create");
  };

  // Open the create form pre-filled with a draft's data for editing.
  const openEdit = async (id: number) => {
    setError("");
    setEditId(id);
    const [pRes, dRes] = await Promise.all([
      fetch(`${API_URL}/api/products/mine`, { credentials: "include" }),
      fetch(`${API_URL}/api/sales-invoices/${id}`, { credentials: "include" }),
    ]);
    const prods: Product[] = (await pRes.json()).products ?? [];
    setProducts(prods);
    const dJson = await dRes.json();
    if (dJson.success) {
      const d = dJson.data as DetailInvoice & { items: DetailItem[] };
      setParty(d.party_name || "");
      setTaxRate(String(Number(d.tax_rate) || 0));
      setDiscount(String(Number(d.discount) || 0));
      setDownPayment(String(Number(d.down_payment) || 0));
      setDueDate(d.due_date ? String(d.due_date).slice(0, 10) : "");
      setCart(
        d.items.map((it) => {
          // Reuse the live product (image, name) when it still exists; otherwise
          // synthesize a minimal one from the stored line so the row survives.
          const prod =
            prods.find((p) => p.id === it.product_id) ??
            ({
              id: it.product_id ?? `line-${it.id}`,
              product_name: it.description,
              price: it.unit_price,
              image: "",
              is_for_sale: true,
            } as Product);
          return {
            product: prod,
            quantity: Number(it.quantity),
            unit_price: String(Number(it.unit_price)),
            discount_pct: String(Number(it.discount_pct) || 0),
          };
        }),
      );
    }
    setView("create");
  };

  const addToCart = (p: Product) => {
    setCart((c) => {
      const found = c.find((i) => i.product.id === p.id);
      if (found) return c.map((i) => (i.product.id === p.id ? { ...i, quantity: i.quantity + 1 } : i));
      return [...c, { product: p, quantity: 1, unit_price: p.price || "0", discount_pct: "0" }];
    });
  };
  const setQty = (id: string, q: number) =>
    setCart((c) =>
      q <= 0
        ? c.filter((i) => i.product.id !== id)
        : c.map((i) => (i.product.id === id ? { ...i, quantity: q } : i)),
    );
  const setPrice = (id: string, price: string) =>
    setCart((c) => c.map((i) => (i.product.id === id ? { ...i, unit_price: price } : i)));
  const setDisc = (id: string, pct: string) => {
    // Clamp to 0-100; keep empty string as-is while typing.
    const n = pct === "" ? "" : String(Math.min(100, Math.max(0, Number(pct) || 0)));
    setCart((c) => c.map((i) => (i.product.id === id ? { ...i, discount_pct: n } : i)));
  };
  const lineNet = (i: CartItem) =>
    i.quantity * Number(i.unit_price || 0) * (1 - Number(i.discount_pct || 0) / 100);

  const filtered = useMemo(
    () => products.filter((p) => p.product_name.toLowerCase().includes(search.toLowerCase())),
    [products, search],
  );
  const totals = useMemo(() => {
    // subtotal is the sum of per-line nets (each line's % discount already applied).
    const subtotal = cart.reduce((s, i) => s + lineNet(i), 0);
    const disc = Math.min(Number(discount || 0), subtotal); // never exceed subtotal
    const base = subtotal - disc;
    const tax = (base * Number(taxRate || 0)) / 100;
    return { subtotal, discount: disc, tax, total: base + tax };
  }, [cart, taxRate, discount]);

  const save = async () => {
    if (cart.length === 0) {
      setError("Pilih minimal satu produk.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        editId ? `${API_URL}/api/sales-invoices/${editId}` : `${API_URL}/api/sales-invoices`,
        {
          method: editId ? "PUT" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            party_name: party,
            due_date: dueDate || null,
            tax_rate: Number(taxRate || 0),
            discount: Number(discount || 0),
            down_payment: Number(downPayment || 0),
            items: cart.map((i) => ({
              product_id: i.product.id,
              description: i.product.product_name,
              quantity: i.quantity,
              unit_price: Number(i.unit_price),
              discount_pct: Number(i.discount_pct || 0),
            })),
          }),
        },
      );
      const json = await res.json();
      if (!json.success) {
        setError(json.error || "Gagal menyimpan faktur.");
        return;
      }
      setEditId(null);
      setView("list");
      await fetchInvoices();
    } catch {
      setError("Terjadi kesalahan jaringan.");
    } finally {
      setSaving(false);
    }
  };

  // "Bayar" opens the payment sheet (prefilled with the remaining balance) so
  // the owner can take a down payment or settle in full; the rest go straight
  // to the backend action endpoints.
  const openPay = (inv: { id: number; number: string; total: string; amount_paid: string }) => {
    const total = Number(inv.total);
    const paid = Number(inv.amount_paid);
    setPayTarget({ id: inv.id, number: inv.number, total, paid });
    setPayAmount(String(Math.max(0, +(total - paid).toFixed(2))));
    setPayError("");
  };

  const submitPay = async () => {
    if (!payTarget) return;
    const remaining = Math.max(0, +(payTarget.total - payTarget.paid).toFixed(2));
    const amount = Number(payAmount);
    if (!(amount > 0) || amount > remaining) {
      setPayError(`Nominal harus lebih dari 0 dan maksimal ${rupiah(remaining)}.`);
      return;
    }
    setPaying(true);
    setPayError("");
    try {
      const res = await fetch(`${API_URL}/api/sales-invoices/${payTarget.id}/pay`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const json = await res.json();
      if (!json.success) {
        setPayError(json.error || "Gagal mencatat pembayaran.");
        return;
      }
      const paidId = payTarget.id;
      setPayTarget(null);
      await fetchInvoices();
      if (view === "detail" && detail?.id === paidId) await openDetail(paidId);
    } catch {
      setPayError("Terjadi kesalahan jaringan.");
    } finally {
      setPaying(false);
    }
  };

  const action = async (id: number, kind: "post" | "pay" | "void") => {
    if (kind === "pay") {
      const inv = invoices.find((i) => i.id === id) ?? (detail?.id === id ? detail : null);
      if (inv) openPay(inv);
      return;
    }
    setBusyId(id);
    try {
      const res = await fetch(`${API_URL}/api/sales-invoices/${id}/${kind}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = await res.json();
      if (kind === "post" && json.warnings?.length) {
        alert("Faktur diposting. Peringatan stok minus:\n" + json.warnings.join("\n"));
      }
      await fetchInvoices();
      if (view === "detail" && detail?.id === id) await openDetail(id);
    } finally {
      setBusyId(null);
    }
  };

  const openDetail = async (id: number) => {
    setView("detail");
    setDetailLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/sales-invoices/${id}`, { credentials: "include" });
      const json = await res.json();
      if (json.success) setDetail(json.data);
    } finally {
      setDetailLoading(false);
    }
  };

  // Payment sheet (full payment or down payment / uang muka). Rendered in both
  // the list and detail views so "Bayar" works from either place.
  const payRemaining = payTarget ? Math.max(0, +(payTarget.total - payTarget.paid).toFixed(2)) : 0;
  const paySheet = (
    <Sheet
      open={payTarget !== null}
      onOpenChange={(open) => {
        if (!open) setPayTarget(null);
      }}
    >
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Terima Pembayaran</SheetTitle>
          <SheetDescription>
            Faktur {payTarget?.number} — bayar lunas atau catat uang muka (DP).
          </SheetDescription>
        </SheetHeader>

        {payTarget && (
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div className="space-y-1 rounded-xl border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Total Faktur</span>
                <span className="tabular-nums">{rupiah(payTarget.total)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Sudah Dibayar</span>
                <span className="tabular-nums">{rupiah(payTarget.paid)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Sisa Tagihan</span>
                <span className="tabular-nums">{rupiah(payRemaining)}</span>
              </div>
            </div>

            <label className="block space-y-1.5">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Wallet className="size-3.5" /> Nominal Pembayaran
              </span>
              <div className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  Rp
                </span>
                <Input
                  inputMode="numeric"
                  value={formatNumberInput(payAmount)}
                  onChange={(e) => setPayAmount(parseNumberInput(e.target.value))}
                  className="pl-8 text-right tabular-nums"
                />
              </div>
            </label>

            {/* Quick fills: common DP percentages (of the invoice total, capped
                at the remaining balance) + full settlement. */}
            <div className="flex flex-wrap gap-2">
              {[30, 50].map((pct) => {
                const v = Math.min(payRemaining, +((payTarget.total * pct) / 100).toFixed(2));
                return (
                  <Button
                    key={pct}
                    size="sm"
                    variant="outline"
                    disabled={v <= 0}
                    onClick={() => setPayAmount(String(v))}
                  >
                    DP {pct}%
                  </Button>
                );
              })}
              <Button size="sm" variant="outline" onClick={() => setPayAmount(String(payRemaining))}>
                Lunas ({rupiah(payRemaining)})
              </Button>
            </div>

            <p className="text-[11px] text-muted-foreground">
              Pembayaran sebagian membuat status faktur menjadi{" "}
              <span className="font-medium">Sebagian</span>; sisa tagihan bisa dibayar lagi kapan saja
              lewat tombol Bayar yang sama.
            </p>

            {payError && <p className="text-xs text-destructive">{payError}</p>}
          </div>
        )}

        <SheetFooter className="border-t">
          <Button
            onClick={submitPay}
            disabled={paying || !payTarget || !(Number(payAmount) > 0)}
            className="w-full bg-green-600 text-white hover:bg-green-700"
          >
            {paying && <Loader2 className="size-4 animate-spin" />}
            Catat Pembayaran
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );

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
          <h1 className="text-xl font-semibold tracking-tight">Detail Faktur Penjualan</h1>
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
                  Pelanggan: {detail.party_name || "—"}
                </p>
                <p
                  className={`text-xs ${
                    isLateInvoice(detail)
                      ? "font-medium text-red-600 dark:text-red-400"
                      : "text-muted-foreground"
                  }`}
                >
                  Jatuh tempo:{" "}
                  {detail.due_date ? new Date(detail.due_date).toLocaleDateString("id-ID") : "—"}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SALES_STATUS_STYLE[detail.status]}`}
                >
                  {SALES_STATUS_LABEL[detail.status]}
                </span>
                {isLateInvoice(detail) && detail.due_date && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                    Terlambat {lateDays(detail.due_date)} hari
                  </span>
                )}
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
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
                      <td className="px-3 py-2 text-right tabular-nums">{rupiah(it.unit_price)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
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
              <div className="flex justify-between text-muted-foreground">
                <span>Pajak ({Number(detail.tax_rate)}%)</span>
                <span className="tabular-nums">{rupiah(detail.tax_amount)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{rupiah(detail.total)}</span>
              </div>
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
                    DP dicatat sebagai kas masuk saat faktur diposting.
                  </p>
                </>
              )}
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
                    <Button variant="outline" onClick={() => openEdit(detail.id)}>
                      <Pencil className="size-4" /> Ubah
                    </Button>
                  )}
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
                      href={`/dashboard/invoice/sales/${detail.id}/print`}
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
      <div className="flex flex-col p-4 md:p-6 lg:h-[calc(100svh-3rem)]">
        <div className="mb-4 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              setEditId(null);
              setView("list");
            }}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">
            {editId ? "Edit Faktur Penjualan" : "Faktur Penjualan Baru"}
          </h1>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_420px]">
          {/* product grid */}
          <div className="flex min-h-0 flex-col">
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Cari produk / item inventaris…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="grid max-h-[46vh] min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto lg:max-h-none xl:grid-cols-3">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className="group flex items-center gap-2 rounded-xl border bg-card p-2 text-left transition-colors hover:border-teal-500 sm:gap-3"
                >
                  <div className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-muted sm:size-12">
                    {p.image && p.image !== "avatar.png" ? (
                      <Image
                        src={resolveProductImage(p.image)}
                        unoptimized={isBackendImage(p.image)}
                        alt={p.product_name}
                        fill
                        className="object-cover"
                        sizes="48px"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <ImageIcon className="size-5 text-muted-foreground/40" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-xs font-medium leading-snug sm:line-clamp-1 sm:text-sm">
                      {p.product_name}
                    </p>
                    <p className="text-[11px] text-muted-foreground tabular-nums sm:text-xs">{rupiah(p.price)}</p>
                    {!p.is_for_sale && (
                      <span className="mt-0.5 inline-block rounded bg-zinc-900/80 px-1.5 py-0.5 text-[9px] font-medium text-white">
                        Inventaris
                      </span>
                    )}
                  </div>
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600 transition-colors group-hover:bg-teal-600 group-hover:text-white dark:bg-teal-950 sm:size-7">
                    <Plus className="size-3.5 sm:size-4" />
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="col-span-full py-10 text-center text-sm text-muted-foreground">
                  Tidak ada produk.
                </p>
              )}
            </div>
          </div>

          {/* cart */}
          <div className="flex min-h-0 flex-col rounded-xl border bg-card">
            {/* compact detail summary + slide-over trigger */}
            <div className="flex items-center justify-between gap-2 border-b p-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                  <User className="size-3.5 shrink-0 text-muted-foreground" />
                  {party || <span className="font-normal text-muted-foreground">Pelanggan belum diisi</span>}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {dueDate
                    ? `Jatuh tempo ${new Date(dueDate).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}`
                    : "Tanpa jatuh tempo"}
                  {Number(taxRate) > 0 ? ` · Pajak ${taxRate}%` : ""}
                  {Number(discount) > 0 ? ` · Diskon ${rupiah(discount)}` : ""}
                  {Number(downPayment) > 0 ? ` · DP ${rupiah(downPayment)}` : ""}
                </p>
              </div>
              <Sheet>
                <SheetTrigger asChild>
                  <Button
                    size="sm"
                    className="shrink-0 bg-teal-600 text-white shadow-sm hover:bg-teal-700"
                  >
                    <SlidersHorizontal className="size-4" />
                    Detail
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
                  <SheetHeader className="border-b">
                    <SheetTitle>Detail Faktur</SheetTitle>
                    <SheetDescription>Pelanggan, jatuh tempo, pajak, diskon, dan ketentuan.</SheetDescription>
                  </SheetHeader>

                  <div className="flex-1 space-y-4 overflow-y-auto p-4">
                    <label className="block space-y-1.5">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <User className="size-3.5" /> Nama Pelanggan / Toko
                      </span>
                      <Input placeholder="cth. Toko Sebelah" value={party} onChange={(e) => setParty(e.target.value)} />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block space-y-1.5">
                        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <CalendarDays className="size-3.5" /> Jatuh Tempo
                        </span>
                        <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                      </label>
                      <label className="block space-y-1.5">
                        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <Percent className="size-3.5" /> Pajak (%)
                        </span>
                        <Input
                          type="number"
                          placeholder="0"
                          value={taxRate}
                          onChange={(e) => setTaxRate(e.target.value)}
                        />
                      </label>
                    </div>
                    <label className="block space-y-1.5">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Tag className="size-3.5" /> Diskon Faktur (Rp)
                      </span>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          Rp
                        </span>
                        <Input
                          inputMode="numeric"
                          value={formatNumberInput(discount)}
                          onChange={(e) => setDiscount(parseNumberInput(e.target.value))}
                          className="pl-8"
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        Diskon keseluruhan, di luar diskon per-produk.
                      </span>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Wallet className="size-3.5" /> Uang Muka / DP (Rp)
                      </span>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          Rp
                        </span>
                        <Input
                          inputMode="numeric"
                          value={formatNumberInput(downPayment)}
                          onChange={(e) => setDownPayment(parseNumberInput(e.target.value))}
                          className="pl-8"
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        Dicatat otomatis sebagai pembayaran pertama (kas masuk) saat faktur diposting.
                      </span>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Syarat &amp; Ketentuan</span>
                      <textarea
                        rows={4}
                        value={terms}
                        onChange={(e) => {
                          setTerms(e.target.value);
                          setSalesTerms(e.target.value);
                        }}
                        placeholder="cth. Pembayaran maksimal 7 hari setelah faktur diterbitkan…"
                        className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                      />
                      <span className="text-[10px] text-muted-foreground">
                        Tersimpan di perangkat ini &amp; muncul saat cetak faktur.
                      </span>
                    </label>
                  </div>

                  <SheetFooter className="border-t">
                    <SheetClose asChild>
                      <Button className="w-full bg-teal-600 text-white hover:bg-teal-700">Selesai</Button>
                    </SheetClose>
                  </SheetFooter>
                </SheetContent>
              </Sheet>
            </div>

            <div className="flex items-center justify-between px-3 pt-3">
              <span className="text-xs font-semibold text-muted-foreground">Item Faktur</span>
              {cart.length > 0 && (
                <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                  {cart.length} item
                </span>
              )}
            </div>

            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
              {cart.length === 0 ? (
                <div className="flex h-full min-h-40 flex-col items-center justify-center rounded-xl border border-dashed text-center">
                  <Receipt className="size-7 text-muted-foreground/40" />
                  <p className="mt-2 text-xs font-medium text-muted-foreground">Keranjang masih kosong</p>
                  <p className="mt-0.5 max-w-55 text-[11px] text-muted-foreground/70">
                    Ketuk produk di sebelah kiri untuk menambahkannya ke faktur.
                  </p>
                </div>
              ) : (
                cart.map((i) => (
                  <div
                    key={i.product.id}
                    className="rounded-xl border bg-background p-3 shadow-sm transition-colors hover:border-teal-500/40"
                  >
                    {/* header: thumbnail + name + delete */}
                    <div className="flex items-start gap-2.5">
                      <div className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-muted">
                        {i.product.image && i.product.image !== "avatar.png" ? (
                          <Image
                            src={resolveProductImage(i.product.image)}
                            unoptimized={isBackendImage(i.product.image)}
                            alt={i.product.product_name}
                            fill
                            className="object-cover"
                            sizes="40px"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <ImageIcon className="size-4 text-muted-foreground/40" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-medium leading-snug">{i.product.product_name}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                          {rupiah(i.unit_price || 0)} / item
                        </p>
                      </div>
                      <button
                        onClick={() => setQty(i.product.id, 0)}
                        className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        aria-label="Hapus item"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>

                    {/* controls */}
                    <div className="mt-3 grid grid-cols-2 gap-2.5">
                      <div className="space-y-1">
                        <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Jumlah
                        </span>
                        <div className="flex items-center justify-between rounded-lg border bg-card">
                          <button
                            className="grid size-8 place-items-center rounded-l-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            onClick={() => setQty(i.product.id, i.quantity - 1)}
                          >
                            <Minus className="size-3.5" />
                          </button>
                          <span className="min-w-8 text-center text-sm font-semibold tabular-nums">{i.quantity}</span>
                          <button
                            className="grid size-8 place-items-center rounded-r-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            onClick={() => setQty(i.product.id, i.quantity + 1)}
                          >
                            <Plus className="size-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Diskon (%)
                        </span>
                        <div className="relative">
                          <Input
                            inputMode="numeric"
                            placeholder="0"
                            value={i.discount_pct}
                            onChange={(e) => setDisc(i.product.id, e.target.value.replace(/[^\d.]/g, ""))}
                            className="h-8 w-full pr-6 text-right text-sm tabular-nums"
                          />
                          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                            %
                          </span>
                        </div>
                      </div>
                      <div className="col-span-2 space-y-1">
                        <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Harga Satuan
                        </span>
                        <div className="relative">
                          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                            Rp
                          </span>
                          <Input
                            inputMode="numeric"
                            value={formatNumberInput(i.unit_price)}
                            onChange={(e) => setPrice(i.product.id, parseNumberInput(e.target.value))}
                            className="h-8 w-full pl-8 text-right text-sm tabular-nums"
                          />
                        </div>
                      </div>
                    </div>

                    {/* line total */}
                    <div className="mt-3 flex items-center justify-between border-t pt-2.5">
                      <span className="text-[11px] font-medium text-muted-foreground">Subtotal</span>
                      <span className="flex items-baseline gap-1.5 tabular-nums">
                        {Number(i.discount_pct) > 0 && (
                          <span className="text-[11px] text-muted-foreground line-through">
                            {rupiah(i.quantity * Number(i.unit_price || 0))}
                          </span>
                        )}
                        <span className="text-sm font-bold">{rupiah(lineNet(i))}</span>
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-1 border-t p-3 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums">{rupiah(totals.subtotal)}</span>
              </div>
              {totals.discount > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Diskon</span>
                  <span className="tabular-nums">-{rupiah(totals.discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-muted-foreground">
                <span>Pajak ({taxRate || 0}%)</span>
                <span className="tabular-nums">{rupiah(totals.tax)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{rupiah(totals.total)}</span>
              </div>
              {Number(downPayment) > 0 && (
                <>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Uang Muka (DP)</span>
                    <span className="tabular-nums">
                      -{rupiah(Math.min(Number(downPayment), totals.total))}
                    </span>
                  </div>
                  <div className="flex justify-between font-semibold text-amber-600 dark:text-amber-400">
                    <span>Sisa Tagihan</span>
                    <span className="tabular-nums">
                      {rupiah(Math.max(0, totals.total - Number(downPayment)))}
                    </span>
                  </div>
                </>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button
                onClick={save}
                disabled={saving || cart.length === 0}
                className="mt-2 w-full bg-teal-600 text-white hover:bg-teal-700"
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                {editId ? "Simpan Perubahan" : "Simpan sebagai Draft"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ======================================================================= list
  const pageCount = Math.max(1, Math.ceil(totalCount / limit));

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Receipt className="size-5 text-teal-600 dark:text-teal-400" />
            Faktur Penjualan
          </h1>
          <p className="text-sm text-muted-foreground">
            Draft → Posting (stok berkurang) → Bayar (kas masuk). Cetak untuk dibagikan.
          </p>
        </div>
        <Button onClick={openCreate} className="bg-teal-600 text-white hover:bg-teal-700">
          <Plus className="size-4" />
          Buat Faktur Penjualan
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Cari no. faktur / nama pelanggan…"
          value={listSearch}
          onChange={(e) => {
            setListSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {lateCount > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-300">
            <AlertTriangle className="size-4 shrink-0" />
            {lateCount} faktur melewati jatuh tempo · sisa tagihan{" "}
            <span className="tabular-nums">{rupiah(lateOutstanding)}</span>
          </p>
          <Button
            size="sm"
            variant="outline"
            className="border-red-300 text-red-700 hover:bg-red-100 hover:text-red-800 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
            onClick={() => {
              setShowLateOnly((v) => !v);
              setPage(1);
            }}
          >
            {showLateOnly ? "Tampilkan Semua" : "Hanya yang Terlambat"}
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : invoices.length === 0 ? (
        debouncedSearch || showLateOnly ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Tidak ada faktur yang cocok dengan pencarian atau filter.
          </p>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 px-6 py-16 text-center">
            <Receipt className="size-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">Belum ada faktur penjualan</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Buat faktur penjualan untuk menagih pelanggan dan mengurangi stok otomatis.
            </p>
          </div>
        )
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="space-y-2.5 sm:hidden">
            {invoices.map((inv) => (
              <div
                key={inv.id}
                role="button"
                tabIndex={0}
                onClick={() => openDetail(inv.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") openDetail(inv.id);
                }}
                className={`w-full rounded-2xl border bg-card p-3.5 text-left shadow-sm active:scale-[0.99] transition-transform ${
                  isLateInvoice(inv) ? "border-red-300 dark:border-red-900" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-sm font-semibold">{inv.number}</p>
                  <span className="flex items-center gap-1">
                    {isLateInvoice(inv) && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                        Terlambat
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SALES_STATUS_STYLE[inv.status]}`}>
                      {SALES_STATUS_LABEL[inv.status]}
                    </span>
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {inv.party_name || "Tanpa nama pelanggan"}
                </p>
                <div className="mt-2 flex items-end justify-between">
                  <span className="text-base font-bold tabular-nums">{rupiah(inv.total)}</span>
                  {inv.due_date &&
                    (isLateInvoice(inv) ? (
                      <span className="text-[11px] font-medium text-red-600 dark:text-red-400">
                        Terlambat {lateDays(inv.due_date)} hari
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        Jatuh tempo {new Date(inv.due_date).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
                      </span>
                    ))}
                </div>
                {inv.status === "partial" && (
                  <p className="mt-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 tabular-nums">
                    Sisa {rupiah(Number(inv.total) - Number(inv.amount_paid))}
                  </p>
                )}
                {inv.status === "draft" && (
                  <div className="mt-3 border-t pt-2.5">
                    <Button
                      size="xs"
                      variant="outline"
                      className="w-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(inv.id);
                      }}
                    >
                      <Pencil className="size-3.5" /> Ubah Draft
                    </Button>
                  </div>
                )}
              </div>
            ))}

            {/* Same pagination as the desktop DataTable, card-list edition. */}
            {pageCount > 1 && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  Sebelumnya
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  Hal. {page} dari {pageCount} · {totalCount} faktur
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount}
                  onClick={() => setPage(page + 1)}
                >
                  Berikutnya
                </Button>
              </div>
            )}
          </div>

          {/* Desktop: table (rows are already the current server page) */}
          <div className="hidden sm:block">
            <DataTable
              columns={getSalesColumns({ busyId, onAction: action, onEdit: openEdit })}
              data={invoices}
              page={page}
              limit={limit}
              count={totalCount}
              setPage={setPage}
              setLimit={setLimit}
              onRowClick={(row) => openDetail(row.id)}
            />
          </div>
        </>
      )}
      {paySheet}
    </div>
  );
}
