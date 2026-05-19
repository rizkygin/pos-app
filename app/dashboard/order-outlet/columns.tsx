"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { ArrowUpDown, BadgeDollarSign, CircleEllipsis, Clock, ArrowRight } from "lucide-react"
import Link from "next/link"
import { format } from "date-fns"
import { id as idLocale } from "date-fns/locale"

export type Order = {
    orderId: string
    customerName: string
    itemCount: number
    totalAmount: number
    status: "addToChart" | "checkout" | null
    createdAt: string | null
}

function fmtIDR(n: number) {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n)
}

export const columns: ColumnDef<Order>[] = [
    {
        accessorKey: "orderId",
        header: "Order ID",
        cell: ({ row }) => (
            <span className="font-black text-sm">#{(row.getValue("orderId") as string).slice(-8).toUpperCase()}</span>
        ),
    },
    {
        accessorKey: "customerName",
        header: ({ column }) => (
            <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
                Pelanggan <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
        ),
        cell: ({ row }) => <span className="font-semibold">{row.getValue("customerName")}</span>,
    },
    {
        accessorKey: "itemCount",
        header: ({ column }) => (
            <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
                Item <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
        ),
        cell: ({ row }) => (
            <span className="text-muted-foreground font-semibold">{row.getValue("itemCount")} item</span>
        ),
    },
    {
        accessorKey: "totalAmount",
        header: ({ column }) => (
            <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
                Total <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
        ),
        cell: ({ row }) => <span className="font-black">{fmtIDR(row.getValue("totalAmount"))}</span>,
    },
    {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
            const status = row.getValue("status") as string | null
            if (status === "checkout") {
                return (
                    <div className="w-fit p-1 px-2.5 bg-emerald-50 text-emerald-700 rounded-full flex items-center gap-1 text-xs font-black border border-emerald-200">
                        <BadgeDollarSign className="w-3.5 h-3.5 text-emerald-500" /> Selesai
                    </div>
                )
            }
            if (status === "addToChart") {
                return (
                    <div className="w-fit p-1 px-2.5 bg-blue-50 text-blue-700 rounded-full flex items-center gap-1 text-xs font-black border border-blue-200">
                        <CircleEllipsis className="w-3.5 h-3.5 text-blue-500" /> Diproses
                    </div>
                )
            }
            return (
                <div className="w-fit p-1 px-2.5 bg-amber-50 text-amber-700 rounded-full flex items-center gap-1 text-xs font-black border border-amber-200">
                    <Clock className="w-3.5 h-3.5 text-amber-500" /> Pending
                </div>
            )
        },
        filterFn: (row, _id, value) => value === "all" || row.getValue("status") === value,
    },
    {
        accessorKey: "createdAt",
        header: ({ column }) => (
            <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
                Waktu <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
        ),
        cell: ({ row }) => {
            const val = row.getValue("createdAt") as string | null
            return (
                <span className="text-muted-foreground text-xs font-semibold whitespace-nowrap">
                    {val ? format(new Date(val), "d MMM yyyy, HH:mm", { locale: idLocale }) : "-"}
                </span>
            )
        },
        sortingFn: (a, b) => {
            const dateA = a.getValue("createdAt") as string | null
            const dateB = b.getValue("createdAt") as string | null
            return new Date(dateA ?? 0).getTime() - new Date(dateB ?? 0).getTime()
        },
    },
    {
        id: "detail",
        cell: ({ row }) => (
            <Link
                href={`/dashboard/order-outlet/${row.getValue("orderId")}`}
                className="flex items-center gap-1 text-xs font-bold text-rose-600 hover:text-rose-700 transition-colors"
            >
                Detail <ArrowRight className="h-3 w-3" />
            </Link>
        ),
    },
]
