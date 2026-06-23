import getOutletID from '@/lib/outlet-id';
import { db } from '@/src/db';
import {
  orderDetailsTable,
  ordersTable,
  outletsTable,
  productsTable,
} from '@/src/db/schema';
import { sum, eq, and, gte, lt, sql, notInArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';

function getLast6Months() {
  const months = [];
  const now = new Date();

  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);

    months.push({
      label: start.toLocaleString('default', {
        month: 'long',
        year: 'numeric',
      }),
      start,
      end,
    });
  }

  return months;
}

export const GET = async (request: Request) => {
  const outlet = await getOutletID();

  if (!outlet) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const months = getLast6Months();

  const result = await Promise.all(
    months.map(async (month) => {
      const data = await db
        .select({
          count_order: sum(orderDetailsTable.quantity),
          total_terjual: sql<number>`sum(cast(${orderDetailsTable.summary_price} as numeric))`,
        })
        .from(orderDetailsTable)
        .innerJoin(ordersTable, eq(orderDetailsTable.order_id, ordersTable.id))
        .leftJoin(
          productsTable,
          eq(orderDetailsTable.product_id, productsTable.id),
        )
        .leftJoin(outletsTable, eq(productsTable.outlet_id, outletsTable.id))
        .where(
          and(
            eq(outletsTable.id, outlet.id),
            gte(orderDetailsTable.created_at, month.start),
            lt(orderDetailsTable.created_at, month.end),
            notInArray(ordersTable.status, ['cancelled', 'pending']),
          ),
        );

      return {
        month: month.label,
        count_order: Number(data[0].count_order) || 0,
        total_terjual: Number(data[0].total_terjual) || 0,
      };
    }),
  );

  return NextResponse.json({ data: result });
};
