import { and, eq, isNull, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { cashierShiftsTable, outletsTable } from "../db/schema";
import { money } from "./money-sql";
import { posPaymentLabel } from "./pos-payment";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The open shift at an outlet, or null. There can only ever be one — the
 * partial unique index in migration 0067 is what guarantees that, not this
 * query's limit(1).
 *
 * Takes a Tx so callers already inside a transaction (a POS sale stamping
 * itself) read the same snapshot they are writing into.
 */
export async function getOpenShift(tx: Tx | typeof db, outletId: number) {
  const [shift] = await tx
    .select()
    .from(cashierShiftsTable)
    .where(
      and(
        eq(cashierShiftsTable.outlet_id, outletId),
        isNull(cashierShiftsTable.closed_at),
      ),
    )
    .limit(1);
  return shift ?? null;
}

/** Just the id, for the stamp-on-write path where nothing else is needed. */
export async function getOpenShiftId(tx: Tx | typeof db, outletId: number) {
  const shift = await getOpenShift(tx, outletId);
  return shift?.id ?? null;
}

export type ShiftPaymentLine = {
  method: string;
  label: string;
  amount: number;
  orderCount: number;
};

export type ShiftReport = {
  shift: {
    id: number;
    cashierName: string;
    openedAt: string;
    closedAt: string | null;
    isOpen: boolean;
  };
  outlet: {
    name: string;
    address: string;
    phone: string;
    logo: string;
  };
  drawer: {
    openingFloat: number;
    cashIn: number;
    cashOut: number;
    /** openingFloat + cashIn - cashOut. Frozen once the shift is closed. */
    expectedCash: number;
    /**
     * How much of the drawer is tax the shop is holding for the tax office.
     *
     * CASH sales only. revenue.tax is the wrong number here and using it would
     * overstate this every time: tax on a QRIS or card sale was collected, but
     * it never entered the drawer, so it is not part of what gets counted.
     *
     * Zero under inclusive pricing too — there the tax is inside the price the
     * customer was already paying, so nothing extra arrived in the till.
     *
     * Cross-shift caveat: a cash sale voided in a LATER shift takes its tax
     * back out of that shift's drawer (cashOut), but the sale itself belongs to
     * the earlier shift, so it is not deducted here. Rare, and the alternative
     * is attributing a refund to a shift that is already closed and signed.
     */
    taxInDrawer: number;
    countedCash: number | null;
    variance: number | null;
    closingNote: string | null;
  };
  revenue: {
    gross: number;
    discount: number;
    /** Sales after discount, BEFORE tax. What the business earned. */
    net: number;
    /**
     * Tax collected on behalf of the tax office. Zero when the outlet charges
     * none. Never part of `net` — it is not income.
     */
    tax: number;
    /**
     * What customers actually handed over: net + tax under exclusive pricing,
     * and just net under inclusive (the tax was already inside the prices).
     * This is the figure the payment lines and the drawer reconcile against.
     */
    collected: number;
    orderCount: number;
    itemCount: number;
  };
  payments: ShiftPaymentLine[];
  cancelled: { count: number; amount: number };
  topProducts: { name: string; qty: number; amount: number }[];
};

/**
 * Everything the closing slip prints, for one shift.
 *
 * Four small indexed queries rather than one clever join: they aggregate over
 * different grains (orders, cash movements, voided orders, product lines) and
 * fusing them would either fan rows out and double count the money, or need
 * enough DISTINCTs to cost more than the four round trips. Each one is bounded
 * by a single shift, so none of them is a report-sized query — this runs on the
 * live pool, not reportDb, because a cashier waiting to go home should not
 * queue behind an owner's three-month analysis.
 *
 * Returns null when the shift does not exist or belongs to another outlet.
 */
export async function buildShiftReport(
  shiftId: number,
  outletId: number,
): Promise<ShiftReport | null> {
  const [row] = await db
    .select({ shift: cashierShiftsTable, outlet: outletsTable })
    .from(cashierShiftsTable)
    .innerJoin(outletsTable, eq(outletsTable.id, cashierShiftsTable.outlet_id))
    .where(
      and(
        eq(cashierShiftsTable.id, shiftId),
        eq(cashierShiftsTable.outlet_id, outletId),
      ),
    )
    .limit(1);

  if (!row) return null;
  const { shift, outlet } = row;
  const isOpen = shift.closed_at === null;

  // ── Sales, bucketed by how they were paid ─────────────────────────────────
  // One pass gives both the payment breakdown and the revenue totals, which is
  // the point: computing them separately is how the two end up disagreeing.
  //
  // Net per bucket is gross minus that order's discount, so the payment lines
  // sum to TOTAL PENJUALAN NETTO exactly. A cashier who has to explain a
  // discrepancy should never be handed a slip whose own sections don't add up.
  const salesResult = await db.execute(sql`
    with per_order as (
      select o.id,
             coalesce(nullif(o.note ->> 'paymentMethod', ''), 'cash') as method,
             -- Same crash guard as lib/money-sql.ts, applied to a JSON value:
             -- note is untyped, so a non-numeric discountAmount would otherwise
             -- abort the whole statement rather than just its own row.
             case when (o.note ->> 'discountAmount') ~ '^\\s*-?[0-9]+(\\.[0-9]+)?\\s*$'
                  then (o.note ->> 'discountAmount')::numeric else 0 end as discount,
             coalesce(o.tax_amount, 0) as tax,
             -- What this order actually put in the till. Exclusive tax was
             -- handed over on top of the line prices; inclusive tax was already
             -- inside them, so adding it would double count the drawer.
             case when coalesce(o.tax_inclusive, false) then 0
                  else coalesce(o.tax_amount, 0) end as tax_on_top,
             coalesce((select sum(${money(sql`od.summary_price`)})
                         from "orderDetails" od where od.order_id = o.id), 0) as gross,
             -- Parents only, unlike gross directly above: an add-on is money
             -- but it is not a separate thing handed over the counter, so one
             -- nasi goreng with two toppings is 1 item and 3 rows. See the
             -- reader rule in lib/addons.ts.
             coalesce((select sum(od.quantity)
                         from "orderDetails" od
                        where od.order_id = o.id
                          and od.parent_detail_id is null), 0) as items
        from orders o
       where o.shift_id = ${shiftId}
         and o.deleted_at is null
    )
    select method,
           count(*)::int             as order_count,
           sum(gross)::float8        as gross,
           sum(discount)::float8     as discount,
           sum(tax)::float8          as tax,
           sum(tax_on_top)::float8   as tax_on_top,
           sum(items)::int           as items
      from per_order
     group by method
     order by sum(gross - discount + tax_on_top) desc
  `);

  const paymentRows = salesResult.rows as any[];
  // Payment lines report what was TENDERED, tax included — they are what a
  // cashier reconciles against EDC settlements and the cash in the drawer, and
  // the customer tendered the tax too. So they foot to `collected`, not to
  // `net`.
  const payments: ShiftPaymentLine[] = paymentRows.map((r) => ({
    method: String(r.method),
    label: posPaymentLabel(String(r.method)),
    amount: Number(r.gross) - Number(r.discount) + Number(r.tax_on_top),
    orderCount: Number(r.order_count),
  }));

  const gross = paymentRows.reduce((a, r) => a + Number(r.gross), 0);
  const discount = paymentRows.reduce((a, r) => a + Number(r.discount), 0);
  const tax = paymentRows.reduce((a, r) => a + Number(r.tax), 0);
  const taxOnTop = paymentRows.reduce((a, r) => a + Number(r.tax_on_top), 0);
  // Only the cash bucket's tax actually landed in the till.
  const taxInDrawer = paymentRows
    .filter((r) => String(r.method) === "cash")
    .reduce((a, r) => a + Number(r.tax_on_top), 0);
  const orderCount = paymentRows.reduce((a, r) => a + Number(r.order_count), 0);
  const itemCount = paymentRows.reduce((a, r) => a + Number(r.items), 0);

  // ── The drawer ────────────────────────────────────────────────────────────
  // Only type='cash' movements count. A QRIS sale books as 'transfer' and must
  // not appear here, or the count at the end can never reconcile — that split
  // is what lib/pos-payment.ts posCashflowTypeFor exists to make.
  const cashResult = await db.execute(sql`
    select coalesce(sum(case when ci.type = 'cash'
                             then ${money(sql`ci.money_amount`)} else 0 end), 0)::float8 as cash_in,
           coalesce(sum(case when co.type = 'cash'
                             then ${money(sql`co.money_amount`)} else 0 end), 0)::float8 as cash_out
      from "cashFlows" cf
      left join "cashInDetailTable"  ci on ci.id = cf.cash_in_detail_id
      left join "cashOutDetailTable" co on co.id = cf.cash_out_detail_id
     where cf.shift_id = ${shiftId}
  `);
  const cashIn = Number((cashResult.rows[0] as any)?.cash_in ?? 0);
  const cashOut = Number((cashResult.rows[0] as any)?.cash_out ?? 0);

  const openingFloat = Number(shift.opening_float ?? 0);
  // A closed shift reports the figure that was on its slip, not a recomputed
  // one: a cancellation booked after the count would otherwise quietly move the
  // discrepancy someone already signed for.
  const expectedCash = isOpen
    ? openingFloat + cashIn - cashOut
    : Number(shift.expected_cash ?? 0);

  // ── Voided sales ──────────────────────────────────────────────────────────
  // Shown, not hidden. A cancellation reverses the money in the ledger, so it
  // is already reflected in the drawer above; printing the count separately is
  // what lets an owner see that six sales were voided on one shift.
  const cancelledResult = await db.execute(sql`
    select count(*)::int as count,
           coalesce(sum(
             coalesce((select sum(${money(sql`od.summary_price`)})
                         from "orderDetails" od where od.order_id = o.id), 0)
             - case when (o.note ->> 'discountAmount') ~ '^\\s*-?[0-9]+(\\.[0-9]+)?\\s*$'
                    then (o.note ->> 'discountAmount')::numeric else 0 end
             -- Same tax rule as the sales query: a void gives back what was
             -- tendered, so exclusive tax comes back and inclusive tax is
             -- already inside the line prices.
             + case when coalesce(o.tax_inclusive, false) then 0
                    else coalesce(o.tax_amount, 0) end
           ), 0)::float8 as amount
      from orders o
     where o.shift_id = ${shiftId}
       and o.deleted_at is not null
  `);
  const cancelled = {
    count: Number((cancelledResult.rows[0] as any)?.count ?? 0),
    amount: Number((cancelledResult.rows[0] as any)?.amount ?? 0),
  };

  // ── What actually sold ────────────────────────────────────────────────────
  const topResult = await db.execute(sql`
    select p.product_name          as name,
           sum(od.quantity)::int   as qty,
           sum(${money(sql`od.summary_price`)})::float8 as amount
      from orders o
      join "orderDetails" od on od.order_id = o.id
      join products p        on p.id = od.product_id
     where o.shift_id = ${shiftId}
       and o.deleted_at is null
     group by p.product_name
     order by qty desc, amount desc
     limit 5
  `);

  return {
    shift: {
      id: shift.id,
      cashierName: shift.cashier_name,
      // ISO 8601, so the browser can render it in the viewer's own timezone.
      // Never formatted server-side: see lib/timezone.ts.
      openedAt: new Date(shift.opened_at).toISOString(),
      closedAt: shift.closed_at ? new Date(shift.closed_at).toISOString() : null,
      isOpen,
    },
    outlet: {
      name: outlet.name ?? "",
      address: outlet.address ?? "",
      phone: outlet.phone ?? "",
      logo: outlet.avatar ?? "",
    },
    drawer: {
      openingFloat,
      cashIn,
      cashOut,
      expectedCash,
      taxInDrawer,
      countedCash: shift.counted_cash === null ? null : Number(shift.counted_cash),
      variance: shift.variance === null ? null : Number(shift.variance),
      closingNote: shift.closing_note ?? null,
    },
    revenue: {
      gross,
      discount,
      // Under INCLUSIVE pricing the line prices already contain the tax, so it
      // has to come out of the sales figure or the shift reports the tax
      // office's money as takings. Under exclusive it was never in there.
      // This is the asymmetry lib/tax.ts describes, applied.
      net: gross - discount - (tax - taxOnTop),
      tax,
      collected: gross - discount + taxOnTop,
      orderCount,
      itemCount,
    },
    payments,
    cancelled,
    topProducts: (topResult.rows as any[]).map((r) => ({
      name: String(r.name ?? ""),
      qty: Number(r.qty),
      amount: Number(r.amount),
    })),
  };
}

/** Most recent shifts at an outlet, newest first — the reprint list. */
export async function listRecentShifts(outletId: number, limit: number) {
  return db
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
    .where(eq(cashierShiftsTable.outlet_id, outletId))
    .orderBy(desc(cashierShiftsTable.opened_at))
    .limit(limit);
}
