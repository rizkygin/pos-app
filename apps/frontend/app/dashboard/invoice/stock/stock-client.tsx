"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Loader2,
  ClipboardCheck,
  ArrowLeft,
  History,
  Wallet,
  Package,
  AlertTriangle,
  Search,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/app/dashboard/reports/data-table";
import { API_URL } from "@/lib/api-url";
import { fmtIDR } from "@/lib/utils/format";
import { stockColumns, type StockRow } from "./columns";

type Product = {
  id: string;
  product_name: string;
  unit: string;
  stock: string;
  buying_price: string;
  // Running weighted-average unit cost from the cost ledger. This is what the
  // stock is actually worth; buying_price is only what was last typed into the
  // product form, and is meaningless for anything produced in-house.
  avg_cost: string;
  track_stock: boolean;
  has_recipe: boolean;
  yield_qty: string;
};

type HistoryRow = {
  id: number;
  qty_change: string;
  note: string | null;
  created_at: string;
  product_name: string;
  unit: string;
};

type FlowRow = {
  id: number;
  qty_change: string;
  reason: "purchase" | "sales" | "adjustment" | "void" | "production";
  note: string | null;
  created_at: string;
  invoice_number: string | null;
};

const FLOW_REASON: Record<FlowRow["reason"], { label: string; cls: string }> = {
  purchase: { label: "Pembelian", cls: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" },
  sales: { label: "Penjualan", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  adjustment: { label: "Opname", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  void: { label: "Pembatalan", cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  // A production batch shows on BOTH sides of itself: negative rows on the
  // ingredients, one positive row on the batch. Same label either way — the
  // sign already says which end of it you are looking at.
  production: { label: "Produksi", cls: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
};

export function StockClient() {
  const [view, setView] = useState<"list" | "opname" | "history" | "flow">("list");
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  // opname state
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // production state: which product is being made, and how much of it
  const [produceRow, setProduceRow] = useState<StockRow | null>(null);
  const [produceQty, setProduceQty] = useState("");
  const [producing, setProducing] = useState(false);
  const [produceError, setProduceError] = useState("");
  // Shortfall notices from the server ("Cabai: stok 0.2, terpakai 0.5"). Shown,
  // never blocking: the batch was physically cooked either way.
  const [produceWarnings, setProduceWarnings] = useState<string[]>([]);

  // per-item flow state
  const [flowProduct, setFlowProduct] = useState<StockRow | null>(null);
  const [flowRows, setFlowRows] = useState<FlowRow[]>([]);
  const [flowLoading, setFlowLoading] = useState(false);

  // history state (default window: last 30 days)
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [histFrom, setHistFrom] = useState(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
  const [histTo, setHistTo] = useState(new Date().toISOString().slice(0, 10));

  const loadStock = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/products/mine`, { credentials: "include" });
      const json = await res.json();
      const products: Product[] = json.products ?? [];
      setRows(
        products
          .filter((p) => p.track_stock)
          .map((p) => {
            const stock = Number(p.stock || 0);
            // Fall back to buying_price only when the ledger has nothing to say
            // (a product that has never moved since migration 0063).
            const ledgerCost = Number(p.avg_cost || 0);
            const buying_price = ledgerCost > 0 ? ledgerCost : Number(p.buying_price || 0);
            return {
              id: p.id,
              product_name: p.product_name,
              unit: p.unit,
              stock,
              buying_price,
              value: stock * buying_price,
              has_recipe: !!p.has_recipe,
              yield_qty: Number(p.yield_qty || 1),
            };
          }),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStock();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const filtered = useMemo(
    () => rows.filter((r) => r.product_name.toLowerCase().includes(search.toLowerCase())),
    [rows, search],
  );
  const totalValue = useMemo(() => rows.reduce((s, r) => s + r.value, 0), [rows]);
  const outOfStock = useMemo(() => rows.filter((r) => r.stock <= 0).length, [rows]);
  const pageData = useMemo(() => filtered.slice((page - 1) * limit, page * limit), [filtered, page, limit]);

  const openOpname = () => {
    // Pre-fill each count with the current system stock; the owner edits the
    // ones they physically counted differently.
    setCounts(Object.fromEntries(rows.map((r) => [r.id, String(r.stock)])));
    setNote("");
    setView("opname");
  };

  const loadHistory = async (from: string, to: string) => {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({ from, to });
      const res = await fetch(`${API_URL}/api/stock/opname-history?${params.toString()}`, {
        credentials: "include",
      });
      const json = await res.json();
      if (json.success) setHistory(json.data);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openHistory = () => {
    setView("history");
    loadHistory(histFrom, histTo);
  };

  const openFlow = async (row: StockRow) => {
    setFlowProduct(row);
    setFlowRows([]);
    setView("flow");
    setFlowLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/api/stock/movements?productId=${encodeURIComponent(row.id)}`,
        { credentials: "include" },
      );
      const json = await res.json();
      if (json.success) setFlowRows(json.data);
    } finally {
      setFlowLoading(false);
    }
  };

  // Rows are newest-first, so the balance AFTER the newest row is the current
  // stock; each older row's after-balance is the newer one minus its change.
  const flowWithBalance = useMemo(() => {
    let bal = flowProduct ? flowProduct.stock : 0;
    return flowRows.map((r) => {
      const after = +bal.toFixed(3);
      bal -= Number(r.qty_change);
      bal = +bal.toFixed(3);
      return { ...r, after };
    });
  }, [flowRows, flowProduct]);

  // Group adjustment history into per-day buckets (preserving newest-first order).
  const historyByDay = useMemo(() => {
    const groups: { day: string; items: HistoryRow[] }[] = [];
    const idx: Record<string, number> = {};
    for (const h of history) {
      const day = new Date(h.created_at).toLocaleDateString("id-ID", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
      if (idx[day] === undefined) {
        idx[day] = groups.length;
        groups.push({ day, items: [] });
      }
      groups[idx[day]].items.push(h);
    }
    return groups;
  }, [history]);

  const saveOpname = async () => {
    setSaving(true);
    try {
      const items = rows.map((r) => ({ product_id: r.id, counted: Number(counts[r.id] ?? r.stock) }));
      await fetch(`${API_URL}/api/stock/opname`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, items }),
      });
      await loadStock();
      setView("list");
    } finally {
      setSaving(false);
    }
  };

  const openProduce = (row: StockRow) => {
    setProduceRow(row);
    // Default to one batch — the number the owner thinks in ("sekali masak").
    setProduceQty(String(row.yield_qty || 1));
    setProduceError("");
    setProduceWarnings([]);
  };

  const submitProduce = async () => {
    if (!produceRow) return;
    setProducing(true);
    setProduceError("");
    try {
      const res = await fetch(`${API_URL}/api/products/${produceRow.id}/production`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qty: Number(produceQty), note: "" }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Gagal mencatat produksi");
      await loadStock();
      // Warnings keep the dialog open so the owner actually reads which
      // ingredient went short; a clean run just closes.
      if (json.warnings?.length) {
        setProduceWarnings(json.warnings);
        setProduceRow((r) => (r ? { ...r } : r));
      } else {
        setProduceRow(null);
      }
    } catch (e) {
      setProduceError(e instanceof Error ? e.message : "Gagal mencatat produksi");
    } finally {
      setProducing(false);
    }
  };

  // ======================================================================= flow
  if (view === "flow" && flowProduct) {
    return (
      <div className="p-4 md:p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={() => setView("list")}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Alur Stok — {flowProduct.product_name}</h1>
            <p className="text-sm text-muted-foreground">
              Stok saat ini:{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {flowProduct.stock} {flowProduct.unit}
              </span>
            </p>
          </div>
        </div>

        {flowLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : flowWithBalance.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 px-6 py-16 text-center">
            <History className="size-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">Belum ada pergerakan stok</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Pembelian, penjualan, dan opname untuk produk ini akan tercatat di sini.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Waktu</th>
                  <th className="px-3 py-2 font-medium">Jenis</th>
                  <th className="px-3 py-2 font-medium">Keterangan</th>
                  <th className="px-3 py-2 text-right font-medium">Perubahan</th>
                  <th className="px-3 py-2 text-right font-medium">Sisa</th>
                </tr>
              </thead>
              <tbody>
                {flowWithBalance.map((m) => {
                  const delta = Number(m.qty_change);
                  const reason = FLOW_REASON[m.reason] ?? FLOW_REASON.adjustment;
                  return (
                    <tr key={m.id} className="border-b last:border-0">
                      <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap text-muted-foreground">
                        {new Date(m.created_at).toLocaleString("id-ID", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${reason.cls}`}>
                          {reason.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {[m.invoice_number, m.note].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-medium tabular-nums whitespace-nowrap ${
                          delta < 0 ? "text-destructive" : delta > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                        }`}
                      >
                        {delta > 0 ? "+" : ""}
                        {delta} {flowProduct.unit}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                        {m.after} {flowProduct.unit}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // ==================================================================== history
  if (view === "history") {
    return (
      <div className="p-4 md:p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={() => setView("list")}>
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">Riwayat Opname</h1>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Dari
            <Input
              type="date"
              value={histFrom}
              max={histTo}
              onChange={(e) => {
                setHistFrom(e.target.value);
                loadHistory(e.target.value, histTo);
              }}
              className="w-40"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Sampai
            <Input
              type="date"
              value={histTo}
              min={histFrom}
              onChange={(e) => {
                setHistTo(e.target.value);
                loadHistory(histFrom, e.target.value);
              }}
              className="w-40"
            />
          </label>
        </div>

        {historyLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 px-6 py-16 text-center">
            <History className="size-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">Belum ada riwayat opname</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Setiap penyesuaian stok dari opname akan tercatat di sini, dikelompokkan per hari.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {historyByDay.map((g) => (
              <div key={g.day} className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">{g.day}</h2>
                  <span className="text-xs text-muted-foreground">{g.items.length} penyesuaian</span>
                </div>
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full text-sm">
                    <tbody>
                      {g.items.map((h) => {
                        const delta = Number(h.qty_change);
                        return (
                          <tr key={h.id} className="border-b last:border-0">
                            <td className="px-3 py-2">
                              <p className="font-medium">{h.product_name}</p>
                              {h.note && <p className="text-xs text-muted-foreground">{h.note}</p>}
                            </td>
                            <td className="px-3 py-2 text-right text-xs tabular-nums whitespace-nowrap text-muted-foreground">
                              {new Date(h.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                            </td>
                            <td
                              className={`px-3 py-2 text-right font-medium tabular-nums whitespace-nowrap ${
                                delta < 0
                                  ? "text-destructive"
                                  : delta > 0
                                    ? "text-green-600 dark:text-green-400"
                                    : "text-muted-foreground"
                              }`}
                            >
                              {delta > 0 ? "+" : ""}
                              {delta} {h.unit}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ===================================================================== opname
  if (view === "opname") {
    return (
      <div className="p-4 md:p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={() => setView("list")}>
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">Stok Opname</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Masukkan jumlah hasil hitung fisik. Selisih akan dicatat sebagai penyesuaian stok
          (tidak memengaruhi kas).
        </p>

        <label className="block max-w-md space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Catatan opname</span>
          <Input
            placeholder="mis. Opname 1 Juli — barang busuk"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Produk</th>
                <th className="px-3 py-2 text-right font-medium">Stok Sistem</th>
                <th className="px-3 py-2 text-right font-medium">Hitung Fisik</th>
                <th className="px-3 py-2 text-right font-medium">Selisih</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const counted = Number(counts[r.id] ?? r.stock);
                const delta = +(counted - r.stock).toFixed(2);
                return (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{r.product_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {r.stock} {r.unit}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        value={counts[r.id] ?? ""}
                        onChange={(e) => setCounts((c) => ({ ...c, [r.id]: e.target.value }))}
                        className="h-8 w-24 ml-auto text-right"
                      />
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums font-medium ${
                        delta < 0 ? "text-destructive" : delta > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                      }`}
                    >
                      {delta > 0 ? "+" : ""}
                      {delta} {r.unit}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    Tidak ada produk yang dikelola stoknya.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setView("list")} disabled={saving}>
            Batal
          </Button>
          <Button onClick={saveOpname} disabled={saving} className="bg-teal-600 text-white hover:bg-teal-700">
            {saving && <Loader2 className="size-4 animate-spin" />}
            Simpan Opname
          </Button>
        </div>
      </div>
    );
  }

  // ======================================================================= list
  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Boxes className="size-5 text-teal-600 dark:text-teal-400" />
            Stok
          </h1>
          <p className="text-sm text-muted-foreground">
            Pantau & sesuaikan stok bahan dan produk yang dikelola.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={openHistory} disabled={loading}>
            <History className="size-4" /> Riwayat
          </Button>
          <Button
            onClick={openOpname}
            disabled={loading || rows.length === 0}
            className="bg-teal-600 text-white hover:bg-teal-700"
          >
            <ClipboardCheck className="size-4" /> Stok Opname
          </Button>
        </div>
      </div>

      {/* stat cards */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 *:min-w-0">
        <StatCard icon={Wallet} label="Nilai Stok (HPP)" value={fmtIDR(totalValue)} accent="teal" />
        <StatCard icon={Package} label="Produk Dikelola" value={String(rows.length)} accent="muted" />
        <StatCard
          icon={AlertTriangle}
          label="Stok Habis"
          value={String(outOfStock)}
          accent={outOfStock > 0 ? "red" : "green"}
        />
      </div>

      {/* toolbar */}
      <div className="relative max-w-xs">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Cari produk…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <DataTable
          columns={stockColumns(openFlow, openProduce)}
          data={pageData}
          page={page}
          limit={limit}
          count={filtered.length}
          setPage={setPage}
          setLimit={setLimit}
        />
      )}

      {/* Production dialog. Hand-rolled overlay: this page has no dialog
          primitive, and pulling one in for a single numeric prompt would be a
          bigger change than the feature. Theme tokens throughout — nothing here
          is a surface that must stay white. */}
      {produceRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !producing && setProduceRow(null)}
        >
          <div
            className="w-full max-w-sm space-y-3 rounded-2xl border bg-background p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Produksi {produceRow.product_name}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Bahan-bahannya berkurang, stok {produceRow.product_name} bertambah
                sebanyak yang pian isi.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">
                Jumlah jadi ({produceRow.unit})
              </label>
              <Input
                type="number"
                min="0"
                step="any"
                autoFocus
                value={produceQty}
                onChange={(e) => setProduceQty(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Stok sekarang: {produceRow.stock} {produceRow.unit}
              </p>
            </div>

            {produceWarnings.length > 0 && (
              <div className="space-y-1 rounded-xl bg-amber-50 p-3 dark:bg-amber-950/40">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                  Produksi tercatat, tapi stok bahan ini kurang:
                </p>
                <ul className="space-y-0.5 text-xs text-amber-800 dark:text-amber-300">
                  {produceWarnings.map((w) => (
                    <li key={w}>• {w}</li>
                  ))}
                </ul>
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  Cek lagi lewat Opname kalau catatan stoknya memang belum pas.
                </p>
              </div>
            )}

            {produceError && (
              <p className="text-xs font-medium text-destructive">{produceError}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                onClick={() => setProduceRow(null)}
                disabled={producing}
              >
                {produceWarnings.length > 0 ? "Tutup" : "Batal"}
              </Button>
              <Button
                onClick={submitProduce}
                disabled={producing || !(Number(produceQty) > 0)}
              >
                {producing && <Loader2 className="mr-1 size-4 animate-spin" />}
                Catat Produksi
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  accent: "teal" | "red" | "green" | "muted";
}) {
  const tint = {
    teal: "text-teal-600 bg-teal-50 dark:bg-teal-950/40 dark:text-teal-400",
    red: "text-red-600 bg-red-50 dark:bg-red-950/40 dark:text-red-400",
    green: "text-green-600 bg-green-50 dark:bg-green-950/40 dark:text-green-400",
    muted: "text-muted-foreground bg-muted",
  }[accent];
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3 sm:p-4">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${tint}`}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-base font-semibold tabular-nums sm:text-lg">{value}</p>
      </div>
    </div>
  );
}
