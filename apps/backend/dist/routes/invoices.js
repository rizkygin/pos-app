"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invoiceRoutes = invoiceRoutes;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const outlet_access_1 = require("../lib/outlet-access");
const stock_1 = require("../lib/stock");
const timezone_1 = require("../lib/timezone");
// Cashflow categories used when an invoice is paid (seeded in CATEGORY_OUT/IN).
const PURCHASE_CASH_CATEGORY = "Pembelian stok barang dagang";
const SALES_CASH_CATEGORY = "Penjualan produk/jasa";
// Resolve the caller's outlet (owner OR active employee holding `perm`), or
// send the matching error + return null. Owners implicitly hold every
// permission; see lib/outlet-access.ts.
async function getOwnerOutlet(request, reply, perm) {
    const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, perm);
    return access ? access.outlet : null;
}
// Compute money for an invoice from its line items. All money is handled as
// numbers here and stored as numeric strings. tax_rate is a percentage.
// Each line's percentage discount is applied first (baked into line_total),
// then the invoice-level `discount` (Rp) is subtracted, then tax.
function computeTotals(items, taxRate, discount, taxInclusive) {
    const lines = items.map((it) => {
        const qty = Number(it.quantity ?? 0);
        const price = Number(it.unit_price ?? 0);
        const discPct = Math.min(100, Math.max(0, Number(it.discount_pct ?? 0)));
        const line_total = +(qty * price * (1 - discPct / 100)).toFixed(2);
        return { qty, price, discPct, line_total };
    });
    const subtotal = +lines.reduce((s, l) => s + l.line_total, 0).toFixed(2);
    const base = Math.max(0, subtotal - discount);
    let tax_amount;
    let total;
    if (taxInclusive) {
        // Prices already include tax: extract the embedded tax from the base.
        tax_amount = +(base - base / (1 + taxRate / 100)).toFixed(2);
        total = base;
    }
    else {
        tax_amount = +((base * taxRate) / 100).toFixed(2);
        total = +(base + tax_amount).toFixed(2);
    }
    return { lines, subtotal, tax_amount, total };
}
// Record `amount` as a cash-IN payment on a sales invoice inside an open
// transaction: find-or-create the category, write the cashflow detail + link +
// payment row, then bump amount_paid/status. Used by /pay and by /post when the
// draft carried a down payment. The caller validates the amount.
async function recordSalesCashIn(tx, outletId, invoice, amount) {
    let [cat] = await tx
        .select({ id: schema_1.cashInCategoryTable.id })
        .from(schema_1.cashInCategoryTable)
        .where((0, drizzle_orm_1.eq)(schema_1.cashInCategoryTable.category, SALES_CASH_CATEGORY))
        .limit(1);
    if (!cat) {
        [cat] = await tx
            .insert(schema_1.cashInCategoryTable)
            .values({ category: SALES_CASH_CATEGORY })
            .returning({ id: schema_1.cashInCategoryTable.id });
    }
    const [detail] = await tx
        .insert(schema_1.cashInDetailTable)
        .values({ category_id: cat.id, money_amount: String(amount), type: "cash" })
        .returning();
    await tx.insert(schema_1.cashFlows).values({ outlet_id: outletId, cash_in_detail_id: detail.id });
    await tx.insert(schema_1.invoicePaymentsTable).values({
        invoice_id: invoice.id,
        cash_in_detail_id: detail.id,
        amount: String(amount),
    });
    const newPaid = +(Number(invoice.amount_paid) + amount).toFixed(2);
    const status = newPaid >= Number(invoice.total) - 0.001 ? "paid" : "partial";
    const [updated] = await tx
        .update(schema_1.invoicesTable)
        .set({ amount_paid: String(newPaid), status, cash_in_detail_id: detail.id })
        .where((0, drizzle_orm_1.eq)(schema_1.invoicesTable.id, invoice.id))
        .returning();
    return updated;
}
// Purchase mirror of recordSalesCashIn: record `amount` as a cash-OUT payment on
// a purchase invoice inside an open transaction — find-or-create the category,
// write the cashflow detail + link + payment row, then bump amount_paid/status.
// Used by /pay and by /post when the draft carried a down payment.
async function recordPurchaseCashOut(tx, outletId, invoice, amount) {
    let [cat] = await tx
        .select({ id: schema_1.cashOutCategoryTable.id })
        .from(schema_1.cashOutCategoryTable)
        .where((0, drizzle_orm_1.eq)(schema_1.cashOutCategoryTable.category, PURCHASE_CASH_CATEGORY))
        .limit(1);
    if (!cat) {
        [cat] = await tx
            .insert(schema_1.cashOutCategoryTable)
            .values({ category: PURCHASE_CASH_CATEGORY })
            .returning({ id: schema_1.cashOutCategoryTable.id });
    }
    const [detail] = await tx
        .insert(schema_1.cashOutDetailTable)
        .values({ category_id: cat.id, money_amount: String(amount), type: "cash" })
        .returning();
    await tx.insert(schema_1.cashFlows).values({ outlet_id: outletId, cash_out_detail_id: detail.id });
    await tx.insert(schema_1.invoicePaymentsTable).values({
        invoice_id: invoice.id,
        cash_out_detail_id: detail.id,
        amount: String(amount),
    });
    const newPaid = +(Number(invoice.amount_paid) + amount).toFixed(2);
    const status = newPaid >= Number(invoice.total) - 0.001 ? "paid" : "partial";
    const [updated] = await tx
        .update(schema_1.invoicesTable)
        .set({ amount_paid: String(newPaid), status, cash_out_detail_id: detail.id })
        .where((0, drizzle_orm_1.eq)(schema_1.invoicesTable.id, invoice.id))
        .returning();
    return updated;
}
async function nextInvoiceNumber(outletId, type) {
    const prefix = type === "purchase" ? "PB" : "PJ";
    // Invoice numbers are permanent document identity: derive the year in the
    // app's zone so one issued on 31 Dec evening is not numbered into next year.
    const year = (0, timezone_1.yearIn)();
    const [{ n }] = await db_1.db
        .select({ n: (0, drizzle_orm_1.sql) `count(*)::int` })
        .from(schema_1.invoicesTable)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.invoicesTable.outlet_id, outletId), (0, drizzle_orm_1.eq)(schema_1.invoicesTable.type, type)));
    return `${prefix}/${year}/${String(Number(n) + 1).padStart(4, "0")}`;
}
async function invoiceRoutes(app) {
    // ----------------------------------------------------------------- suppliers
    app.get("/api/suppliers", async (request, reply) => {
        const outlet = await getOwnerOutlet(request, reply, "purchaseInvoice");
        if (!outlet)
            return;
        const rows = await db_1.db
            .select()
            .from(schema_1.suppliersTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.suppliersTable.outlet_id, outlet.id), (0, drizzle_orm_1.isNull)(schema_1.suppliersTable.deletedAt)))
            .orderBy(schema_1.suppliersTable.name);
        return { success: true, data: rows };
    });
    app.post("/api/suppliers", async (request, reply) => {
        const outlet = await getOwnerOutlet(request, reply, "purchaseInvoice");
        if (!outlet)
            return;
        const body = request.body;
        if (!body?.name?.trim())
            return reply.status(400).send({ success: false, error: "Nama supplier wajib diisi" });
        const [row] = await db_1.db
            .insert(schema_1.suppliersTable)
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
        if (!outlet)
            return;
        const id = Number(request.params.id);
        const body = request.body;
        const [row] = await db_1.db
            .update(schema_1.suppliersTable)
            .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.phone !== undefined ? { phone: body.phone } : {}),
            ...(body.email !== undefined ? { email: body.email } : {}),
            ...(body.address !== undefined ? { address: body.address } : {}),
            ...(body.note !== undefined ? { note: body.note } : {}),
        })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.suppliersTable.id, id), (0, drizzle_orm_1.eq)(schema_1.suppliersTable.outlet_id, outlet.id)))
            .returning();
        if (!row)
            return reply.status(404).send({ success: false, error: "Supplier tidak ditemukan" });
        return { success: true, data: row };
    });
    app.delete("/api/suppliers/:id", async (request, reply) => {
        const outlet = await getOwnerOutlet(request, reply, "purchaseInvoice");
        if (!outlet)
            return;
        const id = Number(request.params.id);
        const [row] = await db_1.db
            .update(schema_1.suppliersTable)
            .set({ deletedAt: new Date() })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.suppliersTable.id, id), (0, drizzle_orm_1.eq)(schema_1.suppliersTable.outlet_id, outlet.id)))
            .returning();
        if (!row)
            return reply.status(404).send({ success: false, error: "Supplier tidak ditemukan" });
        return { success: true };
    });
    // -------------------------------------------------------- purchase invoices
    app.get("/api/purchase-invoices", async (request, reply) => {
        const outlet = await getOwnerOutlet(request, reply, "purchaseInvoice");
        if (!outlet)
            return;
        const { status } = request.query;
        const rows = await db_1.db
            .select({
            id: schema_1.invoicesTable.id,
            number: schema_1.invoicesTable.number,
            status: schema_1.invoicesTable.status,
            supplier_id: schema_1.invoicesTable.supplier_id,
            supplier_name: schema_1.suppliersTable.name,
            party_name: schema_1.invoicesTable.party_name,
            issue_date: schema_1.invoicesTable.issue_date,
            due_date: schema_1.invoicesTable.due_date,
            total: schema_1.invoicesTable.total,
            amount_paid: schema_1.invoicesTable.amount_paid,
        })
            .from(schema_1.invoicesTable)
            .leftJoin(schema_1.suppliersTable, (0, drizzle_orm_1.eq)(schema_1.invoicesTable.supplier_id, schema_1.suppliersTable.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.invoicesTable.outlet_id, outlet.id), (0, drizzle_orm_1.eq)(schema_1.invoicesTable.type, "purchase"), (0, drizzle_orm_1.isNull)(schema_1.invoicesTable.deletedAt), status && status !== "all" ? (0, drizzle_orm_1.eq)(schema_1.invoicesTable.status, status) : undefined))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.invoicesTable.issue_date));
        return { success: true, data: rows };
    });
    app.get("/api/purchase-invoices/:id", async (request, reply) => {
        const outlet = await getOwnerOutlet(request, reply, "purchaseInvoice");
        if (!outlet)
            return;
        const id = Number(request.params.id);
        const [invoice] = await db_1.db
            .select()
            .from(schema_1.invoicesTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.invoicesTable.id, id), (0, drizzle_orm_1.eq)(schema_1.invoicesTable.outlet_id, outlet.id), (0, drizzle_orm_1.eq)(schema_1.invoicesTable.type, "purchase")))
            .limit(1);
        if (!invoice)
            return reply.status(404).send({ success: false, error: "Faktur tidak ditemukan" });
        const items = await db_1.db.select().from(schema_1.invoiceItemsTable).where((0, drizzle_orm_1.eq)(schema_1.invoiceItemsTable.invoice_id, id));
        // Include the outlet (for the print header/logo) and the supplier (recipient).
        let supplier = null;
        if (invoice.supplier_id) {
            [supplier] = await db_1.db
                .select({ name: schema_1.suppliersTable.name, phone: schema_1.suppliersTable.phone, address: schema_1.suppliersTable.address, email: schema_1.suppliersTable.email })
                .from(schema_1.suppliersTable)
                .where((0, drizzle_orm_1.eq)(schema_1.suppliersTable.id, invoice.supplier_id))
                .limit(1);
        }
        let created_by_name = null;
        if (invoice.created_by) {
            const [creator] = await db_1.db
                .select({ name: schema_1.usersTable.name })
                .from(schema_1.usersTable)
                .where((0, drizzle_orm_1.eq)(schema_1.usersTable.id, invoice.created_by))
                .limit(1);
            created_by_name = creator?.name ?? null;
        }
        return { success: true, data: { ...invoice, items, outlet, supplier, created_by_name } };
    });
    app.post("/api/purchase-invoices", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "purchaseInvoice");
        if (!access)
            return;
        const outlet = access.outlet;
        const body = request.body;
        const items = Array.isArray(body.items) ? body.items : [];
        if (items.length === 0)
            return reply.status(400).send({ success: false, error: "Minimal satu item" });
        const taxRate = Number(body.tax_rate ?? 0);
        const discount = Number(body.discount ?? 0);
        const taxInclusive = !!body.tax_inclusive;
        const { lines, subtotal, tax_amount, total } = computeTotals(items, taxRate, discount, taxInclusive);
        // Clamp the agreed DP to [0, total]; it's booked as a cash-out on post.
        const downPayment = Math.max(0, Math.min(Number(body.down_payment ?? 0), total));
        const number = await nextInvoiceNumber(outlet.id, "purchase");
        const created = await db_1.db.transaction(async (tx) => {
            const [invoice] = await tx
                .insert(schema_1.invoicesTable)
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
                created_by: access.userId,
                down_payment: String(downPayment),
                notes: body.notes ?? "",
            })
                .returning();
            await tx.insert(schema_1.invoiceItemsTable).values(items.map((it, i) => ({
                invoice_id: invoice.id,
                product_id: it.product_id ?? null,
                description: it.description ?? "",
                quantity: String(lines[i].qty),
                unit_price: String(lines[i].price),
                discount_pct: String(lines[i].discPct),
                line_total: String(lines[i].line_total),
            })));
            return invoice;
        });
        return reply.status(201).send({ success: true, data: created });
    });
    // Post a draft: write stock-IN movements + bump products.stock. Idempotent —
    // only a draft can be posted.
    app.post("/api/purchase-invoices/:id/post", async (request, reply) => {
        const outlet = await getOwnerOutlet(request, reply, "purchaseInvoice");
        if (!outlet)
            return;
        const id = Number(request.params.id);
        try {
            const result = await db_1.db.transaction(async (tx) => {
                const [invoice] = await tx
                    .select()
                    .from(schema_1.invoicesTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.invoicesTable.id, id), (0, drizzle_orm_1.eq)(schema_1.invoicesTable.outlet_id, outlet.id), (0, drizzle_orm_1.eq)(schema_1.invoicesTable.type, "purchase")))
                    .limit(1);
                if (!invoice)
                    throw new Error("NOT_FOUND");
                if (invoice.status !== "draft")
                    throw new Error("NOT_DRAFT");
                const items = await tx.select().from(schema_1.invoiceItemsTable).where((0, drizzle_orm_1.eq)(schema_1.invoiceItemsTable.invoice_id, id));
                for (const it of items) {
                    if (!it.product_id)
                        continue; // non-stock line
                    // Skip products that don't track their own stock (recipe/service items).
                    const [p] = await tx
                        .select({ track_stock: schema_1.productsTable.track_stock })
                        .from(schema_1.productsTable)
                        .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, it.product_id))
                        .limit(1);
                    if (!p?.track_stock)
                        continue;
                    await tx.insert(schema_1.stockMovementsTable).values({
                        outlet_id: outlet.id,
                        product_id: it.product_id,
                        qty_change: it.quantity, // positive = stock in
                        reason: "purchase",
                        invoice_id: id,
                    });
                    await tx
                        .update(schema_1.productsTable)
                        .set({ stock: (0, drizzle_orm_1.sql) `${schema_1.productsTable.stock} + ${it.quantity}::numeric` })
                        .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, it.product_id));
                }
                let [updated] = await tx
                    .update(schema_1.invoicesTable)
                    .set({ status: "posted" })
                    .where((0, drizzle_orm_1.eq)(schema_1.invoicesTable.id, id))
                    .returning();
                // Book the agreed down payment as the first cash-out. Status becomes
                // partial (or paid, if the DP covers the whole invoice).
                const dp = Math.min(Number(invoice.down_payment), Number(invoice.total));
                if (dp > 0) {
                    updated = await recordPurchaseCashOut(tx, outlet.id, { id, total: invoice.total, amount_paid: invoice.amount_paid }, dp);
                }
                return updated;
            });
            return { success: true, data: result };
        }
        catch (e) {
            const msg = String(e instanceof Error ? e.message : e);
            if (msg.includes("NOT_FOUND"))
                return reply.status(404).send({ success: false, error: "Faktur tidak ditemukan" });
            if (msg.includes("NOT_DRAFT"))
                return reply.status(409).send({ success: false, error: "Hanya draft yang bisa diposting" });
            return reply.status(500).send({ success: false, error: msg });
        }
    });
    // Pay (full or partial): record a cash-OUT (detail + cashFlows link) and update
    // amount_paid/status. Requires a posted/partial invoice.
    app.post("/api/purchase-invoices/:id/pay", async (request, reply) => {
        const outlet = await getOwnerOutlet(request, reply, "purchaseInvoice");
        if (!outlet)
            return;
        const id = Number(request.params.id);
        const body = request.body;
        try {
            const result = await db_1.db.transaction(async (tx) => {
                const [invoice] = await tx
                    .select()
                    .from(schema_1.invoicesTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.invoicesTable.id, id), (0, drizzle_orm_1.eq)(schema_1.invoicesTable.outlet_id, outlet.id), (0, drizzle_orm_1.eq)(schema_1.invoicesTable.type, "purchase")))
                    .limit(1);
                if (!invoice)
                    throw new Error("NOT_FOUND");
                if (invoice.status !== "posted" && invoice.status !== "partial")
                    throw new Error("NOT_PAYABLE");
                const total = Number(invoice.total);
                const alreadyPaid = Number(invoice.amount_paid);
                const remaining = +(total - alreadyPaid).toFixed(2);
                const amount = body.amount != null ? Number(body.amount) : remaining;
                if (!(amount > 0) || amount > remaining + 0.001)
                    throw new Error("BAD_AMOUNT");
                return recordPurchaseCashOut(tx, outlet.id, invoice, amount);
            });
            return { success: true, data: result };
        }
        catch (e) {
            const msg = String(e instanceof Error ? e.message : e);
            if (msg.includes("NOT_FOUND"))
                return reply.status(404).send({ success: false, error: "Faktur tidak ditemukan" });
            if (msg.includes("NOT_PAYABLE"))
                return reply.status(409).send({ success: false, error: "Faktur harus diposting dulu" });
            if (msg.includes("BAD_AMOUNT"))
                return reply.status(400).send({ success: false, error: "Nominal pembayaran tidak valid" });
            if (msg.includes("NO_CATEGORY"))
                return reply.status(500).send({ success: false, error: "Kategori kas keluar belum ada" });
            return reply.status(500).send({ success: false, error: msg });
        }
    });
    // Void: reverse stock movements (and the linked cashflow, if paid). Allowed
    // from posted/partial/paid; a draft is just deleted-equivalent (set void).
    app.post("/api/purchase-invoices/:id/void", async (request, reply) => {
        const outlet = await getOwnerOutlet(request, reply, "purchaseInvoice");
        if (!outlet)
            return;
        const id = Number(request.params.id);
        try {
            const result = await db_1.db.transaction(async (tx) => {
                const [invoice] = await tx
                    .select()
                    .from(schema_1.invoicesTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.invoicesTable.id, id), (0, drizzle_orm_1.eq)(schema_1.invoicesTable.outlet_id, outlet.id), (0, drizzle_orm_1.eq)(schema_1.invoicesTable.type, "purchase")))
                    .limit(1);
                if (!invoice)
                    throw new Error("NOT_FOUND");
                if (invoice.status === "void")
                    throw new Error("ALREADY_VOID");
                // Reverse each posted stock movement once.
                const moves = await tx
                    .select()
                    .from(schema_1.stockMovementsTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.stockMovementsTable.invoice_id, id), (0, drizzle_orm_1.eq)(schema_1.stockMovementsTable.reason, "purchase")));
                for (const m of moves) {
                    await tx.insert(schema_1.stockMovementsTable).values({
                        outlet_id: outlet.id,
                        product_id: m.product_id,
                        qty_change: String(-Number(m.qty_change)),
                        reason: "void",
                        invoice_id: id,
                    });
                    await tx
                        .update(schema_1.productsTable)
                        .set({ stock: (0, drizzle_orm_1.sql) `${schema_1.productsTable.stock} - ${m.qty_change}::numeric` })
                        .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, m.product_id));
                }
                // Remove ALL payments this invoice generated (DP + installments live in
                // invoice_payments; cash_out_detail_id covers legacy single payments).
                // Null the invoice's reference FIRST so the cashOutDetail FK is free to
                // delete, then remove each cashflow effect (cashFlows before its detail).
                const payments = await tx
                    .select({ detail_id: schema_1.invoicePaymentsTable.cash_out_detail_id })
                    .from(schema_1.invoicePaymentsTable)
                    .where((0, drizzle_orm_1.eq)(schema_1.invoicePaymentsTable.invoice_id, id));
                const detailIds = new Set([...payments.map((p) => p.detail_id), invoice.cash_out_detail_id].filter((v) => v != null));
                const [updated] = await tx
                    .update(schema_1.invoicesTable)
                    .set({ status: "void", amount_paid: "0", cash_out_detail_id: null })
                    .where((0, drizzle_orm_1.eq)(schema_1.invoicesTable.id, id))
                    .returning();
                await tx.delete(schema_1.invoicePaymentsTable).where((0, drizzle_orm_1.eq)(schema_1.invoicePaymentsTable.invoice_id, id));
                for (const detailId of detailIds) {
                    await tx.delete(schema_1.cashFlows).where((0, drizzle_orm_1.eq)(schema_1.cashFlows.cash_out_detail_id, detailId));
                    await tx.delete(schema_1.cashOutDetailTable).where((0, drizzle_orm_1.eq)(schema_1.cashOutDetailTable.id, detailId));
                }
                return updated;
            });
            return { success: true, data: result };
        }
        catch (e) {
            const msg = String(e instanceof Error ? e.message : e);
            if (msg.includes("NOT_FOUND"))
                return reply.status(404).send({ success: false, error: "Faktur tidak ditemukan" });
            if (msg.includes("ALREADY_VOID"))
                return reply.status(409).send({ success: false, error: "Faktur sudah dibatalkan" });
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
    app.get("/api/sales-invoices", async (request, reply) => {
        const outlet = await getOwnerOutlet(request, reply, "salesInvoice");
        if (!outlet)
            return;
        const { status, q, late, page, limit } = request.query;
        const pageN = Math.max(1, Number(page) || 1);
        const limitN = Math.min(100, Math.max(1, Number(limit) || 10));
        // Late = billed but not settled by the end of the due date, i.e. late
        // starting the day AFTER due_date (due dates are stored at midnight).
        const lateCond = (0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.invoicesTable.status, ["posted", "partial"]), (0, drizzle_orm_1.lt)(schema_1.invoicesTable.due_date, (0, drizzle_orm_1.sql) `CURRENT_DATE`));
        const baseConds = [
            (0, drizzle_orm_1.eq)(schema_1.invoicesTable.outlet_id, outlet.id),
            (0, drizzle_orm_1.eq)(schema_1.invoicesTable.type, "sales"),
            (0, drizzle_orm_1.isNull)(schema_1.invoicesTable.deletedAt),
        ];
        const conds = [
            ...baseConds,
            status && status !== "all"
                ? (0, drizzle_orm_1.eq)(schema_1.invoicesTable.status, status)
                : undefined,
            q?.trim()
                ? (0, drizzle_orm_1.or)((0, drizzle_orm_1.ilike)(schema_1.invoicesTable.number, `%${q.trim()}%`), (0, drizzle_orm_1.ilike)(schema_1.invoicesTable.party_name, `%${q.trim()}%`))
                : undefined,
            late === "1" || late === "true" ? lateCond : undefined,
        ];
        const [rows, [{ n: count }], [lateAgg]] = await Promise.all([
            db_1.db
                .select({
                id: schema_1.invoicesTable.id,
                number: schema_1.invoicesTable.number,
                status: schema_1.invoicesTable.status,
                party_name: schema_1.invoicesTable.party_name,
                issue_date: schema_1.invoicesTable.issue_date,
                due_date: schema_1.invoicesTable.due_date,
                total: schema_1.invoicesTable.total,
                amount_paid: schema_1.invoicesTable.amount_paid,
                created_by_name: schema_1.usersTable.name,
            })
                .from(schema_1.invoicesTable)
                .leftJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.usersTable.id, schema_1.invoicesTable.created_by))
                .where((0, drizzle_orm_1.and)(...conds))
                .orderBy((0, drizzle_orm_1.desc)(schema_1.invoicesTable.issue_date), (0, drizzle_orm_1.desc)(schema_1.invoicesTable.id))
                .limit(limitN)
                .offset((pageN - 1) * limitN),
            db_1.db
                .select({ n: (0, drizzle_orm_1.sql) `count(*)::int` })
                .from(schema_1.invoicesTable)
                .where((0, drizzle_orm_1.and)(...conds)),
            db_1.db
                .select({
                n: (0, drizzle_orm_1.sql) `count(*)::int`,
                outstanding: (0, drizzle_orm_1.sql) `coalesce(sum(${schema_1.invoicesTable.total} - ${schema_1.invoicesTable.amount_paid}), 0)`,
            })
                .from(schema_1.invoicesTable)
                .where((0, drizzle_orm_1.and)(...baseConds, lateCond)),
        ]);
        return {
            success: true,
            data: rows,
            count,
            late: { count: lateAgg.n, outstanding: lateAgg.outstanding },
        };
    });
    app.get("/api/sales-invoices/:id", async (request, reply) => {
        const outlet = await getOwnerOutlet(request, reply, "salesInvoice");
        if (!outlet)
            return;
        const id = Number(request.params.id);
        const [invoice] = await db_1.db
            .select()
            .from(schema_1.invoicesTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.invoicesTable.id, id), (0, drizzle_orm_1.eq)(schema_1.invoicesTable.outlet_id, outlet.id), (0, drizzle_orm_1.eq)(schema_1.invoicesTable.type, "sales")))
            .limit(1);
        if (!invoice)
            return reply.status(404).send({ success: false, error: "Faktur tidak ditemukan" });
        const items = await db_1.db.select().from(schema_1.invoiceItemsTable).where((0, drizzle_orm_1.eq)(schema_1.invoiceItemsTable.invoice_id, id));
        let created_by_name = null;
        if (invoice.created_by) {
            const [creator] = await db_1.db
                .select({ name: schema_1.usersTable.name })
                .from(schema_1.usersTable)
                .where((0, drizzle_orm_1.eq)(schema_1.usersTable.id, invoice.created_by))
                .limit(1);
            created_by_name = creator?.name ?? null;
        }
        return { success: true, data: { ...invoice, items, outlet, created_by_name } };
    });
    app.post("/api/sales-invoices", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "salesInvoice");
        if (!access)
            return;
        const outlet = access.outlet;
        const body = request.body;
        const items = Array.isArray(body.items) ? body.items : [];
        if (items.length === 0)
            return reply.status(400).send({ success: false, error: "Minimal satu item" });
        const taxRate = Number(body.tax_rate ?? 0);
        const discount = Number(body.discount ?? 0);
        const { lines, subtotal, tax_amount, total } = computeTotals(items, taxRate, discount, false);
        // Clamp the agreed DP to [0, total]; it's booked as a payment on post.
        const downPayment = Math.max(0, Math.min(Number(body.down_payment ?? 0), total));
        const number = await nextInvoiceNumber(outlet.id, "sales");
        const created = await db_1.db.transaction(async (tx) => {
            const [invoice] = await tx
                .insert(schema_1.invoicesTable)
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
                notes: body.notes ?? "",
            })
                .returning();
            await tx.insert(schema_1.invoiceItemsTable).values(items.map((it, i) => ({
                invoice_id: invoice.id,
                product_id: it.product_id ?? null,
                description: it.description ?? "",
                quantity: String(lines[i].qty),
                unit_price: String(lines[i].price),
                discount_pct: String(lines[i].discPct),
                line_total: String(lines[i].line_total),
            })));
            return invoice;
        });
        return reply.status(201).send({ success: true, data: created });
    });
    // Edit a draft sales invoice: replace header fields + line items and recompute
    // totals. Only a draft may be edited (posted/paid invoices are immutable —
    // void and recreate instead).
    app.put("/api/sales-invoices/:id", async (request, reply) => {
        const outlet = await getOwnerOutlet(request, reply, "salesInvoice");
        if (!outlet)
            return;
        const id = Number(request.params.id);
        const body = request.body;
        const items = Array.isArray(body.items) ? body.items : [];
        if (items.length === 0)
            return reply.status(400).send({ success: false, error: "Minimal satu item" });
        const taxRate = Number(body.tax_rate ?? 0);
        const discount = Number(body.discount ?? 0);
        const { lines, subtotal, tax_amount, total } = computeTotals(items, taxRate, discount, false);
        const downPayment = Math.max(0, Math.min(Number(body.down_payment ?? 0), total));
        try {
            const result = await db_1.db.transaction(async (tx) => {
                const [invoice] = await tx
                    .select()
                    .from(schema_1.invoicesTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.invoicesTable.id, id), (0, drizzle_orm_1.eq)(schema_1.invoicesTable.outlet_id, outlet.id), (0, drizzle_orm_1.eq)(schema_1.invoicesTable.type, "sales")))
                    .limit(1);
                if (!invoice)
                    throw new Error("NOT_FOUND");
                if (invoice.status !== "draft")
                    throw new Error("NOT_DRAFT");
                const [updated] = await tx
                    .update(schema_1.invoicesTable)
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
                    notes: body.notes ?? "",
                })
                    .where((0, drizzle_orm_1.eq)(schema_1.invoicesTable.id, id))
                    .returning();
                await tx.delete(schema_1.invoiceItemsTable).where((0, drizzle_orm_1.eq)(schema_1.invoiceItemsTable.invoice_id, id));
                await tx.insert(schema_1.invoiceItemsTable).values(items.map((it, i) => ({
                    invoice_id: id,
                    product_id: it.product_id ?? null,
                    description: it.description ?? "",
                    quantity: String(lines[i].qty),
                    unit_price: String(lines[i].price),
                    discount_pct: String(lines[i].discPct),
                    line_total: String(lines[i].line_total),
                })));
                return updated;
            });
            return { success: true, data: result };
        }
        catch (e) {
            const msg = String(e instanceof Error ? e.message : e);
            if (msg.includes("NOT_FOUND"))
                return reply.status(404).send({ success: false, error: "Faktur tidak ditemukan" });
            if (msg.includes("NOT_DRAFT"))
                return reply.status(409).send({ success: false, error: "Hanya draft yang bisa diubah" });
            return reply.status(500).send({ success: false, error: msg });
        }
    });
    // Post: stock OUT. Overselling is allowed but reported in `warnings`.
    app.post("/api/sales-invoices/:id/post", async (request, reply) => {
        const outlet = await getOwnerOutlet(request, reply, "salesInvoice");
        if (!outlet)
            return;
        const id = Number(request.params.id);
        try {
            const result = await db_1.db.transaction(async (tx) => {
                const [invoice] = await tx
                    .select()
                    .from(schema_1.invoicesTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.invoicesTable.id, id), (0, drizzle_orm_1.eq)(schema_1.invoicesTable.outlet_id, outlet.id), (0, drizzle_orm_1.eq)(schema_1.invoicesTable.type, "sales")))
                    .limit(1);
                if (!invoice)
                    throw new Error("NOT_FOUND");
                if (invoice.status !== "draft")
                    throw new Error("NOT_DRAFT");
                const items = await tx.select().from(schema_1.invoiceItemsTable).where((0, drizzle_orm_1.eq)(schema_1.invoiceItemsTable.invoice_id, id));
                const warnings = [];
                for (const it of items) {
                    if (!it.product_id)
                        continue;
                    // Own stock for track_stock products, ingredient stock for recipe
                    // products; movements carry invoice_id so void can reverse them.
                    warnings.push(...(await (0, stock_1.applySaleStockOut)(tx, {
                        outletId: outlet.id,
                        productId: it.product_id,
                        qty: Number(it.quantity),
                        invoiceId: id,
                    })));
                }
                let [updated] = await tx
                    .update(schema_1.invoicesTable)
                    .set({ status: "posted" })
                    .where((0, drizzle_orm_1.eq)(schema_1.invoicesTable.id, id))
                    .returning();
                // Book the agreed down payment as the first payment. Status becomes
                // partial (or paid, if the DP covers the whole invoice).
                const dp = Math.min(Number(invoice.down_payment), Number(invoice.total));
                if (dp > 0) {
                    updated = await recordSalesCashIn(tx, outlet.id, { id, total: invoice.total, amount_paid: invoice.amount_paid }, dp);
                }
                return { updated, warnings };
            });
            return { success: true, data: result.updated, warnings: result.warnings };
        }
        catch (e) {
            const msg = String(e instanceof Error ? e.message : e);
            if (msg.includes("NOT_FOUND"))
                return reply.status(404).send({ success: false, error: "Faktur tidak ditemukan" });
            if (msg.includes("NOT_DRAFT"))
                return reply.status(409).send({ success: false, error: "Hanya draft yang bisa diposting" });
            return reply.status(500).send({ success: false, error: msg });
        }
    });
    // Pay: record cash IN (detail + cashFlows) and update amount_paid/status.
    app.post("/api/sales-invoices/:id/pay", async (request, reply) => {
        const outlet = await getOwnerOutlet(request, reply, "salesInvoice");
        if (!outlet)
            return;
        const id = Number(request.params.id);
        const body = request.body;
        try {
            const result = await db_1.db.transaction(async (tx) => {
                const [invoice] = await tx
                    .select()
                    .from(schema_1.invoicesTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.invoicesTable.id, id), (0, drizzle_orm_1.eq)(schema_1.invoicesTable.outlet_id, outlet.id), (0, drizzle_orm_1.eq)(schema_1.invoicesTable.type, "sales")))
                    .limit(1);
                if (!invoice)
                    throw new Error("NOT_FOUND");
                if (invoice.status !== "posted" && invoice.status !== "partial")
                    throw new Error("NOT_PAYABLE");
                const total = Number(invoice.total);
                const alreadyPaid = Number(invoice.amount_paid);
                const remaining = +(total - alreadyPaid).toFixed(2);
                const amount = body.amount != null ? Number(body.amount) : remaining;
                if (!(amount > 0) || amount > remaining + 0.001)
                    throw new Error("BAD_AMOUNT");
                return recordSalesCashIn(tx, outlet.id, invoice, amount);
            });
            return { success: true, data: result };
        }
        catch (e) {
            const msg = String(e instanceof Error ? e.message : e);
            if (msg.includes("NOT_FOUND"))
                return reply.status(404).send({ success: false, error: "Faktur tidak ditemukan" });
            if (msg.includes("NOT_PAYABLE"))
                return reply.status(409).send({ success: false, error: "Faktur harus diposting dulu" });
            if (msg.includes("BAD_AMOUNT"))
                return reply.status(400).send({ success: false, error: "Nominal pembayaran tidak valid" });
            return reply.status(500).send({ success: false, error: msg });
        }
    });
    // Void: restore stock (reverse the OUT movements) and remove the cash-IN.
    app.post("/api/sales-invoices/:id/void", async (request, reply) => {
        const outlet = await getOwnerOutlet(request, reply, "salesInvoice");
        if (!outlet)
            return;
        const id = Number(request.params.id);
        try {
            const result = await db_1.db.transaction(async (tx) => {
                const [invoice] = await tx
                    .select()
                    .from(schema_1.invoicesTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.invoicesTable.id, id), (0, drizzle_orm_1.eq)(schema_1.invoicesTable.outlet_id, outlet.id), (0, drizzle_orm_1.eq)(schema_1.invoicesTable.type, "sales")))
                    .limit(1);
                if (!invoice)
                    throw new Error("NOT_FOUND");
                if (invoice.status === "void")
                    throw new Error("ALREADY_VOID");
                const moves = await tx
                    .select()
                    .from(schema_1.stockMovementsTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.stockMovementsTable.invoice_id, id), (0, drizzle_orm_1.eq)(schema_1.stockMovementsTable.reason, "sales")));
                for (const m of moves) {
                    await tx.insert(schema_1.stockMovementsTable).values({
                        outlet_id: outlet.id,
                        product_id: m.product_id,
                        qty_change: String(-Number(m.qty_change)), // reverse the OUT (back IN)
                        reason: "void",
                        invoice_id: id,
                    });
                    await tx
                        .update(schema_1.productsTable)
                        .set({ stock: (0, drizzle_orm_1.sql) `${schema_1.productsTable.stock} - ${m.qty_change}::numeric` })
                        .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, m.product_id));
                }
                // Remove ALL payments this invoice generated (DP + installments live in
                // invoice_payments; cash_in_detail_id covers legacy single payments).
                const payments = await tx
                    .select({ detail_id: schema_1.invoicePaymentsTable.cash_in_detail_id })
                    .from(schema_1.invoicePaymentsTable)
                    .where((0, drizzle_orm_1.eq)(schema_1.invoicePaymentsTable.invoice_id, id));
                const detailIds = new Set([...payments.map((p) => p.detail_id), invoice.cash_in_detail_id].filter((v) => v != null));
                const [updated] = await tx
                    .update(schema_1.invoicesTable)
                    .set({ status: "void", amount_paid: "0", cash_in_detail_id: null })
                    .where((0, drizzle_orm_1.eq)(schema_1.invoicesTable.id, id))
                    .returning();
                await tx.delete(schema_1.invoicePaymentsTable).where((0, drizzle_orm_1.eq)(schema_1.invoicePaymentsTable.invoice_id, id));
                for (const detailId of detailIds) {
                    await tx.delete(schema_1.cashFlows).where((0, drizzle_orm_1.eq)(schema_1.cashFlows.cash_in_detail_id, detailId));
                    await tx.delete(schema_1.cashInDetailTable).where((0, drizzle_orm_1.eq)(schema_1.cashInDetailTable.id, detailId));
                }
                return updated;
            });
            return { success: true, data: result };
        }
        catch (e) {
            const msg = String(e instanceof Error ? e.message : e);
            if (msg.includes("NOT_FOUND"))
                return reply.status(404).send({ success: false, error: "Faktur tidak ditemukan" });
            if (msg.includes("ALREADY_VOID"))
                return reply.status(409).send({ success: false, error: "Faktur sudah dibatalkan" });
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
        if (!outlet)
            return;
        const { period = "30d" } = request.query;
        // Period boundaries are calendar edges, so they must land on local midnight.
        // setHours / new Date(y, m, 1) would use the container's zone — UTC in the
        // deployed image — and quietly shift "today" and "this month" by 7 hours.
        const { timezone = "Asia/Jakarta" } = request.query;
        const now = new Date();
        const todayLocal = new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(now);
        const [localYear, localMonth] = todayLocal.split("-").map(Number);
        const monthsAgoStart = (n) => {
            const m = new Date(Date.UTC(localYear, localMonth - 1 - n, 1));
            const key = `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`;
            return (0, timezone_1.getUTCRangeFromLocalMonth)(key, timezone).startUTC;
        };
        let from;
        if (period === "today") {
            from = (0, timezone_1.getUTCRangeFromLocalDate)(todayLocal, timezone).startUTC;
        }
        else if (period === "7d") {
            from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        }
        else if (period === "month") {
            from = monthsAgoStart(0);
        }
        else {
            from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }
        const BILLED = ["posted", "partial", "paid"];
        const OPEN = ["posted", "partial"];
        const base = [(0, drizzle_orm_1.eq)(schema_1.invoicesTable.outlet_id, outlet.id), (0, drizzle_orm_1.isNull)(schema_1.invoicesTable.deletedAt)];
        const remainingSql = (0, drizzle_orm_1.sql) `coalesce(sum(${schema_1.invoicesTable.total} - ${schema_1.invoicesTable.amount_paid}), 0)`;
        const trendStart = monthsAgoStart(5);
        const [kpiRows, openRows, lateRows, trendRows, topSales, topPurchase] = await Promise.all([
            // Billed in the selected period.
            db_1.db
                .select({
                type: schema_1.invoicesTable.type,
                count: (0, drizzle_orm_1.sql) `count(*)::int`,
                total: (0, drizzle_orm_1.sql) `coalesce(sum(${schema_1.invoicesTable.total}), 0)`,
                paid: (0, drizzle_orm_1.sql) `coalesce(sum(${schema_1.invoicesTable.amount_paid}), 0)`,
            })
                .from(schema_1.invoicesTable)
                .where((0, drizzle_orm_1.and)(...base, (0, drizzle_orm_1.inArray)(schema_1.invoicesTable.status, [...BILLED]), (0, drizzle_orm_1.gte)(schema_1.invoicesTable.issue_date, from)))
                .groupBy(schema_1.invoicesTable.type),
            // Open balance right now (piutang for sales, hutang for purchase).
            db_1.db
                .select({ type: schema_1.invoicesTable.type, count: (0, drizzle_orm_1.sql) `count(*)::int`, outstanding: remainingSql })
                .from(schema_1.invoicesTable)
                .where((0, drizzle_orm_1.and)(...base, (0, drizzle_orm_1.inArray)(schema_1.invoicesTable.status, [...OPEN])))
                .groupBy(schema_1.invoicesTable.type),
            // The overdue slice of that open balance.
            db_1.db
                .select({ type: schema_1.invoicesTable.type, count: (0, drizzle_orm_1.sql) `count(*)::int`, outstanding: remainingSql })
                .from(schema_1.invoicesTable)
                .where((0, drizzle_orm_1.and)(...base, (0, drizzle_orm_1.inArray)(schema_1.invoicesTable.status, [...OPEN]), (0, drizzle_orm_1.lt)(schema_1.invoicesTable.due_date, (0, drizzle_orm_1.sql) `CURRENT_DATE`)))
                .groupBy(schema_1.invoicesTable.type),
            // Billed totals per month, last 6 months.
            db_1.db
                .select({
                type: schema_1.invoicesTable.type,
                // issue_date is timestamptz, so date_trunc would bucket by the session
                // TimeZone (UTC on the server). Convert to local time first, else an
                // invoice issued late on the 31st lands in the following month.
                month: (0, drizzle_orm_1.sql) `to_char(date_trunc('month', ${schema_1.invoicesTable.issue_date} AT TIME ZONE ${timezone}), 'YYYY-MM')`,
                total: (0, drizzle_orm_1.sql) `coalesce(sum(${schema_1.invoicesTable.total}), 0)`,
            })
                .from(schema_1.invoicesTable)
                .where((0, drizzle_orm_1.and)(...base, (0, drizzle_orm_1.inArray)(schema_1.invoicesTable.status, [...BILLED]), (0, drizzle_orm_1.gte)(schema_1.invoicesTable.issue_date, trendStart)))
                .groupBy(schema_1.invoicesTable.type, (0, drizzle_orm_1.sql) `2`),
            // Largest open invoices per side, for the follow-up lists.
            db_1.db
                .select({
                id: schema_1.invoicesTable.id,
                number: schema_1.invoicesTable.number,
                party_name: schema_1.invoicesTable.party_name,
                due_date: schema_1.invoicesTable.due_date,
                total: schema_1.invoicesTable.total,
                amount_paid: schema_1.invoicesTable.amount_paid,
                status: schema_1.invoicesTable.status,
            })
                .from(schema_1.invoicesTable)
                .where((0, drizzle_orm_1.and)(...base, (0, drizzle_orm_1.eq)(schema_1.invoicesTable.type, "sales"), (0, drizzle_orm_1.inArray)(schema_1.invoicesTable.status, [...OPEN])))
                .orderBy((0, drizzle_orm_1.desc)((0, drizzle_orm_1.sql) `${schema_1.invoicesTable.total} - ${schema_1.invoicesTable.amount_paid}`))
                .limit(8),
            db_1.db
                .select({
                id: schema_1.invoicesTable.id,
                number: schema_1.invoicesTable.number,
                party_name: (0, drizzle_orm_1.sql) `coalesce(nullif(${schema_1.invoicesTable.party_name}, ''), ${schema_1.suppliersTable.name}, '')`,
                due_date: schema_1.invoicesTable.due_date,
                total: schema_1.invoicesTable.total,
                amount_paid: schema_1.invoicesTable.amount_paid,
                status: schema_1.invoicesTable.status,
            })
                .from(schema_1.invoicesTable)
                .leftJoin(schema_1.suppliersTable, (0, drizzle_orm_1.eq)(schema_1.invoicesTable.supplier_id, schema_1.suppliersTable.id))
                .where((0, drizzle_orm_1.and)(...base, (0, drizzle_orm_1.eq)(schema_1.invoicesTable.type, "purchase"), (0, drizzle_orm_1.inArray)(schema_1.invoicesTable.status, [...OPEN])))
                .orderBy((0, drizzle_orm_1.desc)((0, drizzle_orm_1.sql) `${schema_1.invoicesTable.total} - ${schema_1.invoicesTable.amount_paid}`))
                .limit(8),
        ]);
        const side = (type, top) => {
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
        const byKey = new Map(trendRows.map((r) => [`${r.type}:${r.month}`, Number(r.total)]));
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
            sales: side("sales", topSales),
            purchase: side("purchase", topPurchase),
            trend,
        };
    });
    // ============================================================ stock opname
    // Absolute physical count: for each tracked product the client sends the
    // counted quantity; the server computes delta = counted - current and records
    // an 'adjustment' stock movement (note for the reason), then sets stock to the
    // count. NO cashflow is created — the cash already left at purchase; spoilage
    // is inventory shrinkage, not a new cash movement (its value shows as lower HPP).
    app.post("/api/stock/opname", async (request, reply) => {
        const outlet = await getOwnerOutlet(request, reply, "stock");
        if (!outlet)
            return;
        const body = request.body;
        const items = Array.isArray(body.items) ? body.items : [];
        if (items.length === 0)
            return reply.status(400).send({ success: false, error: "Tidak ada item" });
        const note = (body.note?.trim() || "Opname").slice(0, 255);
        try {
            const adjusted = await db_1.db.transaction(async (tx) => {
                let count = 0;
                for (const it of items) {
                    if (!it.product_id)
                        continue;
                    const counted = Number(it.counted);
                    if (!Number.isFinite(counted) || counted < 0)
                        continue;
                    // Re-read current stock inside the txn so the delta is correct even if
                    // stock changed since the page loaded. Scoped to this outlet + tracked.
                    const [p] = await tx
                        .select({ stock: schema_1.productsTable.stock, track_stock: schema_1.productsTable.track_stock })
                        .from(schema_1.productsTable)
                        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.id, it.product_id), (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, outlet.id)))
                        .limit(1);
                    if (!p || !p.track_stock)
                        continue;
                    const delta = +(counted - Number(p.stock)).toFixed(2);
                    if (delta === 0)
                        continue;
                    await tx.insert(schema_1.stockMovementsTable).values({
                        outlet_id: outlet.id,
                        product_id: it.product_id,
                        qty_change: String(delta),
                        reason: "adjustment",
                        note,
                    });
                    await tx
                        .update(schema_1.productsTable)
                        .set({ stock: String(counted) })
                        .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, it.product_id));
                    count++;
                }
                return count;
            });
            return { success: true, adjusted };
        }
        catch (e) {
            return reply.status(500).send({ success: false, error: String(e instanceof Error ? e.message : e) });
        }
    });
    // History of stock adjustments (opname reconciliations), newest first, grouped
    // by day on the client. Filtered to a date window (default: last 30 days) so
    // the payload/scan stays bounded — backed by the
    // stock_movements_outlet_reason_created_idx index. `from`/`to` are YYYY-MM-DD.
    app.get("/api/stock/opname-history", async (request, reply) => {
        const outlet = await getOwnerOutlet(request, reply, "stock");
        if (!outlet)
            return;
        const { from, to } = request.query;
        const toDate = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
        const fromDate = from
            ? new Date(`${from}T00:00:00.000Z`)
            : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days
        const rows = await db_1.db
            .select({
            id: schema_1.stockMovementsTable.id,
            qty_change: schema_1.stockMovementsTable.qty_change,
            note: schema_1.stockMovementsTable.note,
            created_at: schema_1.stockMovementsTable.created_at,
            product_name: schema_1.productsTable.product_name,
            unit: schema_1.productsTable.unit,
        })
            .from(schema_1.stockMovementsTable)
            .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.stockMovementsTable.product_id, schema_1.productsTable.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.stockMovementsTable.outlet_id, outlet.id), (0, drizzle_orm_1.eq)(schema_1.stockMovementsTable.reason, "adjustment"), (0, drizzle_orm_1.gte)(schema_1.stockMovementsTable.created_at, fromDate), (0, drizzle_orm_1.lte)(schema_1.stockMovementsTable.created_at, toDate)))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.stockMovementsTable.created_at))
            .limit(1000); // hard cap; narrow the date range if you hit it
        return { success: true, data: rows };
    });
    // Per-product ledger for the Stok page drill-down: every movement
    // (purchase / sales / adjustment / void), newest first, with the invoice
    // number when one caused it. Outlet scoping comes from the movement rows
    // themselves, so a foreign productId simply returns nothing.
    app.get("/api/stock/movements", async (request, reply) => {
        const outlet = await getOwnerOutlet(request, reply, "stock");
        if (!outlet)
            return;
        const { productId, limit } = request.query;
        if (!productId)
            return reply.status(400).send({ success: false, error: "Missing productId" });
        const cap = Math.min(Number(limit) || 200, 500);
        const rows = await db_1.db
            .select({
            id: schema_1.stockMovementsTable.id,
            qty_change: schema_1.stockMovementsTable.qty_change,
            reason: schema_1.stockMovementsTable.reason,
            note: schema_1.stockMovementsTable.note,
            created_at: schema_1.stockMovementsTable.created_at,
            invoice_number: schema_1.invoicesTable.number,
        })
            .from(schema_1.stockMovementsTable)
            .leftJoin(schema_1.invoicesTable, (0, drizzle_orm_1.eq)(schema_1.stockMovementsTable.invoice_id, schema_1.invoicesTable.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.stockMovementsTable.outlet_id, outlet.id), (0, drizzle_orm_1.eq)(schema_1.stockMovementsTable.product_id, productId)))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.stockMovementsTable.created_at), (0, drizzle_orm_1.desc)(schema_1.stockMovementsTable.id))
            .limit(cap);
        return { success: true, data: rows };
    });
}
