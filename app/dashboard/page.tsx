import { getSession } from '@/lib/auth';
import { getRole, getOutlet } from '@/lib/utils/get-role';
import RegisterRolePage from '@/pages/register-role';
import { CourierDashboard } from '@/components/dashboard/courier-dashboard';
import { CustomerDashboard } from '@/components/dashboard/customer-dashboard';
import { OwnerDashboard } from '@/components/dashboard/owner-dashboard';
import { db } from '@/src/db';
import { ordersTable, orderDetailsTable } from '@/src/db/schema';
import { and, eq, gte, sum, sql } from 'drizzle-orm';
import { getUTCTime } from '@/lib/timezone';

const dashboardPage = async () => {
  const role = await getRole();

  if (!role) {
    return <RegisterRolePage />;
  }

  if (role.role === 'owner') {
    const outlet = await getOutlet();
    const outletId = outlet.result[0]?.id;
    if (!outletId) return null;

    const since = new Date(getUTCTime().getTime() - 24 * 60 * 60 * 1000);

    const rawOrders = await db
      .select({
        orderId: ordersTable.id,
        status: ordersTable.status,
        itemCount: sum(orderDetailsTable.quantity).mapWith(Number),
        totalAmount: sum(sql<number>`CAST(${orderDetailsTable.summary_price} AS NUMERIC)`).mapWith(Number),
      })
      .from(ordersTable)
      .leftJoin(orderDetailsTable, eq(orderDetailsTable.order_id, ordersTable.id))
      .where(and(eq(ordersTable.outlet_id, outletId), gte(ordersTable.createdAt, since)))
      .groupBy(ordersTable.id);

    const recentOrder = rawOrders.map((o) => ({
      orderId: o.orderId,
      itemCount: o.itemCount ?? 0,
      totalAmount: o.totalAmount ?? 0,
      status:
        o.status === 'delivered'
          ? ('checkout' as const)
          : ['confirmed', 'preparing', 'ready', 'on_delivery'].includes(o.status)
            ? ('addToChart' as const)
            : null,
    }));

    const activeOrdersCount = rawOrders.filter(
      (o) => !['delivered', 'cancelled'].includes(o.status),
    ).length;

    return <OwnerDashboard activeOrdersCount={activeOrdersCount} recentOrders={recentOrder} />;
  }

  if (role.role === 'courier') {
    return <CourierDashboard />;
  }

  if (role.role === 'customer') {
    return <CustomerDashboard />;
  }
};

export default dashboardPage;
