import { getRole } from '@/lib/utils/get-role';
import { redirect } from 'next/navigation';
import { AdminDashboard } from '@/components/dashboard/admin-dashboard';
import { db } from '@/src/db';
import {
  couriersTable,
  courierSessionsTable,
  customersTable,
  orderDetailsTable,
  ordersTable,
  outletsTable,
  usersTable,
} from '@/src/db/schema';
import { alias } from 'drizzle-orm/pg-core';
import { and, count, countDistinct, desc, eq, gte, isNull, lt, notInArray, sql } from 'drizzle-orm';

const OFFLINE_CUSTOMER_EMAIL = 'rizkygin1@gmail.com';

const adminDashboardPage = async () => {
  const role = await getRole();

  if (!role || role.role !== 'admin') {
    redirect('/dashboard');
  }

  const now = new Date();
  const currentPeriodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const previousPeriodStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  const subtotalSubquery = sql<number>`COALESCE((
    SELECT SUM(CAST(${orderDetailsTable.summary_price} AS NUMERIC))
    FROM ${orderDetailsTable}
    WHERE ${orderDetailsTable.order_id} = ${ordersTable.id}
  ), 0)`.mapWith(Number);

  const revenueExpr = sql<number>`COALESCE(SUM(
    ${subtotalSubquery} + CAST(COALESCE(${ordersTable.delivery_fee}, '0') AS NUMERIC) - CAST(COALESCE(${ordersTable.discount_amount}, '0') AS NUMERIC)
  ), 0)`.mapWith(Number);

  const customerUser = alias(usersTable, 'customer_user');
  const courierUser = alias(usersTable, 'courier_user');

  const [
    [{ total: currentRevenue }],
    [{ total: previousRevenue }],
    [{ total: pendingOrdersCount }],
    [{ total: activeOrdersCount }],
    [{ total: onlineCouriersCount }],
    [{ total: totalOutlets }],
    [{ total: totalCouriers }],
    [{ total: totalCustomers }],
    recentOrdersRaw,
  ] = await Promise.all([
    db
      .select({ total: revenueExpr })
      .from(ordersTable)
      .where(and(eq(ordersTable.status, 'delivered'), gte(ordersTable.createdAt, currentPeriodStart))),
    db
      .select({ total: revenueExpr })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.status, 'delivered'),
          gte(ordersTable.createdAt, previousPeriodStart),
          lt(ordersTable.createdAt, currentPeriodStart),
        ),
      ),
    db.select({ total: count() }).from(ordersTable).where(eq(ordersTable.status, 'pending')),
    db
      .select({ total: count() })
      .from(ordersTable)
      .where(notInArray(ordersTable.status, ['pending', 'delivered', 'cancelled'])),
    db
      .select({ total: countDistinct(courierSessionsTable.courier_id) })
      .from(courierSessionsTable)
      .where(isNull(courierSessionsTable.ended_at)),
    db.select({ total: count() }).from(outletsTable).where(isNull(outletsTable.deletedAt)),
    db.select({ total: count() }).from(couriersTable).where(isNull(couriersTable.deletedAt)),
    db.select({ total: count() }).from(customersTable).where(isNull(customersTable.deletedAt)),
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
        subtotal: subtotalSubquery,
      })
      .from(ordersTable)
      .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
      .innerJoin(customerUser, eq(customersTable.user_id, customerUser.id))
      .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
      .leftJoin(couriersTable, eq(ordersTable.courier_id, couriersTable.id))
      .leftJoin(courierUser, eq(couriersTable.user_id, courierUser.id))
      .orderBy(desc(ordersTable.createdAt))
      .limit(5),
  ]);

  const recentOrders = recentOrdersRaw.map((r) => {
    const deliveryFee = Number(r.delivery_fee ?? 0);
    const discount = Number(r.discount_amount ?? 0);
    return {
      id: r.id,
      status: r.status,
      outlet_name: r.outlet_name,
      customer_name: r.customer_name,
      total_paid: r.subtotal + deliveryFee - discount,
      is_offline: r.customer_email === OFFLINE_CUSTOMER_EMAIL,
    };
  });

  const revenuePercentageChange =
    previousRevenue > 0
      ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
      : currentRevenue > 0
        ? 100
        : 0;

  return (
    <AdminDashboard
      revenue30Days={currentRevenue}
      revenuePercentageChange={revenuePercentageChange}
      pendingOrdersCount={pendingOrdersCount}
      activeOrdersCount={activeOrdersCount}
      onlineCouriersCount={onlineCouriersCount}
      totalOutlets={totalOutlets}
      totalCouriers={totalCouriers}
      totalCustomers={totalCustomers}
      recentOrders={recentOrders}
    />
  );
};

export default adminDashboardPage;
