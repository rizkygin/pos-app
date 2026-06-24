import { API_URL } from '@/lib/api-url';

type RatingInput = { rating: number; comment: string };
type ProductRatingInput = RatingInput & {
  productId: string;
  orderDetailId: number;
};

export type SubmitResult =
  | { ok: true }
  | { ok: false; error: 'already_rated' | 'not_found' | 'unknown' };

async function postRating(path: string, body: unknown): Promise<SubmitResult> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      credentials: 'include',
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
