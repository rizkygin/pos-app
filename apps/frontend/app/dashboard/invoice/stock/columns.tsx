"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, History } from "lucide-react";
import { fmtIDR } from "@/lib/utils/format";

export type StockRow = {
  id: string;
  product_name: string;
  unit: string;
  stock: number;
  buying_price: number;
  value: number;
};

const sortHeader = (label: string) =>
  function Header({ column }: { column: { toggleSorting: (d?: boolean) => void; getIsSorted: () => false | "asc" | "desc" } }) {
    return (
      <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
        {label}
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    );
  };

// Factory instead of a static array: the last column needs the client's
// "open per-item flow" callback.
export const stockColumns = (
  onFlow: (row: StockRow) => void,
): ColumnDef<StockRow>[] => [
  {
    accessorKey: "product_name",
    header: sortHeader("Produk"),
    cell: ({ row }) => <span className="font-medium">{row.original.product_name}</span>,
  },
  {
    accessorKey: "stock",
    header: sortHeader("Stok"),
    cell: ({ row }) => {
      const s = row.original.stock;
      return (
        <span className={`tabular-nums font-medium ${s <= 0 ? "text-destructive" : ""}`}>
          {s} {row.original.unit}
        </span>
      );
    },
  },
  {
    id: "status",
    header: () => <span className="px-3">Status</span>,
    cell: ({ row }) => {
      const habis = row.original.stock <= 0;
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            habis
              ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
              : "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
          }`}
        >
          <span className={`size-1.5 rounded-full ${habis ? "bg-red-500" : "bg-green-500"}`} />
          {habis ? "Habis" : "Tersedia"}
        </span>
      );
    },
  },
  {
    accessorKey: "buying_price",
    header: () => <span>HPP / Unit</span>,
    cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{fmtIDR(row.original.buying_price)}</span>,
  },
  {
    accessorKey: "value",
    header: sortHeader("Nilai"),
    cell: ({ row }) => <span className="tabular-nums">{fmtIDR(row.original.value)}</span>,
  },
  {
    id: "flow",
    header: () => <span className="px-3">Alur</span>,
    cell: ({ row }) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onFlow(row.original)}
        className="text-teal-700 hover:bg-teal-50 hover:text-teal-800 dark:text-teal-400"
      >
        <History className="size-4" /> Alur Stok
      </Button>
    ),
  },
];
