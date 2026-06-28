'use client';

import { Column, ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, Bike, ChevronRight, Globe, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type AdminOrder = {
  id: string;
  status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'on_delivery' | 'delivered' | 'cancelled';
  outlet_name: string;
  customer_name: string;
  courier_name: string | null;
  subtotal: number;
  delivery_fee: number;
  discount_amount: number;
  total_paid: number;
  is_offline: boolean;
  created_at: string | Date | null;
};

const STATUS_MAP: Record<AdminOrder['status'], { label: string; className: string }> = {
  pending: { label: 'Menunggu', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  confirmed: { label: 'Dikonfirmasi', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  preparing: { label: 'Diproses', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  ready: { label: 'Siap', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  on_delivery: { label: 'Diantar', className: 'bg-violet-50 text-violet-700 border-violet-200' },
  delivered: { label: 'Selesai', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  cancelled: { label: 'Dibatalkan', className: 'bg-rose-50 text-rose-700 border-rose-200' },
};

function fmtIDR(n: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}

const sortableHeader = (label: string) =>
  function Header({ column }: { column: Column<AdminOrder, unknown> }) {
    return (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      >
        {label}
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    );
  };

export const columns: ColumnDef<AdminOrder>[] = [
  {
    accessorKey: 'id',
    header: 'ID Pesanan',
    cell: ({ row }) => (
      <span className="font-mono text-xs font-bold">#{row.original.id.slice(-8).toUpperCase()}</span>
    ),
  },
  {
    accessorKey: 'is_offline',
    header: 'Tipe',
    cell: ({ row }) =>
      row.original.is_offline ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold">
          <Store className="h-3 w-3" /> Offline
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-bold">
          <Globe className="h-3 w-3" /> Online
        </span>
      ),
  },
  {
    accessorKey: 'customer_name',
    header: 'Pelanggan',
  },
  {
    accessorKey: 'courier_name',
    header: 'Kurir',
    cell: ({ row }) =>
      row.original.courier_name ? (
        <span className="flex items-center gap-1.5">
          <Bike className="h-3.5 w-3.5 text-orange-500" />
          {row.original.courier_name}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Belum ada kurir</span>
      ),
  },
  {
    accessorKey: 'outlet_name',
    header: 'Outlet',
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const s = STATUS_MAP[row.original.status];
      return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-bold ${s.className}`}>
          {s.label}
        </span>
      );
    },
  },
  {
    accessorKey: 'total_paid',
    header: sortableHeader('Total Dibayar'),
    cell: ({ row }) => <span className="font-bold">{fmtIDR(row.original.total_paid)}</span>,
  },
  {
    accessorKey: 'delivery_fee',
    header: 'Fee Kurir',
    cell: ({ row }) =>
      row.original.delivery_fee > 0 ? (
        <span className="font-medium text-orange-600">{fmtIDR(row.original.delivery_fee)}</span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: 'created_at',
    header: sortableHeader('Tanggal'),
    cell: ({ row }) => {
      const d = row.original.created_at;
      if (!d) return '—';
      return new Date(d).toLocaleDateString('id-ID', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    },
  },
  {
    id: 'chevron',
    header: '',
    cell: () => <ChevronRight className="h-4 w-4 text-muted-foreground" />,
  },
];
