import { db } from '@/src/db';
import { adminsTable, ratingsTable, usersTable } from '@/src/db/schema';
import { auth } from '@/lib/auth';
import { and, count, desc, eq } from 'drizzle-orm';
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
  const productId = searchParams.get('productId');
  if (!productId) {
    return NextResponse.json({ success: false, error: 'productId is required' }, { status: 400 });
  }

  const where = and(
    eq(ratingsTable.product_id, productId),
    eq(ratingsTable.reciepent_as, 'product'),
  );

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: ratingsTable.id,
        rating: ratingsTable.ratings,
        comment: ratingsTable.comment,
        created_at: ratingsTable.createdAt,
        reviewer_name: usersTable.name,
      })
      .from(ratingsTable)
      .leftJoin(usersTable, eq(ratingsTable.reviewer, usersTable.id))
      .where(where)
      .orderBy(desc(ratingsTable.createdAt))
      .limit(25),
    db.select({ total: count() }).from(ratingsTable).where(where),
  ]);

  const data = rows.map((r) => ({
    id: r.id,
    rating: Number(r.rating) || 5,
    comment: r.comment ?? '',
    created_at: r.created_at,
    reviewer_name: r.reviewer_name ?? 'Anonim',
  }));

  const average =
    data.length > 0 ? data.reduce((acc, r) => acc + r.rating, 0) / data.length : 0;

  return NextResponse.json({
    success: true,
    data,
    total,
    average,
  });
};
