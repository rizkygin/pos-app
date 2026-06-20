import { db } from '@/src/db';
import { adminsTable, customersTable, usersTable } from '@/src/db/schema';
import { auth } from '@/lib/auth';
import { and, asc, count, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
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
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const limit = Math.max(1, Number(searchParams.get('limit')) || 10);
  const offset = (page - 1) * limit;
  const search = searchParams.get('search') ?? '';
  const sortBy = searchParams.get('sortBy') ?? '';
  const sortOrder = searchParams.get('sortOrder') === 'asc' ? asc : desc;

  const conditions = [isNull(customersTable.deletedAt)];

  if (search) {
    conditions.push(
      or(
        ilike(usersTable.name, `%${search}%`),
        ilike(usersTable.email, `%${search}%`),
        ilike(usersTable.phone, `%${search}%`),
      )!,
    );
  }

  const where = and(...conditions);

  const sortMap: Record<string, ReturnType<typeof asc | typeof desc>> = {
    name: sortOrder(usersTable.name),
    ratings: sortOrder(sql`CAST(${customersTable.ratings} AS NUMERIC)`),
    review_count: sortOrder(customersTable.review_count),
    created_at: sortOrder(customersTable.createdAt),
  };

  const orderByCol = sortMap[sortBy] ?? desc(customersTable.createdAt);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: customersTable.id,
        user_id: customersTable.user_id,
        name: usersTable.name,
        email: usersTable.email,
        phone: usersTable.phone,
        address: usersTable.address,
        avatar: usersTable.image,
        ratings: customersTable.ratings,
        review_count: customersTable.review_count,
        created_at: customersTable.createdAt,
      })
      .from(customersTable)
      .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
      .where(where)
      .orderBy(orderByCol)
      .limit(limit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(customersTable)
      .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
      .where(where),
  ]);

  return NextResponse.json({ success: true, data: rows, count: total });
};
