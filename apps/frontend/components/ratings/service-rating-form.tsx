'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Star, Store, Package, Check, AlertCircle, Loader2 } from 'lucide-react';
import type { SubmitResult } from '@/app/dashboard/ratings/actions';

type ProductItem = { id: string; orderDetailId: number; name: string; quantity: number };
type RatingInput = { rating: number; comment: string };
type ProductRatingInput = RatingInput & { productId: string; orderDetailId: number };

function StarRow({
  value,
  onChange,
  size = 'lg',
}: {
  value: number;
  onChange: (v: number) => void;
  size?: 'lg' | 'sm';
}) {
  const [hovered, setHovered] = useState(0);
  const px = size === 'lg' ? 'size-9' : 'size-6';
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const active = (hovered || value) >= n;
        return (
          <button
            key={n}
            type="button"
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(0)}
            onClick={() => onChange(n)}
            className="transition-transform hover:scale-110"
            aria-label={`${n} bintang`}
          >
            <Star
              className={
                px +
                ' ' +
                (active ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30')
              }
            />
          </button>
        );
      })}
    </div>
  );
}

export function ServiceRatingForm({
  orderId,
  provider,
  outletName,
  products,
  onSubmit,
}: {
  orderId: string;
  provider: string;
  outletName: string;
  products: ProductItem[];
  onSubmit: (
    ownerRating: RatingInput,
    productRatings: ProductRatingInput[],
  ) => Promise<SubmitResult>;
}) {
  const router = useRouter();
  const [ownerRating, setOwnerRating] = useState(0);
  const [ownerComment, setOwnerComment] = useState('');
  const [productState, setProductState] = useState<Record<string, RatingInput>>(
    Object.fromEntries(products.map((p) => [p.id, { rating: 0, comment: '' }])),
  );
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    if (ownerRating === 0) {
      setError('Beri bintang untuk penyedia layanan dulu.');
      return;
    }
    const productRatings: ProductRatingInput[] = products
      .map((p) => ({
        productId: p.id,
        orderDetailId: p.orderDetailId,
        rating: productState[p.id]?.rating ?? 0,
        comment: productState[p.id]?.comment ?? '',
      }))
      .filter((p) => p.rating > 0);

    startTransition(async () => {
      const res = await onSubmit(
        { rating: ownerRating, comment: ownerComment.trim() },
        productRatings,
      );
      if (res.ok) {
        setDone(true);
      } else if (res.error === 'already_rated') {
        setError('Kamu sudah menilai layanan ini.');
      } else {
        setError('Gagal mengirim penilaian. Coba lagi.');
      }
    });
  };

  if (done) {
    return (
      <div className="max-w-md mx-auto flex flex-col items-center justify-center gap-4 py-16 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950">
          <Check className="size-8 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-lg font-black">Terima kasih!</h1>
          <p className="text-sm text-muted-foreground">Penilaian pian sudah kami simpan.</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/history-order')}
          className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
        >
          Kembali ke Riwayat
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto space-y-5 py-4">
      <div>
        <h1 className="text-lg font-black">Nilai Layanan</h1>
        <p className="text-sm text-muted-foreground">Bagikan pengalaman pian di {outletName}</p>
      </div>

      {/* Provider (owner) */}
      <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-950">
            <Store className="size-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Penyedia Layanan
            </p>
            <p className="text-sm font-bold truncate">{provider}</p>
          </div>
        </div>
        <StarRow value={ownerRating} onChange={setOwnerRating} />
        <textarea
          value={ownerComment}
          onChange={(e) => setOwnerComment(e.target.value)}
          rows={2}
          maxLength={255}
          placeholder="Bagaimana pelayanannya? (opsional)"
          className="w-full resize-none rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>

      {/* Service products */}
      {products.length > 0 && (
        <div className="space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-1">
            Layanan yang diambil
          </p>
          {products.map((p) => (
            <div key={p.id} className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                  <Package className="size-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground">×{p.quantity}</p>
                </div>
              </div>
              <StarRow
                size="sm"
                value={productState[p.id]?.rating ?? 0}
                onChange={(r) =>
                  setProductState((s) => ({ ...s, [p.id]: { ...s[p.id], rating: r } }))
                }
              />
              <textarea
                value={productState[p.id]?.comment ?? ''}
                onChange={(e) =>
                  setProductState((s) => ({ ...s, [p.id]: { ...s[p.id], comment: e.target.value } }))
                }
                rows={2}
                maxLength={255}
                placeholder="Komentar untuk layanan ini (opsional)"
                className="w-full resize-none rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm font-medium text-rose-600">
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      <button
        onClick={submit}
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-3.5 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Star className="size-4" />}
        {pending ? 'Mengirim...' : 'Kirim Penilaian'}
      </button>
    </div>
  );
}
