"use client"

import * as React from "react"
import {
    ColumnDef,
    SortingState,
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search, Filter, Loader2, CalendarDays, X } from "lucide-react"
import { Order } from "./columns"

interface OrdersTableProps {
    columns: ColumnDef<Order>[]
    data: Order[]
    page: number
    limit: number
    count: number
    loading: boolean
    search: string
    status: string
    dateFrom: string
    dateTo: string
    onPageChange: (page: number) => void
    onLimitChange: (limit: number) => void
    onSearchChange: (search: string) => void
    onStatusChange: (status: string) => void
    onDateFromChange: (v: string) => void
    onDateToChange: (v: string) => void
}

const STATUS_OPTIONS = [
    { value: "all",       label: "Semua Status" },
    { value: "pending",   label: "Pending" },
    { value: "aktif",     label: "Aktif (Dikonfirmasi – Diantar)" },
    { value: "selesai",   label: "Selesai (Delivered)" },
    { value: "cancelled", label: "Dibatalkan" },
]

export function OrdersTable({
    columns,
    data,
    page,
    limit,
    count,
    loading,
    search,
    status,
    dateFrom,
    dateTo,
    onPageChange,
    onLimitChange,
    onSearchChange,
    onStatusChange,
    onDateFromChange,
    onDateToChange,
}: OrdersTableProps) {
    const [sorting, setSorting] = React.useState<SortingState>([])

    const pageCount = Math.ceil(count / limit) || 1

    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        onSortingChange: setSorting,
        manualPagination: true,
        pageCount,
        state: { sorting },
    })

    return (
        <div className="space-y-4">
            {/* Search + filter bar */}
            <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Cari pelanggan atau order ID..."
                            value={search}
                            onChange={(e) => onSearchChange(e.target.value)}
                            className="pl-9 font-semibold"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
                        <select
                            value={status}
                            onChange={(e) => onStatusChange(e.target.value)}
                            className="text-xs font-semibold border border-border/60 rounded-md px-3 py-1.5 bg-background text-foreground"
                        >
                            {STATUS_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Date range */}
                <div className="flex flex-wrap items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex items-center gap-2">
                        <input
                            type="date"
                            value={dateFrom}
                            max={dateTo || undefined}
                            onChange={(e) => onDateFromChange(e.target.value)}
                            className="text-xs font-semibold border border-border/60 rounded-md px-3 py-1.5 bg-background text-foreground"
                        />
                        <span className="text-xs text-muted-foreground font-semibold">–</span>
                        <input
                            type="date"
                            value={dateTo}
                            min={dateFrom || undefined}
                            onChange={(e) => onDateToChange(e.target.value)}
                            className="text-xs font-semibold border border-border/60 rounded-md px-3 py-1.5 bg-background text-foreground"
                        />
                    </div>
                    {(dateFrom || dateTo) && (
                        <button
                            onClick={() => { onDateFromChange(""); onDateToChange(""); }}
                            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <X className="h-3.5 w-3.5" /> Reset tanggal
                        </button>
                    )}
                </div>
            </div>

            {/* Table */}
            <div className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden">
                <Table>
                    <TableHeader>
                        {table.getHeaderGroups().map((hg) => (
                            <TableRow key={hg.id} className="bg-muted/30 hover:bg-muted/30">
                                {hg.headers.map((header) => (
                                    <TableHead key={header.id} className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                                    </TableHead>
                                ))}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={columns.length} className="h-32 text-center">
                                    <div className="flex items-center justify-center gap-2 text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        <span className="text-sm font-semibold">Memuat pesanan...</span>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : table.getRowModel().rows.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow key={row.id} className="hover:bg-muted/20 transition-colors">
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id}>
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={columns.length} className="h-32 text-center text-muted-foreground font-semibold">
                                    Tidak ada pesanan ditemukan
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>

                {/* Pagination */}
                <div className="flex items-center justify-between px-5 py-3.5 border-t border-border/40 bg-muted/10">
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground font-semibold">
                            {count} pesanan · halaman {page} dari {pageCount}
                        </span>
                        <select
                            value={limit}
                            onChange={(e) => { onLimitChange(Number(e.target.value)); onPageChange(1); }}
                            className="text-xs font-semibold border border-border/60 rounded-md px-2 py-1 bg-background"
                        >
                            {[10, 25, 50].map((n) => (
                                <option key={n} value={n}>{n} / halaman</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1 || loading}>
                            Sebelumnya
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount || loading}>
                            Berikutnya
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}
