'use server';

import { getSession } from '@/lib/auth';
import { db } from '@/src/db';
import {
  ordersTable,
  orderDetailsTable,
  customersTable,
  outletsTable,
  locationsTable,
} from '@/src/db/schema';
import { eq, and } from 'drizzle-orm';
import { haversineKm } from '@/lib/utils/geo';

//SEARCH:: distance pricelist
function deliveryFeeFromDistance(km: number): number {
  if (km > 30)
    throw new Error('Jarak pengiriman melebihi batas maksimum (30 km)');
  if (km <= 5) return 10_000;
  if (km <= 6) return 11_000;
  if (km <= 7) return 13_000;
  if (km <= 8) return 16_000;
  if (km <= 9) return 17_000;
  if (km <= 10) return 19_000;
  if (km <= 12) return 23_000;
  if (km <= 14) return 25_000;
  if (km <= 15) return 28_000;
  if (km <= 17) return 30_000;
  if (km <= 20) return 38_000;
  if (km <= 25) return 45_000;
  return 60_000;
}

async function computeDeliveryFee(
  userId: string,
  outletId: number,
): Promise<number> {
  const [[userLoc], [outlet]] = await Promise.all([
    db
      .select({ lat: locationsTable.lat, lon: locationsTable.lon })
      .from(locationsTable)
      .where(
        and(
          eq(locationsTable.user_id, userId),
          eq(locationsTable.is_default, true),
        ),
      )
      .limit(1),
    db
      .select({ lat: outletsTable.lat, lon: outletsTable.lon })
      .from(outletsTable)
      .where(eq(outletsTable.id, outletId))
      .limit(1),
  ]);

  if (!userLoc) throw new Error('Alamat pengiriman tidak ditemukan');
  if (!outlet) throw new Error('Outlet tidak ditemukan');

  //TODO:: this just measure about 2 point on base of their location (lon and lat)
  const km = haversineKm(
    parseFloat(userLoc.lat),
    parseFloat(userLoc.lon),
    parseFloat(outlet.lat),
    parseFloat(outlet.lon),
  );

  return deliveryFeeFromDistance(km);
}

export async function getDeliveryFee(
  outlet_id: number,
): Promise<{ fee: number } | { error: string }> {
  try {
    const session = await getSession();
    const fee = await computeDeliveryFee(session.user.id, outlet_id);
    return { fee };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : 'Gagal menghitung ongkos kirim',
    };
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
};

export async function customerMakingOrder(data: OrdersFormDataForFood) {
  const session = await getSession();
  const orderId = crypto.randomUUID();

  const [[customer], delivery_fee] = await Promise.all([
    db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(eq(customersTable.user_id, session.user.id))
      .limit(1),
    computeDeliveryFee(session.user.id, data.outlet_id),
  ]);

  if (!customer) throw new Error('Customer record not found for this user');

  //SEARCH:: customer make an order
  await db.transaction(async (tx) => {
    await tx.insert(ordersTable).values({
      id: orderId,
      customer_id: customer.id,
      outlet_id: data.outlet_id,
      courier_id: null,
      status: 'pending',
      promo_id: data.promo_id,
      discount_amount: data.discount_amount?.toString(),
      delivery_fee: String(delivery_fee),
      note: data.note ?? null,
      scheduled_at: null,
    });

    if (data.items.length > 0) {
      await tx.insert(orderDetailsTable).values(
        data.items.map((item) => ({
          order_id: orderId,
          product_id: item.product_id,
          quantity: item.quantity,
          note_product: item.note_product,
          summary_price: item.summary_price,
        })),
      );
    }
  });
}
