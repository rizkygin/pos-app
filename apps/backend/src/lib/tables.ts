import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  diningTablesTable,
  kitchenTicketsTable,
  tableSessionLinesTable,
  tableSessionsTable,
} from "../db/schema";

/**
 * Table management — the parts the cashier's checkout shares with the floor.
 *
 * An open table bill is NOT an order (see the schema notes). It becomes one at
 * checkout, and the two functions at the bottom of this file are the whole of
 * that handover: prepareTableCheckout() proves, under a row lock, that the cart
 * being paid IS the bill on the table, and settleTableBill() stamps the lines
 * with the order they became — inside the same transaction that writes the
 * order, so "paid" and "the bill is settled" can never disagree.
 */

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A route-level failure with the status to answer it with. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/** Seatings still on the floor. `closed_at IS NULL` is the index's predicate. */
export const LIVE_SESSION = isNull(tableSessionsTable.closed_at);

/**
 * What a line keeps of the product it was added from.
 *
 * The cashier's Product carries its add-on catalogue and description along;
 * neither is needed to price, print or check out a line, and a bill of forty
 * lines would carry forty copies of every topping list. These are the fields
 * the cart, the receipt and /api/add-order-detail actually read.
 */
const PRODUCT_FIELDS = [
  "id",
  "product_name",
  "price",
  "price_mark_down",
  "category",
  "image",
  "unit",
  "isAvailable",
  "barcode",
  "menu_group",
  "menu_group_order",
  "variant_of",
  "variant_name",
  "variant_label",
  "variant_sort",
] as const;

export type LineProduct = {
  id: string;
  product_name: string;
  price: string;
  price_mark_down: string;
  [key: string]: unknown;
};

export type LineAddon = {
  product_id: string;
  option_id: number;
  name: string;
  quantity: number;
  price: number;
};

export type ParsedLine = {
  id: string;
  product: LineProduct;
  quantity: number;
  note: string | null;
  addons: LineAddon[];
};

const LINE_ID = /^[A-Za-z0-9-]{1,64}$/;
export const MAX_LINE_QTY = 9999;

function toPriceString(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return String(v);
  if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim())) return v.trim();
  return null;
}

/** One cart line off the wire, in the cashier's CartItem shape, or an error. */
export function parseCartLine(raw: unknown): ParsedLine | string {
  if (!raw || typeof raw !== "object") return "Baris keranjang tidak valid";
  const r = raw as Record<string, unknown>;

  const id = typeof r.lineId === "string" ? r.lineId : typeof r.id === "string" ? r.id : "";
  if (!LINE_ID.test(id)) return "Baris keranjang tanpa id";

  const p = r.product as Record<string, unknown> | undefined;
  if (!p || typeof p !== "object" || typeof p.id !== "string" || !p.id) {
    return "Produk pada baris keranjang tidak valid";
  }
  const price = toPriceString(p.price);
  if (price === null) return `Harga ${String(p.product_name ?? "produk")} tidak valid`;
  const markDown = toPriceString(p.price_mark_down ?? "0") ?? "0";

  const product: LineProduct = {
    id: p.id,
    product_name: String(p.product_name ?? "").slice(0, 255),
    price,
    price_mark_down: markDown,
  };
  for (const f of PRODUCT_FIELDS) {
    if (f in product) continue;
    if (p[f] !== undefined) (product as Record<string, unknown>)[f] = p[f];
  }

  const quantity = Number(r.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QTY) {
    return `Jumlah ${product.product_name} tidak valid`;
  }

  const addons: LineAddon[] = [];
  if (Array.isArray(r.addons)) {
    for (const a of r.addons as Record<string, unknown>[]) {
      if (!a || typeof a !== "object") continue;
      const q = Number(a.quantity);
      const pr = Number(a.price);
      if (typeof a.product_id !== "string" || !Number.isInteger(q) || q < 1 || !(pr >= 0)) {
        return `Add-on pada ${product.product_name} tidak valid`;
      }
      addons.push({
        product_id: a.product_id,
        option_id: Number(a.option_id) || 0,
        name: String(a.name ?? "").slice(0, 100),
        quantity: q,
        price: pr,
      });
    }
  }

  const note =
    typeof r.note === "string" && r.note.trim() !== "" ? r.note.trim().slice(0, 200) : null;

  return { id, product, quantity, note, addons };
}

/**
 * Price of ONE unit of a line, add-ons included. Mirrors unitPriceOf in
 * cashier-client.tsx and the summary_price arithmetic in add-order-detail — a
 * bill shown on the floor must add up to what the till will charge.
 */
export function lineUnitPrice(product: LineProduct, addons: LineAddon[]): number {
  const base =
    product.price_mark_down && product.price_mark_down !== "0"
      ? parseFloat(product.price_mark_down)
      : parseFloat(product.price);
  const extras = addons.reduce((s, a) => s + a.price * a.quantity, 0);
  return (Number.isFinite(base) ? base : 0) + extras;
}

/**
 * The label the floor calls a seating by: its tables' labels, "5" or "5+6"
 * for joined tables. Empty when it holds no table.
 */
export async function sessionTableLabel(tx: Tx | typeof db, sessionId: string): Promise<string> {
  const held = await tx
    .select({ label: diningTablesTable.label })
    .from(diningTablesTable)
    .where(eq(diningTablesTable.session_id, sessionId));
  return held
    .map((t) => t.label)
    .sort((a, b) => a.localeCompare(b, "id", { numeric: true }))
    .join("+");
}

/** Point every table of `sessionId` at nothing. */
export async function releaseSessionTables(tx: Tx, sessionId: string) {
  await tx
    .update(diningTablesTable)
    .set({ session_id: null, updatedAt: new Date() })
    .where(eq(diningTablesTable.session_id, sessionId));
}

// ── Checkout handover ────────────────────────────────────────────────────────

export type TableCheckoutLink = {
  sessionId: string;
  billNo: number;
  version: number;
};

/** The `tableSession` field of an add-order-detail body, if it has one. */
export function parseTableCheckoutLink(raw: unknown): TableCheckoutLink | null | "invalid" {
  if (raw == null) return null;
  if (typeof raw !== "object") return "invalid";
  const r = raw as Record<string, unknown>;
  const billNo = Number(r.billNo ?? 1);
  const version = Number(r.version);
  if (
    typeof r.id !== "string" ||
    !LINE_ID.test(r.id) ||
    !Number.isInteger(billNo) ||
    billNo < 1 ||
    !Number.isInteger(version)
  ) {
    return "invalid";
  }
  return { sessionId: r.id, billNo, version };
}

/**
 * Prove the cart being paid is exactly this bill, with the seating locked.
 *
 * The cashier holds the bill in a local tab, and the host can change it from
 * another device at any moment — move a drink to the next table, split the
 * bill. Paying a stale copy would book an order that no longer matches the
 * table: the moved drink charged twice, or an item added by the waiter never
 * charged at all. So the cart has to match the unpaid lines line for line and
 * the version has to be the one the tab last saw; anything else is a 409 the
 * cashier resolves by reloading the bill, never a sale.
 *
 * Returns the table label to freeze on the order (orders.table_label), read
 * here while the seating is locked and still holds its tables — once the host
 * clears it, nothing remembers where the bill was eaten. NULL if it holds none.
 */
export async function prepareTableCheckout(
  tx: Tx,
  outletId: number,
  link: TableCheckoutLink,
  cart: unknown[],
): Promise<{ tableLabel: string | null }> {
  const [session] = await tx
    .select({
      status: tableSessionsTable.status,
      version: tableSessionsTable.version,
    })
    .from(tableSessionsTable)
    .where(
      and(eq(tableSessionsTable.id, link.sessionId), eq(tableSessionsTable.outlet_id, outletId)),
    )
    .limit(1)
    .for("update");

  if (!session) throw new HttpError(404, "Sesi meja tidak ditemukan", "TABLE_CONFLICT");
  if (session.status !== "open") {
    throw new HttpError(409, "Bill meja ini sudah dibayar atau sudah ditutup.", "TABLE_CONFLICT");
  }
  if (session.version !== link.version) {
    throw new HttpError(
      409,
      "Bill meja ini diubah dari perangkat lain. Muat ulang bill, lalu bayar lagi.",
      "TABLE_CONFLICT",
    );
  }

  const unpaid = await tx
    .select({ id: tableSessionLinesTable.id, quantity: tableSessionLinesTable.quantity })
    .from(tableSessionLinesTable)
    .where(
      and(
        eq(tableSessionLinesTable.session_id, link.sessionId),
        eq(tableSessionLinesTable.bill_no, link.billNo),
        isNull(tableSessionLinesTable.order_id),
      ),
    );
  if (unpaid.length === 0) {
    throw new HttpError(409, "Bill ini tidak punya item yang belum dibayar.", "TABLE_CONFLICT");
  }

  const posted = new Map<string, number>();
  for (const item of cart as Record<string, unknown>[]) {
    posted.set(String(item?.lineId ?? ""), Number(item?.quantity));
  }
  const matches =
    posted.size === unpaid.length && unpaid.every((l) => posted.get(l.id) === l.quantity);
  if (!matches) {
    throw new HttpError(
      409,
      "Isi keranjang tidak sama dengan bill yang tersimpan. Simpan bill atau muat ulang, lalu bayar lagi.",
      "TABLE_CONFLICT",
    );
  }

  const label = await sessionTableLabel(tx, link.sessionId);
  return { tableLabel: label ? label.slice(0, 40) : null };
}

/**
 * Stamp the bill's lines with the order they became. Called in the SAME
 * transaction as the order insert, after it, so the FK resolves and a failure
 * anywhere leaves both untouched.
 *
 * When that was the last unpaid bill the seating turns "paid" — the guests
 * may still be at the table, and clearing it is the host's call.
 */
export async function settleTableBill(tx: Tx, link: TableCheckoutLink, orderId: string) {
  const now = new Date();
  await tx
    .update(tableSessionLinesTable)
    .set({ order_id: orderId, updated_at: now })
    .where(
      and(
        eq(tableSessionLinesTable.session_id, link.sessionId),
        eq(tableSessionLinesTable.bill_no, link.billNo),
        isNull(tableSessionLinesTable.order_id),
      ),
    );

  const [left] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(tableSessionLinesTable)
    .where(
      and(
        eq(tableSessionLinesTable.session_id, link.sessionId),
        isNull(tableSessionLinesTable.order_id),
      ),
    );

  await tx
    .update(tableSessionsTable)
    .set({
      version: sql`${tableSessionsTable.version} + 1`,
      updatedAt: now,
      ...(Number(left?.n ?? 0) === 0 ? { status: "paid", paid_at: now } : {}),
    })
    .where(eq(tableSessionsTable.id, link.sessionId));
}

/**
 * The undo of settleTableBill, for a table sale that was cancelled: its lines
 * go back on the table as unpaid. The usual reason to cancel is a mistake — the
 * wrong method, the wrong item — and the next thing the cashier does is ring
 * the bill up again, which only the table can do (it is what freezes the table
 * label onto the order). Left pointing at the cancelled order, the items would
 * read as paid forever and the floor's "sudah dibayar" would count money that
 * was refunded.
 *
 * Only while the seating is still live. Once the host has cleared the table
 * there is no bill to go back to, and the lines stay with the cancelled order
 * as the record of what it was. A bill paid before its table was merged into
 * another stays with the closed seating for the same reason.
 *
 * Called inside the cancel's transaction, after the order row is locked. The
 * stock the cancel just returned leaves again when the bill is re-paid;
 * sent_qty is kept, so the kitchen is not told about food it already made.
 * Returns the seating it reopened, or null when there was none to reopen.
 */
export async function reopenCancelledTableBill(
  tx: Tx,
  outletId: number,
  orderId: string,
): Promise<string | null> {
  const [line] = await tx
    .select({ sessionId: tableSessionLinesTable.session_id })
    .from(tableSessionLinesTable)
    .where(eq(tableSessionLinesTable.order_id, orderId))
    .limit(1);
  if (!line) return null;

  const [session] = await tx
    .select({ id: tableSessionsTable.id, status: tableSessionsTable.status })
    .from(tableSessionsTable)
    .where(
      and(
        eq(tableSessionsTable.id, line.sessionId),
        eq(tableSessionsTable.outlet_id, outletId),
        LIVE_SESSION,
        inArray(tableSessionsTable.status, ["open", "paid"]),
      ),
    )
    .limit(1)
    .for("update");
  if (!session) return null;

  const now = new Date();
  await tx
    .update(tableSessionLinesTable)
    .set({ order_id: null, updated_at: now })
    .where(
      and(
        eq(tableSessionLinesTable.session_id, session.id),
        eq(tableSessionLinesTable.order_id, orderId),
      ),
    );

  // Food on the table that nobody has paid for: the seating is open again.
  // The version moves too, so a till holding this table reloads before paying.
  await tx
    .update(tableSessionsTable)
    .set({
      version: sql`${tableSessionsTable.version} + 1`,
      updatedAt: now,
      ...(session.status === "paid" ? { status: "open", paid_at: null } : {}),
    })
    .where(eq(tableSessionsTable.id, session.id));

  // The kitchen tickets learnt the cancelled order's number. Forget it, so the
  // re-payment hands them the new one — linkKitchenTickets only fills blanks.
  await tx
    .update(kitchenTicketsTable)
    .set({ order_id: null, updated_at: now })
    .where(and(eq(kitchenTicketsTable.order_id, orderId), eq(kitchenTicketsTable.source, "table")));

  return session.id;
}

/** Unpaid lines of a seating, oldest first. */
export async function unpaidLines(tx: Tx | typeof db, sessionId: string, ids?: string[]) {
  return tx
    .select()
    .from(tableSessionLinesTable)
    .where(
      and(
        eq(tableSessionLinesTable.session_id, sessionId),
        isNull(tableSessionLinesTable.order_id),
        ids ? inArray(tableSessionLinesTable.id, ids) : undefined,
      ),
    )
    .orderBy(tableSessionLinesTable.created_at, tableSessionLinesTable.id);
}
