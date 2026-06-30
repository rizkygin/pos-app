import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { and, eq, desc, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  suppliersTable,
  invoicesTable,
  invoiceItemsTable,
  stockMovementsTable,
  productsTable,
  cashFlows,
  cashOutCategoryTable,
  cashOutDetailTable,
} from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { getOutletByUserId } from "../lib/outlet-id";

// Cash-out category used when a purchase invoice is paid (seeded in CATEGORY_OUT).
const PURCHASE_CASH_CATEGORY = "Pembelian stok barang dagang";

// Resolve the authenticated owner's outlet, or send the matching error + return
// null. Mirrors the getSession -> getOutletByUserId pattern used across routes.
async function getOwnerOutlet(request: FastifyRequest, reply: FastifyReply) {
  const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
  if (!session?.user) {
    reply.status(401).send({ success: false, error: "Unauthorized" });
    return null;
  }
  const outlet = await getOutletByUserId(session.user.id);
  if (!outlet) {
    reply.status(403).send({ success: false, error: "No outlet found" });
    return null;
  }
  return outlet;
}

type ItemInput = {
  product_id?: string | null;
  description?: string;
  quantity?: number | string;
  unit_price?: number | string;
};

// Compute money for an invoice from its line items. All money is handled as
// numbers here and stored as numeric strings. tax_rate is a percentage.
function computeTotals(
  items: ItemInput[],
  taxRate: number,
  discount: number,
  taxInclusive: boolean,
) {
  const lines = items.map((it) => {
    const qty = Number(it.quantity ?? 0);
    const price = Number(it.unit_price ?? 0);
    const line_total = +(qty * price).toFixed(2);
    return { qty, price, line_total };
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

async function nextInvoiceNumber(outletId: number, type: "purchase" | "sales") {
  const prefix = type === "purchase" ? "PB" : "PJ";
  const year = new Date().getFullYear();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.outlet_id, outletId), eq(invoicesTable.type, type)));
  return `${prefix}/${year}/${String(Number(n) + 1).padStart(4, "0")}`;
}

export async function invoiceRoutes(app: FastifyInstance) {
  // ----------------------------------------------------------------- suppliers
  app.get("/api/suppliers", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply);
    if (!outlet) return;
    const rows = await db
      .select()
      .from(suppliersTable)
      .where(and(eq(suppliersTable.outlet_id, outlet.id), isNull(suppliersTable.deletedAt)))
      .orderBy(suppliersTable.name);
    return { success: true, data: rows };
  });

  app.post("/api/suppliers", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply);
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
    const outlet = await getOwnerOutlet(request, reply);
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
    const outlet = await getOwnerOutlet(request, reply);
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
  app.get("/api/purchase-invoices", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply);
    if (!outlet) return;
    const { status } = request.query as { status?: string };
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
  });

  app.get("/api/purchase-invoices/:id", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply);
    if (!outlet) return;
    const id = Number((request.params as { id: string }).id);
    const [invoice] = await db
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.outlet_id, outlet.id), eq(invoicesTable.type, "purchase")))
      .limit(1);
    if (!invoice) return reply.status(404).send({ success: false, error: "Faktur tidak ditemukan" });
    const items = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoice_id, id));
    return { success: true, data: { ...invoice, items } };
  });

  app.post("/api/purchase-invoices", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply);
    if (!outlet) return;
    const body = request.body as {
      supplier_id?: number | null;
      party_name?: string;
      issue_date?: string;
      due_date?: string;
      tax_rate?: number | string;
      tax_inclusive?: boolean;
      discount?: number | string;
      notes?: string;
      items?: ItemInput[];
    };

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return reply.status(400).send({ success: false, error: "Minimal satu item" });

    const taxRate = Number(body.tax_rate ?? 0);
    const discount = Number(body.discount ?? 0);
    const taxInclusive = !!body.tax_inclusive;
    const { lines, subtotal, tax_amount, total } = computeTotals(items, taxRate, discount, taxInclusive);

    const number = await nextInvoiceNumber(outlet.id, "purchase");

    const created = await db.transaction(async (tx) => {
      const [invoice] = await tx
        .insert(invoicesTable)
        .values({
          outlet_id: outlet.id,
          type: "purchase",
          number,
          status: "draft",
          supplier_id: body.supplier_id ?? null,
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
          line_total: String(lines[i].line_total),
        })),
      );
      return invoice;
    });

    return reply.status(201).send({ success: true, data: created });
  });

  // Post a draft: write stock-IN movements + bump products.stock. Idempotent —
  // only a draft can be posted.
  app.post("/api/purchase-invoices/:id/post", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply);
    if (!outlet) return;
    const id = Number((request.params as { id: string }).id);

    try {
      const result = await db.transaction(async (tx) => {
        const [invoice] = await tx
          .select()
          .from(invoicesTable)
          .where(and(eq(invoicesTable.id, id), eq(invoicesTable.outlet_id, outlet.id), eq(invoicesTable.type, "purchase")))
          .limit(1);
        if (!invoice) throw new Error("NOT_FOUND");
        if (invoice.status !== "draft") throw new Error("NOT_DRAFT");

        const items = await tx.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoice_id, id));
        for (const it of items) {
          if (!it.product_id) continue; // non-stock line
          await tx.insert(stockMovementsTable).values({
            outlet_id: outlet.id,
            product_id: it.product_id,
            qty_change: it.quantity, // positive = stock in
            reason: "purchase",
            invoice_id: id,
          });
          await tx
            .update(productsTable)
            .set({ stock: sql`${productsTable.stock} + ${it.quantity}::numeric` })
            .where(eq(productsTable.id, it.product_id));
        }

        const [updated] = await tx
          .update(invoicesTable)
          .set({ status: "posted" })
          .where(eq(invoicesTable.id, id))
          .returning();
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
  app.post("/api/purchase-invoices/:id/pay", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply);
    if (!outlet) return;
    const id = Number((request.params as { id: string }).id);
    const body = request.body as { amount?: number | string };

    try {
      const result = await db.transaction(async (tx) => {
        const [invoice] = await tx
          .select()
          .from(invoicesTable)
          .where(and(eq(invoicesTable.id, id), eq(invoicesTable.outlet_id, outlet.id), eq(invoicesTable.type, "purchase")))
          .limit(1);
        if (!invoice) throw new Error("NOT_FOUND");
        if (invoice.status !== "posted" && invoice.status !== "partial") throw new Error("NOT_PAYABLE");

        const total = Number(invoice.total);
        const alreadyPaid = Number(invoice.amount_paid);
        const remaining = +(total - alreadyPaid).toFixed(2);
        const amount = body.amount != null ? Number(body.amount) : remaining;
        if (!(amount > 0) || amount > remaining + 0.001) throw new Error("BAD_AMOUNT");

        // Find-or-create the cash-out category so payment never depends on a
        // pre-seeded categories table (it's empty on fresh DBs).
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
          .values({ category_id: cat.id, money_amount: String(amount), type: "cash" })
          .returning();
        await tx.insert(cashFlows).values({ outlet_id: outlet.id, cash_out_detail_id: detail.id });

        const newPaid = +(alreadyPaid + amount).toFixed(2);
        const status = newPaid >= total - 0.001 ? "paid" : "partial";
        const [updated] = await tx
          .update(invoicesTable)
          .set({ amount_paid: String(newPaid), status, cash_out_detail_id: detail.id })
          .where(eq(invoicesTable.id, id))
          .returning();
        return updated;
      });
      return { success: true, data: result };
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (msg.includes("NOT_FOUND")) return reply.status(404).send({ success: false, error: "Faktur tidak ditemukan" });
      if (msg.includes("NOT_PAYABLE")) return reply.status(409).send({ success: false, error: "Faktur harus diposting dulu" });
      if (msg.includes("BAD_AMOUNT")) return reply.status(400).send({ success: false, error: "Nominal pembayaran tidak valid" });
      if (msg.includes("NO_CATEGORY")) return reply.status(500).send({ success: false, error: "Kategori kas keluar belum ada" });
      return reply.status(500).send({ success: false, error: msg });
    }
  });

  // Void: reverse stock movements (and the linked cashflow, if paid). Allowed
  // from posted/partial/paid; a draft is just deleted-equivalent (set void).
  app.post("/api/purchase-invoices/:id/void", async (request, reply) => {
    const outlet = await getOwnerOutlet(request, reply);
    if (!outlet) return;
    const id = Number((request.params as { id: string }).id);

    try {
      const result = await db.transaction(async (tx) => {
        const [invoice] = await tx
          .select()
          .from(invoicesTable)
          .where(and(eq(invoicesTable.id, id), eq(invoicesTable.outlet_id, outlet.id), eq(invoicesTable.type, "purchase")))
          .limit(1);
        if (!invoice) throw new Error("NOT_FOUND");
        if (invoice.status === "void") throw new Error("ALREADY_VOID");

        // Reverse each posted stock movement once.
        const moves = await tx
          .select()
          .from(stockMovementsTable)
          .where(and(eq(stockMovementsTable.invoice_id, id), eq(stockMovementsTable.reason, "purchase")));
        for (const m of moves) {
          await tx.insert(stockMovementsTable).values({
            outlet_id: outlet.id,
            product_id: m.product_id,
            qty_change: String(-Number(m.qty_change)),
            reason: "void",
            invoice_id: id,
          });
          await tx
            .update(productsTable)
            .set({ stock: sql`${productsTable.stock} - ${m.qty_change}::numeric` })
            .where(eq(productsTable.id, m.product_id));
        }

        // Null the invoice's reference FIRST so the cashOutDetail FK is free to
        // delete, then remove the cashflow effect (cashFlows before its detail).
        const coutId = invoice.cash_out_detail_id;
        const [updated] = await tx
          .update(invoicesTable)
          .set({ status: "void", amount_paid: "0", cash_out_detail_id: null })
          .where(eq(invoicesTable.id, id))
          .returning();
        if (coutId) {
          await tx.delete(cashFlows).where(eq(cashFlows.cash_out_detail_id, coutId));
          await tx.delete(cashOutDetailTable).where(eq(cashOutDetailTable.id, coutId));
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
}
