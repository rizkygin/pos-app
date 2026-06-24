import { API_URL } from '@/lib/api-url';

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

export async function approveAdAction(adId: number) {
  return postJson('/api/ads/approve', { adId });
}

export async function rejectAdAction(adId: number, reason: string) {
  return postJson('/api/ads/reject', { adId, reason });
}

export async function deleteAdAction(adId: number) {
  return postJson('/api/ads/admin-delete', { adId });
}
