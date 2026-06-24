import { API_URL } from '@/lib/api-url';

export type DisplayAs = 'once a week' | 'only 1 day' | 'only weekend' | 'only weekdays';

export type CreateAdInput = {
  product_id: string;
  title: string;
  description?: string;
  banner_image: string;
  display_as: DisplayAs;
  day?: string;
  hour_start: string;
  hour_end: string;
  duration?: number;
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

export async function uploadAdBanner(
  formData: FormData,
): Promise<{ success: boolean; imageUrl?: string; message?: string }> {
  try {
    const res = await fetch(`${API_URL}/api/ads/upload-banner`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    return await res.json();
  } catch {
    return { success: false, message: 'Failed to process and upload image.' };
  }
}

export async function createAdAction(data: CreateAdInput) {
  return postJson('/api/ads', data);
}

export async function toggleAdActiveAction(adId: number, isActive: boolean) {
  return postJson('/api/ads/toggle-active', { adId, isActive });
}

export async function deleteAdAction(adId: number) {
  return postJson('/api/ads/delete', { adId });
}
