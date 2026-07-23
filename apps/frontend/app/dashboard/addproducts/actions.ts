import { API_URL } from '@/lib/api-url';

export type AddProductInput = {
  product_name: string;
  price: string;
  price_mark_down: string;
  buying_price: string;
  outlet_id: number;
  category: string;
  description?: string;
  unit?: string;
  image?: string;
  features?: string[];
  is_for_sale?: boolean;
  track_stock?: boolean;
  // Service products: negotiable price range (backend derives price = lowest).
  lowest_price?: string;
  highest_price?: string;
  // Optional — mainly for retail/mart items. Unique per outlet on the backend.
  barcode?: string;
};

type ActionResult = { success: boolean; message?: string };

async function postJson(path: string, body: unknown): Promise<ActionResult> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as ActionResult;
  } catch {
    return { success: false, message: 'Terjadi kesalahan jaringan.' };
  }
}

export async function addProductAction(data: AddProductInput) {
  return postJson('/api/products', data);
}

export async function uploadImage(
  formData: FormData,
): Promise<{ success: boolean; imageUrl?: string; message?: string }> {
  try {
    const res = await fetch(`${API_URL}/api/products/upload-image`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    return await res.json();
  } catch {
    return { success: false, message: 'Failed to process and upload image.' };
  }
}

export async function removeImage(imageUrl: string) {
  return postJson('/api/products/remove-image', { imageUrl });
}

export async function checkImageUrlAccessable(imageUrl: string) {
  if (imageUrl === '') {
    return;
  }
  try {
    const res = await fetch(
      `${API_URL}/api/products/check-image?url=${encodeURIComponent(imageUrl)}`,
      { credentials: 'include' },
    );
    return (await res.json()) as { success: boolean; message: string; path?: string };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function removeOnDatabase(imageUrl: string) {
  return postJson('/api/products/remove-image-db', { imageUrl });
}

export async function deleteProductAction(productId: string) {
  return postJson('/api/products/delete', { productId });
}

export async function updateProductAction(
  productId: string,
  data: Partial<AddProductInput>,
) {
  return postJson('/api/products/update', { productId, data });
}
