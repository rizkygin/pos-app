"use client"

import { ColumnDef } from "@tanstack/react-table"
import Badge from "@/components/ui/badge"

import { z } from "zod"

export const orderDetailSchema = z.object({
    id: z.number(),
    order_id: z.string(),
    product_name: z.string(),
    quantity: z.number(),
    note_product: z.string(),
    extra: z.any().optional().nullable(),
    summary_price: z.string(),
    created_at: z.union([z.string(), z.date()]).optional(),
    status: z.enum(["addToChart", "checkout"]).nullable().optional(),
})
import { Button } from "@/components/ui/button"
import { ArrowUpDown, ArrowUp } from "lucide-react"



export type OrderDetail = z.infer<typeof orderDetailSchema>

export const columns: ColumnDef<OrderDetail>[] = [
    {
        accessorKey: "id",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    No
                    <ArrowUp className="ml-2 h-4 w-4" />
                </Button>
            )
        },
        cell: ({ row, table }) => {
            const pageIndex = table.getState().pagination.pageIndex
            const pageSize = table.getState().pagination.pageSize
            return pageIndex * pageSize + row.index + 1
        },
    },
    {
        accessorKey: "created_at",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Tanggal
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
        cell: ({ row }) => {
            const date = row.getValue('created_at') as string | Date
            return new Date(date).toLocaleDateString('id-ID', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            })
        },
    },
    {
        accessorKey: "product_name",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Nama Produk
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
    },
    {
        accessorKey: "quantity",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Qty
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
    },
    {
        accessorKey: "summary_price",
        header: "Total Harga",
        cell: ({ row }) => {
            const summary_price = row.getValue('summary_price') as string
            return new Intl.NumberFormat('id-ID', {
                style: 'currency',
                currency: 'IDR',
            }).format(Number(summary_price))
        }
    },
    {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
            const status = row.getValue('status') as string
            return <Badge icon={status} />
        }
    }
]