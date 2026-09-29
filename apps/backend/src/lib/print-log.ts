import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  orderDetailsTable,
  ordersTable,
  printLogsTable,
  productsTable,
  tableSessionLinesTable,
  usersTable,
} from "../db/schema";

/**
 * Print logs — the server's copy of every slip printed before its sale is
 * booked (the cashier's pre-checkout struk, a table's Cetak Bill). Written by
 * POST /api/print-logs (routes/print-logs.ts), paid off by linkPrintLogs at
 * checkout. See the "Print logs" section of db/schema.ts.
 */

export const PRINT_KINDS = ["receipt", "table_bill"] as const;
export type PrintKind = (typeof PRINT_KINDS)[number];

/** One line of the slip, as it was printed. */
export type PrintLine = {
  /** The cart line (a table_session_lines id on a table) — what checkout matches. */
  lineId: string;
  name: string;
  variant: string | null;
  qty: number;
  /** Unit price as printed, before add-ons. */
  price: number;
  addons: { name: string; qty: number; price: number }[];
};

/** Trimmed text, or null when blank. Over-long input is cut, never refused. */
function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
}

const money = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 1e12 ? n : null;
};

/** One printed line, or an error sentence. */
export function parsePrintLine(raw: unknown): PrintLine | string {
  const r = (raw ?? {}) as Record<string, unknown>;
  const lineId = typeof r.lineId === "string" ? r.lineId.trim() : "";
  if (!lineId || lineId.length > 64) return "Baris struk tidak valid";
  const name = text(r.name, 255);
  if (!name) return "Nama menu kosong";
  const qty = Number(r.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 9999) return `Jumlah ${name} tidak valid`;
  // A price that doesn't parse is logged as 0 rather than refused: the point
  // of the row is that the print happened, and a refusal would lose it.
  const price = money(r.price) ?? 0;
  const addons = Array.isArray(r.addons) ? r.addons.slice(0, 30) : [];
  return {
    lineId,
    name,
    variant: text(r.variant, 100),
    qty,
    price,
    addons: addons
      .map((a) => {
        const x = (a ?? {}) as Record<string, unknown>;
        const n = text(x.name, 255);
        const q = Number(x.qty);
        const p = money(x.price);
        return n && Number.isInteger(q) && q >= 1 && q <= 999 && p !== null ? { name: n, qty: q, price: p } : null;
      })
      .filter((a): a is PrintLine["addons"][number] => a !== null),
  };
}

/**
 * Stamp a just-committed sale's order id on the slips it paid.
 *
 *   counter  unpaid prints of the till tab that listed one of the sale's cart
 *            lines. By line, not by tab alone: clearing a cart keeps the tab,
 *            and a slip from a cleared cart must stay unpaid rather than ride
 *            on the next customer's sale.
 *   table    unpaid prints — from the till or from Manajemen Meja — that listed
 *            a table line this sale settled. Matched by line like the kitchen's
 *            tickets, so a merge or a move to another seating still finds them.
 *
 * Called AFTER the sale commits, with any failure logged and dropped: a sale
 * must not roll back over an audit label. Returns how many rows it touched.
 */
export async function linkPrintLogs(t: {
  outletId: number;
  orderId: string;
  /** The till tab's id, when the cashier sent one. */
  tabKey: string | null;
  /** The cart lines the sale was rung up from. */
  lineIds: string[];
  /** The sale settled a table bill (its lines now carry orderId). */
  tableBill: boolean;
}): Promise<number> {
  const now = new Date();
  let linked = 0;
  if (t.tabKey && t.lineIds.length) {
    const rows = await db
      .update(printLogsTable)
      .set({ order_id: t.orderId, updated_at: now })
      .where(
        and(
          eq(printLogsTable.outlet_id, t.outletId),
          eq(printLogsTable.source_key, t.tabKey),
          isNull(printLogsTable.session_id),
          isNull(printLogsTable.order_id),
          sql`exists (
            select 1
              from jsonb_array_elements(${printLogsTable.lines}) e
             where e ->> 'lineId' = any(ARRAY[${sql.join(
               t.lineIds.map((id) => sql`${id}`),
               sql`, `,
             )}]::text[])
          )`,
        ),
      )
      .returning({ id: printLogsTable.id });
    linked += rows.length;
  }
  if (t.tableBill) {
    const rows = await db
      .update(printLogsTable)
      .set({ order_id: t.orderId, updated_at: now })
      .where(
        and(
          eq(printLogsTable.outlet_id, t.outletId),
          isNotNull(printLogsTable.session_id),
          isNull(printLogsTable.order_id),
          sql`exists (
            select 1
              from jsonb_array_elements(${printLogsTable.lines}) e
              join ${tableSessionLinesTable} l on l.id = e ->> 'lineId'
             where l.order_id = ${t.orderId}
          )`,
        ),
      )
      .returning({ id: printLogsTable.id });
    linked += rows.length;
  }
  return linked;
}

// ─── Laporan: Struk Belum Dibayar ───────────────────────────────────────────
//
// The rules below are quoted in the owner's guide
// (apps/frontend/app/dashboard/panduan/struk-belum-dibayar/page.tsx) — change
// that page when they change.

/** An unpaid slip younger than this is still being served, not yet a concern. */
export const PRINT_PENDING_MINUTES = 60;
/** Prints read per report; past it the owner is told to narrow the dates. */
export const PRINT_REPORT_CAP = 2000;

export type SlipStatus = "unpaid" | "pending" | "cancelled" | "short" | "paid";

export type Slip = {
  kind: PrintKind;
  status: SlipStatus;
  /** The latest press of Cetak for this slip; firstPrintedAt the earliest. */
  printedAt: string;
  firstPrintedAt: string;
  printCount: number;
  printedBy: string[];
  label: string | null;
  customer: string | null;
  total: number;
  lines: PrintLine[];
  order: { id: string; createdAt: string; cancelledAt: string | null } | null;
  /** Printed units the sale did not charge ("short" only). */
  missing: { name: string; qty: number }[];
  /** What the missing units were worth on the slip. */
  missingAmount: number;
};

const lineValue = (l: PrintLine) => l.price + l.addons.reduce((n, a) => n + a.price * a.qty, 0);

/**
 * The slips printed in [from, to), one entry per slip rather than per press:
 * reprints of the same cart (same tab or table bill, same lines, same sale)
 * fold into one with a count, so an unpaid amount is never counted twice.
 *
 * Status, in order:
 *   pending    no sale yet, last printed under PRINT_PENDING_MINUTES ago
 *   unpaid     no sale, older than that — handed over and never checked out
 *   cancelled  paid, then the sale was cancelled (Pembatalan Order Kasir)
 *   short      paid, but the sale charged fewer units of a printed menu item
 *              than the slip listed (a table slip: everything its seating
 *              paid, so a bill printed whole and paid split is not short)
 *   paid       everything on the slip was charged
 */
export async function printLogReport(outletId: number, from: Date, to: Date) {
  const rows = await db
    .select({
      id: printLogsTable.id,
      kind: printLogsTable.kind,
      sourceKey: printLogsTable.source_key,
      sessionId: printLogsTable.session_id,
      billNo: printLogsTable.bill_no,
      label: printLogsTable.label,
      customer: printLogsTable.customer,
      lines: printLogsTable.lines,
      total: printLogsTable.total,
      orderId: printLogsTable.order_id,
      createdAt: printLogsTable.created_at,
      printedBy: usersTable.name,
      orderCreatedAt: ordersTable.createdAt,
      orderDeletedAt: ordersTable.deletedAt,
    })
    .from(printLogsTable)
    .leftJoin(usersTable, eq(usersTable.id, printLogsTable.created_by))
    .leftJoin(ordersTable, eq(ordersTable.id, printLogsTable.order_id))
    .where(
      and(
        eq(printLogsTable.outlet_id, outletId),
        gte(printLogsTable.created_at, from),
        lt(printLogsTable.created_at, to),
      ),
    )
    .orderBy(desc(printLogsTable.created_at))
    .limit(PRINT_REPORT_CAP + 1);
  const capped = rows.length > PRINT_REPORT_CAP;
  if (capped) rows.length = PRINT_REPORT_CAP;

  // A table's bill can be paid as several orders — a bill printed whole and
  // then split item by item (the split gives the moved units new line ids) —
  // so a table slip is judged against everything its seating paid, plus
  // whatever settled the lines it printed (a line moved to another seating
  // keeps its id). A counter slip only ever has its one sale.
  const tableRows = rows.filter((r) => r.sessionId);
  const sessionOrders = new Map<string, Set<string>>();
  const lineOrder = new Map<string, string>();
  if (tableRows.length) {
    const sessionIds = [...new Set(tableRows.map((r) => r.sessionId!))];
    const lineIds = [...new Set(tableRows.flatMap((r) => (r.lines as PrintLine[]).map((l) => l.lineId)))];
    const settled = await db
      .select({
        sessionId: tableSessionLinesTable.session_id,
        lineId: tableSessionLinesTable.id,
        orderId: tableSessionLinesTable.order_id,
      })
      .from(tableSessionLinesTable)
      .where(
        and(
          isNotNull(tableSessionLinesTable.order_id),
          or(
            inArray(tableSessionLinesTable.session_id, sessionIds),
            lineIds.length ? inArray(tableSessionLinesTable.id, lineIds) : undefined,
          ),
        ),
      );
    for (const l of settled) {
      if (!l.orderId) continue;
      const set = sessionOrders.get(l.sessionId) ?? new Set<string>();
      set.add(l.orderId);
      sessionOrders.set(l.sessionId, set);
      lineOrder.set(l.lineId, l.orderId);
    }
  }

  // What each of those sales charged, by menu item. Parent lines only: an
  // add-on is a child row and is judged with the item it came on. A cancelled
  // sale charged nothing.
  const orderIds = [
    ...new Set([
      ...rows.map((r) => r.orderId).filter((id): id is string => !!id),
      ...[...sessionOrders.values()].flatMap((set) => [...set]),
    ]),
  ];
  const charged = new Map<string, Map<string, number>>();
  if (orderIds.length) {
    const details = await db
      .select({
        orderId: orderDetailsTable.order_id,
        name: productsTable.product_name,
        qty: sql<number>`sum(${orderDetailsTable.quantity})::int`,
      })
      .from(orderDetailsTable)
      .innerJoin(productsTable, eq(productsTable.id, orderDetailsTable.product_id))
      .innerJoin(ordersTable, eq(ordersTable.id, orderDetailsTable.order_id))
      .where(
        and(
          inArray(orderDetailsTable.order_id, orderIds),
          isNull(orderDetailsTable.parent_detail_id),
          isNull(ordersTable.deletedAt),
        ),
      )
      .groupBy(orderDetailsTable.order_id, productsTable.product_name);
    for (const d of details) {
      if (!d.orderId) continue;
      const m = charged.get(d.orderId) ?? new Map<string, number>();
      m.set(d.name, (m.get(d.name) ?? 0) + Number(d.qty));
      charged.set(d.orderId, m);
    }
  }

  // Newest first, so the first row of a group is its latest print.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const lines = r.lines as PrintLine[];
    const where = r.sessionId ? `${r.sessionId}:${r.billNo ?? "all"}` : (r.sourceKey ?? `#${r.id}`);
    const key = [r.kind, where, lines.map((l) => `${l.lineId}x${l.qty}`).sort().join(","), r.orderId ?? "-"].join("|");
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  const now = Date.now();
  const slips: Slip[] = [];
  for (const g of groups.values()) {
    const latest = g[0];
    const lines = latest.lines as PrintLine[];
    let status: SlipStatus;
    let missing: Slip["missing"] = [];
    let missingAmount = 0;
    if (!latest.orderId) {
      status = now - latest.createdAt.getTime() < PRINT_PENDING_MINUTES * 60_000 ? "pending" : "unpaid";
    } else if (latest.orderDeletedAt) {
      status = "cancelled";
    } else {
      const saleIds = new Set([latest.orderId]);
      if (latest.sessionId) {
        for (const id of sessionOrders.get(latest.sessionId) ?? []) saleIds.add(id);
        for (const l of lines) {
          const id = lineOrder.get(l.lineId);
          if (id) saleIds.add(id);
        }
      }
      const sale = new Map<string, number>();
      for (const id of saleIds) {
        for (const [name, qty] of charged.get(id) ?? []) sale.set(name, (sale.get(name) ?? 0) + qty);
      }
      const printed = new Map<string, { qty: number; value: number }>();
      for (const l of lines) {
        const p = printed.get(l.name) ?? { qty: 0, value: lineValue(l) };
        p.qty += l.qty;
        printed.set(l.name, p);
      }
      for (const [name, p] of printed) {
        const short = p.qty - (sale.get(name) ?? 0);
        if (short > 0) {
          missing.push({ name, qty: short });
          missingAmount += short * p.value;
        }
      }
      status = missing.length ? "short" : "paid";
    }
    slips.push({
      kind: latest.kind as PrintKind,
      status,
      printedAt: latest.createdAt.toISOString(),
      firstPrintedAt: g[g.length - 1].createdAt.toISOString(),
      printCount: g.length,
      printedBy: [...new Set(g.map((r) => r.printedBy).filter((n): n is string => !!n))],
      label: latest.label,
      customer: latest.customer,
      total: Number(latest.total),
      lines,
      order: latest.orderId
        ? {
            id: latest.orderId,
            createdAt: latest.orderCreatedAt ? latest.orderCreatedAt.toISOString() : latest.createdAt.toISOString(),
            cancelledAt: latest.orderDeletedAt ? latest.orderDeletedAt.toISOString() : null,
          }
        : null,
      missing,
      missingAmount,
    });
  }

  const sum = (s: SlipStatus, pick: (x: Slip) => number) =>
    slips.filter((x) => x.status === s).reduce((n, x) => n + pick(x), 0);
  const count = (s: SlipStatus) => slips.filter((x) => x.status === s).length;
  const totals = {
    prints: rows.length,
    slips: slips.length,
    unpaid: { count: count("unpaid"), amount: sum("unpaid", (x) => x.total) },
    pending: { count: count("pending"), amount: sum("pending", (x) => x.total) },
    cancelled: { count: count("cancelled"), amount: sum("cancelled", (x) => x.total) },
    short: { count: count("short"), amount: sum("short", (x) => x.missingAmount) },
    paid: { count: count("paid") },
  };
  return { slips, totals, capped };
}
