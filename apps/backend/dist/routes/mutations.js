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
const phone_1 = require("../lib/utils/phone");
const coords_1 = require("../lib/utils/coords");
const service_area_1 = require("../lib/service-area");
// Record a POS sale as cash-in for the given outlet. Find-or-create the "Kasir"
// cash-in category so a missing category can't silently drop the cashflow, and
// attribute it to the actual outlet (was hardcoded to outlet 1).
async function addPosToCashflowin(tx, outletId, total) {
    let [category] = await tx
        .select({ id: schema_1.cashInCategoryTable.id })
        .from(schema_1.cashInCategoryTable)
        .where((0, drizzle_orm_1.eq)(schema_1.cashInCategoryTable.category, "Kasir"))
        .limit(1);
    if (!category) {
        [category] = await tx
            .insert(schema_1.cashInCategoryTable)
            .values({ category: "Kasir" })
            .returning({ id: schema_1.cashInCategoryTable.id });
    }
    const [detail] = await tx
        .insert(schema_1.cashInDetailTable)
        .values({
        category_id: category.id,
        money_amount: String(total),
        type: "cash",
    })
        .returning();
    await tx.insert(schema_1.cashFlows).values({
        outlet_id: outletId,
        cash_in_detail_id: detail.id,
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
            let new_order_id;
            try {
                await db_1.db.transaction(async (tx) => {
                    if (body.cart && body.cart.length > 0) {
                        new_order_id = clientOrderId ?? crypto.randomUUID();
                        await tx.insert(schema_1.ordersTable).values({
                            id: new_order_id,
                            customer_id: customer_offline?.id || 1,
                            courier_id: courier_offline?.id || 1,
                            status: "delivered",
                            outlet_id: body.outletId,
                            note: {
                                customerName: body.customerName || null,
                                cashierName: body.cashierName || null,
                                discountAmount: body.discountAmount ?? 0,
                                paymentMethod: body.paymentMethod ?? "cash",
                                amountPaid: body.amountPaid ?? 0,
                                changeDue: body.changeDue ?? 0,
                            },
                        });
                        for (const item of body.cart) {
                            const qty = Number(item.quantity);
                            const summary_price = item.product.price_mark_down && item.product.price_mark_down !== "0"
                                ? parseFloat(item.product.price_mark_down) * qty
                                : parseFloat(item.product.price) * qty;
                            await tx.insert(schema_1.orderDetailsTable).values({
                                order_id: new_order_id,
                                product_id: item.product.id,
                                quantity: item.quantity,
                                note_product: item.note_product || "-",
                                summary_price: summary_price.toString(),
                                status: "checkout",
                            });
                            // POS is an immediate sale: move stock (own stock for track_stock
                            // products, ingredients for recipe products) with an audit trail.
                            // Oversell warnings are ignored here — a POS sale must never fail
                            // because stock records lag reality.
                            await (0, stock_1.applySaleStockOut)(tx, {
                                outletId: body.outletId,
                                productId: item.product.id,
                                qty,
                                note: `POS ${new_order_id}`,
                            });
                        }
                    }
                    await addPosToCashflowin(tx, body.outletId, body.total);
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
    app.post("/api/add-pos-to-cashflowin", async (request, reply) => {
        try {
            const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "cashier");
            if (!access)
                return;
            const body = request.body || {};
            await db_1.db.transaction((tx) => addPosToCashflowin(tx, access.outlet.id, body.total));
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
