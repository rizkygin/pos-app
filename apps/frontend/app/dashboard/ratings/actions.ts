import { serverFetch } from '@/lib/server-fetch';

type RatingInput = { rating: number; comment: string };
type ProductRatingInput = RatingInput & {
  productId: string;
  orderDetailId: number;
};

export type SubmitResult =
  | { ok: true }
  | { ok: false; error: 'already_rated' | 'not_found' | 'unknown' };

// These run inside `'use server'` handlers (server-side), so a plain
// `credentials: 'include'` fetch won't carry the browser's auth cookie. Route
// through serverFetch, which forwards the incoming cookie to the backend.
async function postRating(path: string, body: unknown): Promise<SubmitResult> {
  try {
    const res = await serverFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as SubmitResult;
  } catch (err) {
    console.error('[postRating]', err);
    return { ok: false, error: 'unknown' };
  }
}

export async function submitCustomerRatingAction(
  orderId: string,
  courierRating: RatingInput,
  productRatings: ProductRatingInput[],
): Promise<SubmitResult> {
  return postRating('/api/ratings/customer', { orderId, courierRating, productRatings });
}

export async function submitCourierRatingAction(
  orderId: string,
  customerRating: RatingInput,
  outletRating: RatingInput,
): Promise<SubmitResult> {
  return postRating('/api/ratings/courier', { orderId, customerRating, outletRating });
}

// Customer rates the provider (owner) + the service product(s) of a service order.
export async function submitServiceRatingAction(
  orderId: string,
  ownerRating: RatingInput,
  productRatings: ProductRatingInput[],
): Promise<SubmitResult> {
  return postRating('/api/ratings/service', { orderId, ownerRating, productRatings });
}
