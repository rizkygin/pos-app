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

// Owner rejects a still-pending order, recording why.
export async function rejectOrderByOwner(orderId: string, reason: string) {
  const res = await fetch(`${API_URL}/api/orders/reject-by-owner`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, reason }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error ?? 'Gagal menolak order');
  }
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

// ----- Materials (own-driver) order actions -----

export type MaterialsQuote = {
  /** Ceiling the API enforces, recomputed server-side from the price bands. */
  cap: number;
  /** Km from outlet to drop-off. Null if no saved address. */
  distanceKm: number | null;
  /** 'road' = real driving route; 'straight' = routing unavailable, reads short. */
  distanceSource: 'road' | 'straight' | null;
  /** Driving time estimate in minutes. Null when the distance is straight-line. */
  driveMinutes: number | null;
  dropoff: {
    label: string | null;
    address: string | null;
    note: string | null;
    lat: string;
    lon: string;
  } | null;
};

// Everything needed to price a haul. The cap alone isn't enough — without the
// distance the owner is picking a number blind.
export async function getMaterialsQuote(orderId: string): Promise<MaterialsQuote> {
  const res = await fetch(`${API_URL}/api/orders/${orderId}/materials-quote`, {
    credentials: 'include',
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(json?.error ?? 'Gagal mengambil data ongkos angkut');
  }
  return {
    cap: Number(json.cap ?? 0),
    distanceKm: json.distanceKm ?? null,
    distanceSource: json.distanceSource ?? null,
    driveMinutes: json.driveMinutes ?? null,
    dropoff: json.dropoff ?? null,
  };
}

// Owner accepts a materials order, quoting the haul into delivery_fee. The goods
// keep their own prices — only the delivery figure is set here.
export async function confirmMaterialsOrder(orderId: string, deliveryFee: number) {
  const res = await fetch(`${API_URL}/api/orders/confirm-materials`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, delivery_fee: deliveryFee }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error ?? 'Gagal mengonfirmasi order bahan bangunan');
  }
}

// Owner's driver leaves with the load (ready -> on_delivery).
export async function dispatchMaterialsOrder(orderId: string) {
  await postOrderAction('/api/orders/dispatch-materials', orderId, 'Gagal mengirim order');
}

// Customer confirms the load arrived (on_delivery -> delivered).
export async function acceptMaterialsOrder(orderId: string) {
  await postOrderAction('/api/orders/accept-materials', orderId, 'Gagal menyelesaikan order');
}
