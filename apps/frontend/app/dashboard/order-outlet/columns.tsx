"use client"

import React from "react"
import { ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { ArrowUpDown, ArrowRight, Clock, CheckCircle2, ChefHat, Package, Bike, XCircle, ShoppingBag } from "lucide-react"
import Link from "next/link"
import { format } from "date-fns"
import { id as idLocale } from "date-fns/locale"

export type OrderStatus = "pending" | "confirmed" | "preparing" | "ready" | "on_delivery" | "delivered" | "cancelled"

export type Order = {
    orderId: string
    customerName: string
    itemCount: number
    totalAmount: number
    status: OrderStatus
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
            const status = row.getValue("status") as OrderStatus
            const map: Record<OrderStatus, { label: string; icon: React.ReactNode; cls: string }> = {
                pending:     { label: "Pending",      icon: <Clock className="w-3.5 h-3.5" />,        cls: "bg-amber-50 text-amber-700 border-amber-200" },
                confirmed:   { label: "Dikonfirmasi", icon: <CheckCircle2 className="w-3.5 h-3.5" />, cls: "bg-blue-50 text-blue-700 border-blue-200" },
                preparing:   { label: "Disiapkan",    icon: <ChefHat className="w-3.5 h-3.5" />,      cls: "bg-violet-50 text-violet-700 border-violet-200" },
                ready:       { label: "Siap",         icon: <Package className="w-3.5 h-3.5" />,      cls: "bg-cyan-50 text-cyan-700 border-cyan-200" },
                on_delivery: { label: "Diantar",      icon: <Bike className="w-3.5 h-3.5" />,         cls: "bg-orange-50 text-orange-700 border-orange-200" },
                delivered:   { label: "Selesai",      icon: <ShoppingBag className="w-3.5 h-3.5" />,  cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                cancelled:   { label: "Dibatalkan",   icon: <XCircle className="w-3.5 h-3.5" />,      cls: "bg-red-50 text-red-700 border-red-200" },
            }
            const cfg = map[status] ?? map.pending
            return (
                <div className={`w-fit p-1 px-2.5 rounded-full flex items-center gap-1 text-xs font-black border ${cfg.cls}`}>
                    {cfg.icon} {cfg.label}
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
