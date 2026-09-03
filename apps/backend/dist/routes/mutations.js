"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mutationRoutes = mutationRoutes;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../auth");
const web_headers_1 = require("../lib/web-headers");
const outlet_access_1 = require("../lib/outlet-access");
const stock_1 = require("../lib/stock");
const cogs_1 = require("../lib/cogs");
const cashflow_categories_1 = require("../lib/cashflow-categories");
const pos_payment_1 = require("../lib/pos-payment");
const shift_1 = require("../lib/shift");
const tax_1 = require("../lib/tax");
const addons_1 = require("../lib/addons");
const phone_1 = require("../lib/utils/phone");
const coords_1 = require("../lib/utils/coords");
const service_area_1 = require("../lib/service-area");
// Record a POS sale as cash-in for the given outlet. Find-or-create the "Kasir"
// cash-in category so a missing category can't silently drop the cashflow, and
// attribute it to the actual outlet (was hardcoded to outlet 1).
//
// orderId is optional because /api/add-pos-to-cashflowin calls this with no
// order in hand. When it is passed the cashflow row carries it, which is what
// makes the sale reversible — see cancelPosOrder.
//
// `method` decides which side of the ledger this lands on. It used to be
// hardcoded 'cash', which meant a QRIS sale counted as notes in the drawer:
// harmless while nothing ever counted the drawer, and wrong the moment a shift
// close does. See lib/pos-payment.ts.
//
// `shiftId` is which cashier stint was open when it was rung up, so a closing
// report can sum the drawer by foreign key instead of by time window.
async function addPosToCashflowin(tx, outletId, total, orderId, method = "cash", shiftId = null) {
    let [category] = await tx
        .select({ id: schema_1.cashInCategoryTable.id })
        .from(schema_1.cashInCategoryTable)
        .where((0, drizzle_orm_1.eq)(schema_1.cashInCategoryTable.category, cashflow_categories_1.CATEGORY_POS_SALE))
        .limit(1);
    if (!category) {
        [category] = await tx
            .insert(schema_1.cashInCategoryTable)
            .values({ category: cashflow_categories_1.CATEGORY_POS_SALE })
            .returning({ id: schema_1.cashInCategoryTable.id });
    }
    const [detail] = await tx
        .insert(schema_1.cashInDetailTable)
        .values({
        category_id: category.id,
        money_amount: String(total),
        type: (0, pos_payment_1.posCashflowTypeFor)(method),
    })
        .returning();
    await tx.insert(schema_1.cashFlows).values({
        outlet_id: outletId,
        cash_in_detail_id: detail.id,
        order_id: orderId ?? null,
        shift_id: shiftId,
    });
}
async function mutationRoutes(app) {
    app.post("/api/add-order-detail", async (request, reply) => {
        try {
            // Owner or employee with the cashier permission. The outlet comes from
            // the caller's access — body.outletId is ignored (it let any session
            // write orders into any outlet).
            const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "cashier");
            if (!access)
                return;
            const body = request.body || {};
            body.outletId = access.outlet.id;
            // Idempotency: the desktop cashier (offline-queue capable) sends its own
            // client-generated orderId so a retried request — e.g. the response was
            // lost after the server already committed — replays as a no-op instead
            // of ringing up the sale twice. The web cashier sends no orderId; that
            // path is untouched (server mints one as before). orders.id is a real
            // PRIMARY KEY, so a genuine duplicate is caught below even if this
            // pre-check loses a race.
            const clientOrderId = typeof body.orderId === "string" && body.orderId.length > 0 ? body.orderId : undefined;
            if (clientOrderId) {
                const [already] = await db_1.db
                    .select({ id: schema_1.ordersTable.id })
                    .from(schema_1.ordersTable)
                    .where((0, drizzle_orm_1.eq)(schema_1.ordersTable.id, clientOrderId))
                    .limit(1);
                if (already) {
                    return { success: true, message: "Order already processed", orderId: clientOrderId, replay: true };
                }
            }
            // The cashier's name is what the report groups on, so it must never be
            // left blank: clients that don't send one (the web cashier historically
            // didn't) fall back to the signed-in user's name.
            let cashierName = typeof body.cashierName === "string" && body.cashierName.trim() !== ""
                ? body.cashierName.trim()
                : null;
            if (!cashierName) {
                const [actor] = await db_1.db
                    .select({ name: schema_1.usersTable.name })
                    .from(schema_1.usersTable)
                    .where((0, drizzle_orm_1.eq)(schema_1.usersTable.id, access.userId))
                    .limit(1);
                cashierName = actor?.name?.trim() || null;
            }
            // Find offline customer and courier (hardcoded for now, can be made dynamic)
            const EMAIL = "rizkygin1@gmail.com";
            const EMAIL_COURIER = "rizkygin3@gmail.com";
            const [customer_offline] = await db_1.db
                .select({ id: schema_1.customersTable.id })
                .from(schema_1.customersTable)
                .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, schema_1.usersTable.id))
                .where((0, drizzle_orm_1.eq)(schema_1.usersTable.email, EMAIL))
                .limit(1);
            const [courier_offline] = await db_1.db
                .select({ id: schema_1.couriersTable.id })
                .from(schema_1.couriersTable)
                .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, schema_1.usersTable.id))
                .where((0, drizzle_orm_1.eq)(schema_1.usersTable.email, EMAIL_COURIER))
                .limit(1);
            // Whatever the cashier picked, coerced to a value the reports know. An
            // unrecognised string would otherwise become its own permanent bucket in
            // the payment report, invisible until someone wonders why the columns
            // don't add up.
            const paymentMethod = (0, pos_payment_1.parsePosPaymentMethod)(body.paymentMethod);
            // Tax is computed HERE, from the outlet's own settings, and never taken
            // from the request. The cashier screen works the same sum out for display,
            // but a client is free to send anything and the amount handed to the tax
            // office is not a number to accept on trust.
            //
            // body.total is already net of the discount, which is the correct base:
            // tax is charged on what the customer pays, not on a price they were
            // given a discount off.
            const taxable = (0, outlet_access_1.hasFeature)(access.gate, "tax");
            const tax = (0, tax_1.computeTax)(Number(body.total) || 0, taxable
                ? (0, tax_1.taxConfigFrom)(access.outlet)
                : { enabled: false, rate: 0, inclusive: false, label: "Pajak" });
            let new_order_id;
            try {
                await db_1.db.transaction(async (tx) => {
                    // Which stint at the drawer this sale belongs to, read inside the
                    // transaction so a shift closing at this exact moment can't leave the
                    // sale attributed to a shift whose totals are already frozen.
                    //
                    // null is a normal answer: selling with no shift open is allowed (a
                    // forgotten "Buka Shift" must never cost a sale). Those orders appear
                    // on no closing report, which is the honest outcome — there is no
                    // drawer to reconcile them against.
                    const shiftId = await (0, shift_1.getOpenShiftId)(tx, body.outletId);
                    if (body.cart && body.cart.length > 0) {
                        new_order_id = clientOrderId ?? crypto.randomUUID();
                        await tx.insert(schema_1.ordersTable).values({
                            id: new_order_id,
                            customer_id: customer_offline?.id || 1,
                            courier_id: courier_offline?.id || 1,
                            // Stated, not inferred. Everything downstream that needs to know
                            // this was rung up at the counter reads this column instead of
                            // re-deriving it from which customer row the two lookups above
                            // happened to land on.
                            source: "pos",
                            status: "delivered",
                            outlet_id: body.outletId,
                            shift_id: shiftId,
                            // Frozen: a rate change tomorrow must not rewrite this sale.
                            // All three stay NULL when no tax applied, so a reader can tell
                            // "not taxed" from "taxed at zero".
                            tax_rate: tax.rate === null ? null : String(tax.rate),
                            tax_amount: tax.amount === null ? null : String(tax.amount),
                            tax_inclusive: tax.inclusive,
                            note: {
                                customerName: body.customerName || null,
                                cashierName,
                                discountAmount: body.discountAmount ?? 0,
                                paymentMethod,
                                amountPaid: body.amountPaid ?? 0,
                                changeDue: body.changeDue ?? 0,
                            },
                        });
                        for (const item of body.cart) {
                            const qty = Number(item.quantity);
                            const summary_price = item.product.price_mark_down && item.product.price_mark_down !== "0"
                                ? parseFloat(item.product.price_mark_down) * qty
                                : parseFloat(item.product.price) * qty;
                            // Priced and sized before the parent row is written, so a bad
                            // add-on payload fails before anything has been committed rather
                            // than half way through the line. See lib/addons.ts for why the
                            // price comes from the client and a vanished option is tolerated.
                            const { resolved: addons, dropped } = await (0, addons_1.resolveAddons)(body.outletId, qty, item.addons);
                            if (dropped.length > 0) {
                                app.log.warn({ orderId: new_order_id, outletId: body.outletId, dropped }, "POS add-ons dropped: not products of this outlet");
                            }
                            // `returning` because the movements written just below have to
                            // carry this row's id — see orderDetailId there.
                            const [detail] = await tx
                                .insert(schema_1.orderDetailsTable)
                                .values({
                                order_id: new_order_id,
                                product_id: item.product.id,
                                quantity: item.quantity,
                                note_product: item.note_product || "-",
                                summary_price: summary_price.toString(),
                                status: "checkout",
                                // Freeze what this line cost, for the lines the cost ledger
                                // cannot see (a service or fee moves no stock, so it writes no
                                // movement). Stamped on every line all the same — deciding here
                                // which ones the ledger will cover would re-read the very
                                // product config that can change afterwards. See lib/cogs.ts.
                                unit_cost: (0, cogs_1.lineUnitCostSql)(item.product.id),
                            })
                                .returning({ id: schema_1.orderDetailsTable.id });
                            // POS is an immediate sale: move stock (own stock for track_stock
                            // products, ingredients for recipe products) with an audit trail.
                            // Oversell warnings are ignored here — a POS sale must never fail
                            // because stock records lag reality.
                            await (0, stock_1.applySaleStockOut)(tx, {
                                outletId: body.outletId,
                                productId: item.product.id,
                                qty,
                                // Stamped so cancelling this order can replay these exact
                                // movements instead of re-expanding the recipe later.
                                orderId: new_order_id,
                                // And the LINE, so the cost of what moved can be attributed
                                // back to the item that was sold — a composition's movements
                                // are against its ingredients and carry no other link to it.
                                orderDetailId: detail.id,
                                note: `POS ${new_order_id}`,
                            });
                            // ── Add-ons: child lines of the one just written ──────────────
                            //
                            // Each is an ordinary order line that happens to point at its
                            // parent, so it takes the SAME two steps the parent just took —
                            // freeze its own unit_cost, then move its own stock — and by
                            // doing so inherits the whole cost ledger for free. Nothing in
                            // lib/cogs.ts or lib/stock.ts knows add-ons exist.
                            //
                            // The two things that must not drift:
                            //   * orderDetailId is the CHILD's id, never the parent's. It is
                            //     what attributes an add-on's ingredients to the add-on
                            //     rather than to the dish.
                            //   * summary_price on this row is the ADD-ON's price alone. The
                            //     parent keeps the base price it was written with; folding
                            //     the add-on into it would count the money twice, because the
                            //     order total is a plain sum over every line.
                            for (const addon of addons) {
                                const [addonDetail] = await tx
                                    .insert(schema_1.orderDetailsTable)
                                    .values({
                                    order_id: new_order_id,
                                    product_id: addon.product_id,
                                    quantity: addon.quantity,
                                    parent_detail_id: detail.id,
                                    // Deliberately no note: the kitchen instruction belongs to
                                    // the dish, and repeating it per topping would print it
                                    // three times on the ticket.
                                    note_product: "-",
                                    summary_price: addon.summary_price.toString(),
                                    status: "checkout",
                                    unit_cost: (0, cogs_1.lineUnitCostSql)(addon.product_id),
                                })
                                    .returning({ id: schema_1.orderDetailsTable.id });
                                await (0, stock_1.applySaleStockOut)(tx, {
                                    outletId: body.outletId,
                                    productId: addon.product_id,
                                    qty: addon.quantity,
                                    orderId: new_order_id,
                                    orderDetailId: addonDetail.id,
                                    note: `POS ${new_order_id}`,
                                });
                            }
                        }
                    }
                    // tax.total, not body.total: under exclusive pricing the customer
                    // hands over the tax as well, and that money is physically in the
                    // drawer. Booking the pre-tax figure would leave every shift close
                    // short by exactly the tax collected.
                    await addPosToCashflowin(tx, body.outletId, tax.total, new_order_id, paymentMethod, shiftId);
                });
            }
            catch (err) {
                // Race: two near-simultaneous retries both slipped past the pre-check
                // above. orders.id is a real PRIMARY KEY, so Postgres catches the
                // duplicate here — treat it exactly like the pre-check hit (already
                // processed), instead of surfacing a raw constraint-violation 500.
                const pgCode = err?.code ?? err?.cause?.code;
                if (clientOrderId && pgCode === "23505") {
                    return { success: true, message: "Order already processed", orderId: clientOrderId, replay: true };
                }
                throw err; // anything else: let the outer catch handle it, unchanged
            }
            return { success: true, message: "Order created successfully", orderId: new_order_id };
        }
        catch (error) {
            return reply.status(500).send({ error: { message: error.message || "Internal server error" } });
        }
    });
    // Cancel a cashier order: soft-delete it, hand the stock back, and reverse
    // the cash it booked. Deliberately NOT a DELETE of anything — a sale that
    // happened and was then voided is two facts, and the books should show both.
    //
    // Gated on the cashier permission rather than owner: the person who rang up
    // the wrong item is the person standing there when the customer says so, and
    // making them fetch the owner is how you get cancellations that never get
    // recorded at all. Owners pass this check too.
    app.post("/api/orders/:orderId/cancel", async (request, reply) => {
        try {
            const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "cashier");
            if (!access)
                return;
            const { orderId } = request.params;
            const { reason } = (request.body ?? {});
            const result = await db_1.db.transaction(async (tx) => {
                // SELECT ... FOR UPDATE: two cashiers hitting cancel on the same order
                // at once would otherwise both read deleted_at as null and both book a
                // reversal, refunding the sale twice into the ledger.
                const [order] = await tx
                    .select({
                    id: schema_1.ordersTable.id,
                    outletId: schema_1.ordersTable.outlet_id,
                    source: schema_1.ordersTable.source,
                    deletedAt: schema_1.ordersTable.deletedAt,
                    note: schema_1.ordersTable.note,
                    taxAmount: schema_1.ordersTable.tax_amount,
                    taxInclusive: schema_1.ordersTable.tax_inclusive,
                })
                    .from(schema_1.ordersTable)
                    .where((0, drizzle_orm_1.eq)(schema_1.ordersTable.id, orderId))
                    .limit(1)
                    .for("update");
                if (!order)
                    return { status: 404, error: "Order tidak ditemukan" };
                // Outlet scoping before anything else: without it, a cashier at one
                // outlet could cancel another outlet's sales by guessing an id.
                if (order.outletId !== access.outlet.id) {
                    return { status: 404, error: "Order tidak ditemukan" };
                }
                if (order.source !== "pos") {
                    return {
                        status: 400,
                        error: "Hanya order kasir yang bisa dibatalkan di sini",
                    };
                }
                // Idempotent: a double-submit is a no-op, not a second reversal.
                if (order.deletedAt) {
                    return { status: 200, alreadyCancelled: true };
                }
                // What this sale actually put in the drawer. Orders rung up after the
                // 0057 migration carry the link and give an exact figure.
                const [linked] = await tx
                    .select({
                    amount: (0, drizzle_orm_1.sql) `coalesce(sum(cast(${schema_1.cashInDetailTable.money_amount} as numeric)), 0)`,
                })
                    .from(schema_1.cashFlows)
                    .innerJoin(schema_1.cashInDetailTable, (0, drizzle_orm_1.eq)(schema_1.cashFlows.cash_in_detail_id, schema_1.cashInDetailTable.id))
                    .where((0, drizzle_orm_1.eq)(schema_1.cashFlows.order_id, orderId));
                let amount = Number(linked?.amount ?? 0);
                // Orders that predate the link have no cash-in to point at, so the
                // total is rebuilt from the lines less the discount the cashier gave —
                // the same arithmetic the checkout screen did when it sent `total`.
                // This can disagree with what was really booked if the order was ever
                // edited, which is why it is the fallback and not the primary path.
                if (amount === 0) {
                    const [sum] = await tx
                        .select({
                        total: (0, drizzle_orm_1.sql) `coalesce(sum(cast(${schema_1.orderDetailsTable.summary_price} as numeric)), 0)`,
                    })
                        .from(schema_1.orderDetailsTable)
                        .where((0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, orderId));
                    const discount = Number(order.note?.discountAmount ?? 0);
                    // Tax has to come back too, or a refund on a taxed sale is short by
                    // the tax. Only under EXCLUSIVE pricing though: an inclusive tax was
                    // already inside the line prices this sum is built from, so adding it
                    // again would refund it twice.
                    const taxBack = order.taxInclusive === false ? Number(order.taxAmount ?? 0) : 0;
                    amount = Math.max(0, Number(sum?.total ?? 0) - discount + taxBack);
                }
                // Which drawer pays the refund back out: the one that is open NOW, not
                // the shift that took the sale. A sale rung up yesterday and voided
                // today takes money out of today's till, and yesterday's report was
                // already printed and signed — silently editing it is exactly what a
                // frozen closing count exists to prevent.
                const reversalShiftId = await (0, shift_1.getOpenShiftId)(tx, access.outlet.id);
                // Reverse it the same way it came in. The original booking is only
                // 'cash' if the customer actually paid cash; reversing a QRIS sale as a
                // cash-out would drain a drawer that never received the money, and the
                // next shift close would come up short by exactly that amount.
                const reversalType = (0, pos_payment_1.posCashflowTypeFor)((0, pos_payment_1.parsePosPaymentMethod)(order.note?.paymentMethod));
                // Reverse the money. Zero is skipped rather than booked: a 0-rupiah
                // cash-out row is noise in the cashflow report, and a free order is a
                // real case (fully discounted).
                if (amount > 0) {
                    let [category] = await tx
                        .select({ id: schema_1.cashOutCategoryTable.id })
                        .from(schema_1.cashOutCategoryTable)
                        .where((0, drizzle_orm_1.eq)(schema_1.cashOutCategoryTable.category, cashflow_categories_1.CATEGORY_POS_CANCELLATION))
                        .limit(1);
                    if (!category) {
                        [category] = await tx
                            .insert(schema_1.cashOutCategoryTable)
                            .values({ category: cashflow_categories_1.CATEGORY_POS_CANCELLATION })
                            .returning({ id: schema_1.cashOutCategoryTable.id });
                    }
                    const [detail] = await tx
                        .insert(schema_1.cashOutDetailTable)
                        .values({
                        category_id: category.id,
                        money_amount: String(amount),
                        type: reversalType,
                    })
                        .returning({ id: schema_1.cashOutDetailTable.id });
                    await tx.insert(schema_1.cashFlows).values({
                        outlet_id: access.outlet.id,
                        cash_out_detail_id: detail.id,
                        order_id: orderId,
                        shift_id: reversalShiftId,
                    });
                }
                // Hand the stock back. Preferred path replays the order's own ledger,
                // which returns exactly what left even if a recipe changed since the
                // sale; it reports false only for orders placed before migration 0062
                // stamped order_id onto movements, and those fall back to re-deriving
                // each line from the recipe as it stands now.
                const replayed = await (0, stock_1.applyOrderStockReturn)(tx, {
                    outletId: access.outlet.id,
                    orderId,
                    note: `Batal POS ${orderId}`,
                });
                if (!replayed) {
                    const lines = await tx
                        .select({
                        productId: schema_1.orderDetailsTable.product_id,
                        quantity: schema_1.orderDetailsTable.quantity,
                    })
                        .from(schema_1.orderDetailsTable)
                        .where((0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, orderId));
                    for (const line of lines) {
                        if (!line.productId)
                            continue;
                        await (0, stock_1.applySaleStockReturn)(tx, {
                            outletId: access.outlet.id,
                            productId: line.productId,
                            qty: Number(line.quantity),
                            note: `Batal POS ${orderId}`,
                        });
                    }
                }
                // status alongside deleted_at: the soft-delete filter is what hides the
                // order, but anything that reads a cancelled row directly (the reprint
                // slip, an admin drilldown) should see it say so rather than still
                // claiming 'delivered'.
                await tx
                    .update(schema_1.ordersTable)
                    .set({
                    deletedAt: new Date(),
                    status: "cancelled",
                    rejected_by: "owner",
                    rejected_reason: (reason ?? "Dibatalkan kasir").slice(0, 255),
                    updatedAt: new Date(),
                })
                    .where((0, drizzle_orm_1.eq)(schema_1.ordersTable.id, orderId));
                return { status: 200, amount };
            });
            if (result.status !== 200) {
                return reply.status(result.status).send({ success: false, error: result.error });
            }
            return { success: true, alreadyCancelled: result.alreadyCancelled ?? false, amount: result.amount ?? 0 };
        }
        catch (error) {
            return reply
                .status(500)
                .send({ success: false, error: error.message || "Internal Server Error" });
        }
    });
    app.post("/api/add-pos-to-cashflowin", async (request, reply) => {
        try {
            const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "cashier");
            if (!access)
                return;
            const body = request.body || {};
            await db_1.db.transaction(async (tx) => addPosToCashflowin(tx, access.outlet.id, body.total, undefined, (0, pos_payment_1.parsePosPaymentMethod)(body.paymentMethod), 
            // Cash taken at the counter belongs to whoever's drawer is open.
            await (0, shift_1.getOpenShiftId)(tx, access.outlet.id)));
            return { success: true };
        }
        catch (error) {
            return reply.status(500).send({ message: error.message, error: "Internal Server Error" });
        }
    });
    app.post("/api/add-product", async (request, reply) => {
        try {
            const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
            if (!session?.user)
                return reply.status(401).send({ error: "Unauthorized" });
            const body = request.body || {};
            const { product_name, price, stock, image, outlet_id } = body;
            // Product creation currently stub (matching frontend behavior)
            // await db.insert(productsTable).values({
            //   product_name,
            //   price,
            //   stock,
            //   image,
            //   outlet_id,
            // });
            return { success: true };
        }
        catch (error) {
            console.error("Add product error:", error);
            return reply.status(500).send({ error: error.message || "Internal Server Error" });
        }
    });
    app.post("/api/register-role", async (request, reply) => {
        try {
            const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
            if (!session?.user)
                return reply.status(401).send({ error: "Unauthorized" });
            const userId = session.user.id;
            const body = request.body || {};
            const { role, data } = body;
            // One role per account, enforced here rather than trusted from the form.
            // Without this every extra submit inserted ANOTHER row — a second
            // couriers/customers record, or a whole second outlet — and /api/me
            // resolves by first match, so the duplicates were invisible in the UI
            // while quietly existing in the database. Double-clicking a slow submit
            // button was enough to do it.
            // LIVE rows only, matching the partial unique indexes exactly. Removal is
            // soft everywhere here, and counting removed rows would permanently bar
            // someone an admin had once taken off the platform from ever signing up
            // again — a ban implemented by accident. The two rules have to stay
            // identical: if this check is looser than the index, an allowed submit
            // dies on a constraint violation instead of a readable 409.
            const [existingAdmin, existingCustomer, existingCourier, existingOutlet] = await Promise.all([
                db_1.db.select({ id: schema_1.adminsTable.id }).from(schema_1.adminsTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.adminsTable.user_id, userId), (0, drizzle_orm_1.isNull)(schema_1.adminsTable.deletedAt))).limit(1),
                db_1.db.select({ id: schema_1.customersTable.id }).from(schema_1.customersTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, userId), (0, drizzle_orm_1.isNull)(schema_1.customersTable.deletedAt))).limit(1),
                db_1.db.select({ id: schema_1.couriersTable.id }).from(schema_1.couriersTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, userId), (0, drizzle_orm_1.isNull)(schema_1.couriersTable.deletedAt))).limit(1),
                db_1.db.select({ id: schema_1.outletsTable.id }).from(schema_1.outletsTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.outletsTable.user_id, userId), (0, drizzle_orm_1.isNull)(schema_1.outletsTable.deletedAt))).limit(1),
            ]);
            const currentRole = existingAdmin.length > 0
                ? "admin"
                : existingCustomer.length > 0
                    ? "customer"
                    : existingCourier.length > 0
                        ? "courier"
                        : existingOutlet.length > 0
                            ? "owner"
                            : null;
            if (currentRole) {
                // 409 rather than 400: the request was well-formed, the account simply
                // already has a role. `alreadyRegistered` lets the form treat a repeat
                // submit as "you're done" and move on instead of showing an error for
                // something the user already achieved.
                return reply.status(409).send({
                    error: currentRole === role
                        ? "Akun pian sudah terdaftar. Silakan lanjut ke dashboard."
                        : `Akun pian sudah terdaftar sebagai ${currentRole}.`,
                    alreadyRegistered: true,
                    role: currentRole,
                });
            }
            if (role === "owner") {
                const name = String(data?.name ?? "").trim();
                const address = String(data?.address ?? "").trim();
                const phone = String(data?.phone ?? "").trim();
                const email = String(data?.email ?? "").trim().toLowerCase();
                if (!name || !address || !phone || !email) {
                    return reply
                        .status(400)
                        .send({ error: "Nama, alamat, WhatsApp, dan email outlet wajib diisi" });
                }
                // Coverage is advisory, NOT a gate. An outlet outside courier range is
                // warned at the form (see /api/service-area) and may still register:
                // they can sell over the counter today, couriers expand, and refusing a
                // real business because of a circle drawn last month is worse than
                // letting them in with their eyes open.
                //
                // outlets.email is UNIQUE — pre-check so the form gets a friendly 409
                // instead of a raw Postgres error via 500.
                const [taken] = await db_1.db
                    .select({ id: schema_1.outletsTable.id })
                    .from(schema_1.outletsTable)
                    .where((0, drizzle_orm_1.eq)(schema_1.outletsTable.email, email))
                    .limit(1);
                if (taken) {
                    return reply
                        .status(409)
                        .send({ error: "Email outlet sudah digunakan, silakan pakai email lain" });
                }
                // Coverage is advisory at signup — the form warns, it never blocks — but
                // the answer is recorded so the order lobby doesn't have to recompute it
                // on every poll.
                const outletCoords = (0, coords_1.parseCoordPair)(data?.lat, data?.lon);
                const { covered } = outletCoords
                    ? await (0, service_area_1.isWithinServiceArea)(outletCoords.lat, outletCoords.lon)
                    : { covered: true };
                try {
                    await db_1.db.insert(schema_1.outletsTable).values({
                        name,
                        address,
                        phone,
                        email,
                        user_id: userId,
                        courier_reachable: covered,
                        avatar: data.avatar || "avatar.png",
                        // Use the coordinates from the form's "Gunakan Lokasi Saya"; the
                        // old Banjarmasin point stays as the fallback only.
                        lat: data.lat || String(coords_1.DEFAULT_COORDS.lat),
                        lon: data.lon || String(coords_1.DEFAULT_COORDS.lon),
                        features: Array.isArray(data.features) ? data.features : [],
                        is_open: false,
                    });
                }
                catch (e) {
                    // Race with the pre-check: two submits with the same email.
                    if (e?.code === "23505" || e?.cause?.code === "23505") {
                        return reply
                            .status(409)
                            .send({ error: "Email outlet sudah digunakan, silakan pakai email lain" });
                    }
                    throw e;
                }
            }
            else if (role === "courier") {
                await db_1.db.insert(schema_1.couriersTable).values({
                    user_id: userId,
                    vehicle_plate: data.vehicle_plate,
                    vehicle_type: data.vehicle_type,
                    avatar: data.avatar || "avatar-courier.png",
                });
            }
            else if (role === "customer") {
                // WhatsApp is how the outlet and courier reach this customer about a
                // live order, so it's required rather than optional. Normalised here,
                // not in the form: the browser is not the only caller, and one canonical
                // shape in the column is worth more than a tidy input mask.
                const phone = (0, phone_1.normalizeIndonesianPhone)(data?.phone);
                if (!phone) {
                    return reply.status(400).send({
                        error: "Nomor WhatsApp tidak valid. Pakai nomor Indonesia, minimal 11 angka (contoh: 08123456789).",
                    });
                }
                // Lives on users, not customers: usersTable.phone is already the column
                // the owner's order lobby reads for customer contact. A second phone
                // field on customersTable would be a copy that immediately starts
                // drifting from it.
                await db_1.db.update(schema_1.usersTable).set({ phone }).where((0, drizzle_orm_1.eq)(schema_1.usersTable.id, userId));
                await db_1.db.insert(schema_1.customersTable).values({
                    user_id: userId,
                });
            }
            else {
                return reply.status(400).send({ error: "Invalid role" });
            }
            return { success: true };
        }
        catch (error) {
            console.error("Registration error:", error);
            return reply.status(500).send({ error: error.message || "Internal Server Error" });
        }
    });
}
