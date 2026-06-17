import { db } from '@/src/db';
import { adminsTable, outletsTable } from '@/src/db/schema';
import { auth } from '@/lib/auth';
import { and, asc, count, desc, eq, gte, ilike, isNull, or, sql } from 'drizzle-orm';
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
  const isOpenParam = searchParams.get('is_open');
  const minRating = searchParams.get('minRating');
  const featuresParam = searchParams.get('features');
  const sortBy = searchParams.get('sortBy') ?? '';
  const sortOrder = searchParams.get('sortOrder') === 'asc' ? asc : desc;

  const conditions = [isNull(outletsTable.deletedAt)];

  if (search) {
    conditions.push(
      or(
        ilike(outletsTable.name, `%${search}%`),
        ilike(outletsTable.address, `%${search}%`),
        ilike(outletsTable.email, `%${search}%`),
        ilike(outletsTable.phone, `%${search}%`),
      )!,
    );
  }

  if (isOpenParam === 'true') {
    conditions.push(eq(outletsTable.is_open, true));
  } else if (isOpenParam === 'false') {
    conditions.push(eq(outletsTable.is_open, false));
  }

  if (minRating) {
    conditions.push(gte(sql`CAST(${outletsTable.ratings} AS NUMERIC)`, Number(minRating)));
  }

  if (featuresParam) {
    const slugs = featuresParam.split(',').filter(Boolean);
    if (slugs.length > 0) {
      conditions.push(sql`${outletsTable.features} @> ARRAY[${sql.join(slugs.map((s) => sql`${s}`), sql`, `)}]::text[]`);
    }
  }

  const where = and(...conditions);

  const sortMap: Record<string, ReturnType<typeof asc | typeof desc>> = {
    name: sortOrder(outletsTable.name),
    ratings: sortOrder(sql`CAST(${outletsTable.ratings} AS NUMERIC)`),
    review_count: sortOrder(outletsTable.review_count),
    created_at: sortOrder(outletsTable.createdAt),
  };

  const orderByCol = sortMap[sortBy] ?? desc(outletsTable.createdAt);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: outletsTable.id,
        name: outletsTable.name,
        phone: outletsTable.phone,
        email: outletsTable.email,
        address: outletsTable.address,
        avatar: outletsTable.avatar,
        ratings: outletsTable.ratings,
        review_count: outletsTable.review_count,
        is_open: outletsTable.is_open,
        tags: outletsTable.tags,
        features: outletsTable.features,
        created_at: outletsTable.createdAt,
      })
      .from(outletsTable)
      .where(where)
      .orderBy(orderByCol)
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(outletsTable).where(where),
  ]);

  return NextResponse.json({ success: true, data: rows, count: total });
};
