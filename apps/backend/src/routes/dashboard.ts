import type { FastifyInstance } from "fastify";
import type { AnyColumn, SQL } from "drizzle-orm";
import {
  and,
  count,
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
} from "drizzle-orm";
import { db } from "../db";
import {
  couriersTable,
  courierSessionsTable,
  customersTable,
  locationsTable,
  ordersTable,
  orderDetailsTable,
  invoicesTable,
  outletsTable,
  productAdsTable,
  productAdsSchedule,
  scheduleProductAdsTable,
  productsTable,
  usersTable,
} from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { orderNotDeleted } from "../lib/order-scope";
import { getOutletByUserId } from "../lib/outlet-id";
import { notInternalCategory } from "../lib/outlet-features";
import { getOutletAccess, hasPermission, parseActiveOutletId } from "../lib/outlet-access";
import { getUTCRangeFromLocalDate, getUTCTime } from "../lib/timezone";
import { getCurrentAdSlot } from "../lib/utils/ad-schedule";
import { getCourierRatingInfo, MAX_SHIFT_HOURS, staleShiftCutoff } from "../lib/utils/courier-availability";
import { formatCurrency } from "../lib/utils/format";
import { haversineKm } from "../lib/utils/geo";
import { normalizeIndonesianPhone } from "../lib/utils/phone";
import { parseCoordPair } from "../lib/utils/coords";

// Role-specific dashboard payloads, composed server-side (was direct DB access
// in the frontend dashboard/page.tsx). Each endpoint returns exactly the props
// its dashboard component consumes.
export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/api/dashboard/owner", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ ok: false });

    const access = await getOutletAccess(session.user.id, parseActiveOutletId(request));
    const outlet = access && hasPermission(access, "reports") ? access.outlet : null;
    if (!outlet) return reply.send({ ok: false });
    const outletId = outlet.id;

    // Timezone matters for "today": an outlet in WITA closes its books six hours
    // before UTC does. Query param mirrors /api/owner/reports; Asia/Jakarta is
    // the default everywhere in this codebase.
    const { timezone = "Asia/Jakarta" } = request.query as Record<string, string>;
    const now = new Date();
    const todayLocal = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);

    const sixMonthsStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const prevSixMonthsStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const sevenDaysStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const prevSevenDaysStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const todayStart = getUTCRangeFromLocalDate(todayLocal, timezone).startUTC;
    const thirtyDaysStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    // Widest window any bucket needs — one scan covers all six sums.
    const windowStart = prevSixMonthsStart;

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
      .leftJoin(orderDetailsTable, eq(orderDetailsTable.order_id, ordersTable.id))
      .where(
        and(orderNotDeleted, eq(ordersTable.outlet_id, outletId), gte(ordersTable.createdAt, since)),
      )
      .groupBy(ordersTable.id);

    const recentOrders = rawOrders.map((o) => ({
      orderId: o.orderId,
      itemCount: o.itemCount ?? 0,
      totalAmount: o.totalAmount ?? 0,
      status:
        o.status === "delivered"
          ? ("checkout" as const)
          : ["confirmed", "preparing", "ready", "on_delivery"].includes(o.status)
            ? ("addToChart" as const)
            : null,
    }));

    const activeOrdersCount = rawOrders.filter(
      (o) => !["delivered", "cancelled"].includes(o.status),
    ).length;

    const validOrderDetails = and(
      orderNotDeleted,
      eq(ordersTable.outlet_id, outletId),
      notInArray(ordersTable.status, ["cancelled", "pending"]),
    );

    // Sales invoices are a second revenue stream (Faktur Jual) that never flows
    // through ordersTable — count them alongside POS orders so the headline
    // number matches what the owner actually sold. Drafts/voids are excluded;
    // issue_date is the period anchor (that is the date on the invoice).
    const validSalesInvoices = and(
      eq(invoicesTable.outlet_id, outletId),
      eq(invoicesTable.type, "sales"),
      inArray(invoicesTable.status, ["posted", "partial", "paid"]),
    );

    // Every period in one pass: FILTER carves the buckets out of a single scan
    // instead of firing six near-identical range queries per source.
    const bucketSums = (amount: SQL, at: AnyColumn) => ({
      cur6: sql<number>`coalesce(sum(${amount}) filter (where ${at} >= ${sixMonthsStart}), 0)`.mapWith(Number),
      prev6: sql<number>`coalesce(sum(${amount}) filter (where ${at} >= ${prevSixMonthsStart} and ${at} < ${sixMonthsStart}), 0)`.mapWith(Number),
      cur7: sql<number>`coalesce(sum(${amount}) filter (where ${at} >= ${sevenDaysStart}), 0)`.mapWith(Number),
      prev7: sql<number>`coalesce(sum(${amount}) filter (where ${at} >= ${prevSevenDaysStart} and ${at} < ${sevenDaysStart}), 0)`.mapWith(Number),
      curToday: sql<number>`coalesce(sum(${amount}) filter (where ${at} >= ${todayStart}), 0)`.mapWith(Number),
      prevToday: sql<number>`coalesce(sum(${amount}) filter (where ${at} >= ${yesterdayStart} and ${at} < ${todayStart}), 0)`.mapWith(Number),
    });

    const [[orderSums], [invoiceSums]] = await Promise.all([
      db
        .select({
          ...bucketSums(
            sql`cast(${orderDetailsTable.summary_price} as numeric)`,
            orderDetailsTable.created_at,
          ),
          // Order counts. count(distinct order_id) because this scan is over
          // LINE ITEMS — a 4-item order must count once, not four times.
          // Today's split feeds the Kasir/Online card; the 30-day total feeds
          // the rotating counter beside it.
          posToday: sql<number>`count(distinct ${orderDetailsTable.order_id}) filter (where ${orderDetailsTable.created_at} >= ${todayStart} and ${ordersTable.source} = 'pos')`.mapWith(Number),
          appToday: sql<number>`count(distinct ${orderDetailsTable.order_id}) filter (where ${orderDetailsTable.created_at} >= ${todayStart} and ${ordersTable.source} = 'app')`.mapWith(Number),
          orders30: sql<number>`count(distinct ${orderDetailsTable.order_id}) filter (where ${orderDetailsTable.created_at} >= ${thirtyDaysStart})`.mapWith(Number),
        })
        .from(orderDetailsTable)
        .innerJoin(ordersTable, eq(orderDetailsTable.order_id, ordersTable.id))
        .where(and(validOrderDetails, gte(orderDetailsTable.created_at, windowStart))),
      db
        .select({
          ...bucketSums(sql`${invoicesTable.total}`, invoicesTable.issue_date),
          count30:
            sql<number>`count(*) filter (where ${invoicesTable.issue_date} >= ${thirtyDaysStart})`.mapWith(
              Number,
            ),
        })
        .from(invoicesTable)
        .where(and(validSalesInvoices, gte(invoicesTable.issue_date, windowStart))),
    ]);

    // Today's Kasir vs Online split. Revenue for the average comes from the
    // curToday bucket the headline already computes.
    const posToday = orderSums?.posToday ?? 0;
    const appToday = orderSums?.appToday ?? 0;
    const revenueToday = orderSums?.curToday ?? 0;
    const todayChannels = {
      pos: posToday,
      app: appToday,
      revenue: revenueToday,
      aov: posToday + appToday > 0 ? Math.round(revenueToday / (posToday + appToday)) : 0,
    };

    // Rolling 30-day counts for the rotating counter — a wider window than the
    // card beside it on purpose, so the two aren't saying the same thing.
    const counts30d = {
      orders: orderSums?.orders30 ?? 0,
      invoices: invoiceSums?.count30 ?? 0,
    };

    // Each period compares against the equal-length window right before it.
    // Keyed on the shared bucket names only — both scans carry extra columns of
    // their own (channel counts, invoice count) that have no period pairing.
    type BucketKey = "cur6" | "prev6" | "cur7" | "prev7" | "curToday" | "prevToday";
    const period = (curKey: BucketKey, prevKey: BucketKey) => {
      const totalSales = (orderSums?.[curKey] ?? 0) + (invoiceSums?.[curKey] ?? 0);
      const previous = (orderSums?.[prevKey] ?? 0) + (invoiceSums?.[prevKey] ?? 0);
      return {
        totalSales,
        percentage:
          previous > 0
            ? ((totalSales - previous) / previous) * 100
            : totalSales > 0
              ? 100
              : 0,
      };
    };

    const total6monthsSales = period("cur6", "prev6");
    const total7daysSales = period("cur7", "prev7");
    const totalTodaySales = period("curToday", "prevToday");

    return reply.send({
      ok: true,
      activeOrdersCount,
      recentOrders,
      total6monthsSales,
      total7daysSales,
      totalTodaySales,
      todayChannels,
      counts30d,
    });
  });

  app.get("/api/dashboard/courier", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ ok: false });

    const [courier] = await db
      .select({
        id: couriersTable.id,
        verificationStatus: couriersTable.verification_status,
        verificationNote: couriersTable.verification_note,
      })
      .from(couriersTable)
      .where(eq(couriersTable.user_id, session.user.id))
      .limit(1);

    if (!courier) return reply.send({ ok: false });

    let initialIsOnline = false;
    let todayOnlineSeconds = 0;

    const [openSession] = await db
      .select({ started_at: courierSessionsTable.started_at })
      .from(courierSessionsTable)
      .where(
        and(
          eq(courierSessionsTable.courier_id, courier.id),
          isNull(courierSessionsTable.ended_at),
          // Past the 12h cap the shift is over, so the courier's own dashboard
          // shouldn't still show them on duty.
          gte(courierSessionsTable.started_at, staleShiftCutoff()),
        ),
      )
      .limit(1);

    initialIsOnline = !!openSession;

    // "Today" means the courier's local day (WIB), not the server's. Railway
    // runs the container in UTC, so `new Date().setHours(0,0,0,0)` marked
    // midnight UTC = 07:00 WIB — every morning before 7am the figure still
    // carried most of the previous day's hours.
    const todayLocal = getUTCTime().toISOString().slice(0, 10);
    const { startUTC: dayStart, endUTC: dayEnd } = getUTCRangeFromLocalDate(todayLocal);

    const [onlineResult] = await db
      .select({
        // Sum the part of each shift that falls INSIDE today, rather than the
        // whole shift: a 22:00->02:00 run belongs to two different days, and
        // counting it wholly against either one is wrong. Three clamps:
        //   - LEAST(...)  end of the overlap: shift end, the 12h cap, or midnight
        //   - GREATEST(started_at, dayStart)  start of the overlap
        //   - GREATEST(0, ...)  a shift entirely outside today contributes 0
        totalSeconds: sql<number>`
          COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (
            LEAST(
              COALESCE(${courierSessionsTable.ended_at}, NOW()),
              ${courierSessionsTable.started_at} + make_interval(hours => ${MAX_SHIFT_HOURS}),
              ${dayEnd}::timestamptz
            )
            - GREATEST(${courierSessionsTable.started_at}, ${dayStart}::timestamptz)
          )))), 0)
        `,
      })
      .from(courierSessionsTable)
      .where(
        and(
          eq(courierSessionsTable.courier_id, courier.id),
          // Any shift overlapping today, including one that began yesterday.
          lte(courierSessionsTable.started_at, dayEnd),
          sql`least(coalesce(${courierSessionsTable.ended_at}, now()), ${courierSessionsTable.started_at} + make_interval(hours => ${MAX_SHIFT_HOURS})) >= ${dayStart}::timestamptz`,
        ),
      );

    todayOnlineSeconds = Math.floor(onlineResult?.totalSeconds ?? 0);

    const [{ completion, sum: earningToday }] = await db
      .select({
        completion: count(ordersTable.id),
        sum: sql<number>`SUM(CAST(orders.delivery_fee as NUMERIC))`,
      })
      .from(ordersTable)
      .where(and(orderNotDeleted, eq(ordersTable.courier_id, courier.id)));

    const [{ totalCancel: cancelOrderByCourier }] = await db
      .select({ totalCancel: count(ordersTable.id) })
      .from(ordersTable)
      .where(
        and(
          orderNotDeleted,
          eq(ordersTable.courier_id, courier.id),
          eq(ordersTable.status, "cancelled"),
          eq(ordersTable.rejected_by, "courier"),
        ),
      );

    const [{ rating }] = await db
      .select({ rating: couriersTable.ratings })
      .from(couriersTable)
      .where(eq(couriersTable.id, courier.id));

    const dashboardValue = {
      earningToday: formatCurrency(earningToday || 0),
      rating: String(rating),
      completion:
        (completion === 0 ? 100 : Math.round((1 - cancelOrderByCourier / completion) * 100)) + "%",
    };

    const { ratingStatus, delaySeconds } = await getCourierRatingInfo(courier.id);

    const courierNow = getUTCTime();
    const daysSinceMonday = (courierNow.getUTCDay() + 6) % 7;
    const thisWeekStart = new Date(courierNow);
    thisWeekStart.setUTCDate(courierNow.getUTCDate() - daysSinceMonday);
    thisWeekStart.setUTCHours(0, 0, 0, 0);
    const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [[thisWeekStats], [lastWeekStats]] = await Promise.all([
      db
        .select({
          total:
            sql<number>`coalesce(sum(cast(${ordersTable.delivery_fee} as numeric)), 0)`.mapWith(
              Number,
            ),
          orders: count(ordersTable.id),
        })
        .from(ordersTable)
        .where(
          and(
            orderNotDeleted,
            eq(ordersTable.courier_id, courier.id),
            eq(ordersTable.status, "delivered"),
            gte(ordersTable.createdAt, thisWeekStart),
          ),
        ),
      db
        .select({
          total:
            sql<number>`coalesce(sum(cast(${ordersTable.delivery_fee} as numeric)), 0)`.mapWith(
              Number,
            ),
        })
        .from(ordersTable)
        .where(
          and(
            orderNotDeleted,
            eq(ordersTable.courier_id, courier.id),
            eq(ordersTable.status, "delivered"),
            gte(ordersTable.createdAt, lastWeekStart),
            lt(ordersTable.createdAt, thisWeekStart),
          ),
        ),
    ]);

    const thisWeekEarnings = thisWeekStats?.total ?? 0;
    const lastWeekEarnings = lastWeekStats?.total ?? 0;
    const thisWeekOrders = thisWeekStats?.orders ?? 0;

    // Per-day earnings for the sparkline on the courier's weekly card. Bucketed
    // in JS rather than with date_trunc: the week boundaries above come from
    // getUTCTime()'s shifted clock, and grouping raw created_at in Postgres
    // would slice the days on a different edge than the totals they sit under.
    const weekOrders = await db
      .select({ createdAt: ordersTable.createdAt, fee: ordersTable.delivery_fee })
      .from(ordersTable)
      .where(
        and(
          orderNotDeleted,
          eq(ordersTable.courier_id, courier.id),
          eq(ordersTable.status, "delivered"),
          gte(ordersTable.createdAt, thisWeekStart),
        ),
      );

    const DAY_LABELS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
    const dailyTotals = new Array(7).fill(0);
    for (const order of weekOrders) {
      if (!order.createdAt) continue;
      const dayIndex = Math.floor(
        (order.createdAt.getTime() - thisWeekStart.getTime()) / 86_400_000,
      );
      if (dayIndex >= 0 && dayIndex < 7) dailyTotals[dayIndex] += Number(order.fee ?? 0);
    }
    const daily = DAY_LABELS.map((label, i) => ({ label, amount: dailyTotals[i] }));

    const weeklyPerformance = {
      daily,
      totalEarnings: formatCurrency(thisWeekEarnings),
      percentageChange:
        lastWeekEarnings > 0
          ? ((thisWeekEarnings - lastWeekEarnings) / lastWeekEarnings) * 100
          : thisWeekEarnings > 0
            ? 100
            : 0,
      orders: thisWeekOrders,
      avgPerOrder: formatCurrency(thisWeekOrders > 0 ? thisWeekEarnings / thisWeekOrders : 0),
    };

    const [activeOrder] = await db
      .select({
        id: ordersTable.id,
        name_customer: usersTable.name,
        customer_phone: usersTable.phone,
        pickup: outletsTable.name,
        dropoff: locationsTable.address,
        dropoffLat: locationsTable.lat,
        dropoffLon: locationsTable.lon,
        delivery_fee: ordersTable.delivery_fee,
        status: ordersTable.status,
      })
      .from(ordersTable)
      .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
      .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
      .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
      .leftJoin(
        locationsTable,
        and(eq(locationsTable.user_id, usersTable.id), eq(locationsTable.is_default, true)),
      )
      .where(
        and(
          orderNotDeleted,
          eq(ordersTable.courier_id, courier.id),
          inArray(ordersTable.status, ["confirmed", "preparing", "ready", "on_delivery"]),
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
          // Canonical 628… so the courier UI can drop it straight into a wa.me
          // link. Null when the stored number is unusable — the UI hides the
          // contact buttons rather than opening a chat with a bad number.
          customer_phone: normalizeIndonesianPhone(activeOrder.customer_phone),
          pickup: activeOrder.pickup,
          dropoff: activeOrder.dropoff ?? "-",
          // Drop-off point for the courier's "Lihat Peta" link. Null when the
          // stored pair is junk ('' / 'NaN' both fit the varchar column), so the
          // UI can fall back to searching the address text instead of routing
          // the rider to 0,0.
          dropoffCoords: parseCoordPair(activeOrder.dropoffLat, activeOrder.dropoffLon),
          items: currentPickUpItems,
          amount: formatCurrency(parseFloat(activeOrder.delivery_fee ?? "0")),
          status: activeOrder.status,
        }
      : null;

    return reply.send({
      ok: true,
      currentPickUp,
      dashboardValue,
      weeklyPerformance,
      initialIsOnline,
      todayOnlineSeconds,
      ratingStatus,
      delaySeconds,
      // Drives the dashboard's gate. Sent on every load rather than cached in a
      // cookie or the session: an admin can approve or revoke at any moment, and
      // the courier finding out on their next refresh is the whole point.
      verificationStatus: courier.verificationStatus,
      verificationNote: courier.verificationNote,
    });
  });

  app.get("/api/dashboard/customer", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ ok: false });

    const [customer] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(eq(customersTable.user_id, session.user.id))
      .limit(1);

    const lastOrders: {
      orderId: string;
      outletId: number;
      outletName: string;
      outletAvatar: string;
      productFeature: string[];
      itemCount: number;
      totalAmount: number;
      itemsSummary: string;
    }[] = [];

    if (customer) {
      const rawLastOrders = await db
        .select({
          orderId: ordersTable.id,
          outletId: outletsTable.id,
          outletName: outletsTable.name,
          // The ordered product's own features drive "Order Lagi" routing — the
          // outlet may offer several features, but we want the one that was
          // actually ordered.
          productFeature: sql<string[] | null>`(
            SELECT ${productsTable.features}
            FROM ${orderDetailsTable}
            JOIN ${productsTable} ON ${productsTable.id} = ${orderDetailsTable.product_id}
            WHERE ${orderDetailsTable.order_id} = ${ordersTable.id}
            ORDER BY ${orderDetailsTable.id}
            LIMIT 1
          )`,
          outletAvatar: outletsTable.avatar,
          itemCount: sum(orderDetailsTable.quantity).mapWith(Number),
          totalAmount: sum(
            sql<number>`CAST(${orderDetailsTable.summary_price} AS NUMERIC)`,
          ).mapWith(Number),
          itemNames: sql<string[]>`array_agg(${productsTable.product_name})`,
        })
        .from(ordersTable)
        .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
        .leftJoin(orderDetailsTable, eq(orderDetailsTable.order_id, ordersTable.id))
        .leftJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
        .where(
          and(
            orderNotDeleted,
            eq(ordersTable.customer_id, customer.id),
            eq(ordersTable.status, "delivered"),
          ),
        )
        .groupBy(ordersTable.id, outletsTable.id)
        .orderBy(desc(ordersTable.createdAt))
        .limit(3);

      rawLastOrders.forEach((o) => {
        lastOrders.push({
          orderId: o.orderId,
          outletId: o.outletId,
          outletName: o.outletName,
          productFeature: o.productFeature ?? [],
          outletAvatar: o.outletAvatar,
          itemCount: o.itemCount ?? 0,
          totalAmount: o.totalAmount ?? 0,
          itemsSummary: (o.itemNames ?? []).filter(Boolean).join(", "),
        });
      });
    }

    const recommendedMenus = await db
      .select({
        outletId: outletsTable.id,
        outletFeature: productsTable.features,
        name: productsTable.product_name,
        lat: outletsTable.lat,
        lon: outletsTable.lon,
        address: outletsTable.address,
        rating: productsTable.ratings,
        image: productsTable.image,
      })
      .from(productsTable)
      .innerJoin(outletsTable, eq(productsTable.outlet_id, outletsTable.id))
      .where(
        and(
          eq(productsTable.is_recommended, true),
          eq(productsTable.isAvailable, true),
          eq(productsTable.is_for_sale, true),
          notInternalCategory(),
          isNull(productsTable.deletedAt),
          eq(outletsTable.is_open, true),
        ),
      )
      .groupBy(outletsTable.id, productsTable.id)
      .orderBy(desc(productsTable.review_count))
      .limit(6);

    // label/address ride along for the dashboard's delivery-address header —
    // same default-address row the distances below are measured from, so what
    // the customer reads at the top is what everything under it is relative to.
    const [userLocation] = await db
      .select({
        id: locationsTable.id,
        label: locationsTable.label,
        address: locationsTable.address,
        lat: locationsTable.lat,
        lon: locationsTable.lon,
      })
      .from(locationsTable)
      .where(
        and(eq(locationsTable.user_id, session.user.id), eq(locationsTable.is_default, true)),
      )
      .limit(1);

    const recommend = recommendedMenus.map((r) => {
      const distance = userLocation
        ? `${haversineKm(
            parseFloat(userLocation.lat),
            parseFloat(userLocation.lon),
            parseFloat(r.lat),
            parseFloat(r.lon),
          ).toFixed(1)} km`
        : "-";

      return {
        outletId: r.outletId,
        outletFeature: r.outletFeature[0] ?? "food",
        menuName: r.name,
        rating: r.rating ?? "5.00",
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
          eq(productAdsTable.status, "approved"),
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
      description: ad.description ?? "",
      bannerImage: ad.bannerImage,
      outletId: ad.outletId,
      outletFeature: ad.outletFeatures[0] ?? "food",
      productName: ad.productName,
    }));

    return reply.send({
      ok: true,
      lastOrders,
      recommend,
      ads,
      hasLocation: !!userLocation,
      location: userLocation
        ? { id: userLocation.id, label: userLocation.label, address: userLocation.address }
        : null,
    });
  });
}
