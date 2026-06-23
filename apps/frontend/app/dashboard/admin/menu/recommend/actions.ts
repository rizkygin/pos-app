import { API_URL } from '@/lib/api-url';

export async function setRecommendedAction(productId: string, isRecommended: boolean) {
  try {
    const res = await fetch(`${API_URL}/api/admin/set-recommended`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, isRecommended }),
    });
    return (await res.json()) as { success: boolean; message?: string };
  } catch (error) {
    console.error('Failed to update recommended status:', error);
    return { success: false, message: 'Failed to update recommended status.' };
  }
}

export type AdminEditProductInput = {
  product_name: string;
  price: string;
  price_mark_down: string;
  category: string;
  description: string;
};

export async function adminUpdateProductAction(
  productId: string,
  data: AdminEditProductInput,
) {
  try {
    const res = await fetch(`${API_URL}/api/admin/update-product`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, data }),
    });
    return (await res.json()) as { success: boolean; message?: string };
  } catch (error) {
    console.error('Failed to update product:', error);
    return { success: false, message: 'Failed to update product.' };
  }
}
