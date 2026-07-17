"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, Loader2, CheckCircle2, Wallet, Ban, Printer, Pencil } from "lucide-react";
import { fmtIDR } from "@/lib/utils/format";

export type SalesRow = {
  id: number;
  number: string;
  status: "draft" | "posted" | "partial" | "paid" | "void";
  party_name: string | null;
  issue_date: string;
  due_date: string | null;
  total: string;
  amount_paid: string;
  created_by_name?: string | null;
};

export type InvoiceAction = "post" | "pay" | "void";

export const SALES_STATUS_STYLE: Record<SalesRow["status"], string> = {
  draft: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  posted: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  partial: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  paid: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  void: "bg-red-100 text-red-600 line-through dark:bg-red-950 dark:text-red-300",
};
export const SALES_STATUS_LABEL: Record<SalesRow["status"], string> = {
  draft: "Draft",
  posted: "Diposting",
  partial: "Sebagian",
  paid: "Lunas",
  void: "Batal",
};

// Late = billed (posted/partial) but not settled by the end of its due date.
// Derived, never stored: it flips off by itself the moment the invoice is paid.
export function isLateInvoice(inv: Pick<SalesRow, "status" | "due_date">) {
  if (!inv.due_date) return false;
  if (inv.status !== "posted" && inv.status !== "partial") return false;
  const due = new Date(inv.due_date);
  due.setHours(23, 59, 59, 999); // late starting the day AFTER the due date
  return due.getTime() < Date.now();
}

export function lateDays(dueDate: string) {
  const due = new Date(dueDate);
  due.setHours(23, 59, 59, 999);
  return Math.max(1, Math.ceil((Date.now() - due.getTime()) / 86_400_000));
}

const sortHeader = (label: string) =>
  function Header({ column }: { column: { toggleSorting: (d?: boolean) => void; getIsSorted: () => false | "asc" | "desc" } }) {
    return (
      <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
        {label}
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    );
  };

export function getSalesColumns(opts: {
  busyId: number | null;
  onAction: (id: number, kind: InvoiceAction) => void;
  onEdit: (id: number) => void;
}): ColumnDef<SalesRow>[] {
  // Buttons stop propagation so clicking an action never triggers the row click.
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return [
    {
      accessorKey: "number",
      header: sortHeader("No. Faktur"),
      cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.number}</span>,
    },
    {
      id: "party",
      header: () => <span className="px-3">Pelanggan</span>,
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.party_name || "—"}</span>,
    },
    {
      accessorKey: "due_date",
      header: sortHeader("Jatuh Tempo"),
      cell: ({ row }) => {
        if (!row.original.due_date) return <span className="tabular-nums text-muted-foreground">—</span>;
        const late = isLateInvoice(row.original);
        return (
          <div className="tabular-nums">
            <span className={late ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground"}>
              {new Date(row.original.due_date).toLocaleDateString("id-ID")}
            </span>
            {late && (
              <p className="text-[11px] font-medium text-red-600 dark:text-red-400">
                Terlambat {lateDays(row.original.due_date)} hari
              </p>
            )}
          </div>
        );
      },
    },
    {
      id: "total",
      accessorFn: (r) => Number(r.total),
      header: sortHeader("Total"),
      cell: ({ row }) => <span className="tabular-nums">{fmtIDR(Number(row.original.total))}</span>,
    },
    {
      id: "paid",
      accessorFn: (r) => Number(r.amount_paid),
      header: sortHeader("Dibayar"),
      cell: ({ row }) => {
        const total = Number(row.original.total);
        const paid = Number(row.original.amount_paid);
        if (!(paid > 0)) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="tabular-nums">
            <span className={row.original.status === "paid" ? "text-green-600 dark:text-green-400" : ""}>
              {fmtIDR(paid)}
            </span>
            {row.original.status === "partial" && (
              <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                Sisa {fmtIDR(total - paid)}
              </p>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: () => <span className="px-3">Status</span>,
      cell: ({ row }) => (
        <div className="flex flex-col items-start gap-1">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SALES_STATUS_STYLE[row.original.status]}`}>
            {SALES_STATUS_LABEL[row.original.status]}
          </span>
          {isLateInvoice(row.original) && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
              Terlambat
            </span>
          )}
        </div>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Aksi</span>,
      cell: ({ row }) => {
        const inv = row.original;
        if (opts.busyId === inv.id) {
          return <Loader2 className="ml-auto size-4 animate-spin text-muted-foreground" />;
        }
        return (
          <div className="flex justify-end gap-1">
            {inv.status === "draft" && (
              <Button
                size="xs"
                variant="outline"
                onClick={(e) => {
                  stop(e);
                  opts.onEdit(inv.id);
                }}
              >
                <Pencil className="size-3.5" /> Ubah
              </Button>
            )}
            {inv.status === "draft" && (
              <Button
                size="xs"
                variant="outline"
                onClick={(e) => {
                  stop(e);
                  opts.onAction(inv.id, "post");
                }}
              >
                <CheckCircle2 className="size-3.5" /> Posting
              </Button>
            )}
            {(inv.status === "posted" || inv.status === "partial") && (
              <Button
                size="xs"
                className="bg-green-600 text-white hover:bg-green-700"
                onClick={(e) => {
                  stop(e);
                  opts.onAction(inv.id, "pay");
                }}
              >
                <Wallet className="size-3.5" /> Bayar
              </Button>
            )}
            {inv.status !== "void" && (
              <a
                href={`/dashboard/invoice/sales/${inv.id}/print`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={stop}
              >
                <Button size="xs" variant="ghost" title="Cetak / PDF">
                  <Printer className="size-3.5" />
                </Button>
              </a>
            )}
            {inv.status !== "void" && (
              <Button
                size="xs"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={(e) => {
                  stop(e);
                  opts.onAction(inv.id, "void");
                }}
              >
                <Ban className="size-3.5" />
              </Button>
            )}
          </div>
        );
      },
    },
  ];
}
