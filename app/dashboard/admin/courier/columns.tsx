'use client';

import { useState } from 'react';
import { Column, ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, Check, Loader2, Pencil, RotateCcw, Star, Trash2, X } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import {
  deleteCourierAction,
  resetCourierRatingAction,
  resetCourierReviewCountAction,
  updateLatestRatingAction,
} from './actions';

export type AdminCourier = {
  id: number;
  user_id: string;
  name: string;
  email: string;
  phone: string;
  avatar: string;
  vehicle_plate: string;
  vehicle_type: 'car' | 'motorcycle';
  ratings: string | null;
  review_count: number;
  latest_rating_id: string | null;
  latest_rating: string | null;
  latest_rating_comment: string | null;
  latest_rating_at: string | Date | null;
  created_at: string | Date | null;
};

function getAvatarSrc(avatar: string): string {
  if (!avatar || avatar === 'avatar-courier.png' || avatar === 'avatar.png') return '/avatar.png';
  if (avatar.startsWith('http') || avatar.startsWith('/')) return avatar;
  return `/${avatar}`;
}

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

function CourierRatingCell({
  courier,
  onMutated,
}: {
  courier: AdminCourier;
  onMutated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(Number(courier.ratings ?? 5).toFixed(1)));
  const [busy, setBusy] = useState(false);

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={1}
          max={5}
          step={0.1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-7 w-16 text-sm"
          autoFocus
        />
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const res = await updateLatestRatingAction(courier.latest_rating_id ?? '', Number(value));
            setBusy(false);
            if (res.success) {
              setEditing(false);
              onMutated();
            }
          }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </Button>
        <Button size="icon-sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
      <span className="font-medium">{Number(courier.ratings ?? 5).toFixed(1)}</span>
      <span className="text-xs text-muted-foreground">({courier.review_count})</span>
      <Button
        size="icon-sm"
        variant="ghost"
        title="Reset rating ke 5.0"
        onClick={async () => {
          await resetCourierRatingAction(courier.id);
          onMutated();
        }}
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function CourierReviewCountCell({
  courier,
  onMutated,
}: {
  courier: AdminCourier;
  onMutated: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="font-medium">{courier.review_count}</span>
      <Button
        size="icon-sm"
        variant="ghost"
        title="Reset jumlah ulasan ke 0"
        onClick={async () => {
          await resetCourierReviewCountAction(courier.id);
          onMutated();
        }}
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function LatestRatingCell({
  courier,
  onMutated,
}: {
  courier: AdminCourier;
  onMutated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(Number(courier.latest_rating ?? 0)));
  const [busy, setBusy] = useState(false);

  if (!courier.latest_rating_id) {
    return <span className="text-xs text-muted-foreground">Belum ada ulasan</span>;
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={1}
          max={5}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-7 w-16 text-sm"
          autoFocus
        />
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const res = await updateLatestRatingAction(courier.latest_rating_id!, Number(value));
            setBusy(false);
            if (res.success) {
              setEditing(false);
              onMutated();
            }
          }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </Button>
        <Button size="icon-sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  const date = courier.latest_rating_at;
  return (
    <div className="space-y-0.5 max-w-[200px]">
      <div className="flex items-center gap-1">
        <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
        <span className="font-medium">{Number(courier.latest_rating ?? 0).toFixed(1)}</span>
        {date && (
          <span className="text-xs text-muted-foreground">
            {new Date(date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        )}
        <Button size="icon-sm" variant="ghost" onClick={() => setEditing(true)} title="Edit ulasan terakhir">
          <Pencil className="h-3 w-3" />
        </Button>
      </div>
      {courier.latest_rating_comment && (
        <p className="text-xs text-muted-foreground truncate" title={courier.latest_rating_comment}>
          &ldquo;{courier.latest_rating_comment}&rdquo;
        </p>
      )}
    </div>
  );
}

function CourierActionsCell({
  courier,
  onMutated,
}: {
  courier: AdminCourier;
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
        title="Hapus kurir"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10">
            <Trash2 className="h-5 w-5 text-destructive" />
          </AlertDialogMedia>
          <AlertDialogTitle>Hapus Kurir</AlertDialogTitle>
          <AlertDialogDescription>
            Akun kurir <strong>{courier.name}</strong> ({courier.email}) akan dihapus dan tidak
            bisa digunakan lagi. Email ini tidak dapat dipakai untuk mendaftar ulang.
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
              const res = await deleteCourierAction(courier.id);
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

export const getColumns = (onMutated: () => void): ColumnDef<AdminCourier>[] => [
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
    header: sortableHeader('Nama Kurir'),
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
    accessorKey: 'vehicle_plate',
    header: 'Kendaraan',
    cell: ({ row }) => (
      <div>
        <p className="font-medium">{row.original.vehicle_plate}</p>
        <p className="text-xs text-muted-foreground capitalize">{row.original.vehicle_type}</p>
      </div>
    ),
  },
  {
    accessorKey: 'ratings',
    header: sortableHeader('Rating'),
    cell: ({ row }) => <CourierRatingCell courier={row.original} onMutated={onMutated} />,
  },
  {
    accessorKey: 'review_count',
    header: sortableHeader('Jumlah Ulasan'),
    cell: ({ row }) => <CourierReviewCountCell courier={row.original} onMutated={onMutated} />,
  },
  {
    accessorKey: 'latest_rating',
    header: 'Ulasan Terakhir',
    cell: ({ row }) => <LatestRatingCell courier={row.original} onMutated={onMutated} />,
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
    cell: ({ row }) => <CourierActionsCell courier={row.original} onMutated={onMutated} />,
  },
];
