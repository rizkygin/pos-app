"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { API_URL } from "@/lib/api-url";

type Product = {
  id: string;
  product_name: string;
  unit: string;
  stock: string;
  buying_price: string;
};

const rupiah = (v: number | string) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(
    Number(v) || 0,
  );

export function StockClient() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/products/mine`, { credentials: "include" });
        const json = await res.json();
        setProducts(json.products ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(
    () => products.filter((p) => p.product_name.toLowerCase().includes(search.toLowerCase())),
    [products, search],
  );
  const totalValue = useMemo(
    () => products.reduce((s, p) => s + Number(p.stock || 0) * Number(p.buying_price || 0), 0),
    [products],
  );

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Boxes className="size-5 text-teal-600 dark:text-teal-400" />
            Stok
          </h1>
          <p className="text-sm text-muted-foreground">
            Stok dipengaruhi oleh faktur: pembelian menambah, penjualan mengurangi.
          </p>
        </div>
        <div className="rounded-xl border bg-card px-4 py-2 text-right">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Nilai Stok (HPP)</p>
          <p className="text-lg font-semibold tabular-nums">{rupiah(totalValue)}</p>
        </div>
      </div>

      <Input
        placeholder="Cari produk…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs"
      />

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Produk</th>
                <th className="px-3 py-2 text-right font-medium">Stok</th>
                <th className="px-3 py-2 text-right font-medium">HPP / Unit</th>
                <th className="px-3 py-2 text-right font-medium">Nilai</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const stock = Number(p.stock || 0);
                return (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{p.product_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={stock <= 0 ? "text-destructive" : ""}>
                        {stock} {p.unit}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {rupiah(p.buying_price)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {rupiah(stock * Number(p.buying_price || 0))}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    Tidak ada produk.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
