import { getSession } from '@/lib/auth';
import { db } from '@/src/db';
import { ratingsTable, usersTable } from '@/src/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export const GET = async () => {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = await db
    .select({
      id: ratingsTable.id,
      ratings: ratingsTable.ratings,
      comment: ratingsTable.comment,
      created_at: ratingsTable.createdAt,
      reviewer_name: usersTable.name,
    })
    .from(ratingsTable)
    .leftJoin(usersTable, eq(ratingsTable.reviewer, usersTable.id))
    .where(
      and(
        eq(ratingsTable.reciepent, session.user.id),
        eq(ratingsTable.reciepent_as, 'courier'),
      ),
    )
    .orderBy(desc(ratingsTable.createdAt));

  const data = rows.map((r) => ({
    id: r.id,
    rating: Number(r.ratings) || 5,
    comment: r.comment ?? '',
    created_at: r.created_at,
    reviewer_name: r.reviewer_name ?? 'Anonim',
  }));

  return NextResponse.json({ data });
};
