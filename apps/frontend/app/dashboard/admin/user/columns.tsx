'use client';

import { Column, ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, Eye, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  image: string | null;
  emailVerified: boolean;
  role: 'admin' | 'owner' | 'courier' | 'customer' | 'none';
  created_at: string | Date | null;
};

const sortableHeader = (label: string) =>
  function Header({ column }: { column: Column<AdminUser, unknown> }) {
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

const roleVariant: Record<AdminUser['role'], 'default' | 'secondary' | 'outline' | 'destructive'> = {
  admin: 'destructive',
  owner: 'default',
  courier: 'secondary',
  customer: 'outline',
  none: 'outline',
};

export type UserHandlers = {
  onView: (user: AdminUser) => void;
  onEdit: (user: AdminUser) => void;
  onDelete: (user: AdminUser) => void;
};

export const getColumns = (handlers: UserHandlers): ColumnDef<AdminUser>[] => [
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
    accessorKey: 'role',
    header: 'Role',
    cell: ({ row }) => (
      <Badge variant={roleVariant[row.original.role]} className="capitalize">
        {row.original.role}
      </Badge>
    ),
  },
  {
    accessorKey: 'emailVerified',
    header: 'Verifikasi',
    cell: ({ row }) =>
      row.original.emailVerified ? (
        <span className="text-xs font-bold text-emerald-600">Terverifikasi</span>
      ) : (
        <span className="text-xs font-medium text-muted-foreground">Belum</span>
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
