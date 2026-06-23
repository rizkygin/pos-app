import { db } from '@/src/db';
import { adminsTable, outletsTable, orderDetailsTable, productsTable } from '@/src/db/schema';
import { auth } from '@/lib/auth';
import { and, asc, count, desc, eq, ilike, isNull, or, SQL, sql } from 'drizzle-orm';
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
  const outletId = searchParams.get('outletId');
  const minRating = searchParams.get('minRating');
  const minPrice = searchParams.get('minPrice');
  const maxPrice = searchParams.get('maxPrice');
  const sortBy = searchParams.get('sortBy') ?? '';
  const sortOrder = searchParams.get('sortOrder') === 'asc' ? asc : desc;

  const now = new Date();
  const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const trafficSubquery = (since: Date) =>
    sql<number>`COALESCE((SELECT SUM(${orderDetailsTable.quantity}) FROM ${orderDetailsTable} WHERE ${orderDetailsTable.product_id} = ${productsTable.id} AND ${orderDetailsTable.created_at} >= ${since}), 0)`.mapWith(Number);

  const conditions = [isNull(productsTable.deletedAt)];

  if (search) {
    conditions.push(
      or(
        ilike(productsTable.product_name, `%${search}%`),
        ilike(outletsTable.name, `%${search}%`),
      )!,
    );
  }

  if (outletId) {
    conditions.push(eq(productsTable.outlet_id, Number(outletId)));
  }

  if (minRating) {
    conditions.push(sql`CAST(${productsTable.ratings} AS NUMERIC) >= ${Number(minRating)}`);
  }

  if (minPrice) {
    conditions.push(sql`CAST(${productsTable.price} AS NUMERIC) >= ${Number(minPrice)}`);
  }

  if (maxPrice) {
    conditions.push(sql`CAST(${productsTable.price} AS NUMERIC) <= ${Number(maxPrice)}`);
  }

  const where = and(...conditions);

  const sortColumns: Record<string, SQL> = {
    price: sql`CAST(${productsTable.price} AS NUMERIC)`,
    rating: sql`CAST(${productsTable.ratings} AS NUMERIC)`,
    traffic_today: trafficSubquery(dayStart),
    traffic_week: trafficSubquery(weekStart),
    traffic_month: trafficSubquery(monthStart),
  };
  const orderByColumn = sortColumns[sortBy];

  const [rows, [{ total }], outlets] = await Promise.all([
    db
      .select({
        id: productsTable.id,
        product_name: productsTable.product_name,
        image: productsTable.image,
        category: productsTable.category,
        price: productsTable.price,
        price_mark_down: productsTable.price_mark_down,
        ratings: productsTable.ratings,
        review_count: productsTable.review_count,
        is_recommended: productsTable.is_recommended,
        outlet_id: productsTable.outlet_id,
        outlet_name: outletsTable.name,
        traffic_today: trafficSubquery(dayStart),
        traffic_week: trafficSubquery(weekStart),
        traffic_month: trafficSubquery(monthStart),
      })
      .from(productsTable)
      .innerJoin(outletsTable, eq(productsTable.outlet_id, outletsTable.id))
      .where(where)
      .orderBy(orderByColumn ? sortOrder(orderByColumn) : desc(productsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(productsTable)
      .innerJoin(outletsTable, eq(productsTable.outlet_id, outletsTable.id))
      .where(where),
    db.select({ id: outletsTable.id, name: outletsTable.name }).from(outletsTable),
  ]);

  return NextResponse.json({
    success: true,
    data: rows,
    count: total,
    outlets,
  });
};
