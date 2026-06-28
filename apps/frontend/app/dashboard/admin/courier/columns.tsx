'use client';

import { Column, ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, Bike, Car, Eye, Pencil, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type AdminCourier = {
  id: number;
  user_id: string;
  name: string;
  email: string;
  phone: string | null;
  avatar: string;
  vehicle_plate: string;
  vehicle_type: 'car' | 'motorcycle';
  ratings: string | null;
  review_count: number;
  created_at: string | Date | null;
};

const sortableHeader = (label: string) =>
  function Header({ column }: { column: Column<AdminCourier, unknown> }) {
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

export type CourierHandlers = {
  onView: (courier: AdminCourier) => void;
  onEdit: (courier: AdminCourier) => void;
  onDelete: (courier: AdminCourier) => void;
};

export const getColumns = (handlers: CourierHandlers): ColumnDef<AdminCourier>[] => [
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
    accessorKey: 'vehicle_plate',
    header: 'Kendaraan',
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        {row.original.vehicle_type === 'car' ? (
          <Car className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Bike className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="font-medium">{row.original.vehicle_plate}</span>
      </div>
    ),
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
        <Button variant="ghost" size="icon" title="Edit" onClick={() => handlers.onEdit(row.original)}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" title="Hapus" onClick={() => handlers.onDelete(row.original)}>
          <Trash2 className="h-4 w-4 text-rose-500" />
        </Button>
      </div>
    ),
  },
];
