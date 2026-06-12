'use client';

import { ColumnDef } from '@tanstack/react-table';
import { Check, Trash2, X } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';

export type AdminAd = {
  id: number;
  title: string;
  description: string | null;
  banner_image: string;
  status: 'pending' | 'approved' | 'rejected';
  is_active: boolean;
  rejection_reason: string | null;
  outlet_id: number;
  outlet_name: string;
  product_id: string;
  product_name: string;
  time_start: string | null;
  time_end: string | null;
  starts_at: string;
  ends_at: string | null;
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const STATUS_LABEL: Record<AdminAd['status'], string> = {
  pending: 'Menunggu',
  approved: 'Disetujui',
  rejected: 'Ditolak',
};

const STATUS_CLASS: Record<AdminAd['status'], string> = {
  pending: 'text-amber-700 bg-amber-50',
  approved: 'text-emerald-700 bg-emerald-50',
  rejected: 'text-rose-700 bg-rose-50',
};

function getBannerSrc(image: string): string {
  if (!image) return '/avatar.png';
  if (image.startsWith('http') || image.startsWith('/')) return image;
  return `/ads/${image}`;
}

export type AdminAdHandlers = {
  onApprove: (ad: AdminAd) => void;
  onReject: (ad: AdminAd) => void;
  onDelete: (ad: AdminAd) => void;
};

export const getColumns = (handlers: AdminAdHandlers): ColumnDef<AdminAd>[] => [
  {
    accessorKey: 'banner_image',
    header: 'Banner',
    cell: ({ row }) => (
      <div className="relative h-12 w-28 rounded-lg overflow-hidden border bg-muted shrink-0">
        <Image src={getBannerSrc(row.original.banner_image)} alt={row.original.title} fill className="object-cover" />
      </div>
    ),
  },
  {
    accessorKey: 'title',
    header: 'Judul',
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-bold">{row.original.title}</span>
        {row.original.description && (
          <span className="text-xs text-muted-foreground line-clamp-1">{row.original.description}</span>
        )}
      </div>
    ),
  },
  {
    accessorKey: 'outlet_name',
    header: 'Outlet',
  },
  {
    accessorKey: 'product_name',
    header: 'Produk',
  },
  {
    accessorKey: 'time_start',
    header: 'Jam Mulai',
    cell: ({ row }) => row.original.time_start ?? '-',
  },
  {
    accessorKey: 'time_end',
    header: 'Jam Selesai',
    cell: ({ row }) => row.original.time_end ?? '-',
  },
  {
    accessorKey: 'starts_at',
    header: 'Periode Tayang',
    cell: ({ row }) => {
      const ad = row.original;
      return (
        <span className="text-xs whitespace-nowrap">
          {formatDate(ad.starts_at)} - {ad.ends_at ? formatDate(ad.ends_at) : 'Tanpa batas'}
        </span>
      );
    },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const ad = row.original;
      return (
        <div className="flex flex-col gap-1">
          <span className={`w-fit px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${STATUS_CLASS[ad.status]}`}>
            {STATUS_LABEL[ad.status]}
          </span>
          {ad.status === 'rejected' && ad.rejection_reason && (
            <span className="text-xs text-rose-600">{ad.rejection_reason}</span>
          )}
        </div>
      );
    },
  },
  {
    id: 'actions',
    header: 'Aksi',
    cell: ({ row }) => {
      const ad = row.original;
      return (
        <div className="flex items-center gap-2">
          {ad.status !== 'approved' && (
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => handlers.onApprove(ad)}>
              <Check className="h-3.5 w-3.5 mr-1" />
              Setujui
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => handlers.onReject(ad)}>
            <X className="h-3.5 w-3.5 mr-1" />
            Tolak
          </Button>
          <Button variant="destructive" size="sm" onClick={() => handlers.onDelete(ad)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      );
    },
  },
];
