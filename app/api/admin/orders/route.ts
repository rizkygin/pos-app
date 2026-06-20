import { db } from '@/src/db';
import {
  adminsTable,
  couriersTable,
  customersTable,
  orderDetailsTable,
  ordersTable,
  outletsTable,
  usersTable,
} from '@/src/db/schema';
import { auth } from '@/lib/auth';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

const OFFLINE_CUSTOMER_EMAIL = 'rizkygin1@gmail.com';
const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'on_delivery',
  'delivered',
  'cancelled',
] as const;

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
  const status = searchParams.get('status');
  const type = searchParams.get('type');
  const sortOrder = searchParams.get('sortOrder') === 'asc' ? asc : desc;

  const customerUser = alias(usersTable, 'customer_user');
  const courierUser = alias(usersTable, 'courier_user');

  const conditions = [];

  if (search) {
    conditions.push(
      or(
        ilike(ordersTable.id, `%${search}%`),
        ilike(customerUser.name, `%${search}%`),
        ilike(outletsTable.name, `%${search}%`),
      )!,
    );
  }

  if (status && (ORDER_STATUSES as readonly string[]).includes(status)) {
    conditions.push(eq(ordersTable.status, status as (typeof ORDER_STATUSES)[number]));
  }

  if (type === 'offline') {
    conditions.push(eq(customerUser.email, OFFLINE_CUSTOMER_EMAIL));
  } else if (type === 'online') {
    conditions.push(sql`${customerUser.email} != ${OFFLINE_CUSTOMER_EMAIL}`);
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const subtotalSubquery = sql<number>`COALESCE((
    SELECT SUM(CAST(${orderDetailsTable.summary_price} AS NUMERIC))
    FROM ${orderDetailsTable}
    WHERE ${orderDetailsTable.order_id} = ${ordersTable.id}
  ), 0)`.mapWith(Number);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: ordersTable.id,
        status: ordersTable.status,
        delivery_fee: ordersTable.delivery_fee,
        discount_amount: ordersTable.discount_amount,
        created_at: ordersTable.createdAt,
        outlet_name: outletsTable.name,
        customer_name: customerUser.name,
        customer_email: customerUser.email,
        courier_name: courierUser.name,
        subtotal: subtotalSubquery,
      })
      .from(ordersTable)
      .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
      .innerJoin(customerUser, eq(customersTable.user_id, customerUser.id))
      .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
      .leftJoin(couriersTable, eq(ordersTable.courier_id, couriersTable.id))
      .leftJoin(courierUser, eq(couriersTable.user_id, courierUser.id))
      .where(where)
      .orderBy(sortOrder(ordersTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(ordersTable)
      .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
      .innerJoin(customerUser, eq(customersTable.user_id, customerUser.id))
      .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
      .where(where),
  ]);

  const data = rows.map((r) => {
    const subtotal = r.subtotal;
    const deliveryFee = Number(r.delivery_fee ?? 0);
    const discount = Number(r.discount_amount ?? 0);
    return {
      id: r.id,
      status: r.status,
      outlet_name: r.outlet_name,
      customer_name: r.customer_name,
      courier_name: r.courier_name,
      subtotal,
      delivery_fee: deliveryFee,
      discount_amount: discount,
      total_paid: subtotal + deliveryFee - discount,
      is_offline: r.customer_email === OFFLINE_CUSTOMER_EMAIL,
      created_at: r.created_at,
    };
  });

  return NextResponse.json({ success: true, data, count: total });
};
