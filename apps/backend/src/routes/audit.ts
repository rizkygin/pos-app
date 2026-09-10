import type { FastifyInstance } from "fastify";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, reportDb } from "../db";
import { cashierShiftsTable } from "../db/schema";
import { requireOutletOwnerOrAdmin } from "../lib/outlet-access";
import { money, orderDiscount } from "../lib/money-sql";
import { getUTCRangeFromLocalDate } from "../lib/timezone";
import { loadFailure } from "./reports";

/**
 * Duplicate-order audit: the in-app version of the one-off "Laporan Transaksi
 * Ganda" that was previously produced by hand and mailed out as a PDF.
 *
 * What it finds: a counter sale committed TWICE. The web cashier posts a
 * checkout without an idempotency key, so when the network drops the response
 * the sale is already saved, the cashier sees a failure and taps Checkout
 * again — a second, identical order. The customer only ever paid once, so the
 * second order is revenue that never happened, and when it is booked as CASH it
 * inflates the shift's expected drawer and the physical count reads SHORT.
 * See routes/mutations.ts (/api/add-order-detail) for the `orderId` key the
 * desktop cashier already sends.
 *
 * Owner-only, and scoped to the outlet in the URL rather than the active-outlet
 * cookie: this names a specific cashier's mistakes and reconciles a drawer, so
 * an employee with the "reports" permission must not reach it — not even the
 * cashier whose shift it is about.
 */

// Same cap and reasoning as the segmented reports: an uncapped window over a
// self-join of every order the outlet ever took is the query that takes the
// server down, and no owner has ever needed it in one screen.
const MAX_RANGE_DAYS = 93;

// How close together two identical carts have to be to read as one sale posted
// twice rather than two customers who genuinely ordered the same thing.
//
// The lower bound of what is actually observed is ~5s and the upper ~70s: a
// double-CLICK lands in well under a second (and is blocked client-side
// anyway), while a retry costs a failed request, an alert() and a human
// deciding to press the button again. 90s covers that with room to spare
// without reaching into "the next customer ordered the same drink".
const WINDOW_SECONDS = 90;

// A pair is downgraded to "check this one" when it is a SINGLE line item, the
// gap is long, and both notes were paid the same way — that combination is also
// what two separate buyers of one coffee look like. A gap under this, more than
// one item, or a payment method that CHANGED between the two notes all point
// firmly at a retry: nothing but a cashier re-entering the sale produces those.
const REVIEW_GAP_SECONDS = 30;

/**
 * The customer name, when the cashier typed one, settles the question the rules
 * above can only guess at.
 *
 * A retry re-posts the SAME snapshot — cashier-client.tsx freezes the name
 * before the request and reuses it on the second attempt — so two notes bearing
 * one name are one sale. Two DIFFERENT names are two people who each said their
 * name, which no retry can produce.
 *
 * Compared case- and space-insensitively: "budi" and "Budi " are the same
 * walk-in. Returns null when either note has no name, which is the common case
 * and means "no opinion" — the pair falls back to the item/gap/payment rules.
 */
function customerVerdict(a: string | null, b: string | null): "same" | "different" | null {
  if (!a || !b) return null;
  const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
  return norm(a) === norm(b) ? "same" : "different";
}

/** Trim to null: older notes carry "" where the cashier typed nothing. */
function name(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}

const ORDER_DISCOUNT = orderDiscount(sql`o`);

type Pair = {
  /** The note that is real. */
  firstId: string;
  firstAt: string;
  firstPayment: string | null;
  /** The note to cancel. */
  secondId: string;
  secondAt: string;
  secondPayment: string | null;
  gapSeconds: number;
  /** Rupiah booked twice — the second note's total. */
  amount: number;
  /** True when the second note was booked as cash, i.e. it moved the drawer. */
  affectsDrawer: boolean;
  items: { name: string; qty: number; note: string | null }[];
  /** "Nama Pelanggan" as typed at the counter, per note. Usually null. */
  firstCustomer: string | null;
  secondCustomer: string | null;
  cashierName: string | null;
  shiftId: number | null;
  /** "likely" = almost certainly a duplicate; "review" = confirm before cancelling. */
  confidence: "likely" | "review";
};

export async function auditRoutes(app: FastifyInstance) {
  /**
   * Every duplicate pair in the window, plus the three roll-ups an owner reads
   * first: the totals, the per-day shape, and what it did to each drawer.
   */
  app.get("/api/audit/duplicate-orders/:outletId", async (request, reply) => {
    const outletId = Number((request.params as { outletId: string }).outletId);
    if (!Number.isInteger(outletId) || outletId <= 0) {
      return reply.status(400).send({ success: false, error: "Outlet tidak valid" });
    }

    const access = await requireOutletOwnerOrAdmin(request, reply, outletId);
    if (!access) return;

    const q = request.query as Record<string, string>;
    const range = parseRange(q);
    if (typeof range === "string") {
      return reply.status(400).send({ success: false, error: range });
    }
    const { from, to, fromDate, toDate } = range;

    try {
      // The denominator. "26 duplicates" means nothing without "out of 748
      // counter sales" next to it, and this is a cheap index-only count against
      // the same window the detector scans.
      const scannedRows = await reportDb.execute(sql`
        select count(*)::int as total
        from orders o
        where o.outlet_id = ${outletId}
          and o.source = 'pos'
          and o.deleted_at is null
          and o.status not in ('cancelled', 'pending')
          and o.created_at >= ${from}
          and o.created_at <  ${to}
      `);
      const totalOrdersScanned = Number((scannedRows.rows as any[])[0]?.total ?? 0);

      const result = await reportDb.execute(sql`
        with pos as (
          select o.id,
                 o.created_at,
                 o.shift_id,
                 o.note ->> 'paymentMethod' as payment,
                 o.note ->> 'cashierName'   as cashier,
                 o.note ->> 'customerName'  as customer,
                 ${ORDER_DISCOUNT} as discount
          from orders o
          where o.outlet_id = ${outletId}
            -- Counter sales only. An app order is placed by the customer and
            -- has no retry loop behind it; two of them minutes apart is a
            -- customer ordering twice, not a bug.
            and o.source = 'pos'
            and o.deleted_at is null
            and o.status not in ('cancelled', 'pending')
            and o.created_at >= ${from}
            and o.created_at <  ${to}
        ),
        -- The cart's identity. EVERY line, add-on children included: two carts
        -- that differ only by a topping are different sales.
        fingerprint as (
          select od.order_id,
                 string_agg(od.product_id || '*' || od.quantity || '@' || od.summary_price,
                            '|' order by od.product_id, od.quantity, od.summary_price) as fp,
                 sum(${money(sql`od.summary_price`)}) as gross
          from "orderDetails" od
          where od.order_id in (select id from pos)
          group by od.order_id
        ),
        -- What to SHOW. Parents only: an add-on is part of the line above it,
        -- not an item the customer asked for. See the reader rule in lib/addons.ts.
        items as (
          select od.order_id,
                 jsonb_agg(jsonb_build_object(
                   'name', p.product_name,
                   'qty',  od.quantity,
                   'note', od.note_product
                 ) order by p.product_name) as items,
                 count(*)::int as line_count
          from "orderDetails" od
          join products p on p.id = od.product_id
          where od.order_id in (select id from pos)
            and od.parent_detail_id is null
          group by od.order_id
        ),
        enriched as (
          select pos.id, pos.created_at, pos.shift_id, pos.payment, pos.cashier, pos.customer,
                 f.fp,
                 (f.gross - pos.discount) as total,
                 coalesce(i.items, '[]'::jsonb) as items,
                 coalesce(i.line_count, 0) as line_count
          from pos
          join fingerprint f on f.order_id = pos.id
          left join items i on i.order_id = pos.id
        ),
        -- Compare each note to the PREVIOUS one with the same cart and the same
        -- total. lag() rather than a self-join on ids: order ids are UUIDs, so
        -- "a.id < b.id" is a string compare that silently drops about half the
        -- pairs. It also handles a triple correctly — three identical notes are
        -- two duplicates, not one and not three.
        paired as (
          select e.*,
                 lag(e.id)         over w as prev_id,
                 lag(e.created_at) over w as prev_at,
                 lag(e.payment)    over w as prev_payment,
                 lag(e.customer)   over w as prev_customer
          from enriched e
          window w as (partition by e.fp, round(e.total) order by e.created_at)
        )
        select prev_id                                        as first_id,
               to_json(prev_at) #>> '{}'                      as first_at,
               prev_payment                                   as first_payment,
               id                                             as second_id,
               to_json(created_at) #>> '{}'                   as second_at,
               payment                                        as second_payment,
               prev_customer                                  as first_customer,
               customer                                       as second_customer,
               extract(epoch from (created_at - prev_at))::int as gap_seconds,
               total::float8                                  as amount,
               items,
               line_count,
               cashier,
               shift_id
        from paired
        where prev_at is not null
          and created_at - prev_at <= ${`${WINDOW_SECONDS} seconds`}::interval
        order by created_at
        limit 500
      `);

      const pairs: Pair[] = (result.rows as any[]).map((r) => {
        const gapSeconds = Number(r.gap_seconds);
        const firstPayment = r.first_payment ?? null;
        const secondPayment = r.second_payment ?? null;
        const samePayment = firstPayment === secondPayment;
        const firstCustomer = name(r.first_customer);
        const secondCustomer = name(r.second_customer);
        const customer = customerVerdict(firstCustomer, secondCustomer);
        return {
          firstId: String(r.first_id),
          firstAt: r.first_at,
          firstPayment,
          secondId: String(r.second_id),
          secondAt: r.second_at,
          secondPayment,
          gapSeconds,
          amount: Number(r.amount),
          // The DRAWER only moves for cash, and only the second note is
          // phantom — a pair paid cash then transfer took real money once and
          // booked it twice, but only the transfer leg is fake.
          affectsDrawer: secondPayment === "cash",
          items: Array.isArray(r.items) ? r.items : [],
          firstCustomer,
          secondCustomer,
          cashierName: r.cashier ?? null,
          shiftId: r.shift_id === null ? null : Number(r.shift_id),
          // Two named customers outrank every other signal in BOTH directions:
          // one name twice is a retry even when the cart is a single coffee
          // 40s apart, and two names is two buyers even when the carts match
          // to the rupiah. Only when at least one note is anonymous — most of
          // them — does the item/gap/payment heuristic decide.
          confidence:
            customer === "different"
              ? "review"
              : customer === "same"
                ? "likely"
                : Number(r.line_count) === 1 && gapSeconds > REVIEW_GAP_SECONDS && samePayment
                  ? "review"
                  : "likely",
        };
      });

      // Roll-ups are computed here rather than in SQL: the set is at most 500
      // rows, and one definition in one place is worth more than a second pass
      // over the orders table that could drift from the list it summarises.
      const summary = {
        totalOrdersScanned,
        pairs: pairs.length,
        excessValue: sum(pairs, (p) => p.amount),
        cashValue: sum(pairs.filter((p) => p.affectsDrawer), (p) => p.amount),
        nonCashValue: sum(pairs.filter((p) => !p.affectsDrawer), (p) => p.amount),
        likely: {
          pairs: pairs.filter((p) => p.confidence === "likely").length,
          value: sum(pairs.filter((p) => p.confidence === "likely"), (p) => p.amount),
          cashValue: sum(
            pairs.filter((p) => p.confidence === "likely" && p.affectsDrawer),
            (p) => p.amount,
          ),
        },
        review: {
          pairs: pairs.filter((p) => p.confidence === "review").length,
          value: sum(pairs.filter((p) => p.confidence === "review"), (p) => p.amount),
        },
      };

      // Grouped in the outlet's own zone, never UTC: a 23:58 sale belongs to the
      // day the cashier worked, and UTC would file it under tomorrow.
      const byDayMap = new Map<string, { pairs: number; value: number; cashValue: number }>();
      for (const p of pairs) {
        const day = jakartaDay(p.secondAt);
        const row = byDayMap.get(day) ?? { pairs: 0, value: 0, cashValue: 0 };
        row.pairs += 1;
        row.value += p.amount;
        if (p.affectsDrawer) row.cashValue += p.amount;
        byDayMap.set(day, row);
      }
      const byDay = [...byDayMap.entries()]
        .map(([day, v]) => ({ day, ...v }))
        .sort((a, b) => a.day.localeCompare(b.day));

      // What each closed drawer was overstated by. Only shifts that actually
      // carry a duplicate are listed — a clean shift has nothing to explain.
      const shiftIds = [...new Set(pairs.map((p) => p.shiftId).filter((id): id is number => id !== null))];
      const shiftRows = shiftIds.length
        ? await db
            .select({
              id: cashierShiftsTable.id,
              cashierName: cashierShiftsTable.cashier_name,
              openedAt: cashierShiftsTable.opened_at,
              closedAt: cashierShiftsTable.closed_at,
              expectedCash: cashierShiftsTable.expected_cash,
              countedCash: cashierShiftsTable.counted_cash,
              variance: cashierShiftsTable.variance,
            })
            .from(cashierShiftsTable)
            .where(
              and(
                eq(cashierShiftsTable.outlet_id, outletId),
                inArray(cashierShiftsTable.id, shiftIds),
              ),
            )
            .orderBy(cashierShiftsTable.opened_at)
        : [];

      const shifts = shiftRows.map((s) => {
        const own = pairs.filter((p) => p.shiftId === s.id);
        const phantomCash = sum(own.filter((p) => p.affectsDrawer), (p) => p.amount);
        const expectedCash = s.expectedCash === null ? null : Number(s.expectedCash);
        return {
          id: s.id,
          cashierName: s.cashierName,
          openedAt: s.openedAt?.toISOString() ?? null,
          closedAt: s.closedAt?.toISOString() ?? null,
          pairs: own.length,
          phantomCash,
          expectedCash,
          countedCash: s.countedCash === null ? null : Number(s.countedCash),
          variance: s.variance === null ? null : Number(s.variance),
          // What the drawer SHOULD have been asked for. The frozen closing
          // columns are deliberately left alone — a discrepancy someone already
          // signed for must not be redrawn under them (see cashier shifts).
          adjustedExpectedCash: expectedCash === null ? null : expectedCash - phantomCash,
        };
      });

      return {
        success: true,
        outlet: { id: access.outlet.id, name: access.outlet.name },
        // True only when a platform admin is reading a merchant's books rather
        // than their own. The page says so out loud: quietly rendering someone
        // else's cashier names and drawer counts as if they were yours is how
        // an audit page becomes the thing that needs auditing.
        viewedAsAdmin: access.isPlatformAdmin && !access.isOwner,
        range: { from: fromDate, to: toDate },
        windowSeconds: WINDOW_SECONDS,
        truncated: pairs.length >= 500,
        summary,
        byDay,
        shifts,
        pairs,
      };
    } catch (error) {
      request.log.error(error);
      const busy = loadFailure(error);
      if (busy) return reply.status(busy.status).send({ success: false, error: busy.error });
      return reply.status(500).send({ success: false, error: "Gagal memuat audit transaksi ganda" });
    }
  });
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((acc, row) => acc + pick(row), 0);
}

/** "2026-09-05" for an instant, in the outlet's zone. */
function jakartaDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/**
 * The window, as local calendar days. Both bounds are INCLUSIVE days converted
 * through the shared zone helpers — never `new Date(y, m, d)`, which would take
 * the server's zone (UTC in the deployed image) and shift every boundary by 7
 * hours, quietly moving late-evening sales into the wrong day.
 */
function parseRange(q: Record<string, string>):
  | { from: Date; to: Date; fromDate: string; toDate: string }
  | string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const fromDate = q.from || shiftDays(today, -29);
  const toDate = q.to || today;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return "Rentang tanggal tidak valid";
  }
  if (toDate < fromDate) return "Tanggal akhir harus setelah tanggal mulai";

  const days = (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000;
  if (days > MAX_RANGE_DAYS) return "Rentang tanggal maksimal 3 bulan";

  const { startUTC: from } = getUTCRangeFromLocalDate(fromDate);
  // Exclusive upper bound = midnight of the day AFTER `toDate`, so the last day
  // is included whole.
  const { startUTC: to } = getUTCRangeFromLocalDate(shiftDays(toDate, 1));
  return { from, to, fromDate, toDate };
}

function shiftDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
