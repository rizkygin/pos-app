import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { db } from '@/src/db';
import {
  customersTable,
  locationsTable,
  outletsTable,
  usersTable,
} from '@/src/db/schema';
import { and, eq } from 'drizzle-orm';

export const GET = async (req: NextRequest) => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user)
    return NextResponse.json({ success: false }, { status: 401 });

  const outletId = req.nextUrl.searchParams.get('outlet_id');
  if (!outletId)
    return NextResponse.json({ success: false, error: 'Missing outlet_id' }, { status: 400 });

  const [[customer], [outlet]] = await Promise.all([
    db
      .select({ id: customersTable.id, ratings: customersTable.ratings, review_count: customersTable.review_count })
      .from(customersTable)
      .where(eq(customersTable.user_id, session.user.id))
      .limit(1),
    db
      .select({ lat: outletsTable.lat, lon: outletsTable.lon, name: outletsTable.name })
      .from(outletsTable)
      .where(eq(outletsTable.id, Number(outletId)))
      .limit(1),
  ]);

  if (!customer || !outlet)
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const [customerUser] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, session.user.id))
    .limit(1);

  const [defaultLocation] = await db
    .select({ lat: locationsTable.lat, lon: locationsTable.lon, address: locationsTable.address })
    .from(locationsTable)
    .where(
      and(
        eq(locationsTable.user_id, session.user.id),
        eq(locationsTable.is_default, true),
      ),
    )
    .limit(1);

  return NextResponse.json({
    success: true,
    pickup: { lat: outlet.lat, lon: outlet.lon, label: outlet.name },
    dropoff: {
      lat: defaultLocation?.lat ?? null,
      lon: defaultLocation?.lon ?? null,
      label: defaultLocation?.address ?? customerUser?.name ?? '',
    },
    customer: {
      ratings: customer.ratings ?? '5',
      review_count: customer.review_count,
    },
  });
};
