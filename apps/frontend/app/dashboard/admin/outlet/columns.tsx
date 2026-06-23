'use client';

import { Column, ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, Star } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';

export type AdminOutlet = {
  id: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  avatar: string;
  ratings: string | null;
  review_count: number;
  is_open: boolean;
  tags: string[];
  features: string[];
  created_at: string | Date | null;
};

function getAvatarSrc(avatar: string): string {
  if (!avatar || avatar === 'avatar.png') return '/avatar.png';
  if (avatar.startsWith('http') || avatar.startsWith('/')) return avatar;
  return `/${avatar}`;
}

const sortableHeader = (label: string) =>
  function Header({ column }: { column: Column<AdminOutlet, unknown> }) {
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

export const columns: ColumnDef<AdminOutlet>[] = [
  {
    accessorKey: 'avatar',
    header: '',
    cell: ({ row }) => (
      <div className="relative h-10 w-10 rounded-lg overflow-hidden border bg-muted shrink-0">
        <Image
          src={getAvatarSrc(row.original.avatar)}
          alt={row.original.name}
          fill
          className="object-cover"
        />
      </div>
    ),
  },
  {
    accessorKey: 'name',
    header: sortableHeader('Nama Outlet'),
    cell: ({ row }) => (
      <div>
        <p className="font-bold">{row.original.name}</p>
        <p className="text-xs text-muted-foreground truncate max-w-[180px]">{row.original.address}</p>
      </div>
    ),
  },
  {
    accessorKey: 'email',
    header: 'Email',
    cell: ({ row }) => (
      <span className="text-sm truncate max-w-[160px] block">{row.original.email}</span>
    ),
  },
  {
    accessorKey: 'phone',
    header: 'Telepon',
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
    accessorKey: 'is_open',
    header: 'Status',
    cell: ({ row }) =>
      row.original.is_open ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Buka
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
          Tutup
        </span>
      ),
  },
  {
    accessorKey: 'tags',
    header: 'Tag',
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1 max-w-[160px]">
        {row.original.tags.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          row.original.tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium border border-border/40"
            >
              {tag}
            </span>
          ))
        )}
      </div>
    ),
  },
  {
    accessorKey: 'features',
    header: 'Fitur',
    cell: ({ row }) => (
      <span className="text-xs font-medium text-muted-foreground">
        {row.original.features.length === 0 ? '—' : `${row.original.features.length} fitur`}
      </span>
    ),
  },
  {
    accessorKey: 'created_at',
    header: sortableHeader('Terdaftar'),
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
];
