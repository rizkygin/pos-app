import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { db } from '@/src/db';
import {
  ordersTable,
  couriersTable,
  customersTable,
  usersTable,
  outletsTable,
  locationsTable,
} from '@/src/db/schema';
import { eq, and, desc } from 'drizzle-orm';

export const GET = async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user)
    return NextResponse.json({ success: false }, { status: 401 });

  const [courier] = await db
    .select({ id: couriersTable.id })
    .from(couriersTable)
    .where(eq(couriersTable.user_id, session.user.id))
    .limit(1);

  if (!courier)
    return NextResponse.json(
      { success: false, error: 'Not a courier' },
      { status: 403 },
    );

  const history = await db
    .select({
      id: ordersTable.id,
      status: ordersTable.status,
      deliveryFee: ordersTable.delivery_fee,
      timestamp: ordersTable.updatedAt,
      customerName: usersTable.name,
      outletName: outletsTable.name,
      dropoff: locationsTable.address,
    })
    .from(ordersTable)
    .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
    .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
    .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
    .leftJoin(
      locationsTable,
      and(
        eq(locationsTable.user_id, usersTable.id),
        eq(locationsTable.is_default, true),
      ),
    )
    .where(eq(ordersTable.courier_id, courier.id))
    .orderBy(desc(ordersTable.updatedAt))
    .limit(3);

  return NextResponse.json({ success: true, history });
};
