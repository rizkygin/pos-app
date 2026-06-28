'use client';

import { Column, ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, Eye, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type AdminCustomer = {
  id: number;
  user_id: string;
  name: string;
  email: string;
  phone: string | null;
  image: string | null;
  ratings: string | null;
  review_count: number;
  created_at: string | Date | null;
};

const sortableHeader = (label: string) =>
  function Header({ column }: { column: Column<AdminCustomer, unknown> }) {
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

export type CustomerHandlers = {
  onView: (customer: AdminCustomer) => void;
  onDelete: (customer: AdminCustomer) => void;
};

export const getColumns = (handlers: CustomerHandlers): ColumnDef<AdminCustomer>[] => [
  {
    accessorKey: 'name',
    header: sortableHeader('Nama'),
    cell: ({ row }) => (
      <div>
        <p className="font-bold">{row.original.name}</p>
        <p className="text-xs text-muted-foreground truncate max-w-[180px]">{row.original.email}</p>
      </div>
    ),
  },
  {
    accessorKey: 'phone',
    header: 'Telepon',
    cell: ({ row }) => row.original.phone || '—',
  },
  {
    accessorKey: 'ratings',
    header: sortableHeader('Rating'),
    cell: ({ row }) => (
      <div className="flex items-center gap-1">
        <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
        <span className="font-medium">{Number(row.original.ratings ?? 5).toFixed(1)}</span>
        <span className="text-xs text-muted-foreground">({row.original.review_count})</span>
      </div>
    ),
  },
  {
    accessorKey: 'created_at',
    header: sortableHeader('Terdaftar'),
    cell: ({ row }) => {
      const d = row.original.created_at;
      if (!d) return '—';
      return new Date(d).toLocaleDateString('id-ID', { year: 'numeric', month: 'short', day: 'numeric' });
    },
  },
  {
    id: 'actions',
    header: 'Aksi',
    cell: ({ row }) => (
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" title="Lihat" onClick={() => handlers.onView(row.original)}>
          <Eye className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" title="Hapus" onClick={() => handlers.onDelete(row.original)}>
          <Trash2 className="h-4 w-4 text-rose-500" />
        </Button>
      </div>
    ),
  },
];
