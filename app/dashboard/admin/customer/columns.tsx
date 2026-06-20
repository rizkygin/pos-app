'use client';

import { useState } from 'react';
import { Column, ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, Loader2, MapPin, Star, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { deleteCustomerAction } from './actions';

type CustomerLocation = {
  id: number;
  label: string;
  address: string;
  lat: string;
  lon: string;
  note: string | null;
  is_default: boolean;
};

function openInGoogleMaps(location: CustomerLocation) {
  const url = `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lon}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export type AdminCustomer = {
  id: number;
  user_id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  avatar: string | null;
  ratings: string | null;
  review_count: number;
  created_at: string | Date | null;
};

function getAvatarSrc(avatar: string | null): string {
  if (!avatar || avatar === 'avatar.png') return '/avatar.png';
  if (avatar.startsWith('http') || avatar.startsWith('/')) return avatar;
  return `/${avatar}`;
}

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

function CustomerActionsCell({
  customer,
  onMutated,
}: {
  customer: AdminCustomer;
  onMutated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        size="icon-sm"
        variant="ghost"
        className="text-destructive hover:bg-destructive/10"
        onClick={() => setOpen(true)}
        title="Hapus pelanggan"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10">
            <Trash2 className="h-5 w-5 text-destructive" />
          </AlertDialogMedia>
          <AlertDialogTitle>Hapus Pelanggan</AlertDialogTitle>
          <AlertDialogDescription>
            Akun pelanggan <strong>{customer.name}</strong> ({customer.email}) akan dihapus dan
            tidak bisa digunakan lagi. Email ini tidak dapat dipakai untuk mendaftar ulang.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={async (e) => {
              e.preventDefault();
              setBusy(true);
              const res = await deleteCustomerAction(customer.id);
              setBusy(false);
              if (res.success) {
                setOpen(false);
                onMutated();
              }
            }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Hapus'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CustomerLocationsCell({ customer }: { customer: AdminCustomer }) {
  const [open, setOpen] = useState(false);
  const [locations, setLocations] = useState<CustomerLocation[] | null>(null);
  const [loading, setLoading] = useState(false);

  const handleOpenChange = async (next: boolean) => {
    setOpen(next);
    if (next && locations === null) {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/customers/locations?customerId=${customer.id}`);
        const result = await res.json();
        setLocations(result.success ? result.data : []);
      } catch (error) {
        console.error('Failed to fetch customer locations:', error);
        setLocations([]);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <MapPin className="h-3.5 w-3.5" />
          Lokasi
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : !locations || locations.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            Belum ada lokasi tersimpan.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {locations.map((location) => (
              <button
                key={location.id}
                onClick={() => openInGoogleMaps(location)}
                className="flex items-start gap-2 rounded-md p-2 text-left hover:bg-muted transition-colors"
              >
                <MapPin className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="font-medium text-sm flex items-center gap-1.5">
                    {location.label}
                    {location.is_default && (
                      <span className="px-1.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold">
                        Utama
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{location.address}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export const getColumns = (onMutated: () => void): ColumnDef<AdminCustomer>[] => [
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
    header: sortableHeader('Nama Pelanggan'),
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
  },
  {
    accessorKey: 'address',
    header: 'Alamat',
    cell: ({ row }) => (
      <span className="text-sm truncate max-w-[180px] block">{row.original.address || '—'}</span>
    ),
  },
  {
    id: 'locations',
    header: 'Lokasi',
    cell: ({ row }) => <CustomerLocationsCell customer={row.original} />,
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
      return new Date(d).toLocaleDateString('id-ID', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    },
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => <CustomerActionsCell customer={row.original} onMutated={onMutated} />,
  },
];
