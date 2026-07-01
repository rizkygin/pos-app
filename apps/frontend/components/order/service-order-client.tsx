'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Wrench, Loader2 } from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { fmtIDR } from '@/lib/utils/format';
import { resolveProductImage, isBackendImage } from '@/lib/image-src';
import { customerMakingOrder } from '@/app/dashboard/order/[feature]/[outletId]/action';

type ServiceProduct = {
  id: string;
  product_name: string;
  image: string;
  price: number;
  lowest_price: number | null;
  highest_price: number | null;
  description?: string;
  unit?: string;
};

function ServiceCard({
  product,
  outletId,
}: {
  product: ServiceProduct;
  outletId: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const lowest = product.lowest_price ?? product.price;
  const highest = product.highest_price ?? lowest;

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
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
        note: {
          location: {
            pick_up: { lat: '', long: '', label: '' },
            drop_off: { lat: '', long: '', label: '' },
          },
          customer_ratings: '',
          customer_review_count: '',
          customer_note: note.trim(),
        } as never,
      });
      router.push('/dashboard/activeorder');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mengajukan layanan');
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative h-14 w-14 rounded-xl overflow-hidden flex-shrink-0">
          <Image
            src={resolveProductImage(product.image)}
            unoptimized={isBackendImage(product.image)}
            alt={product.product_name}
            fill
            className="object-cover"
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm line-clamp-1">{product.product_name}</p>
          {product.description && (
            <p className="text-xs text-muted-foreground line-clamp-1">{product.description}</p>
          )}
          <p className="mt-0.5 text-sm font-black text-blue-600">
            {fmtIDR(lowest)} – {fmtIDR(highest)}
          </p>
        </div>
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Jelaskan kebutuhan pian (contoh: AC tidak dingin, 1 unit, lantai 2)..."
        rows={2}
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
        Harga pasti ditentukan penyedia setelah menerima permintaan pian.
      </p>
    </div>
  );
}

export function ServiceOrderClient({
  feature,
  outletId,
}: {
  feature: string;
  outletId: string;
}) {
  const { data: products, isLoading } = useQuery<ServiceProduct[]>({
    queryKey: ['service-products', outletId],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/get-all-product?id=${outletId}`);
      if (!res.ok) throw new Error('Failed to fetch products');
      const json = await res.json();
      return json.data as ServiceProduct[];
    },
    enabled: !!outletId,
  });

  const serviceProducts = (products ?? []).filter((p) => p.lowest_price != null);

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="max-w-lg mx-auto px-5 pt-4 space-y-4">
        <Link
          href={`/dashboard/order/${feature}`}
          className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Kembali
        </Link>

        <div>
          <h1 className="font-black text-xl">Layanan Jasa</h1>
          <p className="text-sm text-muted-foreground">
            Ajukan permintaan — penyedia akan mengatur harga &amp; jadwal.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : serviceProducts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Belum ada layanan tersedia di outlet ini.
          </div>
        ) : (
          <div className="space-y-3">
            {serviceProducts.map((p) => (
              <ServiceCard key={p.id} product={p} outletId={outletId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
