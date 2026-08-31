"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ChefHat,
  History,
  Info,
  Loader2,
  Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LocalDateTime } from "@/components/local-datetime";
import { API_URL } from "@/lib/api-url";
import { fmtIDR } from "@/lib/utils/format";

// A product that can be produced: it holds stock of its own AND has a
// composition. That intersection is the whole definition of an in-house
// intermediate, and it is also the thing owners never discover on their own —
// see the empty state below.
type Producible = {
  id: string;
  product_name: string;
  unit: string;
  stock: string;
  avg_cost: string;
  yield_qty: string;
};

type PreviewItem = {
  product_id: string;
  name: string;
  qty: number;
  stock: number;
  unit_cost: number;
  cost: number;
  via: string[];
  short: boolean;
};

type Batch = {
  id: number;
  product_id: string;
  product_name: string;
  unit: string;
  qty: string;
  unit_cost: string | null;
  total_cost: string | null;
  note: string | null;
  created_at: string;
};

export function ProductionClient() {
  const [view, setView] = useState<"list" | "history">("list");
  const [items, setItems] = useState<Producible[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Whether the outlet has any stocked product at all. Distinguishes "you have
  // not set up a produced item yet" from "you have not set up stock yet", which
  // are different problems with different first steps.
  const [hasStocked, setHasStocked] = useState(false);

  const [target, setTarget] = useState<Producible | null>(null);
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<{ items: PreviewItem[]; total: number; unit: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/products/mine`, { credentials: "include" });
      const json = await res.json();
      const all: (Producible & { track_stock: boolean; has_recipe: boolean })[] = json.products ?? [];
      setHasStocked(all.some((p) => p.track_stock));
      setItems(all.filter((p) => p.track_stock && p.has_recipe));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadHistory = async () => {
    setBatchesLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/production/history?limit=100`, {
        credentials: "include",
      });
      const json = await res.json();
      setBatches(json.batches ?? []);
    } finally {
      setBatchesLoading(false);
    }
  };

  const open = (p: Producible) => {
    setTarget(p);
    // One batch is the number an owner thinks in ("sekali masak"), so that is
    // the default rather than 1 unit.
    setQty(String(Number(p.yield_qty) || 1));
    setNote("");
    setPreview(null);
    setError("");
    setWarnings([]);
  };

  // Re-price whenever the quantity settles. Debounced because this fires on
  // every keystroke in a number field and each call expands the whole recipe.
  useEffect(() => {
    if (!target) return;
    const n = Number(qty);
    if (!(n > 0)) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/products/${target.id}/production-preview?qty=${n}`,
          { credentials: "include" },
        );
        const json = await res.json();
        if (cancelled) return;
        if (json.success) {
          setPreview({ items: json.items ?? [], total: json.total_cost ?? 0, unit: json.unit_cost ?? 0 });
        } else {
          setPreview(null);
          setError(json.message ?? "");
        }
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [target, qty]);

  const submit = async () => {
    if (!target) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/products/${target.id}/production`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qty: Number(qty), note }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Gagal mencatat produksi");
      await load();
      // Shortfalls keep the dialog open so the owner actually reads which
      // ingredient went short; a clean run just closes.
      if (json.warnings?.length) {
        setWarnings(json.warnings);
        setPreview(null);
      } else {
        setTarget(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mencatat produksi");
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(
    () =>
      items.filter((p) =>
        p.product_name.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [items, search],
  );

  // ───────────────────────────────────────────────────────────────── history
  if (view === "history") {
    return (
      <div className="space-y-5 p-4 md:p-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={() => setView("list")}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Riwayat Produksi</h1>
            <p className="text-sm text-muted-foreground">
              Berapa biaya tiap batch, dan berapa HPP-nya per satuan.
            </p>
          </div>
        </div>

        {batchesLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-2 size-5 animate-spin" /> Memuat…
          </div>
        ) : batches.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Belum ada produksi tercatat.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card">
            <table className="w-full min-w-150 text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                  <th className="px-4 py-2.5 font-bold">Waktu</th>
                  <th className="px-4 py-2.5 font-bold">Produk</th>
                  <th className="px-4 py-2.5 text-right font-bold">Jadi</th>
                  <th className="px-4 py-2.5 text-right font-bold">Biaya Batch</th>
                  <th className="px-4 py-2.5 text-right font-bold">HPP / satuan</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-2.5 text-muted-foreground">
                      <LocalDateTime value={b.created_at} />
                      {b.note && (
                        <span className="block text-[11px] italic">{b.note}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-semibold">{b.product_name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {Number(b.qty)} {b.unit}
                    </td>
                    <td className="px-4 py-2.5 text-right font-black tabular-nums">
                      {fmtIDR(Number(b.total_cost ?? 0))}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {fmtIDR(Number(b.unit_cost ?? 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────── list
  return (
    <div className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Produksi</h1>
          <p className="text-sm text-muted-foreground">
            Masak/rakit barang sendiri: bahannya berkurang, stok hasilnya bertambah.
          </p>
        </div>
        <Button
          variant="outline"
          className="rounded-xl"
          onClick={() => {
            setView("history");
            loadHistory();
          }}
        >
          <History className="mr-1 size-4" /> Riwayat
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" /> Memuat…
        </div>
      ) : items.length === 0 ? (
        /* The state EVERY outlet is in until someone explains this, which is why
           the page exists. The Produksi action used to live only as a row button
           on the Stok page, and that button needs a product that already tracks
           stock AND already has a composition — so it never appeared, and the
           feature was unreachable in practice. An empty list here has to teach
           the setup, not just say "kosong". */
        <div className="rounded-2xl border-2 border-dashed border-border p-6">
          <div className="flex items-center gap-2">
            <ChefHat className="size-5 text-muted-foreground" />
            <h2 className="font-bold">Belum ada produk yang diproduksi sendiri</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Produksi dipakai untuk barang yang pian <em>buat sendiri</em> lalu
            disimpan — sambal yang dimasak per batch, adonan, bumbu dasar, barang
            rakitan. Bedanya dengan menu biasa: hasilnya punya stok sendiri, jadi
            saat terjual yang berkurang stok barang itu, bukan bahannya lagi.
          </p>

          <div className="mt-4 space-y-2 text-sm">
            <p className="font-bold">Cara bikinnya, sekali saja per produk:</p>
            <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
              <li>
                Buka <span className="font-medium text-foreground">Product</span>,
                bikin/edit produknya (misal “Sambal Bawang”).
              </li>
              <li>
                Nyalakan{" "}
                <span className="font-medium text-foreground">lacak stok</span> —
                ini yang bikin hasilnya punya tempat disimpan.
              </li>
              <li>
                Di bagian{" "}
                <span className="font-medium text-foreground">Komposisi Produk</span>,
                isi bahan-bahannya, lalu isi “sekali produksi jadi berapa”.
              </li>
              <li>Simpan — produknya langsung muncul di halaman ini.</li>
            </ol>
          </div>

          {!hasStocked && (
            <p className="mt-4 flex gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <Info className="mt-px size-4 shrink-0" />
              Belum ada produk yang dilacak stoknya sama sekali. Bahan mentahnya
              (beras, cabai, tepung) juga perlu “lacak stok” supaya biayanya
              kehitung waktu produksi.
            </p>
          )}

          <Button asChild className="mt-4 rounded-xl">
            <Link href="/dashboard/addproducts">Ke halaman Product</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Cari produk…"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card p-4 shadow-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-bold">{p.product_name}</p>
                  <p className="text-xs text-muted-foreground">
                    Stok{" "}
                    <span className="font-semibold tabular-nums text-foreground">
                      {Number(p.stock)} {p.unit}
                    </span>
                    {Number(p.avg_cost) > 0 && (
                      <> · HPP {fmtIDR(Number(p.avg_cost))}/{p.unit}</>
                    )}
                  </p>
                </div>
                <Button size="sm" className="shrink-0 rounded-xl" onClick={() => open(p)}>
                  <ChefHat className="mr-1 size-4" /> Produksi
                </Button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Record dialog. Hand-rolled overlay to match the Stok page, which has no
          dialog primitive either. */}
      {target && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !saving && setTarget(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl border bg-background p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Produksi {target.product_name}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Stok sekarang {Number(target.stock)} {target.unit}.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Jumlah jadi ({target.unit})</label>
              <Input
                type="number"
                min="0"
                step="any"
                autoFocus
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Catatan (opsional)</label>
              <Input
                placeholder="mis. masak pagi"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={120}
              />
            </div>

            {/* The point of the whole page: what this run will eat, and what the
                result will be worth, BEFORE it is booked. */}
            {previewing && !preview ? (
              <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Menghitung bahan…
              </div>
            ) : preview && preview.items.length > 0 ? (
              <div className="space-y-2 rounded-xl border border-border/60 p-3">
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  Bahan yang terpakai
                </p>
                <ul className="space-y-1 text-sm">
                  {preview.items.map((it) => (
                    <li key={it.product_id} className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {it.name}
                        {/* Nested ingredients reached through a pass-through
                            composite: say so, or the owner cannot tell why
                            bawang appears under a recipe that never lists it. */}
                        {it.via.length > 0 && (
                          <span className="text-[11px] text-muted-foreground">
                            {" "}
                            via {it.via.join(" › ")}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {it.qty} · {fmtIDR(it.cost)}
                      </span>
                    </li>
                  ))}
                </ul>
                {preview.items.some((i) => i.short) && (
                  <p className="flex gap-1.5 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    <AlertTriangle className="mt-px size-3.5 shrink-0" />
                    Stok bahan kurang, tapi produksi tetap bisa dicatat.
                  </p>
                )}
                <div className="flex items-baseline justify-between border-t pt-2 text-sm">
                  <span className="font-bold">Total biaya batch</span>
                  <span className="font-black tabular-nums">{fmtIDR(preview.total)}</span>
                </div>
                <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                  <span>HPP per {target.unit}</span>
                  <span className="tabular-nums">{fmtIDR(preview.unit)}</span>
                </div>
              </div>
            ) : null}

            {warnings.length > 0 && (
              <div className="space-y-1 rounded-xl bg-amber-50 p-3 dark:bg-amber-950/40">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                  Produksi tercatat, tapi stok bahan ini kurang:
                </p>
                <ul className="space-y-0.5 text-xs text-amber-800 dark:text-amber-300">
                  {warnings.map((w) => (
                    <li key={w}>• {w}</li>
                  ))}
                </ul>
              </div>
            )}

            {error && <p className="text-xs font-medium text-destructive">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setTarget(null)} disabled={saving}>
                {warnings.length > 0 ? "Tutup" : "Batal"}
              </Button>
              <Button onClick={submit} disabled={saving || !(Number(qty) > 0)}>
                {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
                Catat Produksi
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
