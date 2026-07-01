import { API_URL } from '@/lib/api-url';

export async function getDeliveryFee(
  outlet_id: number,
): Promise<{ fee: number } | { error: string }> {
  try {
    const res = await fetch(
      `${API_URL}/api/orders/delivery-fee?outlet_id=${outlet_id}`,
      { credentials: 'include' },
    );
    const json = await res.json();
    if (typeof json?.fee === 'number') return { fee: json.fee };
    return { error: json?.error ?? 'Gagal menghitung ongkos kirim' };
  } catch {
    return { error: 'Gagal menghitung ongkos kirim' };
  }
}

//SEARCH:: note json structure
interface NoteJson {
  location: {
    pick_up: {
      lat: string;
      long: string;
      label: string;
    };
    drop_off: {
      lat: string;
      long: string;
      label: string;
    };
  };
  customer_ratings: string;
  customer_note: string;
  customer_review_count: string;
}

export type OrderItem = {
  product_id: string;
  quantity: number;
  note_product?: string;
  summary_price: string;
};

export type OrdersFormDataForFood = {
  outlet_id: number;
  promo_id?: number;
  discount_amount?: number;
  note?: NoteJson | null;
  items: OrderItem[];
  // 'service' = no courier/delivery; owner drives the flow (see service endpoints).
  fulfillment?: 'delivery' | 'service';
};

export async function customerMakingOrder(data: OrdersFormDataForFood) {
  const res = await fetch(`${API_URL}/api/orders/create`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error ?? 'Gagal membuat order');
  }
}
