import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  and,
  eq,
  desc,
  asc,
  isNull,
  sql,
  gte,
  lte,
  lt,
  or,
  ilike,
  inArray,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import { db, reportDb } from "../db";
import {
  suppliersTable,
  invoicesTable,
  invoiceItemsTable,
  invoicePaymentsTable,
  stockMovementsTable,
  productsTable,
  cashFlows,
  cashOutCategoryTable,
  cashOutDetailTable,
  cashInCategoryTable,
  cashInDetailTable,
  usersTable,
  menuGroupsTable,
  recipeItemsTable,
  stockOpnameSessionsTable,
  stockOpnameLinesTable,
  INVOICE_PAYMENT_METHOD,
} from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { requireOutletAccess, type EmployeePermission } from "../lib/outlet-access";
import { applySaleStockOut } from "../lib/stock";
import { loadFailure } from "./reports";
import {
  getUTCRangeFromLocalDate,
  getUTCRangeFromLocalMonth,
  yearIn,
} from "../lib/timezone";
import { postMovement } from "../lib/cost";
import { postCount } from "../lib/opname";

// Cashflow categories used when an invoice is paid (seeded in CATEGORY_OUT/IN).
const PURCHASE_CASH_CATEGORY = "Pembelian stok barang dagang";
const SALES_CASH_CATEGORY = "Penjualan produk/jasa";

// Resolve the caller's outlet (owner OR active employee holding `perm`), or
// send the matching error + return null. Owners implicitly hold every
// permission; see lib/outlet-access.ts.
async function getOwnerOutlet(
  request: FastifyRequest,
  reply: FastifyReply,
  perm: EmployeePermission,
) {
  const access = await requireOutletAccess(request, reply, perm);
  return access ? access.outlet : null;
}

type ItemInput = {
  product_id?: string | null;
  description?: string;
  quantity?: number | string;
  unit_price?: number | string;
  // Per-line discount percentage (0-100); reduces this line before tax.
  discount_pct?: number | string;
};

// Compute money for an invoice from its line items. All money is handled as
// numbers here and stored as numeric strings. tax_rate is a percentage.
// Each line's percentage discount is applied first (baked into line_total),
// then the invoice-level `discount` (Rp) is subtracted, then tax.
function computeTotals(
  items: ItemInput[],
  taxRate: number,
  discount: number,
  taxInclusive: boolean,
) {
  const lines = items.map((it) => {
    const qty = Number(it.quantity ?? 0);
    const price = Number(it.unit_price ?? 0);
    const discPct = Math.min(100, Math.max(0, Number(it.discount_pct ?? 0)));
    const line_total = +(qty * price * (1 - discPct / 100)).toFixed(2);
    return { qty, price, discPct, line_total };
  });
  const subtotal = +lines.reduce((s, l) => s + l.line_total, 0).toFixed(2);
  const base = Math.max(0, subtotal - discount);
  let tax_amount: number;
  let total: number;
  if (taxInclusive) {
    // Prices already include tax: extract the embedded tax from the base.
    tax_amount = +(base - base / (1 + taxRate / 100)).toFixed(2);
    total = base;
  } else {
    tax_amount = +((base * taxRate) / 100).toFixed(2);
    total = +(base + tax_amount).toFixed(2);
  }
  return { lines, subtotal, tax_amount, total };
}

// A sales line priced at 0 is either a forgotten price or a giveaway. Left
// alone the two are indistinguishable, and the invoice keeps no record of
// what was actually waived — it just silently books the item as worth
// nothing. Requiring a 100% line discount instead keeps the real price on the
// printed invoice with a line through it, and lets anything reading
// discount_pct tell "given away" from "never priced".
//
// Sales only: a purchase line at 0 is a supplier freebie (a promo sample, a
// bonus unit) — a normal thing for a SUPPLIER to hand over — so it is not
// gated here, and this is never called from the purchase-invoice routes.
function rejectZeroPriceLines(items: ItemInput[]): string | null {
  for (const it of items) {
    const price = Number(it.unit_price ?? 0);
    const discPct = Math.min(100, Math.max(0, Number(it.discount_pct ?? 0)));
    if (!(price > 0) && discPct < 100) {
      const label = it.description?.trim() || "Salah satu item";
      return `${label}: harga satuan tidak boleh 0 — isi harga aslinya, lalu beri diskon 100% kalau memang digratiskan.`;
    }
  }
  return null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type PaymentMethod = (typeof INVOICE_PAYMENT_METHOD.enumValues)[number];

// Whatever the owner picked, the cashflow ledger only knows cash vs transfer:
// anything that isn't physical money in the drawer is 'transfer' there, so cash
// opname reconciles. The finer label survives on invoice_payments.method.
function cashflowTypeFor(method: PaymentMethod) {
  return method === "cash" ? ("cash" as const) : ("transfer" as const);
}

// Coerce untrusted input to a known method; anything unrecognised falls back to
// cash, which is what every payment was booked as before this existed.
function parseMethod(v: unknown): PaymentMethod {
  return INVOICE_PAYMENT_METHOD.enumValues.includes(v as PaymentMethod)
    ? (v as PaymentMethod)
    : "cash";
}

// Record `amount` as a cash-IN payment on a sales invoice inside an open
// transaction: find-or-create the category, write the cashflow detail + link +
// payment row, then bump amount_paid/status. Used by /pay and by /post when the
// draft carried a down payment. The caller validates the amount.
async function recordSalesCashIn(
  tx: Tx,
  outletId: number,
  invoice: { id: number; total: string; amount_paid: string },
  amount: number,
  method: PaymentMethod = "cash",
) {
  let [cat] = await tx
    .select({ id: cashInCategoryTable.id })
    .from(cashInCategoryTable)
    .where(eq(cashInCategoryTable.category, SALES_CASH_CATEGORY))
    .limit(1);
  if (!cat) {
    [cat] = await tx
      .insert(cashInCategoryTable)
      .values({ category: SALES_CASH_CATEGORY })
      .returning({ id: cashInCategoryTable.id });
  }

  const [detail] = await tx
    .insert(cashInDetailTable)
    .values({
      category_id: cat.id,
      money_amount: String(amount),
      type: cashflowTypeFor(method),
    })
    .returning();
  await tx.insert(cashFlows).values({ outlet_id: outletId, cash_in_detail_id: detail.id });
  await tx.insert(invoicePaymentsTable).values({
    invoice_id: invoice.id,
    cash_in_detail_id: detail.id,
    amount: String(amount),
    method,
  });

  const newPaid = +(Number(invoice.amount_paid) + amount).toFixed(2);
  const status = newPaid >= Number(invoice.total) - 0.001 ? ("paid" as const) : ("partial" as const);
  const [updated] = await tx
    .update(invoicesTable)
    .set({ amount_paid: String(newPaid), status, cash_in_detail_id: detail.id })
    .where(eq(invoicesTable.id, invoice.id))
    .returning();
  return updated;
}

// Purchase mirror of recordSalesCashIn: record `amount` as a cash-OUT payment on
// a purchase invoice inside an open transaction — find-or-create the category,
// write the cashflow detail + link + payment row, then bump amount_paid/status.
// Used by /pay and by /post when the draft carried a down payment.
async function recordPurchaseCashOut(
  tx: Tx,
  outletId: number,
  invoice: { id: number; total: string; amount_paid: string },
  amount: number,
  method: PaymentMethod = "cash",
) {
  let [cat] = await tx
    .select({ id: cashOutCategoryTable.id })
    .from(cashOutCategoryTable)
    .where(eq(cashOutCategoryTable.category, PURCHASE_CASH_CATEGORY))
    .limit(1);
  if (!cat) {
    [cat] = await tx
      .insert(cashOutCategoryTable)
      .values({ category: PURCHASE_CASH_CATEGORY })
      .returning({ id: cashOutCategoryTable.id });
  }

  const [detail] = await tx
    .insert(cashOutDetailTable)
    .values({
      category_id: cat.id,
      money_amount: String(amount),
      type: cashflowTypeFor(method),
    })
    .returning();
  await tx.insert(cashFlows).values({ outlet_id: outletId, cash_out_detail_id: detail.id });
  await tx.insert(invoicePaymentsTable).values({
    invoice_id: invoice.id,
    cash_out_detail_id: detail.id,
    amount: String(amount),
    method,
  });

  const newPaid = +(Number(invoice.amount_paid) + amount).toFixed(2);
  const status = newPaid >= Number(invoice.total) - 0.001 ? ("paid" as const) : ("partial" as const);
  const [updated] = await tx
    .update(invoicesTable)
    .set({ amount_paid: String(newPaid), status, cash_out_detail_id: detail.id })
    .where(eq(invoicesTable.id, invoice.id))
    .returning();
  return updated;
}

// Payment history for one invoice, oldest first — the DP booked on post plus
// every later installment. Fed to the "Riwayat Pembayaran" list on the detail
// view so the owner can see how each slice actually came in.
async function paymentHistory(invoiceId: number) {
  return db
    .select({
      id: invoicePaymentsTable.id,
      amount: invoicePaymentsTable.amount,
      method: invoicePaymentsTable.method,
      created_at: invoicePaymentsTable.created_at,
    })
    .from(invoicePaymentsTable)
    .where(eq(invoicePaymentsTable.invoice_id, invoiceId))
    .orderBy(invoicePaymentsTable.created_at, invoicePaymentsTable.id);
}

// What the purchase create and update routes take. A supplier is either
// `supplier_id`, as picked from the outlet's list (the web's select), or
// `supplier_name`, a name typed into the Android form: see resolveSupplier.
type PurchaseBody = {
  supplier_id?: number | null;
  supplier_name?: string | null;
  party_name?: string;
  issue_date?: string;
  due_date?: string;
  tax_rate?: number | string;
  tax_inclusive?: boolean;
  discount?: number | string;
  down_payment?: number | string;
  down_payment_method?: string;
  notes?: string;
  items?: ItemInput[];
};

// The supplier a purchase names, inside the invoice's own transaction: the
// picked `supplier_id`, which must be this outlet's, or for a typed
// `supplier_name` the outlet's live supplier of that name (case and spacing
// aside), created when there is none yet. So a name typed once is in the list
// next time, and a save that fails leaves no supplier behind. Null for none.
async function resolveSupplier(
  tx: Tx,
  outletId: number,
  body: { supplier_id?: number | null; supplier_name?: string | null },
): Promise<number | null> {
  if (body.supplier_id != null) {
    const [row] = await tx
      .select({ id: suppliersTable.id })
      .from(suppliersTable)
      .where(and(eq(suppliersTable.id, Number(body.supplier_id)), eq(suppliersTable.outlet_id, outletId)))
      .limit(1);
    if (!row) throw new Error("BAD_SUPPLIER");
    return row.id;
  }
  const name = body.supplier_name?.trim().replace(/\s+/g, " ").slice(0, 255);
  if (!name) return null;
  const [found] = await tx
    .select({ id: suppliersTable.id })
    .from(suppliersTable)
    .where(
      and(
        eq(suppliersTable.outlet_id, outletId),
        isNull(suppliersTable.deletedAt),
        sql`lower(trim(${suppliersTable.name})) = ${name.toLowerCase()}`,
      ),
    )
    .orderBy(asc(suppliersTable.id))
    .limit(1);
  if (found) return found.id;
  const [created] = await tx
    .insert(suppliersTable)
    .values({ outlet_id: outletId, name })
    .returning({ id: suppliersTable.id });
  return created.id;
}

// Resolve a period key ("today" | "7d" | "30d" | "month") to the instant the
// window opens, plus the calendar cursors the trend series needs.
//
// Period boundaries are calendar edges, so they must land on LOCAL midnight.
// setHours / new Date(y, m, 1) would use the container's zone — UTC in the
// deployed image — and quietly shift "today" and "this month" by 7 hours.
function periodWindow(period: string, timezone: string) {
  const now = new Date();
  const todayLocal = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [localYear, localMonth] = todayLocal.split("-").map(Number);
  const monthsAgoStart = (n: number) => {
    const m = new Date(Date.UTC(localYear, localMonth - 1 - n, 1));
    const key = `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`;
    return getUTCRangeFromLocalMonth(key, timezone).startUTC;
  };

  let from: Date;
  if (period === "today") {
    from = getUTCRangeFromLocalDate(todayLocal, timezone).startUTC;
  } else if (period === "7d") {
    from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (period === "month") {
    from = monthsAgoStart(0);
  } else {
    from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  return { from, todayLocal, localYear, localMonth, monthsAgoStart };
}

// The invoice report is now driven by an explicit date range (the filter popup
// on /dashboard/invoice/reports), with the old period tabs kept as the fallback
// for any caller that still sends `period`. `to` is EXCLUSIVE — the client sends
// the day after the last day it wants shown — and the span is capped so one
// request can never sweep the whole invoice history.
export const MAX_REPORT_RANGE_DAYS = 93;

function rangeWindow(query: { period?: string; from?: string; to?: string }, timezone: string) {
  const w = periodWindow(query.period ?? "30d", timezone);
  const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (isDay(query.from) && isDay(query.to)) {
    const from = getUTCRangeFromLocalDate(query.from!, timezone).startUTC;
    const to = getUTCRangeFromLocalDate(query.to!, timezone).startUTC;
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (days > 0 && days <= MAX_REPORT_RANGE_DAYS) return { ...w, from, to };
  }
  return { ...w, to: null as Date | null };
}

// Narrow to invoices that carry a line for one product, or for any product in
// one menu group. EXISTS keeps this a filter on invoices — a join would multiply
// an invoice by its matching lines and inflate every sum.
function itemFilter(query: { productId?: string; menuGroupId?: string }) {
  const productId = query.productId?.trim();
  const menuGroupId = Number(query.menuGroupId);
  if (productId) {
    return sql`exists (select 1 from invoice_items ii where ii.invoice_id = ${invoicesTable.id} and ii.product_id = ${productId})`;
  }
  if (Number.isFinite(menuGroupId) && menuGroupId > 0) {
    return sql`exists (select 1 from invoice_items ii join products p on p.id = ii.product_id where ii.invoice_id = ${invoicesTable.id} and p.menu_group_id = ${menuGroupId})`;
  }
  return undefined;
}

async function nextInvoiceNumber(outletId: number, type: "purchase" | "sales") {
  const prefix = type === "purchase" ? "PB" : "PJ";
  // Invoice numbers are permanent document identity: derive the year in the
  // app's zone so one issued on 31 Dec evening is not numbered into next year.
  const year = yearIn();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.outlet_id, outletId), eq(invoicesTable.type, type)));
  return `${prefix}/${year}/${String(Number(n) + 1).padStart(4, "0")}`;
}

export async function invoiceRoutes(app: FastifyInstance) {
  // ----------------------------------------------------------------- suppliers
  app.get("/api/suppliers", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "purchaseInvoice");
    if (!outlet) return;
    const rows = await db
      .select()
      .from(suppliersTable)
      .where(and(eq(suppliersTable.outlet_id, outlet.id), isNull(suppliersTable.deletedAt)))
      .orderBy(suppliersTable.name);
    return { success: true, data: rows };
  });

  app.post("/api/suppliers", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "purchaseInvoice");
    if (!outlet) return;
    const body = request.body as {
      name?: string;
      phone?: string;
      email?: string;
      address?: string;
      note?: string;
    };
    if (!body?.name?.trim()) return reply.status(400).send({ success: false, error: "Nama supplier wajib diisi" });
    const [row] = await db
      .insert(suppliersTable)
      .values({
        outlet_id: outlet.id,
        name: body.name.trim(),
        phone: body.phone ?? "",
        email: body.email ?? "",
        address: body.address ?? "",
        note: body.note ?? "",
      })
      .returning();
    return reply.status(201).send({ success: true, data: row });
  });

  app.patch("/api/suppliers/:id", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "purchaseInvoice");
    if (!outlet) return;
    const id = Number((request.params as { id: string }).id);
    const body = request.body as Partial<{ name: string; phone: string; email: string; address: string; note: string }>;
    const [row] = await db
      .update(suppliersTable)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.address !== undefined ? { address: body.address } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
      })
      .where(and(eq(suppliersTable.id, id), eq(suppliersTable.outlet_id, outlet.id)))
      .returning();
    if (!row) return reply.status(404).send({ success: false, error: "Supplier tidak ditemukan" });
    return { success: true, data: row };
  });

  app.delete("/api/suppliers/:id", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "purchaseInvoice");
    if (!outlet) return;
    const id = Number((request.params as { id: string }).id);
    const [row] = await db
      .update(suppliersTable)
      .set({ deletedAt: new Date() })
      .where(and(eq(suppliersTable.id, id), eq(suppliersTable.outlet_id, outlet.id)))
      .returning();
    if (!row) return reply.status(404).send({ success: false, error: "Supplier tidak ditemukan" });
    return { success: true };
  });

  // -------------------------------------------------------- purchase invoices
  // Without `page`/`limit` (the web's Faktur Pembelian): every invoice, as it
  // always was. With either (the Android app): one page, newest first, and the
  // sales list's extras. `q` searches the number, the supplier and party_name;
  // `status=open` is posted + partial ("Belum lunas"); `late=1` keeps the
  // overdue ones; `summary=1` adds the chip counts (for the search as typed)
  // and the outlet's hutang (everything posted and not yet paid off). Each row
  // also previews its first lines (`item_names`, `items_count`).
  app.get("/api/purchase-invoices", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "purchaseInvoice");
    if (!outlet) return;
    const { status, q, late, page, limit, summary } = request.query as {
      status?: string;
      q?: string;
      late?: string;
      page?: string;
      limit?: string;
      summary?: string;
    };

    if (page === undefined && limit === undefined) {
      const rows = await db
        .select({
          id: invoicesTable.id,
          number: invoicesTable.number,
          status: invoicesTable.status,
          supplier_id: invoicesTable.supplier_id,
          supplier_name: suppliersTable.name,
          party_name: invoicesTable.party_name,
          issue_date: invoicesTable.issue_date,
          due_date: invoicesTable.due_date,
          total: invoicesTable.total,
          amount_paid: invoicesTable.amount_paid,
        })
        .from(invoicesTable)
        .leftJoin(suppliersTable, eq(invoicesTable.supplier_id, suppliersTable.id))
        .where(
          and(
            eq(invoicesTable.outlet_id, outlet.id),
            eq(invoicesTable.type, "purchase"),
            isNull(invoicesTable.deletedAt),
            status && status !== "all" ? eq(invoicesTable.status, status as "draft" | "posted" | "partial" | "paid" | "void") : undefined,
          ),
        )
        .orderBy(desc(invoicesTable.issue_date));
      return { success: true, data: rows };
    }

    const pageN = Math.max(1, Number(page) || 1);
    const limitN = Math.min(100, Math.max(1, Number(limit) || 10));

    // Late = posted but not paid off by the end of the due date, as on sales.
    const lateCond = and(
      inArray(invoicesTable.status, ["posted", "partial"]),
      lt(invoicesTable.due_date, sql`CURRENT_DATE`),
    );
    const baseConds = [
      eq(invoicesTable.outlet_id, outlet.id),
      eq(invoicesTable.type, "purchase"),
      isNull(invoicesTable.deletedAt),
    ];
    const term = q?.trim();
    const searchCond = term
      ? or(
          ilike(invoicesTable.number, `%${term}%`),
          ilike(invoicesTable.party_name, `%${term}%`),
          ilike(suppliersTable.name, `%${term}%`),
        )
      : undefined;
    const conds = [
      ...baseConds,
      status === "open"
        ? inArray(invoicesTable.status, ["posted", "partial"])
        : status && status !== "all"
          ? eq(invoicesTable.status, status as "draft" | "posted" | "partial" | "paid" | "void")
          : undefined,
      searchCond,
      late === "1" || late === "true" ? lateCond : undefined,
    ];
    const supplierJoin = eq(invoicesTable.supplier_id, suppliersTable.id);

    const wantSummary = summary === "1" || summary === "true";
    const [rows, [{ n: count }], [lateAgg], statusCounts, openAgg] = await Promise.all([
      db
        .select({
          id: invoicesTable.id,
          number: invoicesTable.number,
          status: invoicesTable.status,
          supplier_id: invoicesTable.supplier_id,
          supplier_name: suppliersTable.name,
          party_name: invoicesTable.party_name,
          issue_date: invoicesTable.issue_date,
          due_date: invoicesTable.due_date,
          total: invoicesTable.total,
          amount_paid: invoicesTable.amount_paid,
          created_by_name: usersTable.name,
          items_count: sql<number>`(select count(*)::int from invoice_items ii where ii.invoice_id = ${invoicesTable.id})`,
          item_names: sql<string[] | null>`(select array_agg(f.description order by f.id) from (select ii.description, ii.id from invoice_items ii where ii.invoice_id = ${invoicesTable.id} order by ii.id limit 3) f)`,
        })
        .from(invoicesTable)
        .leftJoin(suppliersTable, supplierJoin)
        .leftJoin(usersTable, eq(usersTable.id, invoicesTable.created_by))
        .where(and(...conds))
        .orderBy(desc(invoicesTable.issue_date), desc(invoicesTable.id))
        .limit(limitN)
        .offset((pageN - 1) * limitN),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(invoicesTable)
        .leftJoin(suppliersTable, supplierJoin)
        .where(and(...conds)),
      db
        .select({
          n: sql<number>`count(*)::int`,
          outstanding: sql<string>`coalesce(sum(${invoicesTable.total} - ${invoicesTable.amount_paid}), 0)`,
        })
        .from(invoicesTable)
        .where(and(...baseConds, lateCond)),
      wantSummary
        ? db
            .select({
              status: invoicesTable.status,
              n: sql<number>`count(*)::int`,
              late: sql<number>`(count(*) filter (where ${lateCond!}))::int`,
            })
            .from(invoicesTable)
            .leftJoin(suppliersTable, supplierJoin)
            .where(and(...baseConds, searchCond))
            .groupBy(invoicesTable.status)
        : Promise.resolve(null),
      wantSummary
        ? db
            .select({
              n: sql<number>`count(*)::int`,
              outstanding: sql<string>`coalesce(sum(${invoicesTable.total} - ${invoicesTable.amount_paid}), 0)`,
            })
            .from(invoicesTable)
            .where(and(...baseConds, inArray(invoicesTable.status, ["posted", "partial"])))
        : Promise.resolve(null),
    ]);

    let counts: Record<string, number> | undefined;
    if (statusCounts) {
      counts = { all: 0, draft: 0, open: 0, late: 0, paid: 0, void: 0 };
      for (const row of statusCounts) {
        counts.all += row.n;
        counts.late += row.late;
        if (row.status === "posted" || row.status === "partial") counts.open += row.n;
        else counts[row.status] = (counts[row.status] ?? 0) + row.n;
      }
    }

    return {
      success: true,
      data: rows,
      count,
      late: { count: lateAgg.n, outstanding: lateAgg.outstanding },
      ...(counts ? { counts } : {}),
      ...(openAgg ? { open: { count: openAgg[0].n, outstanding: openAgg[0].outstanding } } : {}),
    };
  });

  // ---------------------------------------------- Android: the purchase form
  // What a purchase may carry, lean (the sales form's twin): every live
  // product, inventory items included, with the buying price from the product
  // form and the price it was last actually bought at (`last_price`, from the
  // newest posted purchase line), which is usually the better guess. Stock is
  // sent for tracked products: the form shows what posting will bring it to.
  app.get("/api/purchase-invoices/products", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "purchaseInvoice");
    if (!outlet) return;
    const [rows, lastRows] = await Promise.all([
      db
        .select({
          id: productsTable.id,
          name: productsTable.product_name,
          price: productsTable.price,
          buying_price: productsTable.buying_price,
          unit: productsTable.unit,
          image: productsTable.image,
          is_for_sale: productsTable.is_for_sale,
          track_stock: productsTable.track_stock,
          stock: productsTable.stock,
          barcode: productsTable.barcode,
          menu_group: menuGroupsTable.name,
        })
        .from(productsTable)
        .leftJoin(menuGroupsTable, eq(productsTable.menu_group_id, menuGroupsTable.id))
        .where(and(eq(productsTable.outlet_id, outlet.id), isNull(productsTable.deletedAt)))
        .orderBy(asc(productsTable.product_name)),
      db.execute<{ product_id: string; unit_price: string }>(sql`
        select distinct on (ii.product_id) ii.product_id, ii.unit_price
        from invoice_items ii
        join invoices i on i.id = ii.invoice_id
        where i.outlet_id = ${outlet.id} and i.type = 'purchase' and i.deleted_at is null
          and i.status in ('posted', 'partial', 'paid')
          and ii.product_id is not null
        order by ii.product_id, i.issue_date desc, ii.id desc
      `),
    ]);
    const lastPrice = new Map(lastRows.rows.map((r) => [r.product_id, r.unit_price]));
    return {
      success: true,
      data: rows.map((r) => ({ ...r, last_price: lastPrice.get(r.id) ?? null })),
    };
  });

  // The outlet's suppliers for the form's autocomplete, each with how many
  // purchases it has (void ones aside), when the last was, and what is still
  // owed to it (posted + partial). Without `q`, the most recently bought from
  // first, then the rest by name; with it, names that start with it before
  // those that merely contain it.
  app.get("/api/purchase-invoices/parties", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "purchaseInvoice");
    if (!outlet) return;
    const { q, limit } = request.query as { q?: string; limit?: string };
    const limitN = Math.min(50, Math.max(1, Number(limit) || 8));
    const term = q?.trim() ?? "";
    const rows = await db.execute<{
      id: number;
      name: string;
      phone: string | null;
      invoices: number;
      last_at: string | null;
      outstanding: string;
    }>(sql`
      select s.id, trim(s.name) as name, s.phone,
             count(i.id)::int as invoices,
             max(i.issue_date) as last_at,
             coalesce(sum(case when i.status in ('posted', 'partial') then i.total - i.amount_paid else 0 end), 0) as outstanding
      from suppliers s
      left join invoices i on i.supplier_id = s.id and i.outlet_id = s.outlet_id
        and i.type = 'purchase' and i.deleted_at is null and i.status <> 'void'
      where s.outlet_id = ${outlet.id} and s.deleted_at is null
        and trim(s.name) <> ''
        ${term ? sql`and s.name ilike ${`%${term}%`}` : sql``}
      group by s.id, s.name, s.phone
      order by ${term ? sql`(lower(trim(s.name)) like ${term.toLowerCase() + "%"}) desc,` : sql``}
               max(i.issue_date) desc nulls last, lower(trim(s.name))
      limit ${limitN}
    `);
    return { success: true, data: rows.rows };
  });

  // What to suggest on the purchase form. `popular`: what the outlet bought
  // most over the last 180 days, topped up, when purchases alone give too few,
  // with the tracked products the till used up most over the last 30 days
  // (`source: "usage"`): what runs out is what gets bought. With `supplier`:
  // that supplier's latest purchase (`last`, to repeat it) and what is usually
  // bought from it (`usual`, over its last 20, at the price last paid).
  // `exclude` leaves out the draft being edited, so it never suggests itself.
  app.get("/api/purchase-invoices/suggestions", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "purchaseInvoice");
    if (!outlet) return;
    const { supplier, exclude } = request.query as { supplier?: string; exclude?: string };
    const supplierId = Number(supplier);
    const excludeId = Number(exclude);
    const POPULAR = 12;

    type Popular = {
      product_id: string;
      name: string;
      unit: string | null;
      times: number;
      qty: string;
      last_price: string | null;
      source: "invoice" | "usage";
    };
    const popularRows = await db.execute<Omit<Popular, "source">>(sql`
      select ii.product_id, p.product_name as name, p.unit,
             count(distinct ii.invoice_id)::int as times,
             sum(ii.quantity) as qty,
             (array_agg(ii.unit_price order by i.issue_date desc, ii.id desc))[1] as last_price
      from invoice_items ii
      join invoices i on i.id = ii.invoice_id
      join products p on p.id = ii.product_id and p.deleted_at is null
      where i.outlet_id = ${outlet.id} and i.type = 'purchase' and i.deleted_at is null
        and i.status in ('posted', 'partial', 'paid')
        and i.issue_date >= now() - interval '180 days'
      group by ii.product_id, p.product_name, p.unit
      order by times desc, sum(ii.quantity) desc
      limit ${POPULAR}
    `);
    const popular: Popular[] = popularRows.rows.map((r) => ({ ...r, source: "invoice" as const }));
    if (popular.length < POPULAR) {
      // Ordered by how often, not how much: an ingredient's grams and a
      // bottle's count don't add up to anything comparable.
      const taken = popular.map((r) => r.product_id);
      const usageRows = await db.execute<Omit<Popular, "source" | "last_price">>(sql`
        select m.product_id, p.product_name as name, p.unit,
               count(*)::int as times,
               (-sum(m.qty_change))::text as qty
        from stock_movements m
        join products p on p.id = m.product_id and p.deleted_at is null and p.track_stock
        where m.outlet_id = ${outlet.id} and m.reason = 'sales' and m.qty_change < 0
          and m.created_at >= now() - interval '30 days'
          ${taken.length ? sql`and m.product_id not in (${sql.join(taken.map((t) => sql`${t}`), sql`, `)})` : sql``}
        group by m.product_id, p.product_name, p.unit
        order by times desc
        limit ${POPULAR - popular.length}
      `);
      popular.push(...usageRows.rows.map((r) => ({ ...r, last_price: null, source: "usage" as const })));
    }

    if (!(Number.isFinite(supplierId) && supplierId > 0)) {
      return { success: true, data: { popular, last: null, usual: [] } };
    }

    const supplierCond = sql`i.supplier_id = ${supplierId}`;
    const excludeCond = Number.isFinite(excludeId) && excludeId > 0 ? sql`and i.id <> ${excludeId}` : sql``;
    const lastRows = await db.execute<{
      id: number;
      number: string;
      status: string;
      issue_date: string;
      due_date: string | null;
      tax_rate: string;
      discount: string;
      total: string;
    }>(sql`
      select i.id, i.number, i.status, i.issue_date, i.due_date, i.tax_rate, i.discount, i.total
      from invoices i
      where i.outlet_id = ${outlet.id} and i.type = 'purchase' and i.deleted_at is null
        and i.status <> 'void' and ${supplierCond} ${excludeCond}
      order by i.issue_date desc, i.id desc
      limit 1
    `);
    const lastHead = lastRows.rows[0];
    const last = lastHead
      ? {
          ...lastHead,
          items: await db
            .select({
              product_id: invoiceItemsTable.product_id,
              description: invoiceItemsTable.description,
              quantity: invoiceItemsTable.quantity,
              unit_price: invoiceItemsTable.unit_price,
              discount_pct: invoiceItemsTable.discount_pct,
            })
            .from(invoiceItemsTable)
            .where(eq(invoiceItemsTable.invoice_id, lastHead.id))
            .orderBy(asc(invoiceItemsTable.id)),
        }
      : null;

    const usualRows = await db.execute<{
      product_id: string | null;
      description: string;
      times: number;
      avg_qty: string;
      last_price: string;
      last_discount_pct: string;
      last_at: string;
    }>(sql`
      with recent as (
        select i.id, i.issue_date from invoices i
        where i.outlet_id = ${outlet.id} and i.type = 'purchase' and i.deleted_at is null
          and i.status <> 'void' and ${supplierCond} ${excludeCond}
        order by i.issue_date desc, i.id desc
        limit 20
      )
      select ii.product_id,
             (array_agg(ii.description order by r.issue_date desc, ii.id desc))[1] as description,
             count(distinct ii.invoice_id)::int as times,
             round(avg(ii.quantity), 2) as avg_qty,
             (array_agg(ii.unit_price order by r.issue_date desc, ii.id desc))[1] as last_price,
             (array_agg(ii.discount_pct order by r.issue_date desc, ii.id desc))[1] as last_discount_pct,
             max(r.issue_date) as last_at
      from invoice_items ii
      join recent r on r.id = ii.invoice_id
      left join products p on p.id = ii.product_id
      where ii.product_id is null or p.deleted_at is null
      group by ii.product_id, case when ii.product_id is null then lower(trim(ii.description)) end
      order by times desc, max(r.issue_date) desc
      limit 30
    `);

    return { success: true, data: { popular, last, usual: usualRows.rows } };
  });

  app.get("/api/purchase-invoices/:id", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "purchaseInvoice");
    if (!outlet) return;
    const id = Number((request.params as { id: string }).id);
    const [invoice] = await db
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.outlet_id, outlet.id), eq(invoicesTable.type, "purchase")))
      .limit(1);
    if (!invoice)
      return reply
        .status(404)
        .send({ success: false, error: "Faktur tidak ditemukan" });
    // UoM isn't stored on the line — it belongs to the product, so it's joined
    // in rather than duplicated. Null for product-less lines (delivery, jasa).
    const items = await db
      .select({
        id: invoiceItemsTable.id,
        invoice_id: invoiceItemsTable.invoice_id,
        product_id: invoiceItemsTable.product_id,
        description: invoiceItemsTable.description,
        quantity: invoiceItemsTable.quantity,
        unit_price: invoiceItemsTable.unit_price,
        discount_pct: invoiceItemsTable.discount_pct,
        line_total: invoiceItemsTable.line_total,
        unit: productsTable.unit,
      })
      .from(invoiceItemsTable)
      .leftJoin(
        productsTable,
        eq(invoiceItemsTable.product_id, productsTable.id),
      )
      .where(eq(invoiceItemsTable.invoice_id, id));
    // Include the outlet (for the print header/logo) and the supplier (recipient).
    let supplier = null;
    if (invoice.supplier_id) {
      [supplier] = await db
        .select({ name: suppliersTable.name, phone: suppliersTable.phone, address: suppliersTable.address, email: suppliersTable.email })
        .from(suppliersTable)
        .where(eq(suppliersTable.id, invoice.supplier_id))
        .limit(1);
    }
    let created_by_name: string | null = null;
    if (invoice.created_by) {
      const [creator] = await db
        .select({ name: usersTable.name })
        .from(usersTable)
        .where(eq(usersTable.id, invoice.created_by))
        .limit(1);
      created_by_name = creator?.name ?? null;
    }
    const payments = await paymentHistory(id);
    return {
      success: true,
      data: { ...invoice, items, outlet, supplier, created_by_name, payments },
    };
  });

  app.post("/api/purchase-invoices", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "purchaseInvoice");
    if (!access) return;
    const outlet = access.outlet;
    const body = request.body as PurchaseBody;

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return reply.status(400).send({ success: false, error: "Minimal satu item" });

    const taxRate = Number(body.tax_rate ?? 0);
    const discount = Number(body.discount ?? 0);
    const taxInclusive = !!body.tax_inclusive;
    const { lines, subtotal, tax_amount, total } = computeTotals(items, taxRate, discount, taxInclusive);
    // Clamp the agreed DP to [0, total]; it's booked as a cash-out on post.
    const downPayment = Math.max(
      0,
      Math.min(Number(body.down_payment ?? 0), total),
    );
    const dpMethod = parseMethod(body.down_payment_method);

    const number = await nextInvoiceNumber(outlet.id, "purchase");

    try {
      const created = await db.transaction(async (tx) => {
        const supplierId = await resolveSupplier(tx, outlet.id, body);
        const [invoice] = await tx
          .insert(invoicesTable)
          .values({
            outlet_id: outlet.id,
            type: "purchase",
            number,
            status: "draft",
            supplier_id: supplierId,
            party_name: body.party_name ?? "",
            issue_date: body.issue_date ? new Date(body.issue_date) : new Date(),
            due_date: body.due_date ? new Date(body.due_date) : null,
            subtotal: String(subtotal),
            tax_rate: String(taxRate),
            tax_amount: String(tax_amount),
            tax_inclusive: taxInclusive,
            discount: String(discount),
            total: String(total),
            amount_paid: "0",
            created_by: access.userId,
            down_payment: String(downPayment),
            down_payment_method: dpMethod,
            notes: body.notes ?? "",
          })
          .returning();

        await tx.insert(invoiceItemsTable).values(
          items.map((it, i) => ({
            invoice_id: invoice.id,
            product_id: it.product_id ?? null,
            description: it.description ?? "",
            quantity: String(lines[i].qty),
            unit_price: String(lines[i].price),
            discount_pct: String(lines[i].discPct),
            line_total: String(lines[i].line_total),
          })),
        );
        return invoice;
      });

      return reply.status(201).send({ success: true, data: created });
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (msg.includes("BAD_SUPPLIER")) return reply.status(400).send({ success: false, error: "Supplier tidak ditemukan" });
      return reply.status(500).send({ success: false, error: msg });
    }
  });

  // Edit a draft purchase invoice (the Android form's Ubah): replace the
  // header and the lines and recompute the totals, as the sales PUT does. Only
  // a draft may change; a posted one is voided and made again instead.
  app.put("/api/purchase-invoices/:id", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "purchaseInvoice");
    if (!outlet) return;
    const id = Number((request.params as { id: string }).id);
    const body = request.body as PurchaseBody;

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return reply.status(400).send({ success: false, error: "Minimal satu item" });

    const taxRate = Number(body.tax_rate ?? 0);
    const discount = Number(body.discount ?? 0);

    try {
      const result = await db.transaction(async (tx) => {
        const [invoice] = await tx
          .select()
          .from(invoicesTable)
          .where(and(eq(invoicesTable.id, id), eq(invoicesTable.outlet_id, outlet.id), eq(invoicesTable.type, "purchase")))
          .limit(1)
          .for("update");
        if (!invoice) throw new Error("NOT_FOUND");
        if (invoice.status !== "draft") throw new Error("NOT_DRAFT");

        // Tax-inclusive pricing is whatever the draft was made with: the app's
        // form never sets it, so it is never switched off from here.
        const taxInclusive = body.tax_inclusive ?? invoice.tax_inclusive;
        const { lines, subtotal, tax_amount, total } = computeTotals(items, taxRate, discount, taxInclusive);
        const downPayment = Math.max(0, Math.min(Number(body.down_payment ?? 0), total));
        const supplierId = await resolveSupplier(tx, outlet.id, body);

        const [updated] = await tx
          .update(invoicesTable)
          .set({
            supplier_id: supplierId,
            party_name: body.party_name ?? "",
            ...(body.issue_date ? { issue_date: new Date(body.issue_date) } : {}),
            due_date: body.due_date ? new Date(body.due_date) : null,
            subtotal: String(subtotal),
            tax_rate: String(taxRate),
            tax_amount: String(tax_amount),
            tax_inclusive: taxInclusive,
            discount: String(discount),
            total: String(total),
            down_payment: String(downPayment),
            down_payment_method: parseMethod(body.down_payment_method),
            notes: body.notes ?? "",
          })
          .where(eq(invoicesTable.id, id))
          .returning();

        await tx.delete(invoiceItemsTable).where(eq(invoiceItemsTable.invoice_id, id));
        await tx.insert(invoiceItemsTable).values(
          items.map((it, i) => ({
            invoice_id: id,
            product_id: it.product_id ?? null,
            description: it.description ?? "",
            quantity: String(lines[i].qty),
            unit_price: String(lines[i].price),
            discount_pct: String(lines[i].discPct),
            line_total: String(lines[i].line_total),
          })),
        );
        return updated;
      });
      return { success: true, data: result };
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (msg.includes("NOT_FOUND")) return reply.status(404).send({ success: false, error: "Faktur tidak ditemukan" });
      if (msg.includes("NOT_DRAFT")) return reply.status(409).send({ success: false, error: "Hanya draft yang bisa diubah" });
      if (msg.includes("BAD_SUPPLIER")) return reply.status(400).send({ success: false, error: "Supplier tidak ditemukan" });
      return reply.status(500).send({ success: false, error: msg });
    }
  });

  // Post a draft: write stock-IN movements + bump products.stock. Idempotent —
  // only a draft can be posted.
  app.post("/api/purchase-invoices/:id/post", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "purchaseInvoice");
    if (!outlet) return;
    const id = Number((request.params as { id: string }).id);

    try {
      const result = await db.transaction(async (tx) => {
        const [invoice] = await tx
          .select()
          .from(invoicesTable)
          .where(and(eq(invoicesTable.id, id), eq(invoicesTable.outlet_id, outlet.id), eq(invoicesTable.type, "purchase")))
          .limit(1)
          // Locked until the transaction ends: two taps (or two devices) on the
          // same action queue up here, and the second then sees the first's
          // outcome instead of posting the same stock in twice.
          .for("update");
        if (!invoice) throw new Error("NOT_FOUND");
        if (invoice.status !== "draft") throw new Error("NOT_DRAFT");

        const items = await tx.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoice_id, id));
        for (const it of items) {
          if (!it.product_id) continue; // non-stock line
          // Skip products that don't track their own stock (recipe/service items).
          const [p] = await tx
            .select({ track_stock: productsTable.track_stock })
            .from(productsTable)
            .where(eq(productsTable.id, it.product_id))
            .limit(1);
          if (!p?.track_stock) continue;
          // Landed cost per unit: line_total already has the line discount
          // applied, so it is what the goods actually cost, not the list price.
          // This is the number the whole cost ledger is built out of.
          const qtyIn = Number(it.quantity) || 0;
          const landed = qtyIn > 0 ? Number(it.line_total) / qtyIn : Number(it.unit_price);
          await postMovement(tx, {
            outletId: outlet.id,
            productId: it.product_id,
            qtyChange: qtyIn, // positive = stock in
            reason: "purchase",
            unitCost: Number.isFinite(landed) ? landed : Number(it.unit_price) || 0,
            invoiceId: id,
          });
        }

        let [updated] = await tx
          .update(invoicesTable)
          .set({ status: "posted" })
          .where(eq(invoicesTable.id, id))
          .returning();

        if (Number(invoice.total) <= 0) {
          // Fully waived — nothing to pay out, so "posted" would otherwise
          // wait forever on a Bayar action whose amount can never be > 0.
          // Settle it the instant it posts; no cashflow row, no cash moved.
          [updated] = await tx
            .update(invoicesTable)
            .set({ status: "paid" })
            .where(eq(invoicesTable.id, id))
            .returning();
        } else {
          // Book the agreed down payment as the first cash-out. Status becomes
          // partial (or paid, if the DP covers the whole invoice).
          const dp = Math.min(Number(invoice.down_payment), Number(invoice.total));
          if (dp > 0) {
            updated = await recordPurchaseCashOut(
              tx,
              outlet.id,
              { id, total: invoice.total, amount_paid: invoice.amount_paid },
              dp,
              invoice.down_payment_method,
            );
          }
        }
        return updated;
      });
      return { success: true, data: result };
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (msg.includes("NOT_FOUND")) return reply.status(404).send({ success: false, error: "Faktur tidak ditemukan" });
      if (msg.includes("NOT_DRAFT")) return reply.status(409).send({ success: false, error: "Hanya draft yang bisa diposting" });
      return reply.status(500).send({ success: false, error: msg });
    }
  });

  // Pay (full or partial): record a cash-OUT (detail + cashFlows link) and update
  // amount_paid/status. Requires a posted/partial invoice.
  //
  // `expected_paid` (optional; the Android app sends it) works as on the sales
  // side: when what is paid already is no longer what the caller saw, the
  // payment is refused with 409 PAID_CHANGED instead of booked twice.
  app.post("/api/purchase-invoices/:id/pay", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "purchaseInvoice");
    if (!outlet) return;
    const id = Number((request.params as { id: string }).id);
    const body = request.body as { amount?: number | string; method?: string; expected_paid?: number | string };
    const method = parseMethod(body.method);
    const expectedPaid = body.expected_paid != null && body.expected_paid !== "" ? Number(body.expected_paid) : null;

    try {
      const result = await db.transaction(async (tx) => {
        const [invoice] = await tx
          .select()
          .from(invoicesTable)
          .where(and(eq(invoicesTable.id, id), eq(invoicesTable.outlet_id, outlet.id), eq(invoicesTable.type, "purchase")))
          .limit(1)
          // Locked until the transaction ends: two taps (or two devices) on the
          // same action queue up here, and the second then sees the first's
          // outcome instead of acting on the same stale row.
          .for("update");
        if (!invoice) throw new Error("NOT_FOUND");
        if (expectedPaid != null && Number.isFinite(expectedPaid) && Math.abs(Number(invoice.amount_paid) - expectedPaid) > 0.001) {
          throw new Error("PAID_CHANGED");
        }
        if (invoice.status !== "posted" && invoice.status !== "partial") throw new Error("NOT_PAYABLE");

        const total = Number(invoice.total);
        const alreadyPaid = Number(invoice.amount_paid);
        const remaining = +(total - alreadyPaid).toFixed(2);

        // Nothing left to pay out — the /post route now settles a fully
        // waived invoice immediately, but this still heals any that were
        // posted before that existed. No cashflow row: no cash moved.
        if (remaining <= 0.001) {
          const [paid] = await tx
            .update(invoicesTable)
            .set({ status: "paid" })
            .where(eq(invoicesTable.id, id))
            .returning();
          return paid;
        }

        const amount = body.amount != null ? Number(body.amount) : remaining;
        if (!(amount > 0) || amount > remaining + 0.001) throw new Error("BAD_AMOUNT");

        return recordPurchaseCashOut(tx, outlet.id, invoice, amount, method);
      });
      return { success: true, data: result };
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (msg.includes("NOT_FOUND")) return reply.status(404).send({ success: false, error: "Faktur tidak ditemukan" });
      if (msg.includes("PAID_CHANGED")) {
        return reply.status(409).send({
          success: false,
          code: "PAID_CHANGED",
          error: "Pembayaran faktur ini sudah berubah (mungkin sudah tercatat). Muat ulang dulu.",
        });
      }
      if (msg.includes("NOT_PAYABLE")) return reply.status(409).send({ success: false, error: "Faktur harus diposting dulu" });
      if (msg.includes("BAD_AMOUNT")) return reply.status(400).send({ success: false, error: "Nominal pembayaran tidak valid" });
      if (msg.includes("NO_CATEGORY")) return reply.status(500).send({ success: false, error: "Kategori kas keluar belum ada" });
      return reply.status(500).send({ success: false, error: msg });
    }
  });

  // Void: reverse stock movements (and the linked cashflow, if paid). Allowed
  // from posted/partial/paid; a draft is just deleted-equivalent (set void).
  app.post("/api/purchase-invoices/:id/void", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "purchaseInvoice");
    if (!outlet) return;
    const id = Number((request.params as { id: string }).id);

    try {
      const result = await db.transaction(async (tx) => {
        const [invoice] = await tx
          .select()
          .from(invoicesTable)
          .where(and(eq(invoicesTable.id, id), eq(invoicesTable.outlet_id, outlet.id), eq(invoicesTable.type, "purchase")))
          .limit(1)
          // Locked until the transaction ends: a second void waits here and
          // then finds it void, rather than taking the stock out twice.
          .for("update");
        if (!invoice) throw new Error("NOT_FOUND");
        if (invoice.status === "void") throw new Error("ALREADY_VOID");

        // Reverse each posted stock movement once.
        const moves = await tx
          .select()
          .from(stockMovementsTable)
          .where(and(eq(stockMovementsTable.invoice_id, id), eq(stockMovementsTable.reason, "purchase")));
        for (const m of moves) {
          await postMovement(tx, {
            outletId: outlet.id,
            productId: m.product_id,
            qtyChange: -Number(m.qty_change),
            reason: "void",
            // Take back out exactly what this purchase put in. Valuing the
            // reversal at today's average would leave the difference behind as
            // phantom value on a purchase that never happened.
            unitCost: m.unit_cost != null ? Number(m.unit_cost) : null,
            invoiceId: id,
          });
        }

        // Remove ALL payments this invoice generated (DP + installments live in
        // invoice_payments; cash_out_detail_id covers legacy single payments).
        // Null the invoice's reference FIRST so the cashOutDetail FK is free to
        // delete, then remove each cashflow effect (cashFlows before its detail).
        const payments = await tx
          .select({ detail_id: invoicePaymentsTable.cash_out_detail_id })
          .from(invoicePaymentsTable)
          .where(eq(invoicePaymentsTable.invoice_id, id));
        const detailIds = new Set(
          [...payments.map((p) => p.detail_id), invoice.cash_out_detail_id].filter(
            (v): v is number => v != null,
          ),
        );
        const [updated] = await tx
          .update(invoicesTable)
          .set({ status: "void", amount_paid: "0", cash_out_detail_id: null })
          .where(eq(invoicesTable.id, id))
          .returning();
        await tx.delete(invoicePaymentsTable).where(eq(invoicePaymentsTable.invoice_id, id));
        for (const detailId of detailIds) {
          await tx.delete(cashFlows).where(eq(cashFlows.cash_out_detail_id, detailId));
          await tx.delete(cashOutDetailTable).where(eq(cashOutDetailTable.id, detailId));
        }
        return updated;
      });
      return { success: true, data: result };
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (msg.includes("NOT_FOUND")) return reply.status(404).send({ success: false, error: "Faktur tidak ditemukan" });
      if (msg.includes("ALREADY_VOID")) return reply.status(409).send({ success: false, error: "Faktur sudah dibatalkan" });
      return reply.status(500).send({ success: false, error: msg });
    }
  });

  // ============================================================ sales invoices
  // Mirror of purchase, inverted: post = stock OUT (oversell allowed + warned),
  // pay = cash IN. Counterparty is a free-text party_name (or a linked customer).
  // Paginated list. `q` searches number + party_name; `late=1` keeps only
  // overdue invoices (billed, unsettled, due date passed). The response also
  // carries the outlet-wide late aggregates (count + outstanding) so the
  // client's warning banner doesn't depend on which page/filter is loaded.
  //
  // For the Android app: `status=open` is every billed, unsettled invoice
  // (posted + partial, "Belum lunas"), and `summary=1` adds the chip counts
  // (per status, for the search as typed) and the outlet-wide receivable
  // (piutang). Each row also previews its first lines (`item_names`,
  // `items_count`), so a card can say what was sold without opening it.
  app.get("/api/sales-invoices", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "salesInvoice");
    if (!outlet) return;
    const { status, q, late, page, limit, summary } = request.query as {
      status?: string;
      q?: string;
      late?: string;
      page?: string;
      limit?: string;
      summary?: string;
    };
    const pageN = Math.max(1, Number(page) || 1);
    const limitN = Math.min(100, Math.max(1, Number(limit) || 10));

    // Late = billed but not settled by the end of the due date, i.e. late
    // starting the day AFTER due_date (due dates are stored at midnight).
    const lateCond = and(
      inArray(invoicesTable.status, ["posted", "partial"]),
      lt(invoicesTable.due_date, sql`CURRENT_DATE`),
    );

    const baseConds = [
      eq(invoicesTable.outlet_id, outlet.id),
      eq(invoicesTable.type, "sales"),
      isNull(invoicesTable.deletedAt),
    ];
    const searchCond = q?.trim()
      ? or(
          ilike(invoicesTable.number, `%${q.trim()}%`),
          ilike(invoicesTable.party_name, `%${q.trim()}%`),
        )
      : undefined;
    const conds = [
      ...baseConds,
      status === "open"
        ? inArray(invoicesTable.status, ["posted", "partial"])
        : status && status !== "all"
          ? eq(invoicesTable.status, status as "draft" | "posted" | "partial" | "paid" | "void")
          : undefined,
      searchCond,
      late === "1" || late === "true" ? lateCond : undefined,
    ];

    const wantSummary = summary === "1" || summary === "true";
    const [rows, [{ n: count }], [lateAgg], statusCounts, openAgg] = await Promise.all([
      db
        .select({
          id: invoicesTable.id,
          number: invoicesTable.number,
          status: invoicesTable.status,
          party_name: invoicesTable.party_name,
          issue_date: invoicesTable.issue_date,
          due_date: invoicesTable.due_date,
          total: invoicesTable.total,
          amount_paid: invoicesTable.amount_paid,
          created_by_name: usersTable.name,
          items_count: sql<number>`(select count(*)::int from invoice_items ii where ii.invoice_id = ${invoicesTable.id})`,
          item_names: sql<string[] | null>`(select array_agg(f.description order by f.id) from (select ii.description, ii.id from invoice_items ii where ii.invoice_id = ${invoicesTable.id} order by ii.id limit 3) f)`,
        })
        .from(invoicesTable)
        .leftJoin(usersTable, eq(usersTable.id, invoicesTable.created_by))
        .where(and(...conds))
        .orderBy(desc(invoicesTable.issue_date), desc(invoicesTable.id))
        .limit(limitN)
        .offset((pageN - 1) * limitN),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(invoicesTable)
        .where(and(...conds)),
      db
        .select({
          n: sql<number>`count(*)::int`,
          outstanding: sql<string>`coalesce(sum(${invoicesTable.total} - ${invoicesTable.amount_paid}), 0)`,
        })
        .from(invoicesTable)
        .where(and(...baseConds, lateCond)),
      wantSummary
        ? db
            .select({
              status: invoicesTable.status,
              n: sql<number>`count(*)::int`,
              late: sql<number>`(count(*) filter (where ${lateCond!}))::int`,
            })
            .from(invoicesTable)
            .where(and(...baseConds, searchCond))
            .groupBy(invoicesTable.status)
        : Promise.resolve(null),
      wantSummary
        ? db
            .select({
              n: sql<number>`count(*)::int`,
              outstanding: sql<string>`coalesce(sum(${invoicesTable.total} - ${invoicesTable.amount_paid}), 0)`,
            })
            .from(invoicesTable)
            .where(and(...baseConds, inArray(invoicesTable.status, ["posted", "partial"])))
        : Promise.resolve(null),
    ]);

    let counts: Record<string, number> | undefined;
    if (statusCounts) {
      counts = { all: 0, draft: 0, open: 0, late: 0, paid: 0, void: 0 };
      for (const row of statusCounts) {
        counts.all += row.n;
        counts.late += row.late;
        if (row.status === "posted" || row.status === "partial") counts.open += row.n;
        else counts[row.status] = (counts[row.status] ?? 0) + row.n;
      }
    }

    return {
      success: true,
      data: rows,
      count,
      late: { count: lateAgg.n, outstanding: lateAgg.outstanding },
      ...(counts ? { counts } : {}),
      ...(openAgg ? { open: { count: openAgg[0].n, outstanding: openAgg[0].outstanding } } : {}),
    };
  });

  // ------------------------------------------------- Android: the create form
  // The products a sales invoice may carry, lean: no add-ons, costs or recipes
  // (unlike /api/products/mine, which feeds the till). Inventory-only items are
  // in it too — a faktur can sell what the till never does. Stock is sent for
  // tracked products so the picker can warn before posting oversells.
  app.get("/api/sales-invoices/products", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "salesInvoice");
    if (!outlet) return;
    const rows = await db
      .select({
        id: productsTable.id,
        name: productsTable.product_name,
        price: productsTable.price,
        unit: productsTable.unit,
        image: productsTable.image,
        is_for_sale: productsTable.is_for_sale,
        track_stock: productsTable.track_stock,
        stock: productsTable.stock,
        barcode: productsTable.barcode,
        menu_group: menuGroupsTable.name,
      })
      .from(productsTable)
      .leftJoin(menuGroupsTable, eq(productsTable.menu_group_id, menuGroupsTable.id))
      .where(and(eq(productsTable.outlet_id, outlet.id), isNull(productsTable.deletedAt)))
      .orderBy(asc(productsTable.product_name));
    return { success: true, data: rows };
  });

  // Customers this outlet has invoiced before, for the form's autocomplete.
  // party_name is free text, so one customer typed "Toko Sinar" and "toko sinar "
  // is grouped as one, shown under its latest spelling. Without `q`, the most
  // recently invoiced first; with it, names that start with it before those
  // that merely contain it. Each carries how often it was invoiced, when last,
  // and what it still owes (posted + partial).
  app.get("/api/sales-invoices/parties", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "salesInvoice");
    if (!outlet) return;
    const { q, limit } = request.query as { q?: string; limit?: string };
    const limitN = Math.min(50, Math.max(1, Number(limit) || 8));
    const term = q?.trim() ?? "";
    const key = sql`lower(trim(${invoicesTable.party_name}))`;
    const rows = await db
      .select({
        name: sql<string>`(array_agg(trim(${invoicesTable.party_name}) order by ${invoicesTable.issue_date} desc, ${invoicesTable.id} desc))[1]`,
        invoices: sql<number>`count(*)::int`,
        last_at: sql<string>`max(${invoicesTable.issue_date})`,
        outstanding: sql<string>`coalesce(sum(case when ${invoicesTable.status} in ('posted', 'partial') then ${invoicesTable.total} - ${invoicesTable.amount_paid} else 0 end), 0)`,
      })
      .from(invoicesTable)
      .where(
        and(
          eq(invoicesTable.outlet_id, outlet.id),
          eq(invoicesTable.type, "sales"),
          isNull(invoicesTable.deletedAt),
          sql`${invoicesTable.status} <> 'void'`,
          sql`trim(coalesce(${invoicesTable.party_name}, '')) <> ''`,
          term ? ilike(invoicesTable.party_name, `%${term}%`) : undefined,
        ),
      )
      .groupBy(key)
      .orderBy(
        ...(term ? [sql`(${key} like ${term.toLowerCase() + "%"}) desc`] : []),
        sql`max(${invoicesTable.issue_date}) desc`,
      )
      .limit(limitN);
    return { success: true, data: rows };
  });

  // What to suggest on the form. `popular`: the outlet's best sellers on sales
  // invoices over the last 180 days, topped up from the till's last 30 days
  // when invoices alone give too few. With `party`: that customer's latest
  // invoice (`last`, to repeat it) and the items they usually take (`usual`,
  // over their last 20 invoices, with the price they were last given).
  // `exclude` leaves out the draft being edited, so it never suggests itself.
  app.get("/api/sales-invoices/suggestions", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "salesInvoice");
    if (!outlet) return;
    const { party, exclude } = request.query as { party?: string; exclude?: string };
    const partyKey = party?.trim().toLowerCase() ?? "";
    const excludeId = Number(exclude);
    const POPULAR = 12;

    type Popular = {
      product_id: string;
      name: string;
      unit: string | null;
      times: number;
      qty: string;
      last_price: string | null;
      source: "invoice" | "till";
    };
    const popularRows = await db.execute<Omit<Popular, "source">>(sql`
      select ii.product_id, p.product_name as name, p.unit,
             count(distinct ii.invoice_id)::int as times,
             sum(ii.quantity) as qty,
             (array_agg(ii.unit_price order by i.issue_date desc, ii.id desc))[1] as last_price
      from invoice_items ii
      join invoices i on i.id = ii.invoice_id
      join products p on p.id = ii.product_id and p.deleted_at is null
      where i.outlet_id = ${outlet.id} and i.type = 'sales' and i.deleted_at is null
        and i.status in ('posted', 'partial', 'paid')
        and i.issue_date >= now() - interval '180 days'
      group by ii.product_id, p.product_name, p.unit
      order by times desc, sum(ii.quantity) desc
      limit ${POPULAR}
    `);
    const popular: Popular[] = popularRows.rows.map((r) => ({ ...r, source: "invoice" as const }));
    if (popular.length < POPULAR) {
      // Add-on lines are children of a dish, not something a customer orders
      // on its own: parents only, as every item count in the app does.
      const taken = popular.map((r) => r.product_id);
      const tillRows = await db.execute<Omit<Popular, "source" | "last_price">>(sql`
        select od.product_id, p.product_name as name, p.unit,
               count(distinct od.order_id)::int as times,
               sum(od.quantity)::text as qty
        from "orderDetails" od
        join orders o on o.id = od.order_id
        join products p on p.id = od.product_id and p.deleted_at is null
        where o.outlet_id = ${outlet.id} and o.status <> 'cancelled'
          and od.parent_detail_id is null
          and o.created_at >= now() - interval '30 days'
          ${taken.length ? sql`and od.product_id not in (${sql.join(taken.map((t) => sql`${t}`), sql`, `)})` : sql``}
        group by od.product_id, p.product_name, p.unit
        order by times desc, sum(od.quantity) desc
        limit ${POPULAR - popular.length}
      `);
      popular.push(...tillRows.rows.map((r) => ({ ...r, last_price: null, source: "till" as const })));
    }

    if (!partyKey) return { success: true, data: { popular, last: null, usual: [] } };

    const partyCond = sql`lower(trim(i.party_name)) = ${partyKey}`;
    const excludeCond = Number.isFinite(excludeId) && excludeId > 0 ? sql`and i.id <> ${excludeId}` : sql``;
    const lastRows = await db.execute<{
      id: number;
      number: string;
      status: string;
      issue_date: string;
      due_date: string | null;
      tax_rate: string;
      discount: string;
      total: string;
    }>(sql`
      select i.id, i.number, i.status, i.issue_date, i.due_date, i.tax_rate, i.discount, i.total
      from invoices i
      where i.outlet_id = ${outlet.id} and i.type = 'sales' and i.deleted_at is null
        and i.status <> 'void' and ${partyCond} ${excludeCond}
      order by i.issue_date desc, i.id desc
      limit 1
    `);
    const lastHead = lastRows.rows[0];
    const last = lastHead
      ? {
          ...lastHead,
          items: await db
            .select({
              product_id: invoiceItemsTable.product_id,
              description: invoiceItemsTable.description,
              quantity: invoiceItemsTable.quantity,
              unit_price: invoiceItemsTable.unit_price,
              discount_pct: invoiceItemsTable.discount_pct,
            })
            .from(invoiceItemsTable)
            .where(eq(invoiceItemsTable.invoice_id, lastHead.id))
            .orderBy(asc(invoiceItemsTable.id)),
        }
      : null;

    const usualRows = await db.execute<{
      product_id: string | null;
      description: string;
      times: number;
      avg_qty: string;
      last_price: string;
      last_discount_pct: string;
      last_at: string;
    }>(sql`
      with recent as (
        select i.id, i.issue_date from invoices i
        where i.outlet_id = ${outlet.id} and i.type = 'sales' and i.deleted_at is null
          and i.status <> 'void' and ${partyCond} ${excludeCond}
        order by i.issue_date desc, i.id desc
        limit 20
      )
      select ii.product_id,
             (array_agg(ii.description order by r.issue_date desc, ii.id desc))[1] as description,
             count(distinct ii.invoice_id)::int as times,
             round(avg(ii.quantity), 2) as avg_qty,
             (array_agg(ii.unit_price order by r.issue_date desc, ii.id desc))[1] as last_price,
             (array_agg(ii.discount_pct order by r.issue_date desc, ii.id desc))[1] as last_discount_pct,
             max(r.issue_date) as last_at
      from invoice_items ii
      join recent r on r.id = ii.invoice_id
      left join products p on p.id = ii.product_id
      where ii.product_id is null or p.deleted_at is null
      group by ii.product_id, case when ii.product_id is null then lower(trim(ii.description)) end
      order by times desc, max(r.issue_date) desc
      limit 30
    `);

    return { success: true, data: { popular, last, usual: usualRows.rows } };
  });

  app.get("/api/sales-invoices/:id", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "salesInvoice");
    if (!outlet) return;
    const id = Number((request.params as { id: string }).id);
    const [invoice] = await db
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.outlet_id, outlet.id), eq(invoicesTable.type, "sales")))
      .limit(1);
    if (!invoice) return reply.status(404).send({ success: false, error: "Faktur tidak ditemukan" });
    const items = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoice_id, id));
    let created_by_name: string | null = null;
    if (invoice.created_by) {
      const [creator] = await db
        .select({ name: usersTable.name })
        .from(usersTable)
        .where(eq(usersTable.id, invoice.created_by))
        .limit(1);
      created_by_name = creator?.name ?? null;
    }
    const payments = await paymentHistory(id);
    return {
      success: true,
      data: { ...invoice, items, outlet, created_by_name, payments },
    };
  });

  app.post("/api/sales-invoices", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "salesInvoice");
    if (!access) return;
    const outlet = access.outlet;
    const body = request.body as {
      customer_id?: number | null;
      party_name?: string;
      issue_date?: string;
      due_date?: string;
      tax_rate?: number | string;
      discount?: number | string;
      down_payment?: number | string;
      down_payment_method?: string;
      notes?: string;
      items?: ItemInput[];
    };

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return reply.status(400).send({ success: false, error: "Minimal satu item" });
    const zeroPriceError = rejectZeroPriceLines(items);
    if (zeroPriceError) return reply.status(400).send({ success: false, error: zeroPriceError });

    const taxRate = Number(body.tax_rate ?? 0);
    const discount = Number(body.discount ?? 0);
    const { lines, subtotal, tax_amount, total } = computeTotals(items, taxRate, discount, false);
    // Clamp the agreed DP to [0, total]; it's booked as a payment on post.
    const downPayment = Math.max(
      0,
      Math.min(Number(body.down_payment ?? 0), total),
    );
    const dpMethod = parseMethod(body.down_payment_method);
    const number = await nextInvoiceNumber(outlet.id, "sales");

    const created = await db.transaction(async (tx) => {
      const [invoice] = await tx
        .insert(invoicesTable)
        .values({
          outlet_id: outlet.id,
          type: "sales",
          number,
          status: "draft",
          customer_id: body.customer_id ?? null,
          party_name: body.party_name ?? "",
          issue_date: body.issue_date ? new Date(body.issue_date) : new Date(),
          due_date: body.due_date ? new Date(body.due_date) : null,
          subtotal: String(subtotal),
          tax_rate: String(taxRate),
          tax_amount: String(tax_amount),
          tax_inclusive: false,
          discount: String(discount),
          total: String(total),
          amount_paid: "0",
          created_by: access.userId,
          down_payment: String(downPayment),
          down_payment_method: dpMethod,
          notes: body.notes ?? "",
        })
        .returning();

      await tx.insert(invoiceItemsTable).values(
        items.map((it, i) => ({
          invoice_id: invoice.id,
          product_id: it.product_id ?? null,
          description: it.description ?? "",
          quantity: String(lines[i].qty),
          unit_price: String(lines[i].price),
          discount_pct: String(lines[i].discPct),
          line_total: String(lines[i].line_total),
        })),
      );
      return invoice;
    });

    return reply.status(201).send({ success: true, data: created });
  });

  // Edit a draft sales invoice: replace header fields + line items and recompute
  // totals. Only a draft may be edited (posted/paid invoices are immutable —
  // void and recreate instead).
  app.put("/api/sales-invoices/:id", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "salesInvoice");
    if (!outlet) return;
    const id = Number((request.params as { id: string }).id);
    const body = request.body as {
      customer_id?: number | null;
      party_name?: string;
      issue_date?: string;
      due_date?: string;
      tax_rate?: number | string;
      discount?: number | string;
      down_payment?: number | string;
      down_payment_method?: string;
      notes?: string;
      items?: ItemInput[];
    };

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return reply.status(400).send({ success: false, error: "Minimal satu item" });
    const zeroPriceError = rejectZeroPriceLines(items);
    if (zeroPriceError) return reply.status(400).send({ success: false, error: zeroPriceError });

    const taxRate = Number(body.tax_rate ?? 0);
    const discount = Number(body.discount ?? 0);
    const { lines, subtotal, tax_amount, total } = computeTotals(
      items,
      taxRate,
      discount,
      false,
    );
    const downPayment = Math.max(
      0,
      Math.min(Number(body.down_payment ?? 0), total),
    );
    const dpMethod = parseMethod(body.down_payment_method);

    try {
      const result = await db.transaction(async (tx) => {
        const [invoice] = await tx
          .select()
          .from(invoicesTable)
          .where(and(eq(invoicesTable.id, id), eq(invoicesTable.outlet_id, outlet.id), eq(invoicesTable.type, "sales")))
          .limit(1);
        if (!invoice) throw new Error("NOT_FOUND");
        if (invoice.status !== "draft") throw new Error("NOT_DRAFT");

        const [updated] = await tx
          .update(invoicesTable)
          .set({
            customer_id: body.customer_id ?? null,
            party_name: body.party_name ?? "",
            ...(body.issue_date ? { issue_date: new Date(body.issue_date) } : {}),
            due_date: body.due_date ? new Date(body.due_date) : null,
            subtotal: String(subtotal),
            tax_rate: String(taxRate),
            tax_amount: String(tax_amount),
            discount: String(discount),
            total: String(total),
            down_payment: String(downPayment),
            down_payment_method: dpMethod,
            notes: body.notes ?? "",
          })
          .where(eq(invoicesTable.id, id))
          .returning();

        await tx.delete(invoiceItemsTable).where(eq(invoiceItemsTable.invoice_id, id));
        await tx.insert(invoiceItemsTable).values(
          items.map((it, i) => ({
            invoice_id: id,
            product_id: it.product_id ?? null,
            description: it.description ?? "",
            quantity: String(lines[i].qty),
            unit_price: String(lines[i].price),
            discount_pct: String(lines[i].discPct),
            line_total: String(lines[i].line_total),
          })),
        );
        return updated;
      });
      return { success: true, data: result };
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (msg.includes("NOT_FOUND")) return reply.status(404).send({ success: false, error: "Faktur tidak ditemukan" });
      if (msg.includes("NOT_DRAFT")) return reply.status(409).send({ success: false, error: "Hanya draft yang bisa diubah" });
      return reply.status(500).send({ success: false, error: msg });
    }
  });

  // Post: stock OUT. Overselling is allowed but reported in `warnings`.
  app.post("/api/sales-invoices/:id/post", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "salesInvoice");
    if (!outlet) return;
    const id = Number((request.params as { id: string }).id);
    try {
      const result = await db.transaction(async (tx) => {
        const [invoice] = await tx
          .select()
          .from(invoicesTable)
          .where(and(eq(invoicesTable.id, id), eq(invoicesTable.outlet_id, outlet.id), eq(invoicesTable.type, "sales")))
          .limit(1)
          // Locked until the transaction ends: two taps (or two devices) on the
          // same action queue up here, and the second then sees the first's
          // outcome instead of acting on the same stale row.
          .for("update");
        if (!invoice) throw new Error("NOT_FOUND");
        if (invoice.status !== "draft") throw new Error("NOT_DRAFT");

        const items = await tx.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoice_id, id));
        const warnings: string[] = [];
        for (const it of items) {
          if (!it.product_id) continue;
          // Own stock for track_stock products, ingredient stock for recipe
          // products; movements carry invoice_id so void can reverse them.
          warnings.push(
            ...(await applySaleStockOut(tx, {
              outletId: outlet.id,
              productId: it.product_id,
              qty: Number(it.quantity),
              invoiceId: id,
            })),
          );
        }

        let [updated] = await tx
          .update(invoicesTable)
          .set({ status: "posted" })
          .where(eq(invoicesTable.id, id))
          .returning();

        if (Number(invoice.total) <= 0) {
          // Fully waived (every line 100%-discounted, or an invoice-level
          // discount that ate the whole subtotal): there is nothing to
          // collect, so "posted" would otherwise wait forever on a Bayar
          // action whose amount can never be > 0. Settle it the instant it
          // posts — no cashflow row, because no cash moved.
          [updated] = await tx
            .update(invoicesTable)
            .set({ status: "paid" })
            .where(eq(invoicesTable.id, id))
            .returning();
        } else {
          // Book the agreed down payment as the first payment. Status becomes
          // partial (or paid, if the DP covers the whole invoice).
          const dp = Math.min(Number(invoice.down_payment), Number(invoice.total));
          if (dp > 0) {
            updated = await recordSalesCashIn(
              tx,
              outlet.id,
              { id, total: invoice.total, amount_paid: invoice.amount_paid },
              dp,
              invoice.down_payment_method,
            );
          }
        }
        return { updated, warnings };
      });
      return { success: true, data: result.updated, warnings: result.warnings };
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (msg.includes("NOT_FOUND")) return reply.status(404).send({ success: false, error: "Faktur tidak ditemukan" });
      if (msg.includes("NOT_DRAFT")) return reply.status(409).send({ success: false, error: "Hanya draft yang bisa diposting" });
      return reply.status(500).send({ success: false, error: msg });
    }
  });

  // Pay: record cash IN (detail + cashFlows) and update amount_paid/status.
  //
  // `expected_paid` (optional; the Android app sends it) is what the caller saw
  // already paid when it opened the payment form. When the invoice has moved
  // on since — this very payment landed but its answer was lost and the app is
  // trying again, or another device took a payment meanwhile — the request is
  // refused with 409 PAID_CHANGED rather than booking the money twice.
  app.post("/api/sales-invoices/:id/pay", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "salesInvoice");
    if (!outlet) return;
    const id = Number((request.params as { id: string }).id);
    const body = request.body as { amount?: number | string; method?: string; expected_paid?: number | string };
    const method = parseMethod(body.method);
    const expectedPaid = body.expected_paid != null && body.expected_paid !== "" ? Number(body.expected_paid) : null;
    try {
      const result = await db.transaction(async (tx) => {
        const [invoice] = await tx
          .select()
          .from(invoicesTable)
          .where(and(eq(invoicesTable.id, id), eq(invoicesTable.outlet_id, outlet.id), eq(invoicesTable.type, "sales")))
          .limit(1)
          // Locked until the transaction ends: two taps (or two devices) on the
          // same action queue up here, and the second then sees the first's
          // outcome instead of acting on the same stale row.
          .for("update");
        if (!invoice) throw new Error("NOT_FOUND");
        if (expectedPaid != null && Number.isFinite(expectedPaid) && Math.abs(Number(invoice.amount_paid) - expectedPaid) > 0.001) {
          throw new Error("PAID_CHANGED");
        }
        if (invoice.status !== "posted" && invoice.status !== "partial") throw new Error("NOT_PAYABLE");

        const total = Number(invoice.total);
        const alreadyPaid = Number(invoice.amount_paid);
        const remaining = +(total - alreadyPaid).toFixed(2);

        // Nothing left to collect — the /post route now settles a fully
        // waived invoice immediately, but this still heals any that were
        // posted before that existed. No cashflow row: no cash moved.
        if (remaining <= 0.001) {
          const [paid] = await tx
            .update(invoicesTable)
            .set({ status: "paid" })
            .where(eq(invoicesTable.id, id))
            .returning();
          return paid;
        }

        const amount = body.amount != null ? Number(body.amount) : remaining;
        if (!(amount > 0) || amount > remaining + 0.001) throw new Error("BAD_AMOUNT");

        return recordSalesCashIn(tx, outlet.id, invoice, amount, method);
      });
      return { success: true, data: result };
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (msg.includes("NOT_FOUND")) return reply.status(404).send({ success: false, error: "Faktur tidak ditemukan" });
      if (msg.includes("PAID_CHANGED")) {
        return reply.status(409).send({
          success: false,
          code: "PAID_CHANGED",
          error: "Pembayaran faktur ini sudah berubah (mungkin sudah tercatat). Muat ulang dulu.",
        });
      }
      if (msg.includes("NOT_PAYABLE")) return reply.status(409).send({ success: false, error: "Faktur harus diposting dulu" });
      if (msg.includes("BAD_AMOUNT")) return reply.status(400).send({ success: false, error: "Nominal pembayaran tidak valid" });
      return reply.status(500).send({ success: false, error: msg });
    }
  });

  // Void: restore stock (reverse the OUT movements) and remove the cash-IN.
  app.post("/api/sales-invoices/:id/void", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "salesInvoice");
    if (!outlet) return;
    const id = Number((request.params as { id: string }).id);
    try {
      const result = await db.transaction(async (tx) => {
        const [invoice] = await tx
          .select()
          .from(invoicesTable)
          .where(and(eq(invoicesTable.id, id), eq(invoicesTable.outlet_id, outlet.id), eq(invoicesTable.type, "sales")))
          .limit(1)
          // Locked until the transaction ends: two taps (or two devices) on the
          // same action queue up here, and the second then sees the first's
          // outcome instead of acting on the same stale row.
          .for("update");
        if (!invoice) throw new Error("NOT_FOUND");
        if (invoice.status === "void") throw new Error("ALREADY_VOID");

        const moves = await tx
          .select()
          .from(stockMovementsTable)
          .where(and(eq(stockMovementsTable.invoice_id, id), eq(stockMovementsTable.reason, "sales")));
        for (const m of moves) {
          await postMovement(tx, {
            outletId: outlet.id,
            productId: m.product_id,
            qtyChange: -Number(m.qty_change), // reverse the OUT (back IN)
            reason: "void",
            // Restore the cost this sale consumed, so the void cancels the COGS
            // it booked instead of booking a second, differently-priced one.
            unitCost: m.unit_cost != null ? Number(m.unit_cost) : null,
            invoiceId: id,
          });
        }

        // Remove ALL payments this invoice generated (DP + installments live in
        // invoice_payments; cash_in_detail_id covers legacy single payments).
        const payments = await tx
          .select({ detail_id: invoicePaymentsTable.cash_in_detail_id })
          .from(invoicePaymentsTable)
          .where(eq(invoicePaymentsTable.invoice_id, id));
        const detailIds = new Set(
          [...payments.map((p) => p.detail_id), invoice.cash_in_detail_id].filter(
            (v): v is number => v != null,
          ),
        );
        const [updated] = await tx
          .update(invoicesTable)
          .set({ status: "void", amount_paid: "0", cash_in_detail_id: null })
          .where(eq(invoicesTable.id, id))
          .returning();
        await tx.delete(invoicePaymentsTable).where(eq(invoicePaymentsTable.invoice_id, id));
        for (const detailId of detailIds) {
          await tx.delete(cashFlows).where(eq(cashFlows.cash_in_detail_id, detailId));
          await tx.delete(cashInDetailTable).where(eq(cashInDetailTable.id, detailId));
        }
        return updated;
      });
      return { success: true, data: result };
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (msg.includes("NOT_FOUND")) return reply.status(404).send({ success: false, error: "Faktur tidak ditemukan" });
      if (msg.includes("ALREADY_VOID")) return reply.status(409).send({ success: false, error: "Faktur sudah dibatalkan" });
      return reply.status(500).send({ success: false, error: msg });
    }
  });

  // ============================================================ invoice report
  // KPIs for the "Laporan Faktur" page, covering BOTH invoice types.
  // "Billed" = posted/partial/paid (drafts and voids don't count as sales).
  // Period (by issue_date) applies to the billed KPIs; outstanding (piutang/
  // hutang) and late are point-in-time; trend is always the last 6 months.
  app.get("/api/invoices/report", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "reports");
    if (!outlet) return;
    const q = request.query as {
      period?: string;
      from?: string;
      to?: string;
      timezone?: string;
      productId?: string;
      menuGroupId?: string;
    };
    const { period = "30d" } = q;
    const timezone = q.timezone || "Asia/Jakarta";
    const { from, to, localYear, localMonth, monthsAgoStart } = rangeWindow(q, timezone);
    // `to` is exclusive, so lt() is what makes the last day inclusive.
    const inWindow = (col: AnyColumn) =>
      to ? and(gte(col, from), lt(col, to)) : gte(col, from);
    const item = itemFilter(q);

    const BILLED = ["posted", "partial", "paid"] as const;
    const OPEN = ["posted", "partial"] as const;
    const base = [
      eq(invoicesTable.outlet_id, outlet.id),
      isNull(invoicesTable.deletedAt),
      ...(item ? [item] : []),
    ];
    const remainingSql = sql<string>`coalesce(sum(${invoicesTable.total} - ${invoicesTable.amount_paid}), 0)`;

    const trendStart = monthsAgoStart(5);
    // Everything below runs on the capped reports pool, so "busy" and "too
    // slow" are expected outcomes, not bugs — loadFailure turns both into a 503
    // the owner can act on. See reportDb in db/index.ts.
    try {
      const [kpiRows, openRows, lateRows, trendRows, topSales, topPurchase] =
        await Promise.all([
          // Billed in the selected period.
          reportDb
            .select({
              type: invoicesTable.type,
              count: sql<number>`count(*)::int`,
              total: sql<string>`coalesce(sum(${invoicesTable.total}), 0)`,
              paid: sql<string>`coalesce(sum(${invoicesTable.amount_paid}), 0)`,
            })
            .from(invoicesTable)
            .where(
              and(
                ...base,
                inArray(invoicesTable.status, [...BILLED]),
                inWindow(invoicesTable.issue_date),
              ),
            )
            .groupBy(invoicesTable.type),
          // Open balance right now (piutang for sales, hutang for purchase).
          reportDb
            .select({
              type: invoicesTable.type,
              count: sql<number>`count(*)::int`,
              outstanding: remainingSql,
            })
            .from(invoicesTable)
            .where(and(...base, inArray(invoicesTable.status, [...OPEN])))
            .groupBy(invoicesTable.type),
          // The overdue slice of that open balance.
          reportDb
            .select({
              type: invoicesTable.type,
              count: sql<number>`count(*)::int`,
              outstanding: remainingSql,
            })
            .from(invoicesTable)
            .where(
              and(
                ...base,
                inArray(invoicesTable.status, [...OPEN]),
                lt(invoicesTable.due_date, sql`CURRENT_DATE`),
              ),
            )
            .groupBy(invoicesTable.type),
          // Billed totals per month, last 6 months.
          reportDb
            .select({
              type: invoicesTable.type,
              // issue_date is timestamptz, so date_trunc would bucket by the session
              // TimeZone (UTC on the server). Convert to local time first, else an
              // invoice issued late on the 31st lands in the following month.
              month: sql<string>`to_char(date_trunc('month', ${invoicesTable.issue_date} AT TIME ZONE ${timezone}), 'YYYY-MM')`,
              total: sql<string>`coalesce(sum(${invoicesTable.total}), 0)`,
            })
            .from(invoicesTable)
            .where(
              and(
                ...base,
                inArray(invoicesTable.status, [...BILLED]),
                gte(invoicesTable.issue_date, trendStart),
              ),
            )
            .groupBy(invoicesTable.type, sql`2`),
          // Largest open invoices per side, for the follow-up lists.
          reportDb
            .select({
              id: invoicesTable.id,
              number: invoicesTable.number,
              party_name: invoicesTable.party_name,
              due_date: invoicesTable.due_date,
              total: invoicesTable.total,
              amount_paid: invoicesTable.amount_paid,
              status: invoicesTable.status,
            })
            .from(invoicesTable)
            .where(
              and(
                ...base,
                eq(invoicesTable.type, "sales"),
                inArray(invoicesTable.status, [...OPEN]),
              ),
            )
            .orderBy(
              desc(sql`${invoicesTable.total} - ${invoicesTable.amount_paid}`),
            )
            .limit(8),
          reportDb
            .select({
              id: invoicesTable.id,
              number: invoicesTable.number,
              party_name: sql<string>`coalesce(nullif(${invoicesTable.party_name}, ''), ${suppliersTable.name}, '')`,
              due_date: invoicesTable.due_date,
              total: invoicesTable.total,
              amount_paid: invoicesTable.amount_paid,
              status: invoicesTable.status,
            })
            .from(invoicesTable)
            .leftJoin(
              suppliersTable,
              eq(invoicesTable.supplier_id, suppliersTable.id),
            )
            .where(
              and(
                ...base,
                eq(invoicesTable.type, "purchase"),
                inArray(invoicesTable.status, [...OPEN]),
              ),
            )
            .orderBy(
              desc(sql`${invoicesTable.total} - ${invoicesTable.amount_paid}`),
            )
            .limit(8),
        ]);

      const side = (type: "sales" | "purchase", top: typeof topSales) => {
        const kpi = kpiRows.find((r) => r.type === type);
        const open = openRows.find((r) => r.type === type);
        const late = lateRows.find((r) => r.type === type);
        return {
          billed_count: kpi?.count ?? 0,
          billed_total: Number(kpi?.total ?? 0),
          paid_total: Number(kpi?.paid ?? 0),
          outstanding_count: open?.count ?? 0,
          outstanding: Number(open?.outstanding ?? 0),
          late_count: late?.count ?? 0,
          late_outstanding: Number(late?.outstanding ?? 0),
          top_outstanding: top,
        };
      };

      // Assemble a dense 6-month series (months with no invoices stay 0).
      const byKey = new Map(
        trendRows.map((r) => [`${r.type}:${r.month}`, Number(r.total)]),
      );
      const trend = Array.from({ length: 6 }, (_, i) => {
        // Built in UTC purely as a calendar cursor over localYear/localMonth — the
        // keys must match the local-time buckets the SQL above produces.
        const d = new Date(Date.UTC(localYear, localMonth - 1 - 5 + i, 1));
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        return {
          month: d.toLocaleString("id-ID", { month: "short", timeZone: "UTC" }),
          sales: byKey.get(`sales:${key}`) ?? 0,
          purchase: byKey.get(`purchase:${key}`) ?? 0,
        };
      });

      return {
        success: true,
        period,
        from: from.toISOString(),
        to: to?.toISOString() ?? null,
        sales: side("sales", topSales),
        purchase: side("purchase", topPurchase),
        trend,
      };
    } catch (error) {
      request.log.error(error);
      const busy = loadFailure(error);
      if (busy)
        return reply
          .status(busy.status)
          .send({ success: false, error: busy.error });
      return reply
        .status(500)
        .send({ success: false, error: "Gagal memuat laporan" });
    }
  });

  /**
   * Shared machinery for the ITEM-GRAINED invoice reports (per produk, per grup).
   *
   * The three original dimensions group whole INVOICES — one row per payment
   * method, salesperson or customer. These two group invoice_items, and the
   * change of grain drags three consequences with it:
   *
   * 1. BOTH SIDES ARE MEANINGFUL. "Per sales" and "per pelanggan" only exist on
   *    the sales side, which is why the older dimensions are hardcoded to it.
   *    "What did we buy" is as real a question as "what did we sell", so these
   *    take a `side` and default to sales.
   * 2. THE PRODUCT / GRUP FILTERS NARROW LINES, not invoices. itemFilter() above
   *    is an EXISTS that selects whole invoices — right when a row is an
   *    invoice, wrong here, where picking "Minuman" must mean the drinks lines
   *    rather than every line of every invoice that happened to contain one.
   * 3. INVOICE-LEVEL MONEY MUST BE ALLOCATED. total = subtotal - discount +
   *    tax_amount, so summing line_total alone reports money the customer never
   *    paid. Each line gives up its proportional share of the discount and, when
   *    prices are tax-inclusive, of the tax — the same rule netLineRevenue
   *    applies to orders (lib/money-sql.ts).
   *
   *    What the shares sum to is REVENUE NET OF TAX, which is deliberately NOT
   *    the "Nilai Faktur" KPI above: that one is sum(invoices.total), i.e. what
   *    was billed. computeTotals() puts tax outside the line under exclusive
   *    pricing (total = base + tax) and inside it under inclusive (total =
   *    base), so from either side the identity is the same one:
   *
   *        omzet bersih + pajak = nilai faktur
   *
   *    `totals.tax` is returned so the UI can show that sum rather than leave
   *    an unexplained gap between two numbers on one screen. Verified to the
   *    rupiah on outlets 1 and 19.
   *
   * The denominator is the invoice's OWN summed lines rather than the stored
   * `subtotal` column: self-consistent by construction, so the allocation can
   * never leak or invent money even if a stored subtotal has drifted.
   */
  const BILLED_STATUS = sql`('posted', 'partial', 'paid')`;

  type ItemDimension = "product" | "menugroup";
  const ITEM_DIMENSIONS = new Set<string>(["product", "menugroup"]);
  const sideOf = (v?: string) => (v === "purchase" ? "purchase" : "sales");

  /** key / label for the two item dimensions, over the `l` alias below. */
  function itemDimensionSql(dimension: ItemDimension) {
    if (dimension === "product") {
      return {
        key: sql`coalesce(l.product_id, '-')`,
        // A line with no product is a real, permanent state — delivery, jasa, a
        // fee (see invoice_items.product_id). One honest bucket keeps the
        // column summing to the invoice total instead of quietly dropping them.
        label: sql`coalesce(min(l.product_name), 'Tanpa Produk (jasa/ongkir)')`,
        unit: sql`coalesce(min(l.unit), '')`,
      };
    }
    return {
      key: sql`coalesce(l.menu_group_id::text, '-')`,
      label: sql`coalesce(min(l.group_name), 'Tanpa Grup')`,
      unit: sql`''`,
    };
  }

  /**
   * The invoice window + the allocated per-line amount, as CTEs every
   * item-grained query below starts from. `lineWhere` narrows the LINES.
   */
  function invoiceLinesCte(
    outletId: number,
    side: "sales" | "purchase",
    from: Date,
    to: Date | null,
    lineWhere: SQL,
  ) {
    const window = to
      ? sql`i.issue_date >= ${from} and i.issue_date < ${to}`
      : sql`i.issue_date >= ${from}`;
    return sql`
      inv as (
        select i.id, i.number, i.issue_date, i.discount,
               coalesce(i.tax_amount, 0) as tax_amount,
               coalesce(nullif(trim(i.party_name), ''), s.name, 'Tanpa Nama') as party,
               case when i.tax_inclusive then coalesce(i.tax_amount, 0) else 0 end as tax_in_price
        from invoices i
        left join suppliers s on s.id = i.supplier_id
        where i.outlet_id = ${outletId}
          and i.type = ${side}
          and i.deleted_at is null
          and i.status in ${BILLED_STATUS}
          and ${window}
      ),
      gross as (
        select ii.invoice_id, coalesce(sum(ii.line_total), 0) as g
        from invoice_items ii
        where ii.invoice_id in (select id from inv)
        group by ii.invoice_id
      ),
      l as (
        select inv.id as invoice_id, inv.number, inv.issue_date, inv.party,
               ii.id as item_id, ii.description, ii.quantity, ii.unit_price,
               ii.product_id, p.product_name, p.unit, p.menu_group_id,
               mg.name as group_name,
               (ii.line_total - case when g.g > 0
                  then ii.line_total * (inv.discount + inv.tax_in_price) / g.g
                  else 0 end) as amount
        from inv
        join gross g on g.invoice_id = inv.id
        join invoice_items ii on ii.invoice_id = inv.id
        left join products p on p.id = ii.product_id
        left join menu_groups mg on mg.id = p.menu_group_id
        ${lineWhere}
      )`;
  }

  /** Line-level narrowing for the item dimensions. See 2. above. */
  function itemLineWhere(q: { productId?: string; menuGroupId?: string }): SQL {
    const parts: SQL[] = [];
    const productId = q.productId?.trim();
    const menuGroupId = Number(q.menuGroupId);
    if (productId) parts.push(sql`ii.product_id = ${productId}`);
    else if (Number.isFinite(menuGroupId) && menuGroupId > 0) {
      parts.push(sql`p.menu_group_id = ${menuGroupId}`);
    }
    return parts.length ? sql`where ${sql.join(parts, sql` and `)}` : sql``;
  }

  // Segmented invoice report: the same period window as /report, sliced three
  // ways. Sales invoices only — "per sales" (who issued it) and "per pelanggan"
  // are meaningless on the purchase side, and mixing the two would double-count
  // the money. Payment rows are grouped by WHEN THE MONEY MOVED
  // (invoice_payments.created_at), the other two by when the invoice was issued.
  app.get("/api/invoices/report/breakdown", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "reports");
    if (!outlet) return;
    const q = request.query as {
      period?: string;
      from?: string;
      to?: string;
      timezone?: string;
      dimension?: string;
      productId?: string;
      menuGroupId?: string;
    };
    const { dimension = "payment" } = q;
    const timezone = q.timezone || "Asia/Jakarta";
    const { from, to } = rangeWindow(q, timezone);
    const inWindow = (col: AnyColumn) =>
      to ? and(gte(col, from), lt(col, to)) : gte(col, from);
    const item = itemFilter(q);

    // Capped reports pool: see the sibling handler above.
    try {
      // Per produk / per grup: a different grain, and therefore its own query
      // rather than another key expression below. See itemDimensionSql.
      if (ITEM_DIMENSIONS.has(dimension)) {
        const dim = dimension as ItemDimension;
        const side = sideOf((q as { side?: string }).side);
        const { key, label, unit } = itemDimensionSql(dim);
        const result = await reportDb.execute(sql`
          with ${invoiceLinesCte(outlet.id, side, from, to, itemLineWhere(q))}
          select ${key}                                as key,
                 ${label}                              as label,
                 ${unit}                               as unit,
                 count(distinct l.invoice_id)::int     as invoices,
                 coalesce(sum(l.quantity), 0)::float8  as qty,
                 coalesce(sum(l.amount), 0)::float8    as amount,
                 -- Window functions run after the grouping and before the
                 -- LIMIT, so these cover every bucket while only 50 come back.
                 count(*) over ()::int                     as total_buckets,
                 sum(sum(l.amount)) over ()::float8        as total_amount,
                 sum(sum(l.quantity)) over ()::float8      as total_qty,
                 -- Invoice-level facts, so they are read off the inv CTE
                 -- rather than summed per bucket (which would multiply them by
                 -- the number of distinct products on each invoice).
                 (select coalesce(sum(inv.tax_amount), 0) from inv)::float8 as total_tax,
                 (select coalesce(sum(inv.discount), 0) from inv)::float8   as total_discount,
                 (select count(*) from inv)::int                            as total_invoices
          from l
          group by ${key}
          order by amount desc
          limit 50
        `);
        const bucketRows = result.rows as Record<string, unknown>[];
        const head = bucketRows[0];
        return {
          success: true,
          dimension,
          side,
          groups: bucketRows.map((r) => ({
            key: String(r.key),
            label: String(r.label),
            unit: String(r.unit ?? ""),
            count: Number(r.invoices),
            invoices: Number(r.invoices),
            qty: Number(r.qty),
            amount: Number(r.amount),
          })),
          totals: {
            buckets: head ? Number(head.total_buckets) : 0,
            invoices: head ? Number(head.total_invoices) : 0,
            qty: head ? Number(head.total_qty) : 0,
            // Net of the invoice-level discount and of tax. See the note above:
            // amount + tax = the "Nilai Faktur" KPI.
            amount: head ? Number(head.total_amount) : 0,
            tax: head ? Number(head.total_tax) : 0,
            discount: head ? Number(head.total_discount) : 0,
          },
        };
      }

      const BILLED = ["posted", "partial", "paid"] as const;
      const base = [
        eq(invoicesTable.outlet_id, outlet.id),
        eq(invoicesTable.type, "sales"),
        isNull(invoicesTable.deletedAt),

        ...(item ? [item] : []),
      ];

      if (dimension === "payment") {
        // Money actually received in the window, by how it came in. Void invoices
        // have their payment rows deleted, so no status filter is needed here.
        const rows = await reportDb
          .select({
            key: invoicePaymentsTable.method,
            count: sql<number>`count(*)::int`,
            invoices: sql<number>`count(distinct ${invoicePaymentsTable.invoice_id})::int`,
            amount: sql<string>`coalesce(sum(${invoicePaymentsTable.amount}), 0)`,
          })
          .from(invoicePaymentsTable)
          .innerJoin(
            invoicesTable,
            eq(invoicesTable.id, invoicePaymentsTable.invoice_id),
          )
          .where(and(...base, inWindow(invoicePaymentsTable.created_at)))
          .groupBy(invoicePaymentsTable.method)
          .orderBy(desc(sql`coalesce(sum(${invoicePaymentsTable.amount}), 0)`));

        return {
          success: true,
          dimension,
          groups: rows.map((r) => ({
            key: r.key,
            label: r.key,
            count: r.count,
            invoices: r.invoices,
            amount: Number(r.amount),
          })),
        };
      }

      // Staff and customer both slice the invoices ISSUED in the window, so they
      // share a shape: billed / paid / outstanding per bucket.
      const isStaff = dimension === "staff";
      const keyExpr = isStaff
        ? sql<string>`coalesce(${invoicesTable.created_by}, '-')`
        : sql<string>`coalesce(nullif(trim(${invoicesTable.party_name}), ''), '-')`;
      const labelExpr = isStaff
        ? sql<string>`coalesce(${usersTable.name}, 'Tanpa Nama')`
        : sql<string>`coalesce(nullif(trim(${invoicesTable.party_name}), ''), 'Tanpa Nama')`;

      const rows = await reportDb
        .select({
          key: keyExpr,
          label: labelExpr,
          count: sql<number>`count(*)::int`,
          billed: sql<string>`coalesce(sum(${invoicesTable.total}), 0)`,
          paid: sql<string>`coalesce(sum(${invoicesTable.amount_paid}), 0)`,
          outstanding: sql<string>`coalesce(sum(${invoicesTable.total} - ${invoicesTable.amount_paid}), 0)`,
        })
        .from(invoicesTable)
        .leftJoin(usersTable, eq(usersTable.id, invoicesTable.created_by))
        .where(
          and(
            ...base,
            inArray(invoicesTable.status, [...BILLED]),
            inWindow(invoicesTable.issue_date),
          ),
        )
        .groupBy(keyExpr, labelExpr)
        .orderBy(desc(sql`coalesce(sum(${invoicesTable.total}), 0)`))
        .limit(50);

      return {
        success: true,
        dimension,
        groups: rows.map((r) => ({
          key: r.key,
          label: r.label,
          count: r.count,
          amount: Number(r.billed),
          paid: Number(r.paid),
          outstanding: Number(r.outstanding),
        })),
      };
    } catch (error) {
      request.log.error(error);
      const busy = loadFailure(error);
      if (busy)
        return reply
          .status(busy.status)
          .send({ success: false, error: busy.error });
      return reply
        .status(500)
        .send({ success: false, error: "Gagal memuat laporan" });
    }
  });

  /**
   * THE ROWS BEHIND A BUCKET — the "detail" half of the invoice report.
   *
   * Every dimension on the page can now be opened up, and what a row IS depends
   * on the grain of the bucket it came from:
   *
   *   product / menugroup -> one invoice LINE  (which goods, how many, for how much)
   *   payment             -> one PAYMENT       (money that actually moved)
   *   staff / customer    -> one INVOICE       (billed / paid / sisa)
   *
   * Paginated server-side, and `total` rides along as a window function so the
   * count and the page come from one scan rather than two — the same shape
   * /api/reports/breakdown/orders uses.
   *
   * `key` narrows to a single bucket; omitting it means "Semua", so the row list
   * always covers exactly what the bucket list above it summed.
   */
  app.get("/api/invoices/report/breakdown/rows", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "reports");
    if (!outlet) return;
    const q = request.query as {
      period?: string;
      from?: string;
      to?: string;
      timezone?: string;
      dimension?: string;
      side?: string;
      key?: string;
      productId?: string;
      menuGroupId?: string;
      page?: string;
      pageSize?: string;
    };
    const dimension = q.dimension ?? "payment";
    const timezone = q.timezone || "Asia/Jakarta";
    const { from, to } = rangeWindow(q, timezone);
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;
    // Empty string is a legitimate bucket key ("-" is used for the unnamed
    // ones), so only an ABSENT key means "all buckets".
    const key = q.key === undefined ? null : q.key;

    // The invoice-grained branches below alias invoices as `i`, so they cannot
    // reuse itemFilter() — it renders "invoices"."id" from the query builder.
    const rawItemFilter = (): SQL => {
      const productId = q.productId?.trim();
      const menuGroupId = Number(q.menuGroupId);
      if (productId) {
        return sql` and exists (select 1 from invoice_items ii
                    where ii.invoice_id = i.id and ii.product_id = ${productId})`;
      }
      if (Number.isFinite(menuGroupId) && menuGroupId > 0) {
        return sql` and exists (select 1 from invoice_items ii
                    join products p2 on p2.id = ii.product_id
                    where ii.invoice_id = i.id and p2.menu_group_id = ${menuGroupId})`;
      }
      return sql``;
    };

    const paged = <T>(rows: T[], totalRows: number) => ({
      success: true,
      dimension,
      page,
      pageSize,
      total: totalRows,
      totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
      rows,
    });

    try {
      // ---------------------------------------------------------- item rows
      if (ITEM_DIMENSIONS.has(dimension)) {
        const dim = dimension as ItemDimension;
        const side = sideOf(q.side);
        const { key: keyExpr } = itemDimensionSql(dim);
        const narrow = key === null ? sql`` : sql`where ${keyExpr} = ${key}`;
        const result = await reportDb.execute(sql`
          with ${invoiceLinesCte(outlet.id, side, from, to, itemLineWhere(q))}
          select l.invoice_id,
                 l.number,
                 to_json(l.issue_date) #>> '{}'          as issue_date,
                 l.party,
                 -- A line with no product still has its free-text description,
                 -- which is the only name a delivery or jasa line ever had.
                 coalesce(l.product_name, l.description)  as product,
                 coalesce(l.unit, '')                     as unit,
                 l.quantity::float8                       as qty,
                 l.unit_price::float8                     as unit_price,
                 l.amount::float8                         as amount,
                 count(*) over ()::int                    as total
          from l
          ${narrow}
          order by l.issue_date desc, l.item_id desc
          limit ${pageSize} offset ${offset}
        `);
        const rows = result.rows as Record<string, unknown>[];
        return paged(
          rows.map((r) => ({
            invoiceId: Number(r.invoice_id),
            number: String(r.number),
            date: r.issue_date as string,
            party: String(r.party),
            product: String(r.product ?? ""),
            unit: String(r.unit ?? ""),
            qty: Number(r.qty),
            unitPrice: Number(r.unit_price),
            amount: Number(r.amount),
          })),
          rows.length ? Number(rows[0].total) : 0,
        );
      }

      const window = to
        ? (col: SQL) => sql`${col} >= ${from} and ${col} < ${to}`
        : (col: SQL) => sql`${col} >= ${from}`;

      // ------------------------------------------------------- payment rows
      if (dimension === "payment") {
        const narrow = key === null ? sql`` : sql`and ip.method = ${key}`;
        const result = await reportDb.execute(sql`
          select ip.id,
                 i.id                                     as invoice_id,
                 i.number,
                 to_json(ip.created_at) #>> '{}'          as paid_at,
                 coalesce(nullif(trim(i.party_name), ''), 'Tanpa Nama') as party,
                 ip.method,
                 ip.amount::float8                        as amount,
                 count(*) over ()::int                    as total
          from invoice_payments ip
          join invoices i on i.id = ip.invoice_id
          where i.outlet_id = ${outlet.id}
            and i.type = 'sales'
            and i.deleted_at is null
            and ${window(sql`ip.created_at`)}
            ${narrow}${rawItemFilter()}
          order by ip.created_at desc, ip.id desc
          limit ${pageSize} offset ${offset}
        `);
        const rows = result.rows as Record<string, unknown>[];
        return paged(
          rows.map((r) => ({
            paymentId: Number(r.id),
            invoiceId: Number(r.invoice_id),
            number: String(r.number),
            date: r.paid_at as string,
            party: String(r.party),
            method: String(r.method),
            amount: Number(r.amount),
          })),
          rows.length ? Number(rows[0].total) : 0,
        );
      }

      // ------------------------------------------------------- invoice rows
      // staff / customer: same shape, different bucket key.
      const isStaff = dimension === "staff";
      const keyExpr = isStaff
        ? sql`coalesce(i.created_by, '-')`
        : sql`coalesce(nullif(trim(i.party_name), ''), '-')`;
      const narrow = key === null ? sql`` : sql`and ${keyExpr} = ${key}`;
      const result = await reportDb.execute(sql`
        select i.id,
               i.number,
               to_json(i.issue_date) #>> '{}'            as issue_date,
               to_json(i.due_date) #>> '{}'              as due_date,
               coalesce(nullif(trim(i.party_name), ''), 'Tanpa Nama') as party,
               coalesce(u.name, 'Tanpa Nama')            as staff,
               i.status::text                            as status,
               i.total::float8                           as total_amount,
               i.amount_paid::float8                     as paid,
               (i.total - i.amount_paid)::float8         as outstanding,
               count(*) over ()::int                     as total
        from invoices i
        left join users u on u.id = i.created_by
        where i.outlet_id = ${outlet.id}
          and i.type = 'sales'
          and i.deleted_at is null
          and i.status in ${BILLED_STATUS}
          and ${window(sql`i.issue_date`)}
          ${narrow}${rawItemFilter()}
        order by i.issue_date desc, i.id desc
        limit ${pageSize} offset ${offset}
      `);
      const rows = result.rows as Record<string, unknown>[];
      return paged(
        rows.map((r) => ({
          invoiceId: Number(r.id),
          number: String(r.number),
          date: r.issue_date as string,
          dueDate: (r.due_date as string) ?? null,
          party: String(r.party),
          staff: String(r.staff),
          status: String(r.status),
          total: Number(r.total_amount),
          paid: Number(r.paid),
          outstanding: Number(r.outstanding),
        })),
        rows.length ? Number(rows[0].total) : 0,
      );
    } catch (error) {
      request.log.error(error);
      const busy = loadFailure(error);
      if (busy)
        return reply
          .status(busy.status)
          .send({ success: false, error: busy.error });
      return reply
        .status(500)
        .send({ success: false, error: "Gagal memuat rincian" });
    }
  });

  // ============================================================ stock opname
  // Absolute physical count: for each tracked product the client sends the
  // counted quantity; the server computes delta = counted - current and records
  // an 'adjustment' stock movement (note for the reason), then sets stock to the
  // count. NO cashflow is created — the cash already left at purchase; spoilage
  // is inventory shrinkage, not a new cash movement (its value shows as lower HPP).
  app.post("/api/stock/opname", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "stock");
    if (!outlet) return;
    const body = request.body as {
      note?: string;
      // unit_cost is OPTIONAL and only ever honoured for a product whose running
      // average is still 0 — stock that has never been bought through an invoice
      // and therefore carries no cost the ledger could have learned. It can
      // never overwrite an average the ledger computed itself; that number is
      // the whole reason the ledger is trusted over the product form.
      items?: { product_id: string; counted: number | string; unit_cost?: number | string }[];
    };
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return reply.status(400).send({ success: false, error: "Tidak ada item" });
    const note = (body.note?.trim() || "Opname").slice(0, 255);

    try {
      const adjusted = await db.transaction(async (tx) => {
        let count = 0;
        for (const it of items) {
          if (!it.product_id) continue;
          const counted = Number(it.counted);
          if (!Number.isFinite(counted) || counted < 0) continue;
          // Re-read current stock inside the txn so the delta is correct even if
          // stock changed since the page loaded. Scoped to this outlet + tracked.
          const [p] = await tx
            .select({
              stock: productsTable.stock,
              track_stock: productsTable.track_stock,
              avg_cost: productsTable.avg_cost,
              unit: productsTable.unit,
            })
            .from(productsTable)
            .where(and(eq(productsTable.id, it.product_id), eq(productsTable.outlet_id, outlet.id)))
            .limit(1);
          if (!p || !p.track_stock) continue;
          const delta = +(counted - (Number(p.stock) || 0)).toFixed(2);
          const touched = await postCount(tx, {
            outletId: outlet.id,
            product: { id: it.product_id, ...p },
            delta,
            typedCost: it.unit_cost == null ? null : Number(it.unit_cost),
            note,
          });
          if (touched) count++;
        }
        return count;
      });
      return { success: true, adjusted };
    } catch (e) {
      return reply.status(500).send({ success: false, error: String(e instanceof Error ? e.message : e) });
    }
  });

  // The Stok list a page at a time, for the Android app: the outlet's tracked
  // products with the numbers the web's Stok page works out for itself from
  // /api/products/mine. The web still reads that; a phone should not download
  // the whole menu, add-ons and all, to show twenty rows of stock.
  //
  //   q       name or code contains, any case
  //   status  all | ready | out | wip — Semua, Tersedia, Habis, Bahan setengah jadi
  //   sort    name (A–Z) | stock (emptiest first) | value (most valuable first)
  //   page    from 1; limit 1–100, default 20
  //
  // As on the web, `counts` (the tab numbers) follow the search, while `tabs`
  // (which tabs to offer) and `summary` (the stat cards) follow the whole
  // catalogue. `opname` is the outlet's open count, if any, for its banner.
  app.get("/api/stock/items", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "stock");
    if (!outlet) return;
    const query = request.query as { q?: string; status?: string; sort?: string; page?: string; limit?: string };
    const limit = clampInt(query.limit, 1, 100, 20);
    const page = clampInt(query.page, 1, 1_000_000, 1);
    const status = query.status === "ready" || query.status === "out" || query.status === "wip" ? query.status : "all";
    const needle = (query.q ?? "").trim().slice(0, 100);

    const recipe = hasRecipe(outlet.id);
    const tracked = and(
      eq(productsTable.outlet_id, outlet.id),
      isNull(productsTable.deletedAt),
      eq(productsTable.track_stock, true),
    );
    const pattern = `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const matches = needle
      ? or(ilike(productsTable.product_name, pattern), ilike(productsTable.barcode, pattern))!
      : sql`true`;
    const inTab = {
      all: sql`true`,
      ready: sql`${stockQty} > 0`,
      out: sql`${stockQty} <= 0`,
      wip: recipe,
    }[status];
    const order =
      query.sort === "stock"
        ? [sql`${stockQty} asc`, sql`lower(${productsTable.product_name}) asc`]
        : query.sort === "value"
          ? [sql`${stockValue} desc`, sql`lower(${productsTable.product_name}) asc`]
          : [sql`lower(${productsTable.product_name}) asc`];

    const [[agg], rows, [opname]] = await Promise.all([
      db
        .select({
          all: sql<number>`count(*) filter (where ${matches})`.mapWith(Number),
          ready: sql<number>`count(*) filter (where ${matches} and ${stockQty} > 0)`.mapWith(Number),
          out: sql<number>`count(*) filter (where ${matches} and ${stockQty} <= 0)`.mapWith(Number),
          wip: sql<number>`count(*) filter (where ${matches} and ${recipe})`.mapWith(Number),
          tracked: sql<number>`count(*)`.mapWith(Number),
          outAll: sql<number>`count(*) filter (where ${stockQty} <= 0)`.mapWith(Number),
          wipAll: sql<number>`count(*) filter (where ${recipe})`.mapWith(Number),
          value: sql<number>`coalesce(sum(${stockValue}), 0)`.mapWith(Number),
          needsCost: sql<number>`count(*) filter (where not ${ledgerCost} > 0)`.mapWith(Number),
          estimated: sql<number>`coalesce(sum(${stockValue}) filter (where not ${ledgerCost} > 0), 0)`.mapWith(Number),
        })
        .from(productsTable)
        .where(tracked),
      db
        .select(stockItemColumns(recipe))
        .from(productsTable)
        .where(and(tracked, matches, inTab))
        .orderBy(...order, asc(productsTable.id))
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({
          id: stockOpnameSessionsTable.id,
          started_at: stockOpnameSessionsTable.started_at,
          counted: sql<number>`(select count(*) from ${stockOpnameLinesTable} where ${stockOpnameLinesTable.session_id} = ${stockOpnameSessionsTable.id})`.mapWith(Number),
        })
        .from(stockOpnameSessionsTable)
        .where(and(eq(stockOpnameSessionsTable.outlet_id, outlet.id), eq(stockOpnameSessionsTable.status, "open")))
        .limit(1),
    ]);

    const counts = { all: agg.all, ready: agg.ready, out: agg.out, wip: agg.wip };
    return {
      success: true,
      data: rows,
      total: counts[status],
      page,
      limit,
      counts,
      tabs: { ready: agg.tracked - agg.outAll > 0, out: agg.outAll > 0, wip: agg.wipAll > 0 },
      summary: {
        value: Math.round(agg.value),
        tracked: agg.tracked,
        out: agg.outAll,
        // How much of `value` rests on a price typed into the product form
        // rather than on anything the ledger worked out, and for how many.
        needs_cost: agg.needsCost,
        estimated_value: Math.round(agg.estimated),
      },
      opname: opname ?? null,
    };
  });

  // History of stock adjustments (opname reconciliations), newest first, grouped
  // by day on the client. Filtered to a date window (default: last 30 days) so
  // the payload/scan stays bounded — backed by the
  // stock_movements_outlet_reason_created_idx index. `from`/`to` are YYYY-MM-DD.
  //
  // Paged when `limit` is given (the Android app, at most 100 a page): the
  // answer then carries `next_cursor`, to send back as `cursor` for the page
  // after it. `fromAt`/`dateBefore` are ISO instants (the second exclusive)
  // that take over from `from`/`to`, whose bare days are UTC days. Without
  // `limit` the web's one 1000-row answer is exactly what it always was.
  app.get("/api/stock/opname-history", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "stock");
    if (!outlet) return;
    const { from, to, fromAt, dateBefore, limit, cursor } = request.query as {
      from?: string;
      to?: string;
      fromAt?: string;
      dateBefore?: string;
      limit?: string;
      cursor?: string;
    };

    const toDate = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
    const fromDate = from
      ? new Date(`${from}T00:00:00.000Z`)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days

    if (limit) {
      const since = fromAt ? new Date(fromAt) : fromDate;
      const before = dateBefore ? new Date(dateBefore) : null;
      const after = cursor ? movementCursor(cursor) : null;
      if (Number.isNaN(since.getTime()) || (before && Number.isNaN(before.getTime())) || after === undefined) {
        return reply.status(400).send({ success: false, error: "Invalid date or cursor" });
      }
      const cap = clampInt(limit, 1, 100, 30);
      const rows = await db
        .select({
          id: stockMovementsTable.id,
          product_id: stockMovementsTable.product_id,
          qty_change: sql<number>`${stockMovementsTable.qty_change}`.mapWith(Number),
          note: stockMovementsTable.note,
          created_at: stockMovementsTable.created_at,
          product_name: productsTable.product_name,
          unit: productsTable.unit,
        })
        .from(stockMovementsTable)
        .innerJoin(productsTable, eq(stockMovementsTable.product_id, productsTable.id))
        .where(
          and(
            eq(stockMovementsTable.outlet_id, outlet.id),
            eq(stockMovementsTable.reason, "adjustment"),
            gte(stockMovementsTable.created_at, since),
            before ? lt(stockMovementsTable.created_at, before) : lte(stockMovementsTable.created_at, toDate),
            after ? olderThanMovement(after) : undefined,
          ),
        )
        .orderBy(desc(stockMovementsTable.created_at), desc(stockMovementsTable.id))
        .limit(cap + 1);
      const more = rows.length > cap;
      const data = more ? rows.slice(0, cap) : rows;
      return { success: true, data, next_cursor: more ? String(data[data.length - 1].id) : null };
    }

    const rows = await db
      .select({
        id: stockMovementsTable.id,
        qty_change: stockMovementsTable.qty_change,
        note: stockMovementsTable.note,
        created_at: stockMovementsTable.created_at,
        product_name: productsTable.product_name,
        unit: productsTable.unit,
      })
      .from(stockMovementsTable)
      .innerJoin(productsTable, eq(stockMovementsTable.product_id, productsTable.id))
      .where(
        and(
          eq(stockMovementsTable.outlet_id, outlet.id),
          eq(stockMovementsTable.reason, "adjustment"),
          gte(stockMovementsTable.created_at, fromDate),
          lte(stockMovementsTable.created_at, toDate),
        ),
      )
      .orderBy(desc(stockMovementsTable.created_at))
      .limit(1000); // hard cap; narrow the date range if you hit it
    return { success: true, data: rows };
  });

  // Per-product ledger for the Stok page drill-down: every movement
  // (purchase / sales / adjustment / void), newest first, with the invoice
  // number when one caused it. Outlet scoping comes from the movement rows
  // themselves, so a foreign productId simply returns nothing.
  //
  // `paged=1` (the Android app) answers a page at a time instead, each row with
  // the stock left after it, and on request the summary its Alur Stok header
  // shows: see pagedMovements. Without it the web's answer is unchanged.
  app.get("/api/stock/movements", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply, "stock");
    if (!outlet) return;
    const { productId, limit, cursor, reason, paged, summary } = request.query as {
      productId?: string;
      limit?: string;
      cursor?: string;
      reason?: string;
      paged?: string;
      summary?: string;
    };
    if (!productId) return reply.status(400).send({ success: false, error: "Missing productId" });
    if (paged === "1") return pagedMovements(reply, outlet.id, productId, { limit, cursor, reason, summary: summary === "1" });
    const cap = Math.min(Number(limit) || 200, 500);

    const rows = await db
      .select({
        id: stockMovementsTable.id,
        qty_change: stockMovementsTable.qty_change,
        reason: stockMovementsTable.reason,
        note: stockMovementsTable.note,
        created_at: stockMovementsTable.created_at,
        invoice_number: invoicesTable.number,
      })
      .from(stockMovementsTable)
      .leftJoin(invoicesTable, eq(stockMovementsTable.invoice_id, invoicesTable.id))
      .where(
        and(
          eq(stockMovementsTable.outlet_id, outlet.id),
          eq(stockMovementsTable.product_id, productId),
        ),
      )
      .orderBy(desc(stockMovementsTable.created_at), desc(stockMovementsTable.id))
      .limit(cap);
    return { success: true, data: rows };
  });
}

// ───────────────────────────────────────────── stock, a page at a time
// /api/stock/items and the paged /api/stock/movements + opname-history, which
// the Android app reads instead of the whole catalogue and whole ledgers.

function clampInt(raw: unknown, min: number, max: number, fallback: number) {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n >= min ? Math.min(n, max) : fallback;
}

const round3 = (n: number) => +n.toFixed(3);

function rowsOf<T>(result: unknown): T[] {
  const r = result as { rows?: T[] };
  return r.rows ?? (Array.isArray(result) ? (result as T[]) : []);
}

const stockQty = sql`coalesce(${productsTable.stock}, 0)`;
const ledgerCost = sql`coalesce(${productsTable.avg_cost}, 0)`;
// buying_price is the varchar typed into the product form: anything in it that
// is not a plain number counts as nothing instead of failing the whole query.
const typedCost = sql`(case when trim(${productsTable.buying_price}) ~ '^[0-9]+([.][0-9]+)?$' then trim(${productsTable.buying_price})::numeric else 0 end)`;
// What one unit on the shelf is worth: the ledger's running average, or for a
// product the ledger has never priced, what was typed into the form. The web
// Stok page makes the same fallback in the browser (stock-client.tsx).
const unitCost = sql`(case when ${ledgerCost} > 0 then ${ledgerCost} else ${typedCost} end)`;
const stockValue = sql`(${stockQty} * ${unitCost})`;

/** Made in-house from a composition of its own, so "Produksi" applies: /api/products/mine's has_recipe. */
const hasRecipe = (outletId: number) =>
  sql`exists (select 1 from ${recipeItemsTable} where ${recipeItemsTable.product_id} = ${productsTable.id} and ${recipeItemsTable.outlet_id} = ${outletId})`;

/** A product as the Stok list shows it, in both endpoints. */
const stockItemColumns = (recipe: SQL) => ({
  id: productsTable.id,
  product_name: productsTable.product_name,
  unit: productsTable.unit,
  code: productsTable.barcode,
  stock: sql<number>`${stockQty}`.mapWith(Number),
  unit_cost: sql<number>`${unitCost}`.mapWith(Number),
  value: sql<number>`round(${stockValue})`.mapWith(Number),
  // The ledger has never priced it: unit_cost is the form's guess.
  needs_cost: sql<boolean>`not (${ledgerCost} > 0)`,
  has_recipe: sql<boolean>`${recipe}`,
  yield_qty: sql<number>`coalesce(${productsTable.yield_qty}, 1)`.mapWith(Number),
});

/** A paged answer's `cursor`: the id of the last movement on the page before. Undefined when it is not one. */
function movementCursor(raw: string): number | undefined {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

// Keyset paging, newest first: the movements strictly older than movement
// `id`. Looked up rather than carried in the cursor, because created_at keeps
// microseconds a JS Date would round away, skipping or repeating rows where
// two pages meet.
const olderThanMovement = (id: number) =>
  sql`(${stockMovementsTable.created_at}, ${stockMovementsTable.id}) < (select c.created_at, c.id from ${stockMovementsTable} c where c.id = ${id})`;

const MOVEMENT_REASONS = new Set(["purchase", "sales", "adjustment", "void", "production"]);

type MovementRow = {
  id: number;
  qty_change: number;
  reason: string;
  note: string | null;
  created_at: string;
  order_id: string | null;
  invoice_number: string | null;
  line_product: string | null;
  line_qty: number | null;
};

// What a movement `m` says about itself: the invoice behind it, the POS order
// behind it, and for a sale the menu line that took it ("Nasi Goreng" × 2)
// when that line was another product, as every sale of an ingredient is.
// created_at goes out in the same ISO form Drizzle gives a Date.
const movementColumns = (productId: string) => sql`
  m.id, m.qty_change::float8 as qty_change, m.reason, m.note,
  to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
  m.order_id, i.number as invoice_number,
  case when d.product_id <> ${productId} then lp.product_name end as line_product,
  case when d.product_id <> ${productId} then d.quantity end as line_qty`;
const movementJoins = sql`
  left join invoices i on i.id = m.invoice_id
  left join "orderDetails" d on d.id = m.order_detail_id
  left join products lp on lp.id = d.product_id`;

/**
 * One page of a product's Alur Stok, newest first, each movement with the stock
 * left right after it (`balance_after`): the stock now, less every movement
 * newer than that one. The running sum covers ALL the product's movements
 * before `reason` narrows the page, so a filtered row still tells the truth
 * about the shelf. It reads one product's movements per page, on the
 * (product_id, created_at) index.
 *
 * `summary` adds what the app's header shows above the first page: the product
 * as it stands, how many movements of each kind it has, what came in, went out
 * and was used up in the last 30 days, and the latest movement in and out —
 * which order or invoice, what, and when.
 */
async function pagedMovements(
  reply: FastifyReply,
  outletId: number,
  productId: string,
  query: { limit?: string; cursor?: string; reason?: string; summary: boolean },
) {
  const cap = clampInt(query.limit, 1, 100, 30);
  const after = query.cursor ? movementCursor(query.cursor) : null;
  if (after === undefined) return reply.status(400).send({ success: false, error: "Invalid cursor" });
  const reason = query.reason && MOVEMENT_REASONS.has(query.reason) ? query.reason : null;

  const filters = [sql`true`];
  if (reason) filters.push(sql`m.reason = ${reason}`);
  if (after) filters.push(sql`(m.created_at, m.id) < (select c.created_at, c.id from stock_movements c where c.id = ${after})`);

  const latest = (sign: SQL) =>
    db
      .execute(sql`
        select ${movementColumns(productId)}
        from stock_movements m
        ${movementJoins}
        where m.outlet_id = ${outletId} and m.product_id = ${productId} and m.qty_change ${sign}
        order by m.created_at desc, m.id desc
        limit 1
      `)
      .then((r) => rowsOf<MovementRow>(r)[0] ?? null);

  const [pageResult, header] = await Promise.all([
    db.execute(sql`
      select ${movementColumns(productId)},
             (coalesce(p.stock, 0) - coalesce(m.newer, 0))::float8 as balance_after
      from (
        select s.*, sum(s.qty_change) over (
                 order by s.created_at desc, s.id desc
                 rows between unbounded preceding and 1 preceding
               ) as newer
        from stock_movements s
        where s.outlet_id = ${outletId} and s.product_id = ${productId}
      ) m
      join products p on p.id = m.product_id
      ${movementJoins}
      where ${sql.join(filters, sql` and `)}
      order by m.created_at desc, m.id desc
      limit ${cap + 1}
    `),
    query.summary
      ? Promise.all([
          db
            .select({ ...stockItemColumns(hasRecipe(outletId)), track_stock: productsTable.track_stock })
            .from(productsTable)
            .where(and(eq(productsTable.id, productId), eq(productsTable.outlet_id, outletId)))
            .limit(1),
          db.execute(sql`
            select reason, count(*)::int as n,
                   coalesce(sum(qty_change) filter (where qty_change > 0 and created_at >= now() - interval '30 days'), 0)::float8 as in_30d,
                   coalesce(-sum(qty_change) filter (where qty_change < 0 and created_at >= now() - interval '30 days'), 0)::float8 as out_30d,
                   coalesce(-sum(qty_change) filter (
                     where created_at >= now() - interval '30 days'
                       and (reason in ('sales', 'void') or (reason = 'production' and qty_change < 0))
                   ), 0)::float8 as used_30d,
                   to_char(min(created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as first_at
            from stock_movements
            where outlet_id = ${outletId} and product_id = ${productId}
            group by reason
          `),
          latest(sql`> 0`),
          latest(sql`< 0`),
        ])
      : null,
  ]);

  const rows = rowsOf<MovementRow & { balance_after: number }>(pageResult);
  const more = rows.length > cap;
  const data = more ? rows.slice(0, cap) : rows;
  const next_cursor = more ? String(data[data.length - 1].id) : null;
  if (!header) return { success: true, data, next_cursor };

  const [[product], kinds, lastIn, lastOut] = header;
  if (!product) return reply.status(404).send({ success: false, error: "Produk tidak ditemukan" });
  const perReason = rowsOf<{ reason: string; n: number; in_30d: number; out_30d: number; used_30d: number; first_at: string }>(kinds);
  const total = (key: "n" | "in_30d" | "out_30d" | "used_30d") => perReason.reduce((sum, r) => sum + Number(r[key]), 0);
  return {
    success: true,
    data,
    next_cursor,
    summary: {
      product,
      reasons: Object.fromEntries(perReason.map((r) => [r.reason, r.n])),
      total: total("n"),
      in_30d: round3(total("in_30d")),
      out_30d: round3(total("out_30d")),
      // Sales net of their voids, plus what production took: what the outlet
      // actually used up, as opposed to opname corrections.
      used_30d: Math.max(0, round3(total("used_30d"))),
      first_at: perReason.map((r) => r.first_at).sort()[0] ?? null,
      last_in: lastIn,
      last_out: lastOut,
    },
  };
}
