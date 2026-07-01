import { redirect } from 'next/navigation';
import { serverFetch } from '@/lib/server-fetch';
import { ServiceRatingForm } from '@/components/ratings/service-rating-form';
import { submitServiceRatingAction } from '@/app/dashboard/ratings/actions';

export default async function ServiceRatingPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  // Backend guards: this customer's delivered service order, within 7 days, has
  // products, not already rated. { ok: false } => redirect.
  const res = await serverFetch(`/api/ratings/service-page?orderId=${orderId}`);
  const data = res.ok ? await res.json() : { ok: false };
  if (!data.ok) redirect('/dashboard/history-order');
  const { order, products } = data;

  async function handleSubmit(
    ownerRating: { rating: number; comment: string },
    productRatings: { productId: string; orderDetailId: number; rating: number; comment: string }[],
  ) {
    'use server';
    return submitServiceRatingAction(orderId, ownerRating, productRatings);
  }

  return (
    <main className="px-4 pb-12">
      <ServiceRatingForm
        orderId={orderId}
        provider={order.ownerName ?? 'Penyedia'}
        outletName={order.outletName ?? ''}
        products={products.map((p: any) => ({
          id: p.productId,
          orderDetailId: p.orderDetailId,
          name: p.name,
          quantity: p.quantity,
        }))}
        onSubmit={handleSubmit}
      />
    </main>
  );
}
