import { db } from '@/src/db';
import { adminsTable, couriersTable, ratingsTable, usersTable } from '@/src/db/schema';
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
  const minRating = searchParams.get('minRating');
  const sortBy = searchParams.get('sortBy') ?? '';
  const sortOrder = searchParams.get('sortOrder') === 'asc' ? asc : desc;

  const conditions = [isNull(couriersTable.deletedAt)];

  if (search) {
    conditions.push(
      or(
        ilike(usersTable.name, `%${search}%`),
        ilike(usersTable.email, `%${search}%`),
        ilike(usersTable.phone, `%${search}%`),
        ilike(couriersTable.vehicle_plate, `%${search}%`),
      )!,
    );
  }

  if (minRating) {
    conditions.push(gte(sql`CAST(${couriersTable.ratings} AS NUMERIC)`, Number(minRating)));
  }

  const where = and(...conditions);

  const sortMap: Record<string, ReturnType<typeof asc | typeof desc>> = {
    name: sortOrder(usersTable.name),
    ratings: sortOrder(sql`CAST(${couriersTable.ratings} AS NUMERIC)`),
    review_count: sortOrder(couriersTable.review_count),
    created_at: sortOrder(couriersTable.createdAt),
  };

  const orderByCol = sortMap[sortBy] ?? desc(couriersTable.createdAt);

  const latestRating = sql<string | null>`(
    SELECT ${ratingsTable.ratings} FROM ${ratingsTable}
    WHERE ${ratingsTable.reciepent} = ${usersTable.id} AND ${ratingsTable.reciepent_as} = 'courier'
    ORDER BY ${ratingsTable.createdAt} DESC LIMIT 1
  )`;
  const latestRatingId = sql<string | null>`(
    SELECT ${ratingsTable.id} FROM ${ratingsTable}
    WHERE ${ratingsTable.reciepent} = ${usersTable.id} AND ${ratingsTable.reciepent_as} = 'courier'
    ORDER BY ${ratingsTable.createdAt} DESC LIMIT 1
  )`;
  const latestRatingComment = sql<string | null>`(
    SELECT ${ratingsTable.comment} FROM ${ratingsTable}
    WHERE ${ratingsTable.reciepent} = ${usersTable.id} AND ${ratingsTable.reciepent_as} = 'courier'
    ORDER BY ${ratingsTable.createdAt} DESC LIMIT 1
  )`;
  const latestRatingAt = sql<string | null>`(
    SELECT ${ratingsTable.createdAt} FROM ${ratingsTable}
    WHERE ${ratingsTable.reciepent} = ${usersTable.id} AND ${ratingsTable.reciepent_as} = 'courier'
    ORDER BY ${ratingsTable.createdAt} DESC LIMIT 1
  )`;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: couriersTable.id,
        user_id: couriersTable.user_id,
        name: usersTable.name,
        email: usersTable.email,
        phone: usersTable.phone,
        avatar: couriersTable.avatar,
        vehicle_plate: couriersTable.vehicle_plate,
        vehicle_type: couriersTable.vehicle_type,
        ratings: couriersTable.ratings,
        review_count: couriersTable.review_count,
        latest_rating_id: latestRatingId,
        latest_rating: latestRating,
        latest_rating_comment: latestRatingComment,
        latest_rating_at: latestRatingAt,
        created_at: couriersTable.createdAt,
      })
      .from(couriersTable)
      .innerJoin(usersTable, eq(couriersTable.user_id, usersTable.id))
      .where(where)
      .orderBy(orderByCol)
      .limit(limit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(couriersTable)
      .innerJoin(usersTable, eq(couriersTable.user_id, usersTable.id))
      .where(where),
  ]);

  return NextResponse.json({ success: true, data: rows, count: total });
};
