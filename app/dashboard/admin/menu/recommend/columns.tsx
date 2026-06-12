'use client';

import { Column, ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, Pencil, Star } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';

export type AdminProduct = {
  id: string;
  product_name: string;
  image: string;
  category: string;
  price: string;
  price_mark_down: string;
  ratings: string | null;
  review_count: number;
  is_recommended: boolean;
  outlet_id: number;
  outlet_name: string;
  traffic_today: number;
  traffic_week: number;
  traffic_month: number;
};

function getProductImageSrc(image: string): string {
  if (!image || image === 'avatar.png') return '/avatar.png';
  if (image.startsWith('http') || image.startsWith('/')) return image;
  return `/products/${image}`;
}

const formatCurrency = (value: string) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(Number(value));

const sortableHeader = (label: string) =>
  function Header({ column }: { column: Column<AdminProduct, unknown> }) {
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

export type AdminProductHandlers = {
  onToggleRecommend: (product: AdminProduct, value: boolean) => void;
  onEdit: (product: AdminProduct) => void;
  onShowRating: (product: AdminProduct) => void;
};

export const getColumns = (
  handlers: AdminProductHandlers,
): ColumnDef<AdminProduct>[] => [
  {
    accessorKey: 'image',
    header: '',
    cell: ({ row }) => (
      <div className="relative h-10 w-10 rounded-lg overflow-hidden border bg-muted shrink-0">
        <Image
          src={getProductImageSrc(row.original.image)}
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
    accessorKey: 'price',
    header: sortableHeader('Harga'),
    cell: ({ row }) => {
      const { price, price_mark_down } = row.original;
      const hasDiscount = price_mark_down && price_mark_down !== '0';
      return (
        <div className="flex flex-col">
          <span className="font-bold">
            {formatCurrency(hasDiscount ? price_mark_down : price)}
          </span>
          {hasDiscount && (
            <span className="text-xs text-muted-foreground line-through">
              {formatCurrency(price)}
            </span>
          )}
        </div>
      );
    },
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
    accessorKey: 'traffic_today',
    header: sortableHeader('Hari Ini'),
  },
  {
    accessorKey: 'traffic_week',
    header: sortableHeader('Minggu Ini'),
  },
  {
    accessorKey: 'traffic_month',
    header: sortableHeader('Bulan Ini'),
  },
  {
    accessorKey: 'is_recommended',
    header: 'Rekomendasi',
    cell: ({ row }) => {
      const isRecommended = row.original.is_recommended;
      return (
        <button
          type="button"
          role="switch"
          aria-checked={isRecommended}
          onClick={() => handlers.onToggleRecommend(row.original, !isRecommended)}
          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ${isRecommended ? 'bg-emerald-500' : 'bg-muted'}`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition-transform duration-200 ${isRecommended ? 'translate-x-5' : 'translate-x-0'}`}
          />
        </button>
      );
    },
  },
  {
    id: 'actions',
    header: 'Aksi',
    cell: ({ row }) => (
      <Button
        variant="outline"
        size="sm"
        onClick={() => handlers.onEdit(row.original)}
      >
        <Pencil className="h-3.5 w-3.5 mr-1" />
        Edit
      </Button>
    ),
  },
];
