import type { FastifyInstance } from "fastify";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db, reportDb } from "../db";
import { orderCogsSql } from "../lib/cogs";
import { menuGroupsTable, productsTable } from "../db/schema";
import { requireOutletAccess } from "../lib/outlet-access";
import { money } from "../lib/money-sql";

/**
 * Segmented sales reports: the same period sliced four ways.
 *
 * Why four endpoints' worth of shapes behind one handler: payment method,
 * cashier name and customer name are NOT columns. They are free text inside
 * orders.note (see mutations.ts /api/add-order-detail), written by whoever was
 * standing at the counter. Reporting on them means grouping by a JSON
 * expression, which is only affordable because migration 0059 puts expression
 * indexes on exactly these three keys, scoped to (outlet_id, ..., created_at)
 * and partial on deleted_at IS NULL. Change a key expression here and that
 * index stops matching — the query still works, it just starts sequential-
 * scanning every order the outlet ever took.
 *
 * The window is capped at MAX_RANGE_DAYS for the same reason: an uncapped
 * "since forever" range on a JSON group-by is the query that takes the server
 * down, and no owner has ever needed it in one screen.
 */

const MAX_RANGE_DAYS = 93; // ~3 months, the hard cap the UI also enforces

/**
 * The part of an order's tax that is already sitting inside its line prices.
 *
 * Counter tax lives on the order, never in orderDetails.summary_price, so under
 * EXCLUSIVE pricing (the default) summary_price is already net of tax and this
 * is zero — every figure below is correct without it.
 *
 * Under INCLUSIVE pricing ("harga sudah termasuk pajak") the line price
 * contains the tax, so summing summary_price counts the tax office's money as
 * sales. Subtracting this is what keeps revenue — and therefore profit and
 * margin — honest for those outlets. See lib/tax.ts for the full asymmetry.
 */
const TAX_IN_PRICE = sql`case when coalesce(o.tax_inclusive, false)
                              then coalesce(o.tax_amount, 0) else 0 end`;

/**
 * Turn the two ways the reports pool says "no" into something an owner can act
 * on, instead of a 500 that reads like a bug.
 *
 * Both are load, not failure: the pool is capped at 2 connections precisely so
 * a rush of reports queues here rather than starving the cashier (see reportDb
 * in db/index.ts). 503 + "coba lagi" is the honest answer.
 */
export function loadFailure(error: unknown): { status: number; error: string } | null {
  // Drizzle rethrows its own "Failed query: ..." Error and hangs the real pg
  // error off .cause, so neither code nor message is on the object handed to
  // us. Checking the top level only — which is the obvious way to write this —
  // silently matches nothing and every busy report comes back as a 500.
  for (let e = error as any; e; e = e.cause) {
    // 57014 = statement_timeout fired: the query ran past 15s.
    if (e.code === "57014") {
      return { status: 503, error: "Laporan terlalu berat — persempit rentang tanggal atau filternya." };
    }
    // pg's message when connectionTimeoutMillis elapses with all 2 connections busy.
    if (typeof e.message === "string" && e.message.includes("timeout exceeded when trying to connect")) {
      return { status: 503, error: "Laporan sedang sibuk, coba lagi sebentar lagi." };
    }
  }
  return null;
}

export type ReportDimension = "payment" | "cashier" | "customer" | "online";

const DIMENSIONS = new Set<ReportDimension>(["payment", "cashier", "customer", "online"]);

const ORDERS_ONLY = sql`orders o`;

// Both joins are on primary keys and orders.customer_id is NOT NULL, so this
// costs one index lookup per matched order and cannot drop a row.
const CUSTOMER_FROM = sql`orders o
          join customers c on c.id = o.customer_id
          join users u on u.id = c.user_id`;

/**
 * How each dimension buckets an order, and which orders it can see at all.
 *
 * `key` is the group identity (lower-cased for the free-text ones, so
 * "Budi" and "budi" are one cashier); `label` is what to show, taken from an
 * arbitrary row in the bucket via min(). `scope` narrows the source: cashier
 * and payment only exist on counter sales, the online report is the opposite.
 */
function dimensionSql(dimension: ReportDimension): {
  key: SQL;
  label: SQL;
  scope: SQL | null;
  /** Extra FROM the key expression needs; joined for every matched order. */
  from: SQL;
} {
  switch (dimension) {
    case "payment":
      // POS writes 'cash' | 'non_cash'. Older rows predate the field.
      return {
        key: sql`coalesce(nullif(o.note ->> 'paymentMethod', ''), 'cash')`,
        label: sql`coalesce(nullif(o.note ->> 'paymentMethod', ''), 'cash')`,
        scope: sql`o.source = 'pos'`,
        from: ORDERS_ONLY,
      };
    case "cashier":
      return {
        key: sql`lower(coalesce(nullif(o.note ->> 'cashierName', ''), '-'))`,
        label: sql`coalesce(nullif(o.note ->> 'cashierName', ''), '-')`,
        scope: sql`o.source = 'pos'`,
        from: ORDERS_ONLY,
      };
    case "customer":
      // The only dimension that spans both sources. A counter sale carries the
      // name the cashier typed; an app order carries none, because it has a real
      // account behind it — so fall back to the user's name for those.
      //
      // The `o.source = 'app'` guard on that fallback is not decoration: EVERY
      // POS order points at one shared offline placeholder customer (see
      // mutations.ts), so without it every unnamed counter sale would report
      // under that placeholder's name as if it were one enormous customer.
      return {
        key: sql`lower(coalesce(nullif(o.note ->> 'customerName', ''), case when o.source = 'app' then nullif(u.name, '') end, '-'))`,
        label: sql`coalesce(nullif(o.note ->> 'customerName', ''), case when o.source = 'app' then nullif(u.name, '') end, '-')`,
        scope: null,
        from: CUSTOMER_FROM,
      };
    case "online":
      // Online orders carry no note fields — they are real customer accounts —
      // so the useful slice is how the order was fulfilled.
      return {
        key: sql`o.fulfillment::text`,
        label: sql`o.fulfillment::text`,
        scope: sql`o.source = 'app'`,
        from: ORDERS_ONLY,
      };
  }
}

type Filters = {
  from: Date;
  to: Date;
  productId: string | null;
  menuGroupId: number | null;
  rating: number | null;
};

/**
 * Parse + validate the popup's answers. Returns a string on rejection so the
 * caller can 400 with something an owner can act on.
 */
function parseFilters(q: Record<string, string>): Filters | string {
  const from = new Date(q.from ?? "");
  const to = new Date(q.to ?? "");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return "Rentang tanggal tidak valid";
  }
  if (to <= from) return "Tanggal akhir harus setelah tanggal mulai";
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days > MAX_RANGE_DAYS) return "Rentang tanggal maksimal 3 bulan";

  const productId = q.productId ? String(q.productId) : null;

  const menuGroupId = q.menuGroupId ? Number(q.menuGroupId) : null;
  if (menuGroupId !== null && !Number.isInteger(menuGroupId)) return "Menu grup tidak valid";

  const rating = q.rating ? Number(q.rating) : null;
  if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
    return "Rating tidak valid";
  }

  return { from, to, productId, menuGroupId, rating };
}

/**
 * The WHERE of the orders scan, shared by the summary and the paginated list so
 * the two can never disagree about which orders the report covers.
 *
 * Sales = not soft-deleted, not cancelled, not still pending — the same
 * realized-sales definition the dashboard and /api/reports/summary use.
 *
 * The product / menu-group / rating filters are EXISTS subqueries rather than
 * joins on purpose: an order with three matching lines must still count once.
 */
function baseWhere(outletId: number, dimension: ReportDimension, f: Filters): SQL {
  const parts: SQL[] = [
    sql`o.outlet_id = ${outletId}`,
    sql`o.deleted_at is null`,
    sql`o.created_at >= ${f.from}`,
    sql`o.created_at < ${f.to}`,
    sql`o.status not in ('cancelled', 'pending')`,
  ];

  const { scope } = dimensionSql(dimension);
  if (scope) parts.push(scope);

  if (f.productId || f.menuGroupId !== null) {
    const line: SQL[] = [sql`od.order_id = o.id`];
    if (f.productId) line.push(sql`p.id = ${f.productId}`);
    if (f.menuGroupId !== null) line.push(sql`p.menu_group_id = ${f.menuGroupId}`);
    parts.push(sql`exists (
      select 1 from "orderDetails" od
      join products p on p.id = od.product_id
      where ${sql.join(line, sql` and `)}
    )`);
  }

  if (f.rating !== null) {
    parts.push(sql`exists (
      select 1 from ratings r
      join "orderDetails" od2 on od2.id = r.order_details_id
      where od2.order_id = o.id and round(r.ratings) = ${f.rating}
    )`);
  }

  return sql.join(parts, sql` and `);
}

/**
 * Per-order money, rolled up over whichever set of order ids is handed in.
 *
 * Revenue lives on the LINES, not the order, so every figure needs this. WHICH
 * set it runs over is the whole performance story: the summary must aggregate
 * every matched order (it is reporting on all of them), but the row list must
 * NOT — see the paging query below.
 */
const lineAgg = (over: SQL) => sql`
  select od.order_id,
         coalesce(sum(${money(sql`od.summary_price`)}), 0) as revenue,
         ${orderCogsSql(sql`od.order_id`)} as cogs,
         -- FILTER, not a WHERE: revenue above sums EVERY row (an add-on's
         -- summary_price is real money) while the item count must see only the
         -- lines the customer ordered, and both come out of this one pass.
         -- Narrowing the whole query instead would drop add-on revenue from
         -- every report. See the reader rule in lib/addons.ts.
         coalesce(sum(od.quantity) filter (where od.parent_detail_id is null), 0) as qty
  from "orderDetails" od
  join products p on p.id = od.product_id
  where od.order_id in (select id from ${over})
  group by od.order_id
`;

export async function reportRoutes(app: FastifyInstance) {
  /**
   * Option lists for the filter popup. Served from here, gated on "reports",
   * rather than reusing /api/products/mine + /api/menu-groups: those require
   * the "products" permission, so a reports-only employee would get an empty
   * picker on a page they are allowed to use.
   */
  app.get("/api/reports/filters", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "reports");
    if (!access) return;

    const [products, menuGroups] = await Promise.all([
      db
        .select({
          id: productsTable.id,
          name: productsTable.product_name,
          menuGroupId: productsTable.menu_group_id,
        })
        .from(productsTable)
        .where(and(eq(productsTable.outlet_id, access.outlet.id), isNull(productsTable.deletedAt)))
        .orderBy(productsTable.product_name),
      db
        .select({ id: menuGroupsTable.id, name: menuGroupsTable.name })
        .from(menuGroupsTable)
        .where(and(eq(menuGroupsTable.outlet_id, access.outlet.id), isNull(menuGroupsTable.deletedAt)))
        .orderBy(menuGroupsTable.sort_order, menuGroupsTable.name),
    ]);

    return { success: true, products, menuGroups, maxRangeDays: MAX_RANGE_DAYS };
  });

  /**
   * Bucket totals for the chosen dimension. Fetched once when the owner
   * answers the filter popup; paging the list below does NOT re-run it.
   */
  app.get("/api/reports/breakdown", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "reports");
    if (!access) return;

    const q = request.query as Record<string, string>;
    const dimension = q.dimension as ReportDimension;
    if (!DIMENSIONS.has(dimension)) {
      return reply.status(400).send({ success: false, error: "Dimensi laporan tidak dikenal" });
    }

    const filters = parseFilters(q);
    if (typeof filters === "string") {
      return reply.status(400).send({ success: false, error: filters });
    }

    const { key, label } = dimensionSql(dimension);
    const where = baseWhere(access.outlet.id, dimension, filters);

    try {
      const result = await reportDb.execute(sql`
        with base as (
          select o.id, ${key} as grp_key, ${label} as grp_label,
                 ${TAX_IN_PRICE} as tax_in_price
          from ${dimensionSql(dimension).from}
          where ${where}
        ),
        agg as (${lineAgg(sql`base`)})
        select b.grp_key                          as key,
               min(b.grp_label)                   as label,
               count(*)::int                      as orders,
               (coalesce(sum(a.revenue), 0) - coalesce(sum(b.tax_in_price), 0))::float8 as revenue,
               coalesce(sum(a.cogs), 0)::float8    as cogs,
               coalesce(sum(a.qty), 0)::int        as qty
        from base b
        left join agg a on a.order_id = b.id
        group by b.grp_key
        order by revenue desc
        limit 50
      `);

      const groups = (result.rows as any[]).map((r) => ({
        key: String(r.key),
        label: String(r.label),
        orders: Number(r.orders),
        revenue: Number(r.revenue),
        cogs: Number(r.cogs),
        profit: Number(r.revenue) - Number(r.cogs),
        qty: Number(r.qty),
      }));

      const totals = groups.reduce(
        (acc, g) => ({
          orders: acc.orders + g.orders,
          revenue: acc.revenue + g.revenue,
          cogs: acc.cogs + g.cogs,
          profit: acc.profit + g.profit,
          qty: acc.qty + g.qty,
        }),
        { orders: 0, revenue: 0, cogs: 0, profit: 0, qty: 0 },
      );

      return { success: true, dimension, groups, totals };
    } catch (error) {
      request.log.error(error);
      const busy = loadFailure(error);
      if (busy) return reply.status(busy.status).send({ success: false, error: busy.error });
      return reply.status(500).send({ success: false, error: "Gagal memuat laporan" });
    }
  });

  /**
   * The order rows behind a report, paginated SERVER-side.
   *
   * `total` rides along as a window function so the count and the page come
   * from one scan of the base set rather than two.
   */
  app.get("/api/reports/breakdown/orders", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "reports");
    if (!access) return;

    const q = request.query as Record<string, string>;
    const dimension = q.dimension as ReportDimension;
    if (!DIMENSIONS.has(dimension)) {
      return reply.status(400).send({ success: false, error: "Dimensi laporan tidak dikenal" });
    }

    const filters = parseFilters(q);
    if (typeof filters === "string") {
      return reply.status(400).send({ success: false, error: filters });
    }

    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const { key, label } = dimensionSql(dimension);
    const wherePartsList: SQL[] = [baseWhere(access.outlet.id, dimension, filters)];
    // Drilling into one bucket ("show me only Budi's orders") narrows the same
    // base set by the group key, so the page still agrees with the summary.
    if (q.key) wherePartsList.push(sql`${key} = ${q.key}`);
    const where = sql.join(wherePartsList, sql` and `);

    try {
      const result = await reportDb.execute(sql`
        with base as (
          select o.id, o.created_at, o.status::text as status, o.fulfillment::text as fulfillment,
                 ${key} as grp_key, ${label} as grp_label,
                 o.note ->> 'customerName' as customer_name,
                 o.note ->> 'cashierName'  as cashier_name,
                 o.note ->> 'paymentMethod' as payment_method,
                 ${TAX_IN_PRICE} as tax_in_price
          from ${dimensionSql(dimension).from}
          where ${where}
        ),
        -- Cut to ONE page before touching orderDetails. The obvious shape —
        -- roll up the lines for every matched order, then LIMIT — makes page
        -- 500 cost exactly as much as page 1, because the roll-up runs over the
        -- whole window either way. Measured at 100k orders / 300k lines that is
        -- ~0.85s per page turn; paging first makes it ~0.1s and, more to the
        -- point, keeps it flat as the table grows.
        page as (
          select * from base order by created_at desc limit ${pageSize} offset ${offset}
        ),
        agg as (${lineAgg(sql`page`)})
        select p.id,
               -- to_json(...) #>> '{}' renders the timestamp as ISO 8601.
               -- db.execute hands back raw driver strings ("2026-08-08 07:27:10+00"),
               -- which new Date() in the browser is not required to parse.
               to_json(p.created_at) #>> '{}' as created_at,
               p.status, p.fulfillment, p.grp_label as label,
               p.customer_name, p.cashier_name, p.payment_method,
               (coalesce(a.revenue, 0) - coalesce(p.tax_in_price, 0))::float8 as revenue,
               coalesce(a.cogs, 0)::float8    as cogs,
               coalesce(a.qty, 0)::int        as qty,
               -- Counting the matched ORDERS is a walk of the window index;
               -- counting them after the line roll-up would have dragged
               -- orderDetails into it too.
               (select count(*) from base)::int as total
        from page p
        left join agg a on a.order_id = p.id
        order by p.created_at desc
      `);

      const rows = result.rows as any[];
      const total = rows.length > 0 ? Number(rows[0].total) : 0;

      return {
        success: true,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        rows: rows.map((r) => ({
          id: String(r.id),
          createdAt: r.created_at,
          status: r.status,
          fulfillment: r.fulfillment,
          label: String(r.label),
          customerName: r.customer_name ?? null,
          cashierName: r.cashier_name ?? null,
          paymentMethod: r.payment_method ?? null,
          revenue: Number(r.revenue),
          // Both sides of the margin, not just the difference: an owner
          // checking a suspicious row needs to see WHICH half moved. Same
          // orderCogsSql the summary uses, so a row and its bucket can never
          // disagree.
          cogs: Number(r.cogs),
          profit: Number(r.revenue) - Number(r.cogs),
          qty: Number(r.qty),
        })),
      };
    } catch (error) {
      request.log.error(error);
      const busy = loadFailure(error);
      if (busy) return reply.status(busy.status).send({ success: false, error: busy.error });
      return reply.status(500).send({ success: false, error: "Gagal memuat data" });
    }
  });
}
