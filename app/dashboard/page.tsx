import { getSession } from '@/lib/auth';
import { getRole, getOutlet } from '@/lib/utils/get-role';
import RegisterRolePage from '@/pages/register-role';
import { CourierDashboard } from '@/components/dashboard/courier-dashboard';
import { CustomerDashboard } from '@/components/dashboard/customer-dashboard';
import { OwnerDashboard } from '@/components/dashboard/owner-dashboard';
import { db } from '@/src/db';
import {
  couriersTable,
  courierSessionsTable,
  customersTable,
  locationsTable,
  ordersTable,
  orderDetailsTable,
  outletsTable,
  usersTable,
} from '@/src/db/schema';
import { and, desc, eq, gte, inArray, isNull, sql, sum, count } from 'drizzle-orm';
import { getUTCTime } from '@/lib/timezone';
import { formatCurrency } from '@/lib/utils/format';

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
        totalAmount: sum(
          sql<number>`CAST(${orderDetailsTable.summary_price} AS NUMERIC)`,
        ).mapWith(Number),
      })
      .from(ordersTable)
      .leftJoin(
        orderDetailsTable,
        eq(orderDetailsTable.order_id, ordersTable.id),
      )
      .where(
        and(
          eq(ordersTable.outlet_id, outletId),
          gte(ordersTable.createdAt, since),
        ),
      )
      .groupBy(ordersTable.id);

    const recentOrder = rawOrders.map((o) => ({
      orderId: o.orderId,
      itemCount: o.itemCount ?? 0,
      totalAmount: o.totalAmount ?? 0,
      status:
        o.status === 'delivered'
          ? ('checkout' as const)
          : ['confirmed', 'preparing', 'ready', 'on_delivery'].includes(
                o.status,
              )
            ? ('addToChart' as const)
            : null,
    }));

    const activeOrdersCount = rawOrders.filter(
      (o) => !['delivered', 'cancelled'].includes(o.status),
    ).length;

    return (
      <OwnerDashboard
        activeOrdersCount={activeOrdersCount}
        recentOrders={recentOrder}
      />
    );
  }

  if (role.role === 'courier') {
    const session = await getSession();

    const [courier] = await db
      .select({ id: couriersTable.id })
      .from(couriersTable)
      .where(eq(couriersTable.user_id, session.user.id))
      .limit(1);

    let initialIsOnline = false;
    let todayOnlineSeconds = 0;

    if (courier) {
      // Is there an open session right now?
      const [openSession] = await db
        .select({ started_at: courierSessionsTable.started_at })
        .from(courierSessionsTable)
        .where(
          and(
            eq(courierSessionsTable.courier_id, courier.id),
            isNull(courierSessionsTable.ended_at),
          ),
        )
        .limit(1);

      initialIsOnline = !!openSession;

      // Sum all completed sessions today + current open session if any
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [result] = await db
        .select({
          totalSeconds: sql<number>`
            COALESCE(SUM(
              EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - started_at))
            ), 0)
          `,
        })
        .from(courierSessionsTable)
        .where(
          and(
            eq(courierSessionsTable.courier_id, courier.id),
            gte(courierSessionsTable.started_at, todayStart),
          ),
        );

      todayOnlineSeconds = Math.floor(result?.totalSeconds ?? 0);
    }

    const [{ completion, sum: earningToday }] = await db
      .select({
        completion: count(ordersTable.id),
        sum: sql<number>`SUM(CAST(orders.delivery_fee as NUMERIC))`,
      })
      .from(ordersTable)
      .where(eq(ordersTable.courier_id, courier.id));

    const [{ totalCancel: cancelOrderByCourier }] = await db
      .select({ totalCancel: count(ordersTable.id) })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.courier_id, courier.id),
          eq(ordersTable.status, 'cancelled'),
          eq(ordersTable.rejected_by, 'courier'),
        ),
      );

    //TODO :: count all total orders not done by courier / cancelled
    const [{ rating }] = await db
      .select({
        rating: couriersTable.ratings,
      })
      .from(couriersTable)
      .where(eq(couriersTable.id, courier.id));

    const dashboardCurierValue = {
      earningToday: formatCurrency(earningToday || 0),
      rating: String(rating),
      completion: String((1 - cancelOrderByCourier / completion) * 100) + '%',
    };

    const [activeOrder] = await db
      .select({
        id: ordersTable.id,
        name_customer: usersTable.name,
        pickup: outletsTable.name,
        dropoff: locationsTable.address,
        delivery_fee: ordersTable.delivery_fee,
        status: ordersTable.status,
      })
      .from(ordersTable)
      .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
      .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
      .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
      .leftJoin(
        locationsTable,
        and(
          eq(locationsTable.user_id, usersTable.id),
          eq(locationsTable.is_default, true),
        ),
      )
      .where(
        and(
          eq(ordersTable.courier_id, courier.id),
          inArray(ordersTable.status, [
            'confirmed',
            'preparing',
            'ready',
            'on_delivery',
          ]),
        ),
      )
      .orderBy(desc(ordersTable.createdAt))
      .limit(1);

    let currentPickUpItems = 0;
    if (activeOrder) {
      const [{ itemCount }] = await db
        .select({ itemCount: count(orderDetailsTable.id) })
        .from(orderDetailsTable)
        .where(eq(orderDetailsTable.order_id, activeOrder.id));
      currentPickUpItems = itemCount;
    }

    const currentPickUp = activeOrder
      ? {
          id: activeOrder.id,
          name_customer: activeOrder.name_customer,
          pickup: activeOrder.pickup,
          dropoff: activeOrder.dropoff ?? '-',
          items: currentPickUpItems,
          amount: formatCurrency(parseFloat(activeOrder.delivery_fee ?? '0')),
          status: activeOrder.status,
        }
      : null;

    return (
      <CourierDashboard
        currentPickUp={currentPickUp}
        dashboardValue={dashboardCurierValue}
        initialIsOnline={initialIsOnline}
        todayOnlineSeconds={todayOnlineSeconds}
      />
    );
  }

  if (role.role === 'customer') {
    return <CustomerDashboard />;
  }
};

export default dashboardPage;
