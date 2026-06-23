import { db } from '@/src/db';
import {
  adminsTable,
  outletsTable,
  productAdsTable,
  productAdsSchedule,
  productsTable,
  scheduleProductAdsTable,
} from '@/src/db/schema';
import { auth } from '@/lib/auth';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

function formatTimeSlot(slot: { day: string; hour: string }) {
  const day = slot.day.charAt(0).toUpperCase() + slot.day.slice(1);
  return `${day} ${slot.hour}:00`;
}

export const GET = async (req: Request) => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const totalAdmin = await db.$count(adminsTable, eq(adminsTable.user_id, session.user.id));
  if (totalAdmin === 0) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const limit = Math.max(1, Number(searchParams.get('limit')) || 10);
  const offset = (page - 1) * limit;
  const status = searchParams.get('status');

  const conditions = [];
  if (status === 'pending' || status === 'approved' || status === 'rejected') {
    conditions.push(eq(productAdsTable.status, status));
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: productAdsTable.id,
        title: productAdsTable.title,
        description: productAdsTable.description,
        banner_image: productAdsTable.banner_image,
        status: productAdsTable.status,
        is_active: productAdsTable.is_active,
        rejection_reason: productAdsTable.rejection_reason,
        outlet_id: productAdsTable.outlet_id,
        outlet_name: outletsTable.name,
        product_id: productAdsTable.product_id,
        product_name: productsTable.product_name,
        starts_at: productAdsTable.starts_at,
        ends_at: productAdsTable.ends_at,
      })
      .from(productAdsTable)
      .innerJoin(outletsTable, eq(productAdsTable.outlet_id, outletsTable.id))
      .innerJoin(productsTable, eq(productAdsTable.product_id, productsTable.id))
      .where(where)
      .orderBy(desc(productAdsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(productAdsTable)
      .where(where),
  ]);

  const adIds = rows.map((row) => row.id);

  const scheduleRows = adIds.length
    ? await db
        .select({
          adId: productAdsSchedule.productAdsSchedule_id,
          time: scheduleProductAdsTable.time,
        })
        .from(productAdsSchedule)
        .innerJoin(
          scheduleProductAdsTable,
          eq(productAdsSchedule.scheduleProductAdsTable_id, scheduleProductAdsTable.id),
        )
        .where(inArray(productAdsSchedule.productAdsSchedule_id, adIds))
    : [];

  const scheduleByAd = new Map<number, { day: string; hour: string }[]>();
  for (const row of scheduleRows) {
    if (!row.time) continue;
    const slots = scheduleByAd.get(row.adId) ?? [];
    slots.push(row.time);
    scheduleByAd.set(row.adId, slots);
  }

  const data = rows.map((row) => {
    const slots = scheduleByAd.get(row.id) ?? [];
    let time_start: string | null = null;
    let time_end: string | null = null;

    if (slots.length > 0) {
      const sorted = [...slots].sort((a, b) => Number(a.hour) - Number(b.hour));
      time_start = formatTimeSlot(sorted[0]);
      time_end = formatTimeSlot(sorted[sorted.length - 1]);
    }

    return { ...row, time_start, time_end };
  });

  return NextResponse.json({
    success: true,
    data,
    count: total,
  });
};
