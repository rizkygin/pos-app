import { redirect } from 'next/navigation';
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
  productAdsTable,
  productAdsSchedule,
  scheduleProductAdsTable,
  productsTable,
  usersTable,
} from '@/src/db/schema';
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
  sum,
  count,
} from 'drizzle-orm';
import { getUTCTime } from '@/lib/timezone';
import { getCurrentAdSlot } from '@/lib/utils/ad-schedule';
import { getCourierRatingInfo } from '@/lib/utils/courier-availability';
import { formatCurrency } from '@/lib/utils/format';
import { NextResponse } from 'next/server';
import { haversineKm } from '@/lib/utils/geo';

const dashboardPage = async () => {
  const role = await getRole();

  if (!role) {
    return <RegisterRolePage />;
  }
  if (role.role === 'admin') {
    redirect('/dashboard/admin');
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

    const now = new Date();
    const currentPeriodStart = new Date(
      now.getFullYear(),
      now.getMonth() - 5,
      1,
    );
    const previousPeriodStart = new Date(
      now.getFullYear(),
      now.getMonth() - 11,
      1,
    );

    const validOrderDetails = and(
      eq(ordersTable.outlet_id, outletId),
      notInArray(ordersTable.status, ['cancelled', 'pending']),
    );

    const [[currentPeriod], [previousPeriod], [topProductRow]] =
      await Promise.all([
        db
          .select({
            total:
              sql<number>`coalesce(sum(cast(${orderDetailsTable.summary_price} as numeric)), 0)`.mapWith(
                Number,
              ),
          })
          .from(orderDetailsTable)
          .innerJoin(
            ordersTable,
            eq(orderDetailsTable.order_id, ordersTable.id),
          )
          .where(
            and(
              validOrderDetails,
              gte(orderDetailsTable.created_at, currentPeriodStart),
            ),
          ),
        db
          .select({
            total:
              sql<number>`coalesce(sum(cast(${orderDetailsTable.summary_price} as numeric)), 0)`.mapWith(
                Number,
              ),
          })
          .from(orderDetailsTable)
          .innerJoin(
            ordersTable,
            eq(orderDetailsTable.order_id, ordersTable.id),
          )
          .where(
            and(
              validOrderDetails,
              gte(orderDetailsTable.created_at, previousPeriodStart),
              lt(orderDetailsTable.created_at, currentPeriodStart),
            ),
          ),
        db
          .select({
            name: productsTable.product_name,
            category: productsTable.category,
            totalSold: sum(orderDetailsTable.quantity).mapWith(Number),
          })
          .from(orderDetailsTable)
          .innerJoin(
            ordersTable,
            eq(orderDetailsTable.order_id, ordersTable.id),
          )
          .innerJoin(
            productsTable,
            eq(orderDetailsTable.product_id, productsTable.id),
          )
          .where(
            and(
              validOrderDetails,
              gte(orderDetailsTable.created_at, currentPeriodStart),
            ),
          )
          .groupBy(productsTable.id)
          .orderBy(desc(sum(orderDetailsTable.quantity)))
          .limit(1),
      ]);

    const currentSales = currentPeriod?.total ?? 0;
    const previousSales = previousPeriod?.total ?? 0;

    const total6monthsSales = {
      totalSales: currentSales,
      percentage:
        previousSales > 0
          ? ((currentSales - previousSales) / previousSales) * 100
          : currentSales > 0
            ? 100
            : 0,
    };

    const topProduct = topProductRow ?? null;

    return (
      <OwnerDashboard
        activeOrdersCount={activeOrdersCount}
        recentOrders={recentOrder}
        total6monthsSales={total6monthsSales}
        topProduct={topProduct}
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
      completion: (completion === 0 ? 100 : Math.round((1 - cancelOrderByCourier / completion) * 100)) + '%',
    };

    const { ratingStatus, delaySeconds } = await getCourierRatingInfo(courier.id);

    const courierNow = getUTCTime();
    const daysSinceMonday = (courierNow.getUTCDay() + 6) % 7;
    const thisWeekStart = new Date(courierNow);
    thisWeekStart.setUTCDate(courierNow.getUTCDate() - daysSinceMonday);
    thisWeekStart.setUTCHours(0, 0, 0, 0);
    const lastWeekStart = new Date(
      thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000,
    );

    const [[thisWeekStats], [lastWeekStats]] = await Promise.all([
      db
        .select({
          total: sql<number>`coalesce(sum(cast(${ordersTable.delivery_fee} as numeric)), 0)`.mapWith(
            Number,
          ),
          orders: count(ordersTable.id),
        })
        .from(ordersTable)
        .where(
          and(
            eq(ordersTable.courier_id, courier.id),
            eq(ordersTable.status, 'delivered'),
            gte(ordersTable.createdAt, thisWeekStart),
          ),
        ),
      db
        .select({
          total: sql<number>`coalesce(sum(cast(${ordersTable.delivery_fee} as numeric)), 0)`.mapWith(
            Number,
          ),
        })
        .from(ordersTable)
        .where(
          and(
            eq(ordersTable.courier_id, courier.id),
            eq(ordersTable.status, 'delivered'),
            gte(ordersTable.createdAt, lastWeekStart),
            lt(ordersTable.createdAt, thisWeekStart),
          ),
        ),
    ]);

    const thisWeekEarnings = thisWeekStats?.total ?? 0;
    const lastWeekEarnings = lastWeekStats?.total ?? 0;
    const thisWeekOrders = thisWeekStats?.orders ?? 0;

    const weeklyPerformance = {
      totalEarnings: formatCurrency(thisWeekEarnings),
      percentageChange:
        lastWeekEarnings > 0
          ? ((thisWeekEarnings - lastWeekEarnings) / lastWeekEarnings) * 100
          : thisWeekEarnings > 0
            ? 100
            : 0,
      orders: thisWeekOrders,
      avgPerOrder: formatCurrency(
        thisWeekOrders > 0 ? thisWeekEarnings / thisWeekOrders : 0,
      ),
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
        weeklyPerformance={weeklyPerformance}
        initialIsOnline={initialIsOnline}
        todayOnlineSeconds={todayOnlineSeconds}
        ratingStatus={ratingStatus}
        delaySeconds={delaySeconds}
      />
    );
  }

  if (role.role === 'customer') {
    const session = await getSession();

    const [customer] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(eq(customersTable.user_id, session.user.id))
      .limit(1);

    let lastOrders: {
      orderId: string;
      outletId: number;
      outletName: string;
      outletAvatar: string;
      outletFeature: string;
      itemCount: number;
      totalAmount: number;
      itemsSummary: string;
    }[] = [];

    let recommend: {
      outletId: number;
      menuName: string;
      rating: string;
      distance: string;
      image: string;
    }[] = [];

    if (customer) {
      const rawLastOrders = await db
        .select({
          orderId: ordersTable.id,
          outletId: outletsTable.id,
          outletName: outletsTable.name,
          outeletFeature: outletsTable.features,
          outletAvatar: outletsTable.avatar,
          itemCount: sum(orderDetailsTable.quantity).mapWith(Number),
          totalAmount: sum(
            sql<number>`CAST(${orderDetailsTable.summary_price} AS NUMERIC)`,
          ).mapWith(Number),
          itemNames: sql<string[]>`array_agg(${productsTable.product_name})`,
        })
        .from(ordersTable)
        .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
        .leftJoin(
          orderDetailsTable,
          eq(orderDetailsTable.order_id, ordersTable.id),
        )
        .leftJoin(
          productsTable,
          eq(orderDetailsTable.product_id, productsTable.id),
        )
        .where(
          and(
            eq(ordersTable.customer_id, customer.id),
            eq(ordersTable.status, 'delivered'),
          ),
        )
        .groupBy(ordersTable.id, outletsTable.id)
        .orderBy(desc(ordersTable.createdAt))
        .limit(3);

      rawLastOrders.map((o) => {
        lastOrders.push({
          orderId: o.orderId,
          outletId: o.outletId,
          outletName: o.outletName,
          outletFeature: o.outeletFeature[0] ?? 'food',
          outletAvatar: o.outletAvatar,
          itemCount: o.itemCount ?? 0,
          totalAmount: o.totalAmount ?? 0,
          itemsSummary: (o.itemNames ?? []).filter(Boolean).join(', '),
        });
      });
    }

    const recommendedMenus = await db
      .select({
        outletId: outletsTable.id,
        name: productsTable.product_name,
        lat: outletsTable.lat,
        lon: outletsTable.lon,
        address: outletsTable.address,
        rating: productsTable.ratings,
        image: productsTable.image,
      })
      .from(productsTable)
      .innerJoin(outletsTable, eq(productsTable.outlet_id, outletsTable.id))
      .where(eq(productsTable.is_recommended, true))
      .groupBy(outletsTable.id, productsTable.id)
      .orderBy(desc(productsTable.review_count))
      .limit(3);

    const [userLocation] = await db
      .select({ lat: locationsTable.lat, lon: locationsTable.lon })
      .from(locationsTable)
      .where(
        and(
          eq(locationsTable.user_id, session.user.id),
          eq(locationsTable.is_default, true),
        ),
      )
      .limit(1);

    recommend = recommendedMenus.map((r) => {
      const distance = userLocation
        ? `${haversineKm(
            parseFloat(userLocation.lat),
            parseFloat(userLocation.lon),
            parseFloat(r.lat),
            parseFloat(r.lon),
          ).toFixed(1)} km`
        : '-';

      return {
        outletId: r.outletId,
        menuName: r.name,
        rating: r.rating ?? '5.00',
        distance,
        image: r.image,
      };
    });

    const { now: adNow, day: adDay, hour: adHour } = getCurrentAdSlot();

    const adRows = await db
      .select({
        id: productAdsTable.id,
        title: productAdsTable.title,
        description: productAdsTable.description,
        bannerImage: productAdsTable.banner_image,
        outletId: outletsTable.id,
        outletFeatures: outletsTable.features,
        productName: productsTable.product_name,
      })
      .from(productAdsTable)
      .innerJoin(outletsTable, eq(productAdsTable.outlet_id, outletsTable.id))
      .innerJoin(productsTable, eq(productAdsTable.product_id, productsTable.id))
      .innerJoin(
        productAdsSchedule,
        eq(productAdsSchedule.productAdsSchedule_id, productAdsTable.id),
      )
      .innerJoin(
        scheduleProductAdsTable,
        eq(scheduleProductAdsTable.id, productAdsSchedule.scheduleProductAdsTable_id),
      )
      .where(
        and(
          eq(productAdsTable.status, 'approved'),
          eq(productAdsTable.is_active, true),
          lte(productAdsTable.starts_at, adNow),
          or(isNull(productAdsTable.ends_at), gte(productAdsTable.ends_at, adNow)),
          sql`${scheduleProductAdsTable.time}->>'day' = ${adDay}`,
          sql`${scheduleProductAdsTable.time}->>'hour' = ${adHour}`,
        ),
      )
      .orderBy(sql`RANDOM()`)
      .limit(10);

    const ads = adRows.map((ad) => ({
      id: ad.id,
      title: ad.title,
      description: ad.description ?? '',
      bannerImage: ad.bannerImage,
      outletId: ad.outletId,
      outletFeature: ad.outletFeatures[0] ?? 'food',
      productName: ad.productName,
    }));

    return (
      <CustomerDashboard
        lastOrders={lastOrders}
        recommend={recommend}
        ads={ads}
        hasLocation={!!userLocation}
      />
    );
  }
};

export default dashboardPage;
