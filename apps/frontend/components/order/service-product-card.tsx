'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { Wrench, Loader2, X } from 'lucide-react';
import { resolveProductImage, isBackendImage } from '@/lib/image-src';
import { StarRating } from '@/components/star-rating';
import { fmtIDR } from '@/lib/utils/format';
import { API_URL } from '@/lib/api-url';
import { customerMakingOrder } from '@/app/dashboard/order/[feature]/[outletId]/action';
import type { Product } from '@/lib/types';

// Grid card for a service product — mirrors ProductCard's look but, instead of
// add-to-basket, opens a request modal (note + submit) that places a service
// order directly. No cart, since services are requested one at a time.
export function ServiceProductCard({
  product,
  outletId,
}: {
  product: Product;
  outletId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const lowest = product.lowest_price ?? product.price;
  const highest = product.highest_price ?? lowest;

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      // Forward the customer's location (where the service is needed) + profile,
      // same source the delivery checkout uses. The provider goes to the drop-off.
      const loc = await fetch(
        `${API_URL}/api/get-order-locations?outlet_id=${outletId}`,
        { credentials: 'include' },
      )
        .then((r) => r.json())
        .catch(() => null);

      const note_ = {
        location: {
          pick_up: {
            lat: `${loc?.pickup?.lat ?? ''}`,
            long: `${loc?.pickup?.lon ?? ''}`,
            label: `${loc?.pickup?.label ?? ''}`,
          },
          drop_off: {
            lat: `${loc?.dropoff?.lat ?? ''}`,
            long: `${loc?.dropoff?.lon ?? ''}`,
            label: `${loc?.dropoff?.label ?? ''}`,
          },
        },
        customer_ratings: `${loc?.customer?.ratings ?? ''}`,
        customer_review_count: `${loc?.customer?.review_count ?? ''}`,
        customer_note: note.trim(),
      };

      await customerMakingOrder({
        outlet_id: Number(outletId),
        fulfillment: 'service',
        items: [
          {
            product_id: product.id,
            quantity: 1,
            note_product: note.trim() || undefined,
            // Placeholder — the owner sets the agreed price within the range on confirm.
            summary_price: String(lowest),
          },
        ],
        note: note_ as never,
      });
      router.push('/dashboard/scheduled-order');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mengajukan layanan');
      setSubmitting(false);
    }
  };

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        whileHover={{ y: -4 }}
        className={`group relative bg-card rounded-[1.5rem] border border-border/60 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden ${!product.isAvailable ? 'opacity-60' : ''}`}
      >
        <div className="relative aspect-square overflow-hidden">
          <Image
            src={resolveProductImage(product.image)}
            unoptimized={isBackendImage(product.image)}
            alt={product.product_name}
            fill
            className="object-cover group-hover:scale-110 transition-transform duration-500"
          />
          <span className="absolute top-2.5 left-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/90 backdrop-blur-sm text-[10px] font-black text-white shadow-sm">
            <Wrench className="h-2.5 w-2.5" /> Jasa
          </span>
          {!product.isAvailable && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <span className="px-3 py-1 rounded-full bg-black/60 text-white text-xs font-bold">
                Tidak tersedia
              </span>
            </div>
          )}
        </div>

        <div className="p-3 space-y-1.5">
          <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
            {product.category}
          </p>
          <h4 className="font-black text-sm leading-tight line-clamp-2">{product.product_name}</h4>
          <div className="flex items-center gap-1.5">
            <StarRating rating={product.ratings} size="sm" />
            <span className="text-xs font-bold text-amber-600">{Number(product.ratings ?? 5).toFixed(1)}</span>
          </div>
          <div className="space-y-0.5">
            <p className="text-sm font-black text-blue-600">
              {fmtIDR(lowest)} – {fmtIDR(highest)}
            </p>
            <p className="text-[10px] text-muted-foreground">kisaran harga</p>
          </div>
          {product.isAvailable && (
            <div className="pt-1">
              <button
                onClick={() => setOpen(true)}
                className="flex w-full items-center justify-center gap-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs h-8 shadow-sm shadow-blue-200 transition-colors"
              >
                <Wrench className="h-3.5 w-3.5" /> Ajukan
              </button>
            </div>
          )}
        </div>
      </motion.div>

      {/* Request modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-background p-5 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="relative h-11 w-11 rounded-xl overflow-hidden shrink-0">
                  <Image
                    src={resolveProductImage(product.image)}
                    unoptimized={isBackendImage(product.image)}
                    alt={product.product_name}
                    fill
                    className="object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <p className="font-black text-sm truncate">{product.product_name}</p>
                  <p className="text-xs font-bold text-blue-600">
                    {fmtIDR(lowest)} – {fmtIDR(highest)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => !submitting && setOpen(false)}
                className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ini Kolom Request (misal : tolong buatkan aku warna dominan hijau )"
              rows={3}
              maxLength={255}
              className="w-full resize-none rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-400"
            />

            {error && <p className="text-xs font-medium text-rose-600">{error}</p>}

            <button
              onClick={submit}
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Mengajukan...
                </>
              ) : (
                <>
                  <Wrench className="h-4 w-4" /> Ajukan Layanan
                </>
              )}
            </button>
            <p className="text-[11px] text-muted-foreground text-center">
              Harga dapat berubah ubah tergantung <b>REQUEST</b> pian. laporkan Admin{' '}
              <b>ULUN PESAN </b>jika pemilik tidak mengabarkan harga terlebih dahulu ke pian.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
