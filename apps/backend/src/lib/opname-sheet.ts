import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  productsTable,
  stockMovementsTable,
  stockOpnameLinesTable,
  stockOpnameSessionsTable,
  usersTable,
} from "../db/schema";
import { classify, linesWithSystem, reasonFits, round3, stockAt, unitCostOf, type VarianceTone } from "./opname";

/**
 * An opname session as a count SHEET, a page at a time: every tracked product
 * of the outlet with its answer in the session, if any, judged the way the web
 * page judges it (opname-session.tsx) and FINISH gates it (routes/stock-opname.ts).
 *
 * The web page downloads the whole catalogue and every line and works this out
 * in the browser. The Android app asks for one page instead, so the same work is
 * done here, with the same rules from lib/opname.ts, and only the page is sent.
 *
 * A session that is over is a record, not a sheet to fill: see closedSheet.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Q = typeof db | Tx;
type Session = typeof stockOpnameSessionsTable.$inferSelect;

/** A product's place in the count: no answer yet, skipped, or how its count compares. */
export type SheetTone = "pending" | "skipped" | VarianceTone;

/**
 * The sheet's tabs (the web's Semua, Belum dihitung, Sudah dihitung, Ada
 * selisih) and the review's groups (Perlu alasan, Selisih kecil, Cocok,
 * Dilewati).
 */
export const SHEET_FILTERS = ["all", "todo", "done", "diff", "major", "minor", "ok", "skipped"] as const;
export type SheetFilter = (typeof SHEET_FILTERS)[number];

export type SheetLine = {
  counted: number | null;
  skipped: boolean;
  reason: string | null;
  countedAt: string;
  countedBy: string | null;
  /** The HPP typed for it on the web during this count, if any: the app sends it back untouched when it saves the line again. */
  unitCost: number | null;
  /** System stock when it was counted, and the count less that. */
  systemQty: number | null;
  delta: number | null;
  impact: number | null;
};

export type SheetRow = {
  productId: string;
  productName: string;
  code: string | null;
  unit: string;
  /** On the shelf now. */
  stock: number;
  /** What a NEW count would be compared with: the stock now, or at the chosen past moment. */
  reference: number | null;
  /** One unit's worth for the impact: the ledger's average, else an HPP typed on the web, else the form's price. */
  unitCost: number;
  tone: SheetTone;
  /** A major difference whose reason is missing or does not fit it: it holds the finish back. */
  needsReason: boolean;
  line: SheetLine | null;
};

export type SheetSummary = {
  total: number;
  answered: number;
  pending: number;
  skipped: number;
  ok: number;
  minor: number;
  major: number;
  /** Major differences still without a fitting reason. */
  unexplained: number;
  /** What the differences do to the value of the shelf, in rupiah. */
  impact: number;
  /** The first products still to count, by name, for "3 barang belum dihitung: …". */
  pendingNames: string[];
  /** Answers that FINISH will not book: the product was deleted or stopped tracking stock. */
  dropped: string[];
};

export type SheetHeader = {
  id: number;
  code: string;
  note: string;
  status: string;
  startedAt: string | null;
  startedBy: string | null;
  /** When it was approved or cancelled, and by whom; null while open. */
  finishedAt: string | null;
  finishedBy: string | null;
  productCount: number;
};

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export const sessionCode = (id: number) => `OP-${String(id).padStart(4, "0")}`;

const byName = (a: SheetRow, b: SheetRow) =>
  a.productName.localeCompare(b.productName, "id", { sensitivity: "base" }) || a.productId.localeCompare(b.productId);

/** The names of these users, looked up once. */
async function userNames(q: Q, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((u): u is string => !!u))];
  const users = wanted.length
    ? await q.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, wanted))
    : [];
  const byId = new Map(users.map((u) => [u.id, u.name]));
  return (id: string | null) => (id ? (byId.get(id) ?? null) : null);
}

/**
 * What FINISH booked for each line of these sessions, in rupiah: the adjustment
 * it posted, as the ledger valued it (signed, cost_change). FINISH dates each
 * adjustment at its line's counted_at, and no other count of the product can
 * share that moment (lastCountedAt refuses one that is not later), so the time
 * finds the movement. The quantity-less "HPP awal" revaluation that may sit
 * beside it is left out: it changed what the shelf was worth, not the count.
 */
export async function bookedValues(q: Q, sessionIds: number[]): Promise<Map<number, Map<string, number>>> {
  const out = new Map<number, Map<string, number>>();
  if (sessionIds.length === 0) return out;
  const rows = await q
    .select({
      session_id: stockOpnameLinesTable.session_id,
      product_id: stockOpnameLinesTable.product_id,
      value: sql<number>`coalesce(sum(${stockMovementsTable.cost_change}), 0)`.mapWith(Number),
    })
    .from(stockOpnameLinesTable)
    .innerJoin(stockOpnameSessionsTable, eq(stockOpnameSessionsTable.id, stockOpnameLinesTable.session_id))
    .innerJoin(
      stockMovementsTable,
      and(
        eq(stockMovementsTable.product_id, stockOpnameLinesTable.product_id),
        eq(stockMovementsTable.created_at, stockOpnameLinesTable.counted_at),
        eq(stockMovementsTable.outlet_id, stockOpnameSessionsTable.outlet_id),
        eq(stockMovementsTable.reason, "adjustment"),
        sql`${stockMovementsTable.qty_change} <> 0`,
      ),
    )
    .where(
      and(
        inArray(stockOpnameLinesTable.session_id, sessionIds),
        eq(stockOpnameSessionsTable.status, "finished"),
        sql`${stockOpnameLinesTable.delta} <> 0`,
      ),
    )
    .groupBy(stockOpnameLinesTable.session_id, stockOpnameLinesTable.product_id);
  for (const r of rows) {
    const lines = out.get(r.session_id) ?? new Map<string, number>();
    lines.set(r.product_id, r.value);
    out.set(r.session_id, lines);
  }
  return out;
}

/**
 * Every row of the sheet, its summary and its header. `at` is the past moment
 * a count is being typed for ("Waktu lain"), or null for now. Each count is
 * compared with the stock at its own moment, worked out from the ledger now.
 */
export async function opnameSheet(q: Q, session: Session, at: Date | null) {
  if (session.status !== "open") return closedSheet(q, session);
  const [products, lines, past] = await Promise.all([
    q
      .select({
        id: productsTable.id,
        name: productsTable.product_name,
        code: productsTable.barcode,
        unit: productsTable.unit,
        stock: productsTable.stock,
        avg_cost: productsTable.avg_cost,
        buying_price: productsTable.buying_price,
      })
      .from(productsTable)
      .where(
        and(
          eq(productsTable.outlet_id, session.outlet_id),
          eq(productsTable.track_stock, true),
          isNull(productsTable.deletedAt),
        ),
      ),
    linesWithSystem(q, session.id),
    at ? stockAt(q, session.outlet_id, at) : Promise.resolve(null),
  ]);

  const nameOf = await userNames(q, [session.started_by, ...lines.map((l) => l.counted_by)]);

  const lineOf = new Map(lines.map((l) => [l.product_id, l]));
  const tracked = new Set(products.map((p) => p.id));

  const rows: SheetRow[] = products
    .map((p) => {
      const l = lineOf.get(p.id);
      const stock = Number(p.stock) || 0;
      const reference = past ? (past[p.id] ?? null) : stock;
      const unitCost = unitCostOf(p.avg_cost, p.buying_price, l?.unit_cost);
      let line: SheetLine | null = null;
      let tone: SheetTone = "pending";
      if (l) {
        const counted = l.counted == null ? null : Number(l.counted);
        const system = l.skipped ? null : round3(Number(l.stock) - Number(l.after));
        const delta = l.skipped || counted == null || system == null ? null : round3(counted - system);
        tone = l.skipped ? "skipped" : delta == null ? "pending" : classify(delta, system ?? 0, unitCost);
        line = {
          counted,
          skipped: l.skipped,
          reason: l.reason,
          countedAt: iso(l.counted_at)!,
          countedBy: nameOf(l.counted_by),
          unitCost: l.unit_cost == null ? null : Number(l.unit_cost),
          systemQty: system,
          delta,
          impact: delta == null ? null : Math.round(delta * unitCost),
        };
      }
      return {
        productId: p.id,
        productName: p.name,
        code: p.code,
        unit: p.unit,
        stock,
        reference,
        unitCost,
        tone,
        needsReason: tone === "major" && !reasonFits(line?.reason, line?.delta ?? 0),
        line,
      };
    })
    .sort(byName);

  const count = (t: SheetTone) => rows.filter((r) => r.tone === t).length;
  const pendingRows = rows.filter((r) => r.tone === "pending");
  const summary: SheetSummary = {
    total: rows.length,
    answered: rows.length - pendingRows.length,
    pending: pendingRows.length,
    skipped: count("skipped"),
    ok: count("ok"),
    minor: count("minor"),
    major: count("major"),
    unexplained: rows.filter((r) => r.needsReason).length,
    impact: rows.reduce((sum, r) => sum + (r.line?.impact ?? 0), 0),
    pendingNames: pendingRows.slice(0, 3).map((r) => r.productName),
    dropped: lines.filter((l) => !l.track_stock || l.deleted_at != null || !tracked.has(l.product_id)).map((l) => l.product_name),
  };

  const header: SheetHeader = {
    id: session.id,
    code: sessionCode(session.id),
    note: session.note,
    status: session.status,
    startedAt: iso(session.started_at),
    startedBy: nameOf(session.started_by),
    finishedAt: null,
    finishedBy: null,
    productCount: rows.length,
  };

  return { header, rows, summary };
}

/**
 * A session that is over, as Riwayat Opname shows it: what it counted and
 * nothing else. Not today's catalogue: a product added since was never part of
 * it, and one deleted since still was.
 *
 * A finished session shows what it booked: the system stock and difference
 * FINISH wrote on each line, valued as the ledger valued the adjustment. A
 * cancelled one booked nothing, so its differences are what they would have
 * been: the ledger still knows the stock at each count's moment.
 */
async function closedSheet(q: Q, session: Session) {
  const finished = session.status === "finished";
  const [lines, booked] = await Promise.all([
    linesWithSystem(q, session.id),
    finished ? bookedValues(q, [session.id]) : Promise.resolve(new Map<number, Map<string, number>>()),
  ]);
  const nameOf = await userNames(q, [session.started_by, session.finished_by, ...lines.map((l) => l.counted_by)]);
  const values = booked.get(session.id) ?? new Map<string, number>();

  // A counted line FINISH wrote nothing on: the product was deleted or stopped
  // tracking stock before approval, so it was never booked.
  const unbooked = (l: (typeof lines)[number]) => finished && !l.skipped && l.delta == null;

  const rows: SheetRow[] = lines
    .filter((l) => !unbooked(l))
    .map((l) => {
      const counted = l.counted == null ? null : Number(l.counted);
      const system = l.skipped
        ? null
        : finished
          ? Number(l.system_qty)
          : round3(Number(l.stock) - Number(l.after));
      const delta = l.skipped || counted == null || system == null ? null : finished ? Number(l.delta) : round3(counted - system);
      const value = values.get(l.product_id);
      // One unit's worth as it was booked, where it was; otherwise as it stands.
      const unitCost =
        value != null && delta ? Math.abs(value / delta) : unitCostOf(l.avg_cost, l.buying_price, l.unit_cost);
      const tone: SheetTone = l.skipped ? "skipped" : delta == null ? "pending" : classify(delta, system ?? 0, unitCost);
      return {
        productId: l.product_id,
        productName: l.product_name,
        code: l.barcode,
        unit: l.unit,
        stock: Number(l.stock) || 0,
        // Nothing more is counted into it.
        reference: null,
        unitCost,
        tone,
        needsReason: false,
        line: {
          counted,
          skipped: l.skipped,
          reason: l.reason,
          countedAt: iso(l.counted_at)!,
          countedBy: nameOf(l.counted_by),
          unitCost: l.unit_cost == null ? null : Number(l.unit_cost),
          systemQty: system,
          delta,
          impact: delta == null ? null : Math.round(value ?? delta * unitCost),
        },
      };
    })
    .sort(byName);

  const count = (t: SheetTone) => rows.filter((r) => r.tone === t).length;
  const summary: SheetSummary = {
    total: rows.length,
    answered: rows.length,
    pending: 0,
    skipped: count("skipped"),
    ok: count("ok"),
    minor: count("minor"),
    major: count("major"),
    unexplained: 0,
    impact: rows.reduce((sum, r) => sum + (r.line?.impact ?? 0), 0),
    pendingNames: [],
    dropped: lines.filter(unbooked).map((l) => l.product_name),
  };

  const header: SheetHeader = {
    id: session.id,
    code: sessionCode(session.id),
    note: session.note,
    status: session.status,
    startedAt: iso(session.started_at),
    startedBy: nameOf(session.started_by),
    finishedAt: iso(session.finished_at),
    finishedBy: nameOf(session.finished_by),
    productCount: rows.length,
  };

  return { header, rows, summary };
}

export const SESSION_STATUSES = ["open", "finished", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/**
 * Sessions as Riwayat Opname lists them: who and when, how much was counted,
 * and for a finished one what it did to the shelf, split into what went missing
 * (shortage, negative) and what turned up (surplus). A cancelled session booked
 * nothing and an open one has booked nothing yet, so theirs are null.
 */
export async function sessionCards(q: Q, sessions: Session[]) {
  if (sessions.length === 0) return [];
  const ids = sessions.map((s) => s.id);
  const line = stockOpnameLinesTable;
  const [tallies, counters, booked] = await Promise.all([
    q
      .select({
        session_id: line.session_id,
        answered: sql<number>`count(*)`.mapWith(Number),
        skipped: sql<number>`count(*) filter (where ${line.skipped})`.mapWith(Number),
        differences: sql<number>`count(*) filter (where ${line.delta} <> 0)`.mapWith(Number),
        lastCountedAt: sql<Date | null>`max(${line.counted_at})`.mapWith(line.counted_at),
      })
      .from(line)
      .where(inArray(line.session_id, ids))
      .groupBy(line.session_id),
    q
      .selectDistinct({ session_id: line.session_id, user_id: line.counted_by })
      .from(line)
      .where(inArray(line.session_id, ids)),
    bookedValues(
      q,
      sessions.filter((s) => s.status === "finished").map((s) => s.id),
    ),
  ]);
  const nameOf = await userNames(q, [
    ...sessions.flatMap((s) => [s.started_by, s.finished_by]),
    ...counters.map((c) => c.user_id),
  ]);
  // How many products an open session has to answer for: its progress.
  const open = sessions.find((s) => s.status === "open");
  const [{ total } = { total: 0 }] = open
    ? await q
        .select({ total: sql<number>`count(*)`.mapWith(Number) })
        .from(productsTable)
        .where(
          and(eq(productsTable.outlet_id, open.outlet_id), eq(productsTable.track_stock, true), isNull(productsTable.deletedAt)),
        )
    : [];

  return sessions.map((s) => {
    const t = tallies.find((x) => x.session_id === s.id);
    const finished = s.status === "finished";
    const values = [...(booked.get(s.id)?.values() ?? [])];
    return {
      id: s.id,
      code: sessionCode(s.id),
      note: s.note,
      status: s.status,
      startedAt: iso(s.started_at),
      startedBy: nameOf(s.started_by),
      finishedAt: iso(s.finished_at),
      finishedBy: nameOf(s.finished_by),
      lastCountedAt: iso(t?.lastCountedAt),
      answered: t?.answered ?? 0,
      skipped: t?.skipped ?? 0,
      differences: finished ? (t?.differences ?? 0) : null,
      shortage: finished ? Math.round(values.filter((v) => v < 0).reduce((a, v) => a + v, 0)) : null,
      surplus: finished ? Math.round(values.filter((v) => v > 0).reduce((a, v) => a + v, 0)) : null,
      counters: [
        ...new Set(
          counters
            .filter((c) => c.session_id === s.id)
            .map((c) => nameOf(c.user_id))
            .filter((n): n is string => !!n),
        ),
      ].sort((a, b) => a.localeCompare(b, "id")),
      productCount: s.status === "open" ? total : null,
    };
  });
}

export function matchesFilter(tone: SheetTone, filter: SheetFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "todo":
      return tone === "pending";
    case "done":
      return tone !== "pending";
    case "diff":
      return tone === "minor" || tone === "major";
    case "major":
    case "minor":
    case "ok":
    case "skipped":
      return tone === filter;
  }
}

/**
 * A page of the sheet: the rows matching `q` (name or code) and `filter`, by
 * name, except "diff", which puts the differences that need a reason first, as
 * the review does. `counts` are each tab's number for the search as typed.
 */
export function sheetPage(
  rows: SheetRow[],
  opts: { q: string; filter: SheetFilter; page: number; limit: number },
) {
  const needle = opts.q.trim().toLowerCase();
  const searched = needle
    ? rows.filter((r) => r.productName.toLowerCase().includes(needle) || (r.code ?? "").toLowerCase().includes(needle))
    : rows;
  const counts = Object.fromEntries(
    SHEET_FILTERS.map((f) => [f, searched.filter((r) => matchesFilter(r.tone, f)).length]),
  ) as Record<SheetFilter, number>;
  let shown = searched.filter((r) => matchesFilter(r.tone, opts.filter));
  if (opts.filter === "diff") {
    shown = [...shown].sort((a, b) => Number(b.tone === "major") - Number(a.tone === "major"));
  }
  const start = (opts.page - 1) * opts.limit;
  return { data: shown.slice(start, start + opts.limit), total: shown.length, counts };
}
