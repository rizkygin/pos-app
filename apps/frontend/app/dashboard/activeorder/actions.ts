import { API_URL } from '@/lib/api-url';

async function postOrderAction(path: string, orderId: string, fallbackMessage: string) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId }),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error ?? fallbackMessage);
  }
}

// Customer cancels their own pending order. The caller handles navigation
// (the old server action used redirect('/dashboard/order')).
export async function cancelOrderbyCustomer(orderId: string) {
  await postOrderAction('/api/orders/cancel-by-customer', orderId, 'Gagal membatalkan order');
}

export async function confirmOrder(orderId: string) {
  await postOrderAction('/api/orders/confirm', orderId, 'Gagal mengonfirmasi order');
}

export async function confirmPickup(orderId: string) {
  await postOrderAction('/api/orders/confirm-pickup', orderId, 'Gagal mengonfirmasi pickup');
}

export async function markOrderReady(orderId: string) {
  await postOrderAction('/api/orders/mark-ready', orderId, 'Gagal menandai order siap');
}

export async function markOrderDelivered(orderId: string) {
  await postOrderAction('/api/orders/mark-delivered', orderId, 'Gagal menyelesaikan order');
}
