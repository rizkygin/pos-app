"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.productRoutes = productRoutes;
const drizzle_orm_1 = require("drizzle-orm");
const pg_core_1 = require("drizzle-orm/pg-core");
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = __importDefault(require("node:fs/promises"));
const sharp_1 = __importDefault(require("sharp"));
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../auth");
const web_headers_1 = require("../lib/web-headers");
const outlet_access_1 = require("../lib/outlet-access");
const outlet_features_1 = require("../lib/outlet-features");
const UPLOADS_ROOT = node_path_1.default.join(process.cwd(), "uploads");
const PRODUCTS_DIR = node_path_1.default.join(UPLOADS_ROOT, "products");
const PRODUCTS_URL_PREFIX = "/uploads/products/";
// Empty string -> null so the unique-per-outlet index (which allows unlimited
// NULLs) doesn't treat "no barcode yet" as a collision between two products.
function normalizeBarcode(barcode) {
    if (barcode === undefined)
        return undefined;
    const trimmed = barcode.trim();
    return trimmed === "" ? null : trimmed;
}
async function findBarcodeConflict(outletId, barcode, excludeProductId) {
    const [conflict] = await db_1.db
        .select({ id: schema_1.productsTable.id, product_name: schema_1.productsTable.product_name })
        .from(schema_1.productsTable)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, outletId), (0, drizzle_orm_1.eq)(schema_1.productsTable.barcode, barcode)))
        .limit(1);
    if (!conflict || conflict.id === excludeProductId)
        return null;
    return conflict;
}
// Two kinds of product are priced by a [lowest, highest] range, and they are NOT
// the same thing:
//
//   jasa      — the range is the price itself, negotiated per job. No stock.
//   materials — the goods have a fixed price (the range floor); the band above it
//               is the outlet's haul cost, quoted per order into delivery_fee.
//               Besi and keramik are counted in batang and dus, so stock stays on.
//
// `lowest_price != null` used to imply "service" on its own. It can't any more —
// the discriminator is courier_deliverable, which is forced true for every
// category that doesn't ask the question (see resolveCourierDeliverable), so only
// bulky goods can be both ranged and undeliverable.
// `courierDeliverable` must be the RESOLVED value (post resolveCourierDeliverable),
// not the raw body field: a client sending courier_deliverable:false on a makanan
// product gets forced back to true, and the pricing must agree with that.
function rangePricedFields(data, courierDeliverable) {
    const hasRange = data.lowest_price != null && data.lowest_price !== "";
    if (!hasRange)
        return null;
    const isMaterials = courierDeliverable === false;
    return {
        lowest_price: data.lowest_price,
        highest_price: data.highest_price ?? data.lowest_price,
        // Mirrored so existing "mulai dari" customer displays keep working.
        price: data.lowest_price,
        price_mark_down: data.lowest_price,
        // Forcing this off for materials would silently wipe a hardware store's
        // inventory the moment they set a delivery band on a product.
        ...(isMaterials ? {} : { track_stock: false }),
        discount_percent: null,
    };
}
// Only mart and building materials can hold something a courier can't carry, so
// only they are asked in the product form. Mirrored here rather than trusted
// from the client: a stale `false` on a makanan product would silently route
// the customer's order down the no-courier flow with no UI showing why.
const COURIER_QUESTION_CATEGORIES = new Set(["mart", "bahan bangunan"]);
function resolveCourierDeliverable(category, value) {
    if (!category || !COURIER_QUESTION_CATEGORIES.has(category))
        return true;
    return value ?? true;
}
async function requireUser(request, reply) {
    const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
    if (!session?.user) {
        reply.status(401).send({ success: false, message: "Unauthorized" });
        return null;
    }
    return session;
}
async function productRoutes(app) {
    // The caller's outlet + its products, in one call. Backs the cashier and
    // product-manager pages (both need outlet info + the outlet's product list).
    app.get("/api/products/mine", async (request, reply) => {
        const session = await requireUser(request, reply);
        if (!session)
            return;
        // Owner or ANY active employee: this is the read-only outlet+product list
        // that every permitted page needs (cashier, faktur, stok). Mutations below
        // require the 'products' permission explicitly.
        const access = await (0, outlet_access_1.getOutletAccess)(session.user.id, (0, outlet_access_1.parseActiveOutletId)(request));
        if (!access)
            return reply.send({ outlet: null, products: [] });
        const outlet = access.outlet;
        const rows = await db_1.db
            .select()
            .from(schema_1.productsTable)
            .leftJoin(schema_1.menuGroupsTable, (0, drizzle_orm_1.eq)(schema_1.productsTable.menu_group_id, schema_1.menuGroupsTable.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, outlet.id), (0, drizzle_orm_1.isNull)(schema_1.productsTable.deletedAt)));
        // Flattened back to bare product rows: faktur and stok also read this
        // endpoint and index straight into product fields, so the join must not
        // change the shape. The section name rides along as two extra keys, which
        // the cashier uses for its tabs the same way the customer menu does.
        const products = rows.map((r) => ({
            ...r.products,
            menu_group: r.menu_groups?.name ?? null,
            menu_group_order: r.menu_groups?.sort_order ?? null,
        }));
        return reply.send({ outlet, products });
    });
    app.post("/api/products", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        try {
            const data = request.body;
            const id = crypto.randomUUID();
            const courierDeliverable = resolveCourierDeliverable(data.category, data.courier_deliverable);
            const ranged = rangePricedFields(data, courierDeliverable);
            const barcode = normalizeBarcode(data.barcode);
            if (barcode) {
                const conflict = await findBarcodeConflict(access.outlet.id, barcode);
                if (conflict) {
                    return reply.send({
                        success: false,
                        message: `Barcode sudah dipakai produk "${conflict.product_name}" di outlet ini.`,
                    });
                }
            }
            try {
                await db_1.db.insert(schema_1.productsTable).values({
                    id,
                    product_name: data.product_name,
                    price: ranged?.price ?? data.price,
                    price_mark_down: ranged?.price_mark_down ?? data.price_mark_down,
                    buying_price: data.buying_price,
                    // Pinned to the caller's outlet — body.outlet_id is ignored.
                    outlet_id: access.outlet.id,
                    category: data.category,
                    menu_group_id: data.menu_group_id ?? null,
                    description: data.description || "",
                    unit: data.unit || "pcs",
                    image: data.image || "avatar.png",
                    features: data.features ?? [],
                    is_for_sale: data.is_for_sale ?? true,
                    // rangePricedFields only pins track_stock off for jasa; bulky goods
                    // keep counting theirs, so fall through to the owner's choice.
                    track_stock: ranged?.track_stock ?? data.track_stock ?? true,
                    courier_deliverable: courierDeliverable,
                    lowest_price: ranged?.lowest_price ?? null,
                    highest_price: ranged?.highest_price ?? null,
                    barcode: barcode ?? null,
                });
            }
            catch (err) {
                // Race-safe fallback: two concurrent saves could both pass the
                // pre-check above before either commits.
                if ((err?.code ?? err?.cause?.code) === "23505") {
                    return reply.send({ success: false, message: "Barcode sudah dipakai produk lain di outlet ini." });
                }
                throw err;
            }
            // outlets.features is derived, never owner-edited: a new product may put
            // the outlet into a category it wasn't browsable under before.
            await (0, outlet_features_1.recalcOutletFeatures)(access.outlet.id);
            return reply.send({ success: true, message: "Product added successfully." });
        }
        catch (error) {
            app.log.error(error, "Failed to add product");
            return reply.status(500).send({ success: false, message: "Failed to add product." });
        }
    });
    app.post("/api/products/upload-image", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        try {
            const file = await request.file();
            if (!file)
                return reply.send({ success: false, message: "No image file provided." });
            const buffer = await file.toBuffer();
            const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
            const filename = `product-${uniqueSuffix}.webp`;
            await promises_1.default.mkdir(PRODUCTS_DIR, { recursive: true });
            await (0, sharp_1.default)(buffer)
                .resize(400, 600, { fit: "cover", position: "center" })
                .webp({ quality: 80 })
                .toFile(node_path_1.default.join(PRODUCTS_DIR, filename));
            return reply.send({ success: true, imageUrl: `${PRODUCTS_URL_PREFIX}${filename}` });
        }
        catch (error) {
            app.log.error(error, "Failed to upload product image");
            return reply.status(500).send({ success: false, message: "Failed to process and upload image." });
        }
    });
    app.post("/api/products/remove-image", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        try {
            const { imageUrl } = request.body ?? {};
            if (!imageUrl || !imageUrl.startsWith(PRODUCTS_URL_PREFIX)) {
                return reply.send({ success: false, message: "Invalid image URL." });
            }
            const filename = imageUrl.slice(PRODUCTS_URL_PREFIX.length);
            const filePath = node_path_1.default.join(PRODUCTS_DIR, filename);
            if (!filePath.startsWith(PRODUCTS_DIR + node_path_1.default.sep)) {
                return reply.send({ success: false, message: "Invalid image URL." });
            }
            await promises_1.default.unlink(filePath);
            return reply.send({ success: true, message: "Image removed successfully." });
        }
        catch (error) {
            app.log.error(error, "Failed to remove product image");
            return reply.status(500).send({ success: false, message: "Failed to remove image." });
        }
    });
    // Returns { success } for backend-served (/uploads/) images; legacy paths
    // live in the frontend public dir, so we assume them accessible.
    app.get("/api/products/check-image", async (request, reply) => {
        const imageUrl = request.query.url ?? "";
        if (imageUrl === "")
            return reply.send({ ok: true });
        if (!imageUrl.startsWith(PRODUCTS_URL_PREFIX)) {
            return reply.send({ success: true, message: "assumed accessible", path: imageUrl });
        }
        try {
            const filename = imageUrl.slice(PRODUCTS_URL_PREFIX.length);
            await promises_1.default.access(node_path_1.default.join(PRODUCTS_DIR, filename));
            return reply.send({ success: true, message: "Image is accessable", path: imageUrl });
        }
        catch (error) {
            return reply.send({ success: false, message: error.message });
        }
    });
    app.post("/api/products/remove-image-db", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        try {
            const { imageUrl } = request.body ?? {};
            await db_1.db
                .update(schema_1.productsTable)
                .set({ image: "avatar.png" })
                .where((0, drizzle_orm_1.eq)(schema_1.productsTable.image, imageUrl ?? ""));
            return reply.send({ success: true, message: "Image removed successfully." });
        }
        catch (error) {
            app.log.error(error, "Failed to remove image from db");
            return reply.status(500).send({ success: false, message: "Failed to remove image." });
        }
    });
    // Products with history (orders, invoices, stock ledger, ratings, ads, or
    // used as someone's recipe ingredient) are SOFT-deleted: deletedAt is set,
    // listings hide them, but old receipts/reports keep resolving their name —
    // deleting a product must never rewrite financial history. Only a product
    // nothing references is hard-deleted (image file included). Its own recipe
    // rows cascade with the row; an ingredient in use never reaches this path.
    app.post("/api/products/delete", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        try {
            const { productId } = request.body ?? {};
            if (!productId)
                return reply.send({ success: false, message: "productId is required" });
            const [product] = await db_1.db
                .select()
                .from(schema_1.productsTable)
                .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, productId))
                .limit(1);
            if (!product || product.outlet_id !== access.outlet.id)
                return reply.send({ success: false, message: "Product not found" });
            const referenced = (await Promise.all([
                db_1.db.select({ id: schema_1.orderDetailsTable.id }).from(schema_1.orderDetailsTable).where((0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, productId)).limit(1),
                db_1.db.select({ id: schema_1.invoiceItemsTable.id }).from(schema_1.invoiceItemsTable).where((0, drizzle_orm_1.eq)(schema_1.invoiceItemsTable.product_id, productId)).limit(1),
                db_1.db.select({ id: schema_1.stockMovementsTable.id }).from(schema_1.stockMovementsTable).where((0, drizzle_orm_1.eq)(schema_1.stockMovementsTable.product_id, productId)).limit(1),
                db_1.db.select({ id: schema_1.ratingsTable.id }).from(schema_1.ratingsTable).where((0, drizzle_orm_1.eq)(schema_1.ratingsTable.product_id, productId)).limit(1),
                db_1.db.select({ id: schema_1.productAdsTable.id }).from(schema_1.productAdsTable).where((0, drizzle_orm_1.eq)(schema_1.productAdsTable.product_id, productId)).limit(1),
                db_1.db.select({ id: schema_1.recipeItemsTable.id }).from(schema_1.recipeItemsTable).where((0, drizzle_orm_1.eq)(schema_1.recipeItemsTable.ingredient_id, productId)).limit(1),
            ])).some((rows) => rows.length > 0);
            if (referenced) {
                await db_1.db
                    .update(schema_1.productsTable)
                    .set({ deletedAt: new Date() })
                    .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, productId));
                // Archiving the outlet's last product of a category drops that feature,
                // so the outlet stops being listed under it straight away.
                await (0, outlet_features_1.recalcOutletFeatures)(access.outlet.id);
                return reply.send({ success: true, message: "Product archived (punya riwayat penjualan)." });
            }
            await db_1.db.delete(schema_1.productsTable).where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, productId));
            await (0, outlet_features_1.recalcOutletFeatures)(access.outlet.id);
            // Unlink the image only after the row delete succeeded, so a failed
            // delete can't orphan the product from its picture.
            if (product.image?.startsWith(PRODUCTS_URL_PREFIX)) {
                const filename = product.image.slice(PRODUCTS_URL_PREFIX.length);
                try {
                    await promises_1.default.unlink(node_path_1.default.join(PRODUCTS_DIR, filename));
                }
                catch (err) {
                    app.log.error(err, "Failed to delete product image file");
                }
            }
            return reply.send({ success: true, message: "Product deleted successfully." });
        }
        catch (error) {
            app.log.error(error, "Failed to delete product");
            return reply.status(500).send({ success: false, message: "Failed to delete product." });
        }
    });
    app.post("/api/products/update", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        try {
            const { productId, data } = request.body ?? {};
            if (!productId || !data) {
                return reply.send({ success: false, message: "productId and data are required" });
            }
            const [existing] = await db_1.db
                .select({
                outlet_id: schema_1.productsTable.outlet_id,
                category: schema_1.productsTable.category,
                courier_deliverable: schema_1.productsTable.courier_deliverable,
            })
                .from(schema_1.productsTable)
                .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, productId))
                .limit(1);
            if (!existing || existing.outlet_id !== access.outlet.id)
                return reply.send({ success: false, message: "Product not found" });
            // Fall back to the stored row for anything the caller omitted. Resolving
            // against the body alone would flip a besi product back to "deliverable"
            // on any partial update that didn't happen to resend the flag.
            const courierDeliverable = resolveCourierDeliverable(data.category ?? existing.category, data.courier_deliverable ?? existing.courier_deliverable);
            const ranged = rangePricedFields(data, courierDeliverable);
            const barcode = normalizeBarcode(data.barcode);
            if (barcode) {
                const conflict = await findBarcodeConflict(access.outlet.id, barcode, productId);
                if (conflict) {
                    return reply.send({
                        success: false,
                        message: `Barcode sudah dipakai produk "${conflict.product_name}" di outlet ini.`,
                    });
                }
            }
            try {
                await db_1.db
                    .update(schema_1.productsTable)
                    .set({
                    product_name: data.product_name,
                    price: ranged?.price ?? data.price,
                    price_mark_down: ranged?.price_mark_down ?? data.price_mark_down,
                    buying_price: data.buying_price,
                    category: data.category,
                    ...(data.menu_group_id !== undefined && { menu_group_id: data.menu_group_id }),
                    description: data.description,
                    unit: data.unit,
                    ...(data.image && { image: data.image }),
                    ...(data.features !== undefined && { features: data.features }),
                    ...(data.is_for_sale !== undefined && { is_for_sale: data.is_for_sale }),
                    // Always rewritten: moving a product out of mart/bahan bangunan has
                    // to clear any `false` it was carrying, and the resolved value
                    // already accounts for fields the caller omitted.
                    courier_deliverable: courierDeliverable,
                    ...(barcode !== undefined && { barcode }),
                    ...(ranged
                        ? {
                            lowest_price: ranged.lowest_price,
                            highest_price: ranged.highest_price,
                            discount_percent: null,
                            // Present only for jasa — materials keep their real stock.
                            ...(ranged.track_stock !== undefined
                                ? { track_stock: ranged.track_stock }
                                : data.track_stock !== undefined && { track_stock: data.track_stock }),
                        }
                        : data.track_stock !== undefined && { track_stock: data.track_stock }),
                })
                    .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, productId));
            }
            catch (err) {
                if ((err?.code ?? err?.cause?.code) === "23505") {
                    return reply.send({ success: false, message: "Barcode sudah dipakai produk lain di outlet ini." });
                }
                throw err;
            }
            // Both `category` and `is_for_sale` are editable here, and either can add
            // or remove a feature — including removing the outlet's last one.
            await (0, outlet_features_1.recalcOutletFeatures)(access.outlet.id);
            return reply.send({ success: true, message: "Product updated successfully." });
        }
        catch (error) {
            app.log.error(error, "Failed to update product");
            return reply.status(500).send({ success: false, message: "Failed to update product." });
        }
    });
    // ── Recipe (bill-of-materials) ─────────────────────────────────────────
    // Strictly opt-in: only track_stock=false products can have one, and a
    // product without recipe rows simply moves no stock when sold.
    // Recipe rows + ingredient display info for the product-form editor.
    app.get("/api/products/:id/recipe", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        const productId = request.params.id;
        const [product] = await db_1.db
            .select({ outlet_id: schema_1.productsTable.outlet_id, track_stock: schema_1.productsTable.track_stock })
            .from(schema_1.productsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.id, productId), (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, access.outlet.id)))
            .limit(1);
        if (!product)
            return reply.status(404).send({ success: false, message: "Product not found" });
        const ingredient = (0, pg_core_1.alias)(schema_1.productsTable, "ingredient");
        const items = await db_1.db
            .select({
            ingredient_id: schema_1.recipeItemsTable.ingredient_id,
            qty: schema_1.recipeItemsTable.qty,
            name: ingredient.product_name,
            unit: ingredient.unit,
            stock: ingredient.stock,
        })
            .from(schema_1.recipeItemsTable)
            .innerJoin(ingredient, (0, drizzle_orm_1.eq)(ingredient.id, schema_1.recipeItemsTable.ingredient_id))
            .where((0, drizzle_orm_1.eq)(schema_1.recipeItemsTable.product_id, productId));
        return reply.send({ success: true, items });
    });
    // Replace-on-save: the submitted list becomes the whole recipe (empty list
    // clears it). Rejected for track_stock products — one stock mode at a time.
    app.put("/api/products/:id/recipe", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        const productId = request.params.id;
        const body = request.body ?? {};
        const items = Array.isArray(body.items) ? body.items : [];
        const [product] = await db_1.db
            .select({ outlet_id: schema_1.productsTable.outlet_id, track_stock: schema_1.productsTable.track_stock })
            .from(schema_1.productsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.id, productId), (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, access.outlet.id)))
            .limit(1);
        if (!product)
            return reply.status(404).send({ success: false, message: "Product not found" });
        if (product.track_stock && items.length > 0) {
            return reply.status(409).send({
                success: false,
                message: "Produk dengan stok sendiri tidak bisa punya resep — matikan 'lacak stok' dulu.",
            });
        }
        // Validate every line against the caller's own products before writing.
        const clean = [];
        for (const it of items) {
            const qty = Number(it.qty);
            if (!it.ingredient_id || !Number.isFinite(qty) || qty <= 0) {
                return reply.status(400).send({ success: false, message: "Setiap bahan butuh qty > 0" });
            }
            if (it.ingredient_id === productId) {
                return reply.status(400).send({ success: false, message: "Produk tidak bisa jadi bahan dirinya sendiri" });
            }
            const [ing] = await db_1.db
                .select({ track_stock: schema_1.productsTable.track_stock, outlet_id: schema_1.productsTable.outlet_id })
                .from(schema_1.productsTable)
                .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, it.ingredient_id))
                .limit(1);
            if (!ing || ing.outlet_id !== product.outlet_id) {
                return reply.status(400).send({ success: false, message: "Bahan tidak ditemukan di outlet ini" });
            }
            if (!ing.track_stock) {
                return reply.status(400).send({ success: false, message: "Bahan harus produk yang melacak stok" });
            }
            clean.push({ ingredient_id: it.ingredient_id, qty: qty.toFixed(3) });
        }
        await db_1.db.transaction(async (tx) => {
            await tx.delete(schema_1.recipeItemsTable).where((0, drizzle_orm_1.eq)(schema_1.recipeItemsTable.product_id, productId));
            if (clean.length) {
                await tx.insert(schema_1.recipeItemsTable).values(clean.map((c) => ({
                    outlet_id: product.outlet_id,
                    product_id: productId,
                    ingredient_id: c.ingredient_id,
                    qty: c.qty,
                })));
            }
        });
        return reply.send({ success: true });
    });
    // ── Menu groups: owner-defined sections for the public /menu page ────────
    // Separate from products.category on purpose — see menuGroupsTable in
    // db/schema.ts. Same "products" permission as the product routes above.
    app.get("/api/menu-groups", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        const groups = await db_1.db
            .select({
            id: schema_1.menuGroupsTable.id,
            name: schema_1.menuGroupsTable.name,
            sort_order: schema_1.menuGroupsTable.sort_order,
        })
            .from(schema_1.menuGroupsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.menuGroupsTable.outlet_id, access.outlet.id), (0, drizzle_orm_1.isNull)(schema_1.menuGroupsTable.deletedAt)))
            .orderBy(schema_1.menuGroupsTable.sort_order, schema_1.menuGroupsTable.name);
        return reply.send({ success: true, groups });
    });
    app.post("/api/menu-groups", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        const name = String(request.body?.name ?? "").trim();
        if (!name)
            return reply.status(400).send({ success: false, error: "Nama grup wajib diisi" });
        if (name.length > 60)
            return reply.status(400).send({ success: false, error: "Nama grup maksimal 60 karakter" });
        // New groups land at the end rather than the top: appending is what an
        // owner adding a section to an existing menu expects.
        const [last] = await db_1.db
            .select({ max: (0, drizzle_orm_1.sql) `coalesce(max(${schema_1.menuGroupsTable.sort_order}), -1)` })
            .from(schema_1.menuGroupsTable)
            .where((0, drizzle_orm_1.eq)(schema_1.menuGroupsTable.outlet_id, access.outlet.id));
        try {
            const [created] = await db_1.db
                .insert(schema_1.menuGroupsTable)
                .values({ outlet_id: access.outlet.id, name, sort_order: Number(last?.max ?? -1) + 1 })
                .returning({ id: schema_1.menuGroupsTable.id, name: schema_1.menuGroupsTable.name, sort_order: schema_1.menuGroupsTable.sort_order });
            return reply.send({ success: true, group: created });
        }
        catch {
            // Unique (outlet_id, name) — the picker relies on distinct names.
            return reply.status(409).send({ success: false, error: "Grup dengan nama itu sudah ada" });
        }
    });
    app.patch("/api/menu-groups/:id", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        const id = Number(request.params.id);
        const name = String(request.body?.name ?? "").trim();
        if (!id || !name)
            return reply.status(400).send({ success: false, error: "id dan nama wajib diisi" });
        try {
            const updated = await db_1.db
                .update(schema_1.menuGroupsTable)
                .set({ name, updatedAt: new Date() })
                // Scoped to the caller's outlet so an id from another outlet can't be renamed.
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.menuGroupsTable.id, id), (0, drizzle_orm_1.eq)(schema_1.menuGroupsTable.outlet_id, access.outlet.id)))
                .returning({ id: schema_1.menuGroupsTable.id });
            if (updated.length === 0)
                return reply.status(404).send({ success: false, error: "Grup tidak ditemukan" });
            return reply.send({ success: true });
        }
        catch {
            return reply.status(409).send({ success: false, error: "Grup dengan nama itu sudah ada" });
        }
    });
    // Bulk reorder: the client sends ids in their new display order.
    app.post("/api/menu-groups/reorder", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        const ids = request.body?.ids;
        if (!Array.isArray(ids))
            return reply.status(400).send({ success: false, error: "ids wajib berupa array" });
        await db_1.db.transaction(async (tx) => {
            for (const [index, id] of ids.entries()) {
                await tx
                    .update(schema_1.menuGroupsTable)
                    .set({ sort_order: index, updatedAt: new Date() })
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.menuGroupsTable.id, Number(id)), (0, drizzle_orm_1.eq)(schema_1.menuGroupsTable.outlet_id, access.outlet.id)));
            }
        });
        return reply.send({ success: true });
    });
    app.delete("/api/menu-groups/:id", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        const id = Number(request.params.id);
        if (!id)
            return reply.status(400).send({ success: false, error: "id wajib diisi" });
        // Hard delete: products.menu_group_id is ON DELETE SET NULL, so the products
        // survive and simply become ungrouped.
        const deleted = await db_1.db
            .delete(schema_1.menuGroupsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.menuGroupsTable.id, id), (0, drizzle_orm_1.eq)(schema_1.menuGroupsTable.outlet_id, access.outlet.id)))
            .returning({ id: schema_1.menuGroupsTable.id });
        if (deleted.length === 0)
            return reply.status(404).send({ success: false, error: "Grup tidak ditemukan" });
        return reply.send({ success: true });
    });
}
