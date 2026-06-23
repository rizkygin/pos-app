import { getSession } from '@/lib/auth';
import { db } from '@/src/db';
import {
  outletsTable,
  productsTable,
  ratingsTable,
  usersTable,
} from '@/src/db/schema';
import { SQL, and, count, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

const PAGE_SIZE = 20;

function buildSummary(rows: { rating: string | null; count: number }[]) {
  const map: Record<number, number> = {};
  for (const r of rows) map[Math.round(Number(r.rating))] = (map[Math.round(Number(r.rating))] ?? 0) + r.count;
  const dist = [5, 4, 3, 2, 1].map((star) => ({ star, count: map[star] ?? 0 }));
  const total = dist.reduce((a, d) => a + d.count, 0);
  const avg =
    total > 0 ? dist.reduce((a, d) => a + d.star * d.count, 0) / total : 0;
  return { avg, count: total, dist };
}

export const GET = async (req: NextRequest) => {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const rawType = searchParams.get('type') ?? 'all';
  const type =
    rawType === 'outlet' || rawType === 'product' ? rawType : ('all' as const);
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'));
  const offset = (page - 1) * PAGE_SIZE;

  const [outlet] = await db
    .select({ id: outletsTable.id })
    .from(outletsTable)
    .where(eq(outletsTable.user_id, session.user.id))
    .limit(1);

  if (!outlet) {
    return NextResponse.json({ error: 'Outlet not found' }, { status: 404 });
  }

  const productRows = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.outlet_id, outlet.id));
  const productIds = productRows.map((p) => p.id);

  const outletCond = and(
    eq(ratingsTable.outlet_id, outlet.id),
    eq(ratingsTable.reciepent_as, 'outlet'),
  )!;

  const productCond: SQL | undefined =
    productIds.length > 0
      ? and(
          inArray(ratingsTable.product_id, productIds),
          eq(ratingsTable.reciepent_as, 'product'),
        )!
      : undefined;

  const listWhere: SQL =
    type === 'outlet'
      ? outletCond
      : type === 'product'
        ? productCond ?? sql`1 = 0`
        : productCond
          ? or(outletCond, productCond)!
          : outletCond;

  const [outletDistRows, productDistRows, [countRow], listRows] =
    await Promise.all([
      db
        .select({ rating: ratingsTable.ratings, count: count() })
        .from(ratingsTable)
        .where(outletCond)
        .groupBy(ratingsTable.ratings),

      productCond
        ? db
            .select({ rating: ratingsTable.ratings, count: count() })
            .from(ratingsTable)
            .where(productCond)
            .groupBy(ratingsTable.ratings)
        : Promise.resolve([]),

      db.select({ total: count() }).from(ratingsTable).where(listWhere),

      db
        .select({
          id: ratingsTable.id,
          ratings: ratingsTable.ratings,
          comment: ratingsTable.comment,
          created_at: ratingsTable.createdAt,
          reviewer_name: usersTable.name,
          product_name: productsTable.product_name,
          outlet_id: ratingsTable.outlet_id,
        })
        .from(ratingsTable)
        .leftJoin(usersTable, eq(ratingsTable.reviewer, usersTable.id))
        .leftJoin(productsTable, eq(ratingsTable.product_id, productsTable.id))
        .where(listWhere)
        .orderBy(desc(ratingsTable.createdAt))
        .limit(PAGE_SIZE)
        .offset(offset),
    ]);

  const total = countRow?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const data = listRows.map((r) => ({
    id: r.id,
    rating: Number(r.ratings) || 5,
    comment: r.comment ?? '',
    created_at: r.created_at,
    reviewer_name: r.reviewer_name ?? 'Anonim',
    type: r.outlet_id != null ? ('outlet' as const) : ('product' as const),
    product_name: r.product_name ?? null,
  }));

  return NextResponse.json({
    data,
    total,
    page,
    totalPages,
    summary: {
      outlet: buildSummary(outletDistRows),
      product: buildSummary(productDistRows),
    },
  });
};
