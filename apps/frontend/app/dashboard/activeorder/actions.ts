'use server';

import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { db } from '@/src/db';
import {
  cashInCategoryTable,
  couriersTable,
  customersTable,
  ordersTable,
  outletsTable,
  cashInDetailTable,
  orderDetailsTable,
  cashFlows,
} from '@/src/db/schema';
import { and, eq, isNotNull, or, sql } from 'drizzle-orm';
import { CATEGORY_IN } from '@/lib/cashflow-categories';
import { OrdersTable } from '../order-outlet/data-table';

export async function cancelOrderbyCustomer(orderId: string) {
  const session = await getSession();

  const [customer] = await db
    .select({ id: customersTable.id })
    .from(customersTable)
    .where(eq(customersTable.user_id, session.user.id))
    .limit(1);

  if (!customer) throw new Error('Customer not found');

  await db
    .update(ordersTable)
    .set({
      status: 'cancelled',
      rejected_by: 'customer',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(ordersTable.id, orderId),
        eq(ordersTable.customer_id, customer.id),
        eq(ordersTable.status, 'pending'),
      ),
    );

  redirect('/dashboard/order');
}

export async function confirmOrder(orderId: string) {
  const session = await getSession();

  const [outlet] = await db
    .select({ id: outletsTable.id })
    .from(outletsTable)
    .where(eq(outletsTable.user_id, session.user.id))
    .limit(1);

  if (!outlet) throw new Error('Not an owner');

  await db
    .update(ordersTable)
    .set({ status: 'confirmed', updatedAt: new Date() })
    .where(
      and(
        eq(ordersTable.id, orderId),
        eq(ordersTable.outlet_id, outlet.id),
        eq(ordersTable.status, 'pending'),
      ),
    );
}

export async function confirmPickup(orderId: string) {
  const session = await getSession();

  const [outlet] = await db
    .select({ id: outletsTable.id })
    .from(outletsTable)
    .where(eq(outletsTable.user_id, session.user.id))
    .limit(1);

  if (!outlet) throw new Error('Not an owner');

  await db
    .update(ordersTable)
    .set({ status: 'on_delivery', updatedAt: new Date() })
    .where(
      and(
        eq(ordersTable.id, orderId),
        eq(ordersTable.outlet_id, outlet.id),
        eq(ordersTable.status, 'ready'),
      ),
    );
}

export async function markOrderDelivered(orderId: string) {
  const session = await getSession();

  await db.transaction(async (tx) => {
    //store to db cashflowin
    const [idCategory] = await tx
      .select({
        id: cashInCategoryTable.id,
      })
      .from(cashInCategoryTable)
      .where(eq(cashInCategoryTable.category, CATEGORY_IN[0]))
      .limit(1);

    const [outlet] = await tx
      .select({ id: ordersTable.outlet_id })
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .limit(1);

    if (!outlet) throw new Error('Not an owner');

    const amount = await tx
      .select({
        sum: sql<number>`sum(cast(${orderDetailsTable.summary_price} as numeric))`,
      })
      .from(orderDetailsTable)
      .where(eq(orderDetailsTable.order_id, orderId));

    const cashIn = await tx
      .insert(cashInDetailTable)
      .values({
        category_id: idCategory.id,
        money_amount: String(amount[0].sum ?? 0),
        type: 'cash',
      })
      .returning({
        id: cashInDetailTable.id,
      });

    //this cashflows
    await tx.insert(cashFlows).values({
      outlet_id: Number(outlet.id),
      cash_opname: 'cash',
      cash_in_detail_id: cashIn[0].id,
    });

    const [courier] = await tx
      .select({ id: couriersTable.id })
      .from(couriersTable)
      .where(eq(couriersTable.user_id, session.user.id))
      .limit(1);

    if (!courier) throw new Error('Not a courier');
    
    await tx
      .update(orderDetailsTable)
      .set({
        status: 'checkout',
      })
      .where(eq(orderDetailsTable.order_id, orderId));

    await tx
      .update(ordersTable)
      .set({ status: 'delivered', updatedAt: new Date() })
      .where(
        and(
          eq(ordersTable.id, orderId),
          eq(ordersTable.courier_id, courier.id),
          eq(ordersTable.status, 'on_delivery'),
        ),
      );
  });
}

export async function markOrderReady(orderId: string) {
  const session = await getSession();

  const [outlet] = await db
    .select({ id: outletsTable.id })
    .from(outletsTable)
    .where(eq(outletsTable.user_id, session.user.id))
    .limit(1);

  if (!outlet) throw new Error('Not an owner');

  await db
    .update(ordersTable)
    .set({ status: 'ready', updatedAt: new Date() })
    .where(
      and(
        eq(ordersTable.id, orderId),
        eq(ordersTable.outlet_id, outlet.id),
        isNotNull(ordersTable.courier_id),
        or(
          eq(ordersTable.status, 'confirmed'),
          eq(ordersTable.status, 'preparing'),
        ),
      ),
    );
}
