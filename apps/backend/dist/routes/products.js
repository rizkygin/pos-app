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
const stock_1 = require("../lib/stock");
const addons_1 = require("../lib/addons");
const variants_1 = require("../lib/variants");
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
// An ingredient has no selling price, and never had one.
//
// "bahan" enters the books through a PURCHASE INVOICE and leaves through a
// recipe. Nothing sells it: it is excluded from every public listing and from
// the POS grid by category alone (INTERNAL_CATEGORIES in lib/outlet-features.ts),
// so a number in `price` is not merely unused, it is a lie the etalase already
// has to work around — the Bahan tab substitutes buying_price for its Harga
// column precisely because this one is a column of zeroes.
//
// It is also not where cost comes from. HPP for an ingredient is the cost
// ledger's weighted average (products.avg_cost, maintained from
// stock_movements), never a figure typed into the product form.
//
// Pinned here rather than trusted from the form, for the same reason
// rangePricedFields is: the form hides the input, and the stored row must agree
// with what the form is telling the owner.
const INGREDIENT_CATEGORY = "bahan";
function ingredientPricedFields(category) {
    if ((category ?? "").trim().toLowerCase() !== INGREDIENT_CATEGORY)
        return null;
    return { price: "0", price_mark_down: "0" };
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
/**
 * Does anything in the books point at this product?
 *
 * The test for soft- vs hard-delete, hoisted out of the delete route because
 * deleting a base product now has to ask it once per variant too: a variant
 * that has been sold must be ARCHIVED like any other sold product, or the
 * order line, the invoice line and the stock movement that reference it lose
 * the row that gives them a name.
 */
async function productIsReferenced(productId) {
    const hits = await Promise.all([
        db_1.db.select({ id: schema_1.orderDetailsTable.id }).from(schema_1.orderDetailsTable).where((0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, productId)).limit(1),
        db_1.db.select({ id: schema_1.invoiceItemsTable.id }).from(schema_1.invoiceItemsTable).where((0, drizzle_orm_1.eq)(schema_1.invoiceItemsTable.product_id, productId)).limit(1),
        db_1.db.select({ id: schema_1.stockMovementsTable.id }).from(schema_1.stockMovementsTable).where((0, drizzle_orm_1.eq)(schema_1.stockMovementsTable.product_id, productId)).limit(1),
        db_1.db.select({ id: schema_1.ratingsTable.id }).from(schema_1.ratingsTable).where((0, drizzle_orm_1.eq)(schema_1.ratingsTable.product_id, productId)).limit(1),
        db_1.db.select({ id: schema_1.productAdsTable.id }).from(schema_1.productAdsTable).where((0, drizzle_orm_1.eq)(schema_1.productAdsTable.product_id, productId)).limit(1),
        db_1.db.select({ id: schema_1.recipeItemsTable.id }).from(schema_1.recipeItemsTable).where((0, drizzle_orm_1.eq)(schema_1.recipeItemsTable.ingredient_id, productId)).limit(1),
    ]);
    return hits.some((rows) => rows.length > 0);
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
        // Which products have a composition at all. One flat query over the
        // outlet's recipe rows rather than an EXISTS per product: the Stok page
        // needs this only to decide whether to offer the "Produksi" button, and
        // recipe_items is small enough per outlet that the set is cheaper than the
        // correlated subquery would be.
        const withRecipe = new Set((await db_1.db
            .selectDistinct({ product_id: schema_1.recipeItemsTable.product_id })
            .from(schema_1.recipeItemsTable)
            .where((0, drizzle_orm_1.eq)(schema_1.recipeItemsTable.outlet_id, outlet.id))).map((r) => r.product_id));
        // Flattened back to bare product rows: faktur and stok also read this
        // endpoint and index straight into product fields, so the join must not
        // change the shape. The section name rides along as two extra keys, which
        // the cashier uses for its tabs the same way the customer menu does.
        // Add-on groups, so the POS can open a picker without a second round trip
        // per product. Live rows only: this drives COMPOSITION, and composition
        // follows the menu as it stands right now. Settlement is the other half and
        // deliberately reads archived rows instead — see lib/addons.ts.
        const addonsByProduct = await (0, addons_1.addonGroupsForProducts)(outlet.id, rows.map((r) => r.products.id));
        const products = rows.map((r) => ({
            ...r.products,
            menu_group: r.menu_groups?.name ?? null,
            menu_group_order: r.menu_groups?.sort_order ?? null,
            has_recipe: withRecipe.has(r.products.id),
            addon_groups: addonsByProduct.get(r.products.id) ?? [],
        }));
        const gate = await (0, outlet_access_1.getSubscriptionGate)(outlet.user_id);
        return reply.send({ outlet, products, gate });
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
            const ingredient = ingredientPricedFields(data.category);
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
                    price: ingredient?.price ?? ranged?.price ?? data.price,
                    price_mark_down: ingredient?.price_mark_down ?? ranged?.price_mark_down ?? data.price_mark_down,
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
    //
    // A BASE PRODUCT TAKES ITS VARIANTS WITH IT. A variant is only reachable
    // through its base's picker (the POS grid shows bases), so one left behind is
    // a product that still exists, still holds stock, and can no longer be sold
    // by anybody. Each variant is judged on its OWN history though — a Large that
    // has been sold is archived, an unsold one is deleted — because the rule
    // being protected is about the books, not about the family.
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
            // Gathered BEFORE anything is written: hard-deleting the base first would
            // null these rows' variant_of (ON DELETE set null) and leave them
            // unfindable — as standalone products the owner never authored.
            const variants = product.variant_of
                ? []
                : await db_1.db
                    .select()
                    .from(schema_1.productsTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.variant_of, productId), (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, access.outlet.id), (0, drizzle_orm_1.isNull)(schema_1.productsTable.deletedAt)));
            let archived = 0;
            let removed = 0;
            let baseArchived = false;
            // Variants first, base last, so a failure part way through never leaves a
            // deleted base pointing at live children.
            for (const row of [...variants, product]) {
                if (await productIsReferenced(row.id)) {
                    if (row.id === productId)
                        baseArchived = true;
                    await db_1.db
                        .update(schema_1.productsTable)
                        .set({ deletedAt: new Date() })
                        .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, row.id));
                    archived += 1;
                    continue;
                }
                await db_1.db.delete(schema_1.productsTable).where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, row.id));
                removed += 1;
                // Unlink the image only after the row delete succeeded, so a failed
                // delete can't orphan the product from its picture. A variant inherits
                // its base's image path, so only delete a file nothing else points at.
                if (row.image?.startsWith(PRODUCTS_URL_PREFIX)) {
                    const [stillUsed] = await db_1.db
                        .select({ id: schema_1.productsTable.id })
                        .from(schema_1.productsTable)
                        .where((0, drizzle_orm_1.eq)(schema_1.productsTable.image, row.image))
                        .limit(1);
                    if (!stillUsed) {
                        const filename = row.image.slice(PRODUCTS_URL_PREFIX.length);
                        try {
                            await promises_1.default.unlink(node_path_1.default.join(PRODUCTS_DIR, filename));
                        }
                        catch (err) {
                            app.log.error(err, "Failed to delete product image file");
                        }
                    }
                }
            }
            // Archiving the outlet's last product of a category drops that feature,
            // so the outlet stops being listed under it straight away.
            await (0, outlet_features_1.recalcOutletFeatures)(access.outlet.id);
            // The base's own fate leads the sentence, because that is the row the
            // owner tapped delete on. A variant may well have gone the other way —
            // one that has been sold is archived even when its base is deleted
            // outright — so the variants are counted separately rather than folded
            // into a single verb that would be wrong for half of them.
            const suffix = variants.length > 0 ? ` (termasuk ${variants.length} varian)` : "";
            return reply.send({
                success: true,
                message: baseArchived
                    ? `Produk diarsipkan (punya riwayat penjualan)${suffix}.`
                    : `Produk dihapus${suffix}.`,
                archived,
                removed,
            });
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
                // Both for the variant cascade below: the OLD name is what tells a
                // derived variant name apart from one the owner typed.
                product_name: schema_1.productsTable.product_name,
                variant_of: schema_1.productsTable.variant_of,
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
            // Resolved against the stored row like courierDeliverable above: a partial
            // update that omits `category` must not un-pin an ingredient's price.
            const ingredient = ingredientPricedFields(data.category ?? existing.category);
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
                    price: ingredient?.price ?? ranged?.price ?? data.price,
                    price_mark_down: ingredient?.price_mark_down ?? ranged?.price_mark_down ?? data.price_mark_down,
                    buying_price: data.buying_price,
                    // A leftover discount on something that is not sold is noise, and
                    // it would keep the etalase drawing a strikethrough price.
                    ...(ingredient && { discount_percent: null }),
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
            // Variants follow their base on the three fields that decide where a row
            // FILES, because a variant that disagrees with its base about any of them
            // becomes unreachable rather than merely inconsistent:
            //
            //   product_name    printed on every receipt and report, which have no
            //                   base to read context from. Only the ones still
            //                   carrying the derived name are rewritten — a
            //                   product_name the owner typed themselves is theirs.
            //   category /      a variant filed elsewhere sorts into a different tab
            //   menu_group_id   from the product it belongs to.
            //   is_for_sale     hiding a base from customers while its Large stays
            //                   listed is not "hidden", it is one size hidden.
            //
            // Deliberately NOT cascaded: price (the entire point of a variant),
            // barcode (unique per outlet), and isAvailable — a base marked habis
            // while the Large is still in the fridge is a true statement.
            if (!existing.variant_of) {
                const variants = await db_1.db
                    .select({
                    id: schema_1.productsTable.id,
                    product_name: schema_1.productsTable.product_name,
                    variant_name: schema_1.productsTable.variant_name,
                })
                    .from(schema_1.productsTable)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.variant_of, productId), (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, access.outlet.id)));
                for (const variant of variants) {
                    const renamed = data.product_name &&
                        variant.variant_name &&
                        variant.product_name ===
                            (0, variants_1.variantProductName)(existing.product_name, variant.variant_name)
                        ? (0, variants_1.variantProductName)(data.product_name, variant.variant_name)
                        : undefined;
                    const patch = {
                        ...(renamed && { product_name: renamed }),
                        ...(data.category !== undefined && { category: data.category }),
                        ...(data.menu_group_id !== undefined && { menu_group_id: data.menu_group_id }),
                        ...(data.is_for_sale !== undefined && { is_for_sale: data.is_for_sale }),
                    };
                    if (Object.keys(patch).length > 0) {
                        await db_1.db.update(schema_1.productsTable).set(patch).where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, variant.id));
                    }
                }
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
    /**
     * Flip one product between purchasable and not.
     *
     * Deliberately NOT folded into /api/products/update: that route resolves
     * courier_deliverable, the price range and the barcode from the body, so a
     * one-field call through it would need the whole product resent just to hide
     * an item — and any field the owner forgot would be rewritten. This is the
     * toggle in the inventory table, so it stays a single column write.
     *
     * `isAvailable=false` removes the product from every customer-facing read
     * (get-menu, get-all-product, search-products all filter on it); it stays
     * fully visible to the owner, in stock, and on past orders.
     */
    app.patch("/api/products/:id/availability", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        const productId = request.params.id;
        const isAvailable = request.body?.isAvailable;
        if (!productId || typeof isAvailable !== "boolean") {
            return reply.status(400).send({ success: false, message: "productId dan isAvailable wajib diisi" });
        }
        // Scoped to the caller's outlet so an id from another outlet can't be flipped.
        const updated = await db_1.db
            .update(schema_1.productsTable)
            .set({ isAvailable })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.id, productId), (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, access.outlet.id), (0, drizzle_orm_1.isNull)(schema_1.productsTable.deletedAt)))
            .returning({ id: schema_1.productsTable.id, isAvailable: schema_1.productsTable.isAvailable });
        if (updated.length === 0) {
            return reply.status(404).send({ success: false, message: "Produk tidak ditemukan" });
        }
        return reply.send({ success: true, isAvailable: updated[0].isAvailable });
    });
    // ── Variants ───────────────────────────────────────────────────────────
    //
    // A variant is a product (migration 0071), so there is no variant CRUD in the
    // sale path — only here, where one gets authored. These routes exist rather
    // than pointing the owner at /api/products because a variant is defined by
    // what it INHERITS: the same category, picture, menu section and stock model
    // as its base, differing in size and price. Making the owner retype all of it
    // is how you end up with a "Large" filed under the wrong tab.
    //
    // Every route below is scoped to the base product AND the caller's outlet, so
    // a variantId from somewhere else resolves to nothing.
    /** Add a variant to a product. */
    app.post("/api/products/:id/variants", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        const baseId = request.params.id;
        const body = (request.body ?? {});
        const variantName = (body.variant_name ?? "").trim();
        if (!variantName) {
            return reply.send({ success: false, message: "Nama varian wajib diisi." });
        }
        if (!body.price || Number(body.price) < 0) {
            return reply.send({ success: false, message: "Harga varian wajib diisi." });
        }
        const [base] = await db_1.db
            .select()
            .from(schema_1.productsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.id, baseId), (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, access.outlet.id)))
            .limit(1);
        if (!base)
            return reply.send({ success: false, message: "Produk tidak ditemukan." });
        const rejection = (0, variants_1.variantRejection)(base);
        if (rejection)
            return reply.send({ success: false, message: rejection });
        const existing = await (0, variants_1.countVariants)(baseId);
        if (existing >= variants_1.MAX_VARIANTS_PER_PRODUCT) {
            return reply.send({
                success: false,
                message: `Maksimal ${variants_1.MAX_VARIANTS_PER_PRODUCT} varian per produk.`,
            });
        }
        const barcode = normalizeBarcode(body.barcode);
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
            const id = crypto.randomUUID();
            let copiedRecipeRows = 0;
            await db_1.db.transaction(async (tx) => {
                await tx.insert(schema_1.productsTable).values((0, variants_1.buildVariantRow)(base, id, {
                    variant_name: variantName,
                    price: body.price,
                    price_mark_down: body.price_mark_down,
                    buying_price: body.buying_price,
                    barcode,
                    // Appended, not sorted in: the owner adds sizes in the order they
                    // want them read, and re-sorting on price would put a cheap Jumbo
                    // above Reguler the moment they run a promo.
                    variant_sort: existing + 1,
                }));
                // The base's composition comes along. An empty recipe would sell the
                // variant while consuming nothing — no stock movement, no COGS, and a
                // margin that silently improves every time the bigger size sells. See
                // copyRecipe in lib/variants.ts.
                copiedRecipeRows = await (0, variants_1.copyRecipe)(tx, access.outlet.id, baseId, id);
                // The base needs a label of its own the moment it has a sibling,
                // otherwise its option in the picker renders nameless. Only filled in
                // if the owner never set one — this must never overwrite their word.
                if (!base.variant_name || !base.variant_label) {
                    await tx
                        .update(schema_1.productsTable)
                        .set({
                        variant_name: base.variant_name ?? variants_1.DEFAULT_BASE_VARIANT_NAME,
                        variant_label: base.variant_label ?? variants_1.DEFAULT_VARIANT_LABEL,
                    })
                        .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, baseId));
                }
            });
            return reply.send({
                success: true,
                id,
                copied_recipe_rows: copiedRecipeRows,
                message: copiedRecipeRows
                    ? `Varian ditambahkan. Resep disalin dari produk induk (${copiedRecipeRows} bahan) — sesuaikan takarannya.`
                    : "Varian ditambahkan.",
            });
        }
        catch (err) {
            if ((err?.code ?? err?.cause?.code) === "23505") {
                return reply.send({ success: false, message: "Barcode sudah dipakai produk lain di outlet ini." });
            }
            app.log.error(err, "Failed to add variant");
            return reply.status(500).send({ success: false, message: "Gagal menambah varian." });
        }
    });
    /**
     * Rename / reprice one variant.
     *
     * Renaming rewrites product_name too, because the two must not drift: the
     * picker shows variant_name and every receipt shows product_name, and an
     * owner who fixes a typo in one place would otherwise still be printing the
     * old word. A product_name the owner has customised by hand through the
     * ordinary product form is left alone — it only tracks while it still matches
     * what this route would have generated.
     */
    app.patch("/api/products/:id/variants/:variantId", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        const { id: baseId, variantId } = request.params;
        const body = (request.body ?? {});
        const [base] = await db_1.db
            .select({ id: schema_1.productsTable.id, product_name: schema_1.productsTable.product_name })
            .from(schema_1.productsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.id, baseId), (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, access.outlet.id)))
            .limit(1);
        if (!base)
            return reply.send({ success: false, message: "Produk tidak ditemukan." });
        const [variant] = await db_1.db
            .select()
            .from(schema_1.productsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.id, variantId), (0, drizzle_orm_1.eq)(schema_1.productsTable.variant_of, baseId), (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, access.outlet.id)))
            .limit(1);
        if (!variant)
            return reply.send({ success: false, message: "Varian tidak ditemukan." });
        const barcode = normalizeBarcode(body.barcode);
        if (barcode) {
            const conflict = await findBarcodeConflict(access.outlet.id, barcode, variantId);
            if (conflict) {
                return reply.send({
                    success: false,
                    message: `Barcode sudah dipakai produk "${conflict.product_name}" di outlet ini.`,
                });
            }
        }
        const nextName = body.variant_name?.trim();
        // Only follow the rename while the row still carries the name this route
        // would have written; a hand-edited product_name is the owner's, not ours.
        const nameIsDerived = variant.variant_name != null &&
            variant.product_name === (0, variants_1.variantProductName)(base.product_name, variant.variant_name);
        try {
            await db_1.db
                .update(schema_1.productsTable)
                .set({
                ...(nextName && { variant_name: nextName }),
                ...(nextName && nameIsDerived && {
                    product_name: (0, variants_1.variantProductName)(base.product_name, nextName),
                }),
                ...(body.price !== undefined && {
                    price: body.price,
                    // Repricing clears any promo unless a new one is sent with it —
                    // "0" is the no-discount sentinel. See buildVariantRow.
                    price_mark_down: body.price_mark_down ?? "0",
                }),
                ...(body.buying_price !== undefined && { buying_price: body.buying_price }),
                ...(barcode !== undefined && { barcode }),
                ...(body.variant_sort !== undefined && { variant_sort: body.variant_sort }),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, variantId));
        }
        catch (err) {
            if ((err?.code ?? err?.cause?.code) === "23505") {
                return reply.send({ success: false, message: "Barcode sudah dipakai produk lain di outlet ini." });
            }
            app.log.error(err, "Failed to update variant");
            return reply.status(500).send({ success: false, message: "Gagal menyimpan varian." });
        }
        return reply.send({ success: true, message: "Varian disimpan." });
    });
    /**
     * The base's own two words: the question its picker asks ("Ukuran") and the
     * name of its own option in that picker ("Reguler").
     *
     * Separate from /api/products/update for the same reason the availability
     * toggle is: that route resolves the price range, the barcode and
     * courier_deliverable from the body, so a two-field call through it would
     * need the whole product resent — and anything the caller omitted would be
     * rewritten from defaults.
     */
    app.patch("/api/products/:id/variant-meta", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        const baseId = request.params.id;
        const body = (request.body ?? {});
        const label = body.variant_label?.trim();
        const name = body.variant_name?.trim();
        const updated = await db_1.db
            .update(schema_1.productsTable)
            .set({
            ...(body.variant_label !== undefined && {
                variant_label: label || variants_1.DEFAULT_VARIANT_LABEL,
            }),
            ...(body.variant_name !== undefined && {
                variant_name: name || variants_1.DEFAULT_BASE_VARIANT_NAME,
            }),
        })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.id, baseId), (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, access.outlet.id), 
        // A variant has no question of its own to ask.
        (0, drizzle_orm_1.isNull)(schema_1.productsTable.variant_of)))
            .returning({ id: schema_1.productsTable.id });
        if (updated.length === 0) {
            return reply.send({ success: false, message: "Produk tidak ditemukan." });
        }
        return reply.send({ success: true });
    });
    /** Menu order for one product's variants, as the owner's arrows leave it. */
    app.post("/api/products/:id/variants/reorder", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        const baseId = request.params.id;
        const ids = request.body?.ids;
        if (!Array.isArray(ids)) {
            return reply.send({ success: false, message: "ids wajib diisi." });
        }
        // Scoped to this base inside the loop, so an id belonging to another
        // product (or another outlet) updates nothing rather than being reordered
        // into a family it isn't part of.
        await db_1.db.transaction(async (tx) => {
            for (const [index, id] of ids.entries()) {
                await tx
                    .update(schema_1.productsTable)
                    .set({ variant_sort: index + 1 })
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.id, id), (0, drizzle_orm_1.eq)(schema_1.productsTable.variant_of, baseId), (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, access.outlet.id)));
            }
        });
        return reply.send({ success: true });
    });
    // ── Recipe (bill-of-materials) ─────────────────────────────────────────
    // Strictly opt-in: a product without recipe rows simply moves no stock
    // through a recipe. Recipes NEST — an ingredient may have its own recipe —
    // and both a menu item (track_stock=false) and an in-house intermediate
    // (track_stock=true, produced in batches) can carry one. See recipeItemsTable
    // in db/schema.ts for how expansion decides where to stop.
    // Recipe rows + ingredient display info for the product-form editor.
    app.get("/api/products/:id/recipe", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        const productId = request.params.id;
        const [product] = await db_1.db
            .select({
            outlet_id: schema_1.productsTable.outlet_id,
            track_stock: schema_1.productsTable.track_stock,
            yield_qty: schema_1.productsTable.yield_qty,
        })
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
        return reply.send({ success: true, items, yield_qty: product.yield_qty });
    });
    // Replace-on-save: the submitted list becomes the whole recipe (empty list
    // clears it).
    //
    // An ingredient may itself be a composite, so this is where cycles have to be
    // stopped. The check runs INSIDE the transaction, AFTER the rows are written:
    // validating the post-write graph is exact, whereas simulating the
    // delete-then-insert merge in JS would be a second implementation of the same
    // rule waiting to drift. A cycle throws and the whole save rolls back.
    app.put("/api/products/:id/recipe", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        const productId = request.params.id;
        const body = request.body ?? {};
        const items = Array.isArray(body.items) ? body.items : [];
        // Batch size rides along with the composition rather than the product form:
        // it only means anything alongside a composition, and this is the one place
        // that edits them together. Omitted / unparseable leaves it untouched.
        const rawYield = body.yield_qty;
        const parsedYield = rawYield === undefined || rawYield === "" ? null : Number(rawYield);
        if (parsedYield !== null && (!Number.isFinite(parsedYield) || parsedYield <= 0)) {
            return reply.status(400).send({ success: false, message: "Hasil sekali produksi harus lebih dari 0" });
        }
        const [product] = await db_1.db
            .select({ outlet_id: schema_1.productsTable.outlet_id, track_stock: schema_1.productsTable.track_stock })
            .from(schema_1.productsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.id, productId), (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, access.outlet.id)))
            .limit(1);
        if (!product)
            return reply.status(404).send({ success: false, message: "Product not found" });
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
            // No track_stock requirement: an ingredient that does not track stock is
            // a pass-through composite, which is exactly how sub-recipes are built.
            clean.push({ ingredient_id: it.ingredient_id, qty: qty.toFixed(3) });
        }
        try {
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
                if (parsedYield !== null) {
                    await tx
                        .update(schema_1.productsTable)
                        .set({ yield_qty: parsedYield.toFixed(3) })
                        .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, productId));
                }
                const bad = await (0, stock_1.findRecipeCycle)(tx, productId);
                if (bad)
                    throw new stock_1.RecipeGraphError(bad);
            });
        }
        catch (e) {
            if (e instanceof stock_1.RecipeGraphError) {
                return reply.status(409).send({ success: false, message: e.message });
            }
            throw e;
        }
        return reply.send({ success: true });
    });
    // ── Recipe Explorer ─────────────────────────────────────────────────────
    // Everything the /dashboard/addproducts/recipe-explorer screen draws, in one
    // call: this product's recipe as a TREE (not the flattened leaf list
    // production-preview returns — that screen is about the levels themselves),
    // its variant siblings, its add-on options with their own sub-trees, and the
    // two derived figures shown beside them.
    //
    // Costing follows the sale path exactly (lib/stock.ts + lib/cost.ts), so the
    // HPP here is the number a sale would actually book:
    //   tracks stock          -> avg_cost, the batch's real weighted average
    //   has recipe, no stock  -> the sum of its children
    //   neither               -> buying_price
    //
    // A stock-tracking composite therefore costs its OWN average rather than what
    // its recipe would cost today. Its children are still returned, flagged
    // batch_boundary, so the diagram can show the batch's bill of materials — but
    // their costs deliberately do NOT sum to the parent's. That gap is the honest
    // difference between what a batch cost and what it would cost now, and it is
    // the same boundary applySaleStockOut stops at.
    //
    // Quantities multiply straight down the tree with no yield division:
    // recipe_items.qty is already "per ONE unit of product_id" for every kind of
    // product (see the schema comment), so a chain of qtys is the whole story.
    app.get("/api/products/:id/recipe-explorer", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        const outletId = access.outlet.id;
        const productId = request.params.id;
        // The whole outlet's catalogue and recipe edges, in two queries. The walk
        // needs arbitrary depth in several places (the product, every add-on
        // option), and one in-memory graph is cheaper than a recursive CTE per
        // node for a catalogue this size. Soft-deleted rows stay in the map so an
        // archived ingredient still resolves inside a recipe that references it.
        const [catalogue, edges] = await Promise.all([
            db_1.db
                .select({
                id: schema_1.productsTable.id,
                name: schema_1.productsTable.product_name,
                unit: schema_1.productsTable.unit,
                price: schema_1.productsTable.price,
                price_mark_down: schema_1.productsTable.price_mark_down,
                buying_price: schema_1.productsTable.buying_price,
                avg_cost: schema_1.productsTable.avg_cost,
                stock: schema_1.productsTable.stock,
                track_stock: schema_1.productsTable.track_stock,
                yield_qty: schema_1.productsTable.yield_qty,
                ratings: schema_1.productsTable.ratings,
                review_count: schema_1.productsTable.review_count,
                barcode: schema_1.productsTable.barcode,
                image: schema_1.productsTable.image,
                isAvailable: schema_1.productsTable.isAvailable,
                variant_of: schema_1.productsTable.variant_of,
                variant_name: schema_1.productsTable.variant_name,
                variant_label: schema_1.productsTable.variant_label,
                variant_sort: schema_1.productsTable.variant_sort,
                deletedAt: schema_1.productsTable.deletedAt,
            })
                .from(schema_1.productsTable)
                .where((0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, outletId)),
            db_1.db
                .select({
                product_id: schema_1.recipeItemsTable.product_id,
                ingredient_id: schema_1.recipeItemsTable.ingredient_id,
                qty: schema_1.recipeItemsTable.qty,
            })
                .from(schema_1.recipeItemsTable)
                .where((0, drizzle_orm_1.eq)(schema_1.recipeItemsTable.outlet_id, outletId)),
        ]);
        const byId = new Map(catalogue.map((p) => [p.id, p]));
        const product = byId.get(productId);
        if (!product || product.deletedAt) {
            return reply.status(404).send({ success: false, message: "Product not found" });
        }
        const kidsOf = new Map();
        for (const e of edges) {
            const list = kidsOf.get(e.product_id);
            const row = { ingredient_id: e.ingredient_id, qty: Number(e.qty) || 0 };
            if (list)
                list.push(row);
            else
                kidsOf.set(e.product_id, [row]);
        }
        const num = (v) => Number(v) || 0;
        // What one unit of a product currently carries.
        //
        // Cycles are refused at write time (findRecipeCycle), so reaching one here
        // means the rows predate that check or were seeded around it. The walk
        // stops rather than spinning, and the product falls back to its
        // buying_price: expanding a recipe that eats itself yields a number that is
        // not just wrong but arbitrarily wrong, and Rp 0 reads as "free" rather
        // than "unknown". Which products those were is reported so the page can say
        // the recipe needs fixing instead of quietly under-costing the dish.
        const costCache = new Map();
        const cyclic = new Set();
        const unitCostOf = (id, path = []) => {
            const hit = costCache.get(id);
            if (hit !== undefined)
                return hit;
            const p = byId.get(id);
            if (!p)
                return 0;
            if (path.includes(id)) {
                cyclic.add(id);
                return num(p.buying_price);
            }
            const kids = kidsOf.get(id) ?? [];
            let v = p.track_stock
                ? num(p.avg_cost) || num(p.buying_price)
                : kids.length
                    ? kids.reduce((s, k) => s + k.qty * unitCostOf(k.ingredient_id, [...path, id]), 0)
                    : num(p.buying_price);
            // Its own expansion came back through it — the sum above is meaningless.
            if (cyclic.has(id))
                v = num(p.avg_cost) || num(p.buying_price);
            costCache.set(id, v);
            return v;
        };
        // Days of stock cover, from the ledger rather than a stored rate: nothing
        // in this schema records a usage rate, but every outflow is a row here.
        // Averaged over 30 days across ALL products that consumed the ingredient,
        // not just this one — that is what "how long will it last" means.
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const usageRows = await db_1.db
            .select({
            product_id: schema_1.stockMovementsTable.product_id,
            out_qty: (0, drizzle_orm_1.sql) `coalesce(sum(-${schema_1.stockMovementsTable.qty_change}), 0)`.mapWith(Number),
        })
            .from(schema_1.stockMovementsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.stockMovementsTable.outlet_id, outletId), (0, drizzle_orm_1.inArray)(schema_1.stockMovementsTable.reason, ["sales", "production"]), (0, drizzle_orm_1.sql) `${schema_1.stockMovementsTable.qty_change} < 0`, (0, drizzle_orm_1.gt)(schema_1.stockMovementsTable.created_at, since)))
            .groupBy(schema_1.stockMovementsTable.product_id);
        const dailyUsage = new Map();
        for (const r of usageRows)
            if (r.out_qty > 0)
                dailyUsage.set(r.product_id, r.out_qty / 30);
        // null, not Infinity: an ingredient nothing has consumed in 30 days has no
        // honest answer here, and the UI says so rather than printing a number.
        const daysLeftOf = (id) => {
            const rate = dailyUsage.get(id);
            const p = byId.get(id);
            if (!rate || !p)
                return null;
            return Number((num(p.stock) / rate).toFixed(1));
        };
        const MAX_DEPTH = 5;
        // `mult` is how many units of THIS node one unit of the root consumes, so
        // `cost` is always the node's contribution to one unit of the root.
        const buildNode = (id, qty, mult, key, depth, path) => {
            const p = byId.get(id);
            if (!p)
                return null;
            const kids = kidsOf.get(id) ?? [];
            const unitCost = unitCostOf(id);
            const childMult = mult * qty;
            const stop = depth >= MAX_DEPTH || path.includes(id);
            return {
                key,
                product_id: id,
                name: p.name,
                unit: p.unit,
                qty,
                unit_cost: unitCost,
                cost: mult * qty * unitCost,
                stock: num(p.stock),
                track_stock: p.track_stock,
                composite: kids.length > 0,
                batch_boundary: p.track_stock && kids.length > 0,
                yield_qty: num(p.yield_qty),
                cyclic: cyclic.has(id),
                days_left: daysLeftOf(id),
                children: stop
                    ? []
                    : kids
                        .map((k) => buildNode(k.ingredient_id, k.qty, childMult, `${key}/${k.ingredient_id}`, depth + 1, [...path, id]))
                        .filter(Boolean),
            };
        };
        const treeOf = (rootId, keyPrefix) => (kidsOf.get(rootId) ?? [])
            .map((k) => buildNode(k.ingredient_id, k.qty, 1, `${keyPrefix}/${k.ingredient_id}`, 1, [rootId]))
            .filter(Boolean);
        const tree = treeOf(productId, "r");
        // Add-ons are real products too, so each option gets its own sub-tree and
        // its own HPP — the chip can say what saying yes actually costs.
        const groups = (await (0, addons_1.addonGroupsForProducts)(outletId, [productId])).get(productId) ?? [];
        const addons = groups.flatMap((grp) => grp.options.flatMap((opt) => {
            // One of the option, as a branch of its own hanging off the dish.
            const node = buildNode(opt.product_id, 1, 1, `a${opt.id}`, 1, [productId]);
            return node
                ? [{
                        option_id: opt.id,
                        group_id: grp.id,
                        group_name: grp.name,
                        label: opt.name,
                        price: opt.price,
                        available: opt.available,
                        hpp: node.cost,
                        node,
                    }]
                : [];
        }));
        // One axis, because that is all the schema has: a base row plus the rows
        // pointing at it via variant_of, asking the single question in
        // variant_label. The base is always the first option — it stays sellable.
        const baseId = product.variant_of ?? product.id;
        const base = byId.get(baseId);
        const siblings = catalogue
            .filter((p) => !p.deletedAt && (p.id === baseId || p.variant_of === baseId))
            .sort((a, b) => a.variant_sort - b.variant_sort || a.name.localeCompare(b.name));
        const variants = siblings.length > 1
            ? {
                label: base?.variant_label ?? variants_1.DEFAULT_VARIANT_LABEL,
                options: siblings.map((p) => ({
                    id: p.id,
                    name: p.variant_name ?? (p.id === baseId ? variants_1.DEFAULT_BASE_VARIANT_NAME : p.name),
                    price: num(p.price_mark_down) || num(p.price),
                    current: p.id === productId,
                })),
            }
            : null;
        // Units sold in 30 days. Child (add-on) lines are excluded — this counts
        // how often the DISH went out, and an add-on line is not a sale of its own.
        const [sold] = await db_1.db
            .select({
            qty: (0, drizzle_orm_1.sql) `coalesce(sum(${schema_1.orderDetailsTable.quantity}), 0)`.mapWith(Number),
            orders: (0, drizzle_orm_1.sql) `count(distinct ${schema_1.orderDetailsTable.order_id})`.mapWith(Number),
        })
            .from(schema_1.orderDetailsTable)
            .innerJoin(schema_1.ordersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.id, schema_1.orderDetailsTable.order_id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, productId), (0, drizzle_orm_1.isNull)(schema_1.orderDetailsTable.parent_detail_id), (0, drizzle_orm_1.isNull)(schema_1.ordersTable.deletedAt), (0, drizzle_orm_1.sql) `${schema_1.ordersTable.status} <> 'cancelled'`, (0, drizzle_orm_1.gt)(schema_1.orderDetailsTable.created_at, since)));
        const sellPrice = num(product.price_mark_down) || num(product.price);
        return reply.send({
            success: true,
            product: {
                id: product.id,
                name: product.name,
                unit: product.unit,
                image: product.image,
                price: sellPrice,
                list_price: num(product.price),
                discounted: num(product.price_mark_down) > 0,
                barcode: product.barcode,
                ratings: product.ratings === null ? null : Number(product.ratings),
                review_count: product.review_count,
                track_stock: product.track_stock,
                stock: num(product.stock),
                yield_qty: num(product.yield_qty),
                avg_cost: num(product.avg_cost),
                is_variant: !!product.variant_of,
            },
            // What the recipe costs to make TODAY, and what one unit currently
            // carries. They differ for a stock-tracking product whose batch was made
            // at older prices — see the batch_boundary note above. A product with no
            // recipe at all has no recipe_cost, only a unit_cost.
            recipe_cost: tree.reduce((s, n) => s + n.cost, 0),
            unit_cost: unitCostOf(productId),
            tree,
            addons,
            variants,
            sold_30d: sold?.qty ?? 0,
            orders_30d: sold?.orders ?? 0,
            low_stock_days: 12,
            // Named so the page can tell the owner which recipe to go and fix.
            cyclic: [...cyclic].map((id) => byId.get(id)?.name ?? id),
        });
    });
    // ── Production batch ────────────────────────────────────────────────────
    // Make an in-house intermediate: its ingredients go out, the batch comes in.
    // qty is in the product's OWN stock unit (2.5 kg of sambal), not in batches —
    // products.yield_qty is only the form's default for that number.
    // What a batch WOULD cost, before committing to it. Read-only.
    //
    // Runs inside a transaction purely so it borrows the same Tx type the write
    // path uses; nothing is written and it is rolled back on the way out.
    app.get("/api/products/:id/production-preview", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "stock");
        if (!access)
            return;
        const productId = request.params.id;
        const query = request.query;
        const qty = Number(query.qty);
        if (!Number.isFinite(qty) || qty <= 0) {
            return reply.status(400).send({ success: false, message: "Jumlah produksi harus lebih dari 0" });
        }
        // "raw" walks past produced intermediates down to the materials nothing is
        // made from — a planning view, not what a sale deducts. See expandRecipe.
        const mode = query.mode === "raw" ? "raw" : "ledger";
        const [product] = await db_1.db
            .select({
            name: schema_1.productsTable.product_name,
            unit: schema_1.productsTable.unit,
            track_stock: schema_1.productsTable.track_stock,
            outlet_id: schema_1.productsTable.outlet_id,
        })
            .from(schema_1.productsTable)
            .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, productId))
            .limit(1);
        if (!product || product.outlet_id !== access.outlet.id) {
            return reply.status(404).send({ success: false, message: "Product not found" });
        }
        try {
            const preview = await db_1.db.transaction(async (tx) => {
                const out = await (0, stock_1.previewProduction)(tx, { outletId: access.outlet.id, productId, qty, mode });
                return out;
            });
            return reply.send({
                success: true,
                mode,
                product: { name: product.name, unit: product.unit, track_stock: product.track_stock },
                qty,
                items: preview.items,
                total_cost: preview.totalCost,
                // The number the owner is actually deciding on: what one unit of this
                // batch will be worth. applyProduction divides by the qty actually made,
                // not by yield_qty, so the preview must too.
                unit_cost: qty > 0 ? Number((preview.totalCost / qty).toFixed(4)) : 0,
            });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.startsWith("RECIPE_CYCLE") || msg.startsWith("RECIPE_TOO_DEEP")) {
                return reply.status(409).send({ success: false, message: "Resep produk ini berputar — perbaiki dulu." });
            }
            throw e;
        }
    });
    app.post("/api/products/:id/production", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "stock");
        if (!access)
            return;
        const productId = request.params.id;
        const body = request.body ?? {};
        const qty = Number(body.qty);
        if (!Number.isFinite(qty) || qty <= 0) {
            return reply.status(400).send({ success: false, message: "Jumlah produksi harus lebih dari 0" });
        }
        try {
            const warnings = await db_1.db.transaction((tx) => (0, stock_1.applyProduction)(tx, {
                outletId: access.outlet.id,
                productId,
                qty,
                note: (body.note?.trim() || "").slice(0, 120),
            }));
            return reply.send({ success: true, warnings });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // Everything applyProduction throws is a client mistake, not a fault.
            if (msg === "PRODUCT_NOT_FOUND") {
                return reply.status(404).send({ success: false, message: "Product not found" });
            }
            if (msg === "NOT_STOCKED") {
                return reply.status(409).send({
                    success: false,
                    message: "Aktifkan 'lacak stok' dulu — hasil produksi butuh tempat disimpan.",
                });
            }
            if (msg === "NO_RECIPE") {
                return reply.status(409).send({
                    success: false,
                    message: "Produk ini belum punya resep, jadi tidak ada yang bisa diproduksi.",
                });
            }
            if (msg.startsWith("RECIPE_CYCLE") || msg.startsWith("RECIPE_TOO_DEEP")) {
                return reply.status(409).send({ success: false, message: "Resep produk ini berputar — perbaiki dulu." });
            }
            throw e;
        }
    });
    // Past batches: the POSITIVE 'production' movements, which are the batch
    // itself coming in. The negative rows of the same run are its ingredients
    // going out — same reason, opposite sign — and listing both would show every
    // batch three or four times over.
    //
    // unit_cost on that row is what the batch was actually worth per unit at the
    // moment it was made, which is the number this page exists to show: it is the
    // only place an owner can see that sambal got more expensive without anyone
    // changing a price.
    app.get("/api/production/history", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "stock");
        if (!access)
            return;
        const cap = Math.min(Number(request.query.limit) || 50, 200);
        const rows = await db_1.db
            .select({
            id: schema_1.stockMovementsTable.id,
            product_id: schema_1.stockMovementsTable.product_id,
            product_name: schema_1.productsTable.product_name,
            unit: schema_1.productsTable.unit,
            qty: schema_1.stockMovementsTable.qty_change,
            unit_cost: schema_1.stockMovementsTable.unit_cost,
            total_cost: schema_1.stockMovementsTable.cost_change,
            note: schema_1.stockMovementsTable.note,
            created_at: schema_1.stockMovementsTable.created_at,
        })
            .from(schema_1.stockMovementsTable)
            .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.productsTable.id, schema_1.stockMovementsTable.product_id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.stockMovementsTable.outlet_id, access.outlet.id), (0, drizzle_orm_1.eq)(schema_1.stockMovementsTable.reason, "production"), (0, drizzle_orm_1.gt)(schema_1.stockMovementsTable.qty_change, "0")))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.stockMovementsTable.created_at), (0, drizzle_orm_1.desc)(schema_1.stockMovementsTable.id))
            .limit(cap);
        return reply.send({ success: true, batches: rows });
    });
    // Write back ONLY the selling price. Deliberately not /api/products/update:
    // that route resolves courier_deliverable and the range-price fields from the
    // body it is given, so a deliberately sparse "just the price" call there would
    // reinterpret fields the caller never meant to touch. A one-column update
    // cannot.
    //
    // Range-priced products (a service quoted between two numbers) are refused
    // rather than silently flattened to a single price — the calculator has no
    // opinion about which end of the range it just computed.
    app.patch("/api/products/:id/price", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        const productId = request.params.id;
        const price = Number(request.body?.price);
        if (!Number.isFinite(price) || price < 0) {
            return reply.status(400).send({ success: false, message: "Harga tidak valid" });
        }
        const [existing] = await db_1.db
            .select({
            outlet_id: schema_1.productsTable.outlet_id,
            lowest_price: schema_1.productsTable.lowest_price,
            highest_price: schema_1.productsTable.highest_price,
        })
            .from(schema_1.productsTable)
            .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, productId))
            .limit(1);
        if (!existing || existing.outlet_id !== access.outlet.id) {
            return reply.status(404).send({ success: false, message: "Product not found" });
        }
        if (existing.lowest_price || existing.highest_price) {
            return reply.status(409).send({
                success: false,
                message: "Produk ini pakai harga rentang — atur harganya lewat form produk.",
            });
        }
        await db_1.db
            .update(schema_1.productsTable)
            .set({ price: String(Math.round(price)) })
            .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, productId));
        return reply.send({ success: true, price: String(Math.round(price)) });
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
    // ══ Add-on catalogue ══════════════════════════════════════════════════════
    //
    // Groups are per OUTLET and attached to products, so "Topping" is authored
    // once and reused. The option list of a group is replaced wholesale (same
    // idiom as the recipe editor above) — the client owns the whole set.
    //
    // NOTHING HERE HARD-DELETES A ROW THAT HAS BEEN OFFERED. A cashier's held tab
    // lives in localStorage for days and may still reference an option the owner
    // just removed; archiving instead of deleting is what lets that sale settle.
    // See lib/addons.ts.
    app.get("/api/addon-groups", async (request, reply) => {
        const session = await requireUser(request, reply);
        if (!session)
            return;
        const access = await (0, outlet_access_1.getOutletAccess)(session.user.id, (0, outlet_access_1.parseActiveOutletId)(request));
        if (!access)
            return reply.send({ groups: [] });
        const rows = await db_1.db
            .select({
            id: schema_1.addonGroupsTable.id,
            name: schema_1.addonGroupsTable.name,
            min_select: schema_1.addonGroupsTable.min_select,
            max_select: schema_1.addonGroupsTable.max_select,
            sort_order: schema_1.addonGroupsTable.sort_order,
            option_id: schema_1.addonGroupOptionsTable.id,
            option_product_id: schema_1.addonGroupOptionsTable.product_id,
            option_price: schema_1.addonGroupOptionsTable.price,
            option_sort: schema_1.addonGroupOptionsTable.sort_order,
            option_name: schema_1.productsTable.product_name,
        })
            .from(schema_1.addonGroupsTable)
            .leftJoin(schema_1.addonGroupOptionsTable, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.addonGroupOptionsTable.group_id, schema_1.addonGroupsTable.id), (0, drizzle_orm_1.isNull)(schema_1.addonGroupOptionsTable.deletedAt)))
            .leftJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.productsTable.id, schema_1.addonGroupOptionsTable.product_id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.addonGroupsTable.outlet_id, access.outlet.id), (0, drizzle_orm_1.isNull)(schema_1.addonGroupsTable.deletedAt)))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.addonGroupsTable.sort_order), (0, drizzle_orm_1.asc)(schema_1.addonGroupOptionsTable.sort_order));
        const groups = [];
        for (const r of rows) {
            let g = groups.find((x) => x.id === r.id);
            if (!g) {
                g = {
                    id: r.id,
                    name: r.name,
                    min_select: r.min_select,
                    max_select: r.max_select,
                    sort_order: r.sort_order,
                    options: [],
                };
                groups.push(g);
            }
            // leftJoin: a group with no options yields a single all-null row.
            if (r.option_id !== null && r.option_product_id !== null) {
                g.options.push({
                    id: r.option_id,
                    product_id: r.option_product_id,
                    name: r.option_name ?? "",
                    price: Number(r.option_price) || 0,
                });
            }
        }
        return reply.send({ groups });
    });
    app.post("/api/addon-groups", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        const body = request.body ?? {};
        const name = (body.name ?? "").trim();
        if (!name)
            return reply.status(400).send({ success: false, message: "Nama grup wajib diisi" });
        const rules = normaliseAddonRules(body.min_select, body.max_select);
        if ("error" in rules)
            return reply.status(400).send({ success: false, message: rules.error });
        const [row] = await db_1.db
            .insert(schema_1.addonGroupsTable)
            .values({ outlet_id: access.outlet.id, name, ...rules.value })
            .returning({ id: schema_1.addonGroupsTable.id });
        return reply.send({ success: true, id: row.id });
    });
    app.patch("/api/addon-groups/:id", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        const id = Number(request.params.id);
        if (!id)
            return reply.status(400).send({ success: false, message: "id wajib diisi" });
        const body = request.body ?? {};
        const patch = { updatedAt: new Date() };
        if (typeof body.name === "string") {
            const name = body.name.trim();
            if (!name)
                return reply.status(400).send({ success: false, message: "Nama grup wajib diisi" });
            patch.name = name;
        }
        if (body.min_select !== undefined || body.max_select !== undefined) {
            const rules = normaliseAddonRules(body.min_select, body.max_select);
            if ("error" in rules)
                return reply.status(400).send({ success: false, message: rules.error });
            Object.assign(patch, rules.value);
        }
        if (Number.isFinite(Number(body.sort_order)))
            patch.sort_order = Number(body.sort_order);
        const updated = await db_1.db
            .update(schema_1.addonGroupsTable)
            .set(patch)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.addonGroupsTable.id, id), (0, drizzle_orm_1.eq)(schema_1.addonGroupsTable.outlet_id, access.outlet.id)))
            .returning({ id: schema_1.addonGroupsTable.id });
        if (updated.length === 0)
            return reply.status(404).send({ success: false, message: "Grup tidak ditemukan" });
        return reply.send({ success: true });
    });
    // Archive, never delete. The group may be sitting in a parked cart.
    app.delete("/api/addon-groups/:id", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        const id = Number(request.params.id);
        if (!id)
            return reply.status(400).send({ success: false, message: "id wajib diisi" });
        const now = new Date();
        const updated = await db_1.db
            .update(schema_1.addonGroupsTable)
            .set({ deletedAt: now })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.addonGroupsTable.id, id), (0, drizzle_orm_1.eq)(schema_1.addonGroupsTable.outlet_id, access.outlet.id)))
            .returning({ id: schema_1.addonGroupsTable.id });
        if (updated.length === 0)
            return reply.status(404).send({ success: false, message: "Grup tidak ditemukan" });
        // Detach it from every product too, so it stops being offered — the rows
        // themselves are archived rather than removed, for the same reason.
        await db_1.db
            .update(schema_1.productAddonGroupsTable)
            .set({ deleted_at: now })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productAddonGroupsTable.group_id, id), (0, drizzle_orm_1.isNull)(schema_1.productAddonGroupsTable.deleted_at)));
        return reply.send({ success: true });
    });
    // Replace a group's options wholesale.
    app.put("/api/addon-groups/:id/options", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        const id = Number(request.params.id);
        const body = request.body ?? {};
        const items = Array.isArray(body.options) ? body.options : [];
        const [group] = await db_1.db
            .select({ id: schema_1.addonGroupsTable.id })
            .from(schema_1.addonGroupsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.addonGroupsTable.id, id), (0, drizzle_orm_1.eq)(schema_1.addonGroupsTable.outlet_id, access.outlet.id)))
            .limit(1);
        if (!group)
            return reply.status(404).send({ success: false, message: "Grup tidak ditemukan" });
        // Validate against the caller's own products before touching anything.
        const clean = [];
        const seen = new Set();
        for (const [i, it] of items.entries()) {
            if (!it.product_id) {
                return reply.status(400).send({ success: false, message: "Setiap opsi butuh produk" });
            }
            if (seen.has(it.product_id)) {
                return reply.status(400).send({ success: false, message: "Produk yang sama dipilih dua kali" });
            }
            seen.add(it.product_id);
            const price = Number(it.price ?? 0);
            // 0 is legitimate — a free add-on that still consumes stock and still
            // costs money is exactly what this models. Negative is not: a discount
            // belongs on the order, where reports can see it.
            if (!Number.isFinite(price) || price < 0) {
                return reply.status(400).send({ success: false, message: "Harga opsi tidak boleh negatif" });
            }
            const [p] = await db_1.db
                .select({ outlet_id: schema_1.productsTable.outlet_id })
                .from(schema_1.productsTable)
                .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, it.product_id))
                .limit(1);
            if (!p || p.outlet_id !== access.outlet.id) {
                return reply.status(400).send({ success: false, message: "Produk tidak ditemukan di outlet ini" });
            }
            clean.push({ product_id: it.product_id, price: price.toFixed(2), sort_order: i });
        }
        await db_1.db.transaction(async (tx) => {
            // Archive the current set, then insert the new one. The unique index is
            // partial on deleted_at IS NULL, so re-adding an option that was archived
            // a moment ago is allowed — which a plain unique index would have blocked
            // forever the first time someone removed and re-added a topping.
            await tx
                .update(schema_1.addonGroupOptionsTable)
                .set({ deletedAt: new Date() })
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.addonGroupOptionsTable.group_id, id), (0, drizzle_orm_1.isNull)(schema_1.addonGroupOptionsTable.deletedAt)));
            if (clean.length) {
                await tx.insert(schema_1.addonGroupOptionsTable).values(clean.map((c) => ({
                    group_id: id,
                    product_id: c.product_id,
                    price: c.price,
                    sort_order: c.sort_order,
                })));
            }
        });
        return reply.send({ success: true });
    });
    // Which groups a product offers. Replaced wholesale, same as the recipe.
    app.put("/api/products/:id/addon-groups", async (request, reply) => {
        const access = await (0, outlet_access_1.requireOutletAccess)(request, reply, "products");
        if (!access)
            return;
        const productId = request.params.id;
        const body = request.body ?? {};
        const groupIds = Array.isArray(body.group_ids)
            ? [...new Set(body.group_ids.map(Number).filter((n) => Number.isFinite(n)))]
            : [];
        const [product] = await db_1.db
            .select({ id: schema_1.productsTable.id })
            .from(schema_1.productsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.id, productId), (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, access.outlet.id)))
            .limit(1);
        if (!product)
            return reply.status(404).send({ success: false, message: "Product not found" });
        if (groupIds.length) {
            const owned = await db_1.db
                .select({ id: schema_1.addonGroupsTable.id })
                .from(schema_1.addonGroupsTable)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.addonGroupsTable.outlet_id, access.outlet.id), (0, drizzle_orm_1.isNull)(schema_1.addonGroupsTable.deletedAt), (0, drizzle_orm_1.inArray)(schema_1.addonGroupsTable.id, groupIds)));
            if (owned.length !== groupIds.length) {
                return reply.status(400).send({ success: false, message: "Grup tidak ditemukan di outlet ini" });
            }
        }
        await db_1.db.transaction(async (tx) => {
            await tx
                .update(schema_1.productAddonGroupsTable)
                .set({ deleted_at: new Date() })
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productAddonGroupsTable.product_id, productId), (0, drizzle_orm_1.isNull)(schema_1.productAddonGroupsTable.deleted_at)));
            if (groupIds.length) {
                await tx.insert(schema_1.productAddonGroupsTable).values(groupIds.map((gid, i) => ({ product_id: productId, group_id: gid, sort_order: i })));
            }
        });
        return reply.send({ success: true });
    });
}
/**
 * min_select / max_select, checked together because neither means anything
 * alone. min_select >= 1 IS "wajib pilih"; max_select null is unlimited.
 */
function normaliseAddonRules(rawMin, rawMax) {
    const min = rawMin === undefined || rawMin === null || rawMin === "" ? 0 : Number(rawMin);
    const max = rawMax === undefined || rawMax === null || rawMax === "" ? null : Number(rawMax);
    if (!Number.isFinite(min) || min < 0)
        return { error: "Minimal pilihan tidak boleh negatif" };
    if (max !== null && (!Number.isFinite(max) || max < 1)) {
        return { error: "Maksimal pilihan minimal 1" };
    }
    if (max !== null && max < min) {
        return { error: "Maksimal pilihan tidak boleh kurang dari minimal" };
    }
    return { value: { min_select: Math.floor(min), max_select: max === null ? null : Math.floor(max) } };
}
