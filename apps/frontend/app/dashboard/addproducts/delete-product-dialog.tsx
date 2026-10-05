'use client';

import { useEffect, useState } from 'react';
import { Archive, Ban, Loader2, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { API_URL } from '@/lib/api-url';
import { deleteProductAction } from './actions';

// Mirrors GET /api/products/:id/delete-check (backend routes/products.ts).
type Check = {
  variants: number;
  outcome: 'delete' | 'archive' | 'blocked';
  message: string | null;
};

// The confirm button stays locked this long after the check lands, so a
// double tap on the trash icon cannot carry through to the button that opens
// under the same finger.
const ARM_SECONDS = 2;

/**
 * Confirm before deleting a product. Says up front what will actually happen
 * — deleted for good, archived because it has history, or refused because an
 * open opname / unpaid table bill still uses it — instead of a bare
 * "Yakin?". Focus starts on Batal (Radix AlertDialog does that), so Enter or
 * Space cancels, and a click outside does nothing.
 */
export function DeleteProductDialog({
  product,
  onClose,
  onDeleted,
}: {
  product: { id: string; product_name: string };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [check, setCheck] = useState<Check | null>(null);
  const [left, setLeft] = useState(ARM_SECONDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/products/${product.id}/delete-check`, { credentials: 'include' })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) setCheck(json);
        else setError(json.message || 'Gagal memeriksa produk');
      })
      .catch(() => !cancelled && setError('Gagal terhubung ke server'));
    return () => {
      cancelled = true;
    };
  }, [product.id]);

  useEffect(() => {
    if (!check || check.outcome === 'blocked') return;
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [check]);

  const confirm = async () => {
    setBusy(true);
    setError('');
    const result = await deleteProductAction(product.id);
    setBusy(false);
    if (!result.success) {
      setError(result.message || 'Gagal menghapus produk');
      return;
    }
    onDeleted();
  };

  const archive = check?.outcome === 'archive';
  const label = archive ? 'Arsipkan' : 'Hapus Permanen';

  return (
    <AlertDialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hapus &ldquo;{product.product_name}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              {!check && !error && (
                <p className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Memeriksa riwayat produk…
                </p>
              )}
              {check?.outcome === 'blocked' && (
                <p className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                  <Ban className="mt-0.5 size-4 shrink-0" />
                  {check.message}
                </p>
              )}
              {check?.outcome === 'delete' && (
                <p>
                  Produk ini belum pernah dipakai di transaksi mana pun, jadi akan{' '}
                  <b className="text-rose-600">dihapus permanen</b> dan tidak bisa dikembalikan.
                </p>
              )}
              {archive && (
                <p>
                  Produk ini punya riwayat (penjualan, faktur, stok, atau opname), jadi akan{' '}
                  <b className="text-foreground">diarsipkan</b>: hilang dari daftar produk dan kasir,
                  tapi riwayat dan laporan tetap utuh. Bisa dipulihkan lagi dari tab Arsip.
                </p>
              )}
              {check && check.outcome !== 'blocked' && check.variants > 0 && (
                <p>Termasuk {check.variants} varian.</p>
              )}
              {error && <p className="font-medium text-rose-600">{error}</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {check?.outcome === 'blocked' ? 'Tutup' : 'Batal'}
          </AlertDialogCancel>
          {check && check.outcome !== 'blocked' && (
            <Button variant="destructive" onClick={confirm} disabled={busy || left > 0}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : archive ? (
                <Archive className="size-4" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {left > 0 ? `${label} (${left})` : label}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
