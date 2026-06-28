'use client';

import { Column, ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, MessageSquare, Star } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { resolveProductImage, isBackendImage } from '@/lib/image-src';

export type RatingProduct = {
  id: string;
  product_name: string;
  image: string;
  category: string;
  ratings: string | null;
  review_count: number;
  outlet_id: number;
  outlet_name: string;
};

const sortableHeader = (label: string) =>
  function Header({ column }: { column: Column<RatingProduct, unknown> }) {
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

export type RatingHandlers = {
  onShowRating: (product: RatingProduct) => void;
};

export const getColumns = (
  handlers: RatingHandlers,
): ColumnDef<RatingProduct>[] => [
  {
    accessorKey: 'image',
    header: '',
    cell: ({ row }) => (
      <div className="relative h-10 w-10 rounded-lg overflow-hidden border bg-muted shrink-0">
        <Image
          src={resolveProductImage(row.original.image)}
          unoptimized={isBackendImage(row.original.image)}
          alt={row.original.product_name}
          fill
          className="object-cover"
        />
      </div>
    ),
  },
  {
    accessorKey: 'product_name',
    header: sortableHeader('Produk'),
  },
  {
    accessorKey: 'outlet_name',
    header: sortableHeader('Outlet'),
  },
  {
    accessorKey: 'category',
    header: 'Kategori',
  },
  {
    accessorKey: 'ratings',
    header: sortableHeader('Rating'),
    cell: ({ row }) => (
      <button
        onClick={() => handlers.onShowRating(row.original)}
        className="flex items-center gap-1 hover:underline"
      >
        <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
        <span className="font-medium">
          {Number(row.original.ratings ?? 5).toFixed(1)}
        </span>
        <span className="text-xs text-muted-foreground">
          ({row.original.review_count})
        </span>
      </button>
    ),
  },
  {
    accessorKey: 'review_count',
    header: sortableHeader('Jumlah Ulasan'),
  },
  {
    id: 'actions',
    header: 'Aksi',
    cell: ({ row }) => (
      <Button
        variant="outline"
        size="sm"
        onClick={() => handlers.onShowRating(row.original)}
      >
        <MessageSquare className="h-3.5 w-3.5 mr-1" />
        Lihat Ulasan
      </Button>
    ),
  },
];
