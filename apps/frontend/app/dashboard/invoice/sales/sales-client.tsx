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
  Search,
  ImageIcon,
  SlidersHorizontal,
  User,
  CalendarDays,
  Percent,
  Tag,
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
} from "./columns";

type Product = { id: string; product_name: string; price: string; image: string; is_for_sale: boolean };
type CartItem = { product: Product; quantity: number; unit_price: string; discount_pct: string };
type DetailItem = {
  id: number;
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
  const [detail, setDetail] = useState<DetailInvoice | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [party, setParty] = useState("");
  const [taxRate, setTaxRate] = useState("0");
  const [discount, setDiscount] = useState("0");
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
      const res = await fetch(`${API_URL}/api/sales-invoices`, { credentials: "include" });
      const json = await res.json();
      if (json.success) setInvoices(json.data);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    fetchInvoices();
  }, []);

  const openCreate = async () => {
    setCart([]);
    setParty("");
    setTaxRate("0");
    setDiscount("0");
    setDueDate("");
    setError("");
    const res = await fetch(`${API_URL}/api/products/mine`, { credentials: "include" });
    const json = await res.json();
    setProducts(json.products ?? []);
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
      const res = await fetch(`${API_URL}/api/sales-invoices`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          party_name: party,
          due_date: dueDate || null,
          tax_rate: Number(taxRate || 0),
          discount: Number(discount || 0),
          items: cart.map((i) => ({
            product_id: i.product.id,
            description: i.product.product_name,
            quantity: i.quantity,
            unit_price: Number(i.unit_price),
            discount_pct: Number(i.discount_pct || 0),
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
                <p className="text-xs text-muted-foreground">
                  Jatuh tempo:{" "}
                  {detail.due_date ? new Date(detail.due_date).toLocaleDateString("id-ID") : "—"}
                </p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SALES_STATUS_STYLE[detail.status]}`}
              >
                {SALES_STATUS_LABEL[detail.status]}
              </span>
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
              {Number(detail.amount_paid) > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Dibayar</span>
                  <span className="tabular-nums">{rupiah(detail.amount_paid)}</span>
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
      </div>
    );
  }

  // ===================================================================== create
  if (view === "create") {
    return (
      <div className="flex flex-col p-4 md:p-6 lg:h-[calc(100svh-3rem)]">
        <div className="mb-4 flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={() => setView("list")}>
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">Faktur Penjualan Baru</h1>
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
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button
                onClick={save}
                disabled={saving || cart.length === 0}
                className="mt-2 w-full bg-teal-600 text-white hover:bg-teal-700"
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                Simpan sebagai Draft
              </Button>
            </div>
          </div>
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

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : invoices.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 px-6 py-16 text-center">
          <Receipt className="size-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">Belum ada faktur penjualan</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Buat faktur penjualan untuk menagih pelanggan dan mengurangi stok otomatis.
          </p>
        </div>
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="space-y-2.5 sm:hidden">
            {invoices.map((inv) => (
              <button
                key={inv.id}
                onClick={() => openDetail(inv.id)}
                className="w-full rounded-2xl border bg-card p-3.5 text-left shadow-sm active:scale-[0.99] transition-transform"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-sm font-semibold">{inv.number}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SALES_STATUS_STYLE[inv.status]}`}>
                    {SALES_STATUS_LABEL[inv.status]}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {inv.party_name || "Tanpa nama pelanggan"}
                </p>
                <div className="mt-2 flex items-end justify-between">
                  <span className="text-base font-bold tabular-nums">{rupiah(inv.total)}</span>
                  {inv.due_date && (
                    <span className="text-[11px] text-muted-foreground">
                      Jatuh tempo {new Date(inv.due_date).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden sm:block">
            <DataTable
              columns={getSalesColumns({ busyId, onAction: action })}
              data={invoices.slice((page - 1) * limit, page * limit)}
              page={page}
              limit={limit}
              count={invoices.length}
              setPage={setPage}
              setLimit={setLimit}
              onRowClick={(row) => openDetail(row.id)}
            />
          </div>
        </>
      )}
    </div>
  );
}
