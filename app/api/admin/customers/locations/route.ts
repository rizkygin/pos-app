import { db } from '@/src/db';
import { adminsTable, customersTable, locationsTable } from '@/src/db/schema';
import { auth } from '@/lib/auth';
import { desc, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

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
  const customerId = Number(searchParams.get('customerId'));
  if (!customerId) {
    return NextResponse.json({ success: false, error: 'customerId is required' }, { status: 400 });
  }

  const [customer] = await db
    .select({ user_id: customersTable.user_id })
    .from(customersTable)
    .where(eq(customersTable.id, customerId))
    .limit(1);

  if (!customer) {
    return NextResponse.json({ success: false, error: 'Customer not found' }, { status: 404 });
  }

  const rows = await db
    .select({
      id: locationsTable.id,
      label: locationsTable.label,
      address: locationsTable.address,
      lat: locationsTable.lat,
      lon: locationsTable.lon,
      note: locationsTable.note,
      is_default: locationsTable.is_default,
    })
    .from(locationsTable)
    .where(eq(locationsTable.user_id, customer.user_id))
    .orderBy(desc(locationsTable.is_default), desc(locationsTable.createdAt));

  return NextResponse.json({ success: true, data: rows });
};
