import { db } from '@/src/db';
import {
  productAdsTable,
  productAdsSchedule,
  scheduleProductAdsTable,
} from '@/src/db/schema';
import { getCurrentAdSlot } from '@/lib/utils/ad-schedule';
import { and, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export const GET = async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const outletId = Number(searchParams.get('outletId'));

  if (!outletId || isNaN(outletId)) {
    return NextResponse.json({ success: false, data: [] }, { status: 400 });
  }

  const { now, day, hour } = getCurrentAdSlot();

  const rows = await db
    .select({
      id: productAdsTable.id,
      title: productAdsTable.title,
      description: productAdsTable.description,
      banner_image: productAdsTable.banner_image,
      product_id: productAdsTable.product_id,
    })
    .from(productAdsTable)
    .innerJoin(
      productAdsSchedule,
      eq(productAdsSchedule.productAdsSchedule_id, productAdsTable.id),
    )
    .innerJoin(
      scheduleProductAdsTable,
      eq(scheduleProductAdsTable.id, productAdsSchedule.scheduleProductAdsTable_id),
    )
    .where(
      and(
        eq(productAdsTable.outlet_id, outletId),
        eq(productAdsTable.status, 'approved'),
        eq(productAdsTable.is_active, true),
        lte(productAdsTable.starts_at, now),
        or(isNull(productAdsTable.ends_at), gte(productAdsTable.ends_at, now)),
        sql`${scheduleProductAdsTable.time}->>'day' = ${day}`,
        sql`${scheduleProductAdsTable.time}->>'hour' = ${hour}`,
      ),
    );

  return NextResponse.json({ success: true, data: rows });
};
