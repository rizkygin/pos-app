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

// ----- Service (no-courier) order actions -----

// Owner accepts a service order at a price they pick within the product's range.
export async function confirmServiceOrder(orderId: string, price: number) {
  const res = await fetch(`${API_URL}/api/orders/confirm-service`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, price }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error ?? 'Gagal mengonfirmasi order layanan');
  }
}

// Owner sets the appointment time + optional discount (amount or percent).
export async function scheduleServiceOrder(
  orderId: string,
  scheduled_at: string,
  discount: { discount_amount?: number; discount_percent?: number },
) {
  const res = await fetch(`${API_URL}/api/orders/schedule-service`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, scheduled_at, ...discount }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error ?? 'Gagal menjadwalkan order layanan');
  }
}

// Owner closes a scheduled service order (ready -> on_delivery).
export async function closeServiceOrder(orderId: string) {
  await postOrderAction('/api/orders/close-service', orderId, 'Gagal menutup order layanan');
}

// Customer accepts a closed service order (on_delivery -> delivered).
export async function acceptServiceOrder(orderId: string) {
  await postOrderAction('/api/orders/accept-service', orderId, 'Gagal menyelesaikan order layanan');
}
