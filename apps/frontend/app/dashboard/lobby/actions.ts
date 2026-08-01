import { API_URL } from '@/lib/api-url';

export async function acceptOrder(orderId: string) {
  const res = await fetch(`${API_URL}/api/courier/accept-order`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId }),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error ?? 'Gagal menerima order');
  }
}

export async function declineOrder(orderId: string) {
  const res = await fetch(`${API_URL}/api/courier/decline-order`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId }),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error ?? 'Gagal menolak order');
  }
}
