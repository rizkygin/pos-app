import type { FastifyInstance } from "fastify";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { db } from "../db";
import {
  productsTable,
  outletsTable,
  recipeItemsTable,
  orderDetailsTable,
  invoiceItemsTable,
  stockMovementsTable,
  ratingsTable,
  productAdsTable,
  menuGroupsTable,
} from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { getOutletAccess, requireOutletAccess, parseActiveOutletId } from "../lib/outlet-access";
import { recalcOutletFeatures } from "../lib/outlet-features";
import { RecipeGraphError, applyProduction, findRecipeCycle, previewProduction } from "../lib/stock";

const UPLOADS_ROOT = path.join(process.cwd(), "uploads");
const PRODUCTS_DIR = path.join(UPLOADS_ROOT, "products");
const PRODUCTS_URL_PREFIX = "/uploads/products/";

type AddProductInput = {
  product_name: string;
  price: string;
  price_mark_down: string;
  buying_price: string;
  outlet_id: number;
  category: string;
  // Owner's menu section for the public /menu page; null clears it.
  menu_group_id?: number | null;
  description?: string;
  unit?: string;
  image?: string;
  features?: string[];
  is_for_sale?: boolean;
  track_stock?: boolean;
  // false = too bulky for a courier; decides the order's fulfillment at
  // checkout, not the customer. See products.courier_deliverable in schema.ts.
  courier_deliverable?: boolean;
  // Service products: a negotiable price range. When lowest_price is set the
  // product is treated as a service (price mirrors lowest_price, no stock).
  lowest_price?: string;
  highest_price?: string;
  // Optional, mainly for retail/mart items. Unique per outlet — see
  // products_outlet_barcode_uq in schema.ts.
  barcode?: string;
};

// Empty string -> null so the unique-per-outlet index (which allows unlimited
// NULLs) doesn't treat "no barcode yet" as a collision between two products.
function normalizeBarcode(barcode: string | undefined): string | null | undefined {
  if (barcode === undefined) return undefined;
  const trimmed = barcode.trim();
  return trimmed === "" ? null : trimmed;
}

async function findBarcodeConflict(outletId: number, barcode: string, excludeProductId?: string) {
  const [conflict] = await db
    .select({ id: productsTable.id, product_name: productsTable.product_name })
    .from(productsTable)
    .where(and(eq(productsTable.outlet_id, outletId), eq(productsTable.barcode, barcode)))
    .limit(1);
  if (!conflict || conflict.id === excludeProductId) return null;
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
function rangePricedFields(data: Partial<AddProductInput>, courierDeliverable: boolean) {
  const hasRange = data.lowest_price != null && data.lowest_price !== "";
  if (!hasRange) return null;

  const isMaterials = courierDeliverable === false;
  return {
    lowest_price: data.lowest_price!,
    highest_price: data.highest_price ?? data.lowest_price!,
    // Mirrored so existing "mulai dari" customer displays keep working.
    price: data.lowest_price!,
    price_mark_down: data.lowest_price!,
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

function resolveCourierDeliverable(
  category: string | undefined,
  value: boolean | undefined,
): boolean {
  if (!category || !COURIER_QUESTION_CATEGORIES.has(category)) return true;
  return value ?? true;
}

async function requireUser(request: any, reply: any) {
  const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
  if (!session?.user) {
    reply.status(401).send({ success: false, message: "Unauthorized" });
    return null;
  }
  return session;
}

export async function productRoutes(app: FastifyInstance) {
  // The caller's outlet + its products, in one call. Backs the cashier and
  // product-manager pages (both need outlet info + the outlet's product list).
  app.get("/api/products/mine", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    // Owner or ANY active employee: this is the read-only outlet+product list
    // that every permitted page needs (cashier, faktur, stok). Mutations below
    // require the 'products' permission explicitly.
    const access = await getOutletAccess(session.user.id, parseActiveOutletId(request));
    if (!access) return reply.send({ outlet: null, products: [] });
    const outlet = access.outlet;

    const rows = await db
      .select()
      .from(productsTable)
      .leftJoin(menuGroupsTable, eq(productsTable.menu_group_id, menuGroupsTable.id))
      .where(
        and(
          eq(productsTable.outlet_id, outlet.id),
          isNull(productsTable.deletedAt),
        ),
      );

    // Which products have a composition at all. One flat query over the
    // outlet's recipe rows rather than an EXISTS per product: the Stok page
    // needs this only to decide whether to offer the "Produksi" button, and
    // recipe_items is small enough per outlet that the set is cheaper than the
    // correlated subquery would be.
    const withRecipe = new Set(
      (
        await db
          .selectDistinct({ product_id: recipeItemsTable.product_id })
          .from(recipeItemsTable)
          .where(eq(recipeItemsTable.outlet_id, outlet.id))
      ).map((r) => r.product_id),
    );

    // Flattened back to bare product rows: faktur and stok also read this
    // endpoint and index straight into product fields, so the join must not
    // change the shape. The section name rides along as two extra keys, which
    // the cashier uses for its tabs the same way the customer menu does.
    const products = rows.map((r) => ({
      ...r.products,
      menu_group: r.menu_groups?.name ?? null,
      menu_group_order: r.menu_groups?.sort_order ?? null,
      has_recipe: withRecipe.has(r.products.id),
    }));

    return reply.send({ outlet, products });
  });

  app.post("/api/products", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "products");
    if (!access) return;
    try {
      const data = request.body as AddProductInput;
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
        await db.insert(productsTable).values({
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
      } catch (err: any) {
        // Race-safe fallback: two concurrent saves could both pass the
        // pre-check above before either commits.
        if ((err?.code ?? err?.cause?.code) === "23505") {
          return reply.send({ success: false, message: "Barcode sudah dipakai produk lain di outlet ini." });
        }
        throw err;
      }

      // outlets.features is derived, never owner-edited: a new product may put
      // the outlet into a category it wasn't browsable under before.
      await recalcOutletFeatures(access.outlet.id);

      return reply.send({ success: true, message: "Product added successfully." });
    } catch (error) {
      app.log.error(error, "Failed to add product");
      return reply.status(500).send({ success: false, message: "Failed to add product." });
    }
  });

  app.post("/api/products/upload-image", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "products");
    if (!access) return;
    try {
      const file = await request.file();
      if (!file) return reply.send({ success: false, message: "No image file provided." });

      const buffer = await file.toBuffer();
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const filename = `product-${uniqueSuffix}.webp`;
      await fs.mkdir(PRODUCTS_DIR, { recursive: true });

      await sharp(buffer)
        .resize(400, 600, { fit: "cover", position: "center" })
        .webp({ quality: 80 })
        .toFile(path.join(PRODUCTS_DIR, filename));

      return reply.send({ success: true, imageUrl: `${PRODUCTS_URL_PREFIX}${filename}` });
    } catch (error) {
      app.log.error(error, "Failed to upload product image");
      return reply.status(500).send({ success: false, message: "Failed to process and upload image." });
    }
  });

  app.post("/api/products/remove-image", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "products");
    if (!access) return;
    try {
      const { imageUrl } = (request.body as { imageUrl?: string }) ?? {};
      if (!imageUrl || !imageUrl.startsWith(PRODUCTS_URL_PREFIX)) {
        return reply.send({ success: false, message: "Invalid image URL." });
      }
      const filename = imageUrl.slice(PRODUCTS_URL_PREFIX.length);
      const filePath = path.join(PRODUCTS_DIR, filename);
      if (!filePath.startsWith(PRODUCTS_DIR + path.sep)) {
        return reply.send({ success: false, message: "Invalid image URL." });
      }
      await fs.unlink(filePath);
      return reply.send({ success: true, message: "Image removed successfully." });
    } catch (error) {
      app.log.error(error, "Failed to remove product image");
      return reply.status(500).send({ success: false, message: "Failed to remove image." });
    }
  });

  // Returns { success } for backend-served (/uploads/) images; legacy paths
  // live in the frontend public dir, so we assume them accessible.
  app.get("/api/products/check-image", async (request, reply) => {
    const imageUrl = (request.query as { url?: string }).url ?? "";
    if (imageUrl === "") return reply.send({ ok: true });

    if (!imageUrl.startsWith(PRODUCTS_URL_PREFIX)) {
      return reply.send({ success: true, message: "assumed accessible", path: imageUrl });
    }

    try {
      const filename = imageUrl.slice(PRODUCTS_URL_PREFIX.length);
      await fs.access(path.join(PRODUCTS_DIR, filename));
      return reply.send({ success: true, message: "Image is accessable", path: imageUrl });
    } catch (error: any) {
      return reply.send({ success: false, message: error.message });
    }
  });

  app.post("/api/products/remove-image-db", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "products");
    if (!access) return;
    try {
      const { imageUrl } = (request.body as { imageUrl?: string }) ?? {};
      await db
        .update(productsTable)
        .set({ image: "avatar.png" })
        .where(eq(productsTable.image, imageUrl ?? ""));
      return reply.send({ success: true, message: "Image removed successfully." });
    } catch (error) {
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
    const access = await requireOutletAccess(request, reply, "products");
    if (!access) return;
    try {
      const { productId } = (request.body as { productId?: string }) ?? {};
      if (!productId) return reply.send({ success: false, message: "productId is required" });

      const [product] = await db
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, productId))
        .limit(1);
      if (!product || product.outlet_id !== access.outlet.id)
        return reply.send({ success: false, message: "Product not found" });

      const referenced = (
        await Promise.all([
          db.select({ id: orderDetailsTable.id }).from(orderDetailsTable).where(eq(orderDetailsTable.product_id, productId)).limit(1),
          db.select({ id: invoiceItemsTable.id }).from(invoiceItemsTable).where(eq(invoiceItemsTable.product_id, productId)).limit(1),
          db.select({ id: stockMovementsTable.id }).from(stockMovementsTable).where(eq(stockMovementsTable.product_id, productId)).limit(1),
          db.select({ id: ratingsTable.id }).from(ratingsTable).where(eq(ratingsTable.product_id, productId)).limit(1),
          db.select({ id: productAdsTable.id }).from(productAdsTable).where(eq(productAdsTable.product_id, productId)).limit(1),
          db.select({ id: recipeItemsTable.id }).from(recipeItemsTable).where(eq(recipeItemsTable.ingredient_id, productId)).limit(1),
        ])
      ).some((rows) => rows.length > 0);

      if (referenced) {
        await db
          .update(productsTable)
          .set({ deletedAt: new Date() })
          .where(eq(productsTable.id, productId));
        // Archiving the outlet's last product of a category drops that feature,
        // so the outlet stops being listed under it straight away.
        await recalcOutletFeatures(access.outlet.id);
        return reply.send({ success: true, message: "Product archived (punya riwayat penjualan)." });
      }

      await db.delete(productsTable).where(eq(productsTable.id, productId));
      await recalcOutletFeatures(access.outlet.id);
      // Unlink the image only after the row delete succeeded, so a failed
      // delete can't orphan the product from its picture.
      if (product.image?.startsWith(PRODUCTS_URL_PREFIX)) {
        const filename = product.image.slice(PRODUCTS_URL_PREFIX.length);
        try {
          await fs.unlink(path.join(PRODUCTS_DIR, filename));
        } catch (err) {
          app.log.error(err, "Failed to delete product image file");
        }
      }
      return reply.send({ success: true, message: "Product deleted successfully." });
    } catch (error) {
      app.log.error(error, "Failed to delete product");
      return reply.status(500).send({ success: false, message: "Failed to delete product." });
    }
  });

  app.post("/api/products/update", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "products");
    if (!access) return;
    try {
      const { productId, data } = (request.body as {
        productId?: string;
        data?: Partial<AddProductInput>;
      }) ?? {};
      if (!productId || !data) {
        return reply.send({ success: false, message: "productId and data are required" });
      }

      const [existing] = await db
        .select({
          outlet_id: productsTable.outlet_id,
          category: productsTable.category,
          courier_deliverable: productsTable.courier_deliverable,
        })
        .from(productsTable)
        .where(eq(productsTable.id, productId))
        .limit(1);
      if (!existing || existing.outlet_id !== access.outlet.id)
        return reply.send({ success: false, message: "Product not found" });

      // Fall back to the stored row for anything the caller omitted. Resolving
      // against the body alone would flip a besi product back to "deliverable"
      // on any partial update that didn't happen to resend the flag.
      const courierDeliverable = resolveCourierDeliverable(
        data.category ?? existing.category,
        data.courier_deliverable ?? existing.courier_deliverable,
      );
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
        await db
          .update(productsTable)
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
          .where(eq(productsTable.id, productId));
      } catch (err: any) {
        if ((err?.code ?? err?.cause?.code) === "23505") {
          return reply.send({ success: false, message: "Barcode sudah dipakai produk lain di outlet ini." });
        }
        throw err;
      }

      // Both `category` and `is_for_sale` are editable here, and either can add
      // or remove a feature — including removing the outlet's last one.
      await recalcOutletFeatures(access.outlet.id);

      return reply.send({ success: true, message: "Product updated successfully." });
    } catch (error) {
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
    const access = await requireOutletAccess(request, reply, "products");
    if (!access) return;

    const productId = (request.params as { id?: string }).id;
    const isAvailable = (request.body as { isAvailable?: unknown })?.isAvailable;
    if (!productId || typeof isAvailable !== "boolean") {
      return reply.status(400).send({ success: false, message: "productId dan isAvailable wajib diisi" });
    }

    // Scoped to the caller's outlet so an id from another outlet can't be flipped.
    const updated = await db
      .update(productsTable)
      .set({ isAvailable })
      .where(
        and(
          eq(productsTable.id, productId),
          eq(productsTable.outlet_id, access.outlet.id),
          isNull(productsTable.deletedAt),
        ),
      )
      .returning({ id: productsTable.id, isAvailable: productsTable.isAvailable });

    if (updated.length === 0) {
      return reply.status(404).send({ success: false, message: "Produk tidak ditemukan" });
    }
    return reply.send({ success: true, isAvailable: updated[0].isAvailable });
  });

  // ── Recipe (bill-of-materials) ─────────────────────────────────────────
  // Strictly opt-in: a product without recipe rows simply moves no stock
  // through a recipe. Recipes NEST — an ingredient may have its own recipe —
  // and both a menu item (track_stock=false) and an in-house intermediate
  // (track_stock=true, produced in batches) can carry one. See recipeItemsTable
  // in db/schema.ts for how expansion decides where to stop.

  // Recipe rows + ingredient display info for the product-form editor.
  app.get("/api/products/:id/recipe", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "products");
    if (!access) return;
    const productId = (request.params as { id: string }).id;

    const [product] = await db
      .select({
        outlet_id: productsTable.outlet_id,
        track_stock: productsTable.track_stock,
        yield_qty: productsTable.yield_qty,
      })
      .from(productsTable)
      .where(and(eq(productsTable.id, productId), eq(productsTable.outlet_id, access.outlet.id)))
      .limit(1);
    if (!product) return reply.status(404).send({ success: false, message: "Product not found" });

    const ingredient = alias(productsTable, "ingredient");
    const items = await db
      .select({
        ingredient_id: recipeItemsTable.ingredient_id,
        qty: recipeItemsTable.qty,
        name: ingredient.product_name,
        unit: ingredient.unit,
        stock: ingredient.stock,
      })
      .from(recipeItemsTable)
      .innerJoin(ingredient, eq(ingredient.id, recipeItemsTable.ingredient_id))
      .where(eq(recipeItemsTable.product_id, productId));

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
    const access = await requireOutletAccess(request, reply, "products");
    if (!access) return;
    const productId = (request.params as { id: string }).id;
    const body =
      (request.body as {
        items?: { ingredient_id?: string; qty?: number | string }[];
        yield_qty?: number | string;
      }) ?? {};
    const items = Array.isArray(body.items) ? body.items : [];

    // Batch size rides along with the composition rather than the product form:
    // it only means anything alongside a composition, and this is the one place
    // that edits them together. Omitted / unparseable leaves it untouched.
    const rawYield = body.yield_qty;
    const parsedYield = rawYield === undefined || rawYield === "" ? null : Number(rawYield);
    if (parsedYield !== null && (!Number.isFinite(parsedYield) || parsedYield <= 0)) {
      return reply.status(400).send({ success: false, message: "Hasil sekali produksi harus lebih dari 0" });
    }

    const [product] = await db
      .select({ outlet_id: productsTable.outlet_id, track_stock: productsTable.track_stock })
      .from(productsTable)
      .where(and(eq(productsTable.id, productId), eq(productsTable.outlet_id, access.outlet.id)))
      .limit(1);
    if (!product) return reply.status(404).send({ success: false, message: "Product not found" });

    // Validate every line against the caller's own products before writing.
    const clean: { ingredient_id: string; qty: string }[] = [];
    for (const it of items) {
      const qty = Number(it.qty);
      if (!it.ingredient_id || !Number.isFinite(qty) || qty <= 0) {
        return reply.status(400).send({ success: false, message: "Setiap bahan butuh qty > 0" });
      }
      if (it.ingredient_id === productId) {
        return reply.status(400).send({ success: false, message: "Produk tidak bisa jadi bahan dirinya sendiri" });
      }
      const [ing] = await db
        .select({ track_stock: productsTable.track_stock, outlet_id: productsTable.outlet_id })
        .from(productsTable)
        .where(eq(productsTable.id, it.ingredient_id))
        .limit(1);
      if (!ing || ing.outlet_id !== product.outlet_id) {
        return reply.status(400).send({ success: false, message: "Bahan tidak ditemukan di outlet ini" });
      }
      // No track_stock requirement: an ingredient that does not track stock is
      // a pass-through composite, which is exactly how sub-recipes are built.
      clean.push({ ingredient_id: it.ingredient_id, qty: qty.toFixed(3) });
    }

    try {
      await db.transaction(async (tx) => {
        await tx.delete(recipeItemsTable).where(eq(recipeItemsTable.product_id, productId));
        if (clean.length) {
          await tx.insert(recipeItemsTable).values(
            clean.map((c) => ({
              outlet_id: product.outlet_id,
              product_id: productId,
              ingredient_id: c.ingredient_id,
              qty: c.qty,
            })),
          );
        }
        if (parsedYield !== null) {
          await tx
            .update(productsTable)
            .set({ yield_qty: parsedYield.toFixed(3) })
            .where(eq(productsTable.id, productId));
        }
        const bad = await findRecipeCycle(tx, productId);
        if (bad) throw new RecipeGraphError(bad);
      });
    } catch (e) {
      if (e instanceof RecipeGraphError) {
        return reply.status(409).send({ success: false, message: e.message });
      }
      throw e;
    }

    return reply.send({ success: true });
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
    const access = await requireOutletAccess(request, reply, "stock");
    if (!access) return;
    const productId = (request.params as { id: string }).id;
    const query = request.query as { qty?: string; mode?: string };
    const qty = Number(query.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      return reply.status(400).send({ success: false, message: "Jumlah produksi harus lebih dari 0" });
    }
    // "raw" walks past produced intermediates down to the materials nothing is
    // made from — a planning view, not what a sale deducts. See expandRecipe.
    const mode = query.mode === "raw" ? "raw" : "ledger";

    const [product] = await db
      .select({
        name: productsTable.product_name,
        unit: productsTable.unit,
        track_stock: productsTable.track_stock,
        outlet_id: productsTable.outlet_id,
      })
      .from(productsTable)
      .where(eq(productsTable.id, productId))
      .limit(1);
    if (!product || product.outlet_id !== access.outlet.id) {
      return reply.status(404).send({ success: false, message: "Product not found" });
    }

    try {
      const preview = await db.transaction(async (tx) => {
        const out = await previewProduction(tx, { outletId: access.outlet.id, productId, qty, mode });
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("RECIPE_CYCLE") || msg.startsWith("RECIPE_TOO_DEEP")) {
        return reply.status(409).send({ success: false, message: "Resep produk ini berputar — perbaiki dulu." });
      }
      throw e;
    }
  });

  app.post("/api/products/:id/production", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "stock");
    if (!access) return;
    const productId = (request.params as { id: string }).id;
    const body = (request.body as { qty?: number | string; note?: string }) ?? {};

    const qty = Number(body.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      return reply.status(400).send({ success: false, message: "Jumlah produksi harus lebih dari 0" });
    }

    try {
      const warnings = await db.transaction((tx) =>
        applyProduction(tx, {
          outletId: access.outlet.id,
          productId,
          qty,
          note: (body.note?.trim() || "").slice(0, 120),
        }),
      );
      return reply.send({ success: true, warnings });
    } catch (e) {
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
    const access = await requireOutletAccess(request, reply, "stock");
    if (!access) return;
    const cap = Math.min(Number((request.query as { limit?: string }).limit) || 50, 200);

    const rows = await db
      .select({
        id: stockMovementsTable.id,
        product_id: stockMovementsTable.product_id,
        product_name: productsTable.product_name,
        unit: productsTable.unit,
        qty: stockMovementsTable.qty_change,
        unit_cost: stockMovementsTable.unit_cost,
        total_cost: stockMovementsTable.cost_change,
        note: stockMovementsTable.note,
        created_at: stockMovementsTable.created_at,
      })
      .from(stockMovementsTable)
      .innerJoin(productsTable, eq(productsTable.id, stockMovementsTable.product_id))
      .where(
        and(
          eq(stockMovementsTable.outlet_id, access.outlet.id),
          eq(stockMovementsTable.reason, "production"),
          gt(stockMovementsTable.qty_change, "0"),
        ),
      )
      .orderBy(desc(stockMovementsTable.created_at), desc(stockMovementsTable.id))
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
    const access = await requireOutletAccess(request, reply, "products");
    if (!access) return;
    const productId = (request.params as { id: string }).id;
    const price = Number((request.body as { price?: number | string })?.price);

    if (!Number.isFinite(price) || price < 0) {
      return reply.status(400).send({ success: false, message: "Harga tidak valid" });
    }

    const [existing] = await db
      .select({
        outlet_id: productsTable.outlet_id,
        lowest_price: productsTable.lowest_price,
        highest_price: productsTable.highest_price,
      })
      .from(productsTable)
      .where(eq(productsTable.id, productId))
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

    await db
      .update(productsTable)
      .set({ price: String(Math.round(price)) })
      .where(eq(productsTable.id, productId));

    return reply.send({ success: true, price: String(Math.round(price)) });
  });

  // ── Menu groups: owner-defined sections for the public /menu page ────────
  // Separate from products.category on purpose — see menuGroupsTable in
  // db/schema.ts. Same "products" permission as the product routes above.

  app.get("/api/menu-groups", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "products");
    if (!access) return;

    const groups = await db
      .select({
        id: menuGroupsTable.id,
        name: menuGroupsTable.name,
        sort_order: menuGroupsTable.sort_order,
      })
      .from(menuGroupsTable)
      .where(
        and(
          eq(menuGroupsTable.outlet_id, access.outlet.id),
          isNull(menuGroupsTable.deletedAt),
        ),
      )
      .orderBy(menuGroupsTable.sort_order, menuGroupsTable.name);

    return reply.send({ success: true, groups });
  });

  app.post("/api/menu-groups", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "products");
    if (!access) return;

    const name = String((request.body as { name?: string })?.name ?? "").trim();
    if (!name) return reply.status(400).send({ success: false, error: "Nama grup wajib diisi" });
    if (name.length > 60) return reply.status(400).send({ success: false, error: "Nama grup maksimal 60 karakter" });

    // New groups land at the end rather than the top: appending is what an
    // owner adding a section to an existing menu expects.
    const [last] = await db
      .select({ max: sql<number>`coalesce(max(${menuGroupsTable.sort_order}), -1)` })
      .from(menuGroupsTable)
      .where(eq(menuGroupsTable.outlet_id, access.outlet.id));

    try {
      const [created] = await db
        .insert(menuGroupsTable)
        .values({ outlet_id: access.outlet.id, name, sort_order: Number(last?.max ?? -1) + 1 })
        .returning({ id: menuGroupsTable.id, name: menuGroupsTable.name, sort_order: menuGroupsTable.sort_order });
      return reply.send({ success: true, group: created });
    } catch {
      // Unique (outlet_id, name) — the picker relies on distinct names.
      return reply.status(409).send({ success: false, error: "Grup dengan nama itu sudah ada" });
    }
  });

  app.patch("/api/menu-groups/:id", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "products");
    if (!access) return;

    const id = Number((request.params as { id?: string }).id);
    const name = String((request.body as { name?: string })?.name ?? "").trim();
    if (!id || !name) return reply.status(400).send({ success: false, error: "id dan nama wajib diisi" });

    try {
      const updated = await db
        .update(menuGroupsTable)
        .set({ name, updatedAt: new Date() })
        // Scoped to the caller's outlet so an id from another outlet can't be renamed.
        .where(and(eq(menuGroupsTable.id, id), eq(menuGroupsTable.outlet_id, access.outlet.id)))
        .returning({ id: menuGroupsTable.id });
      if (updated.length === 0) return reply.status(404).send({ success: false, error: "Grup tidak ditemukan" });
      return reply.send({ success: true });
    } catch {
      return reply.status(409).send({ success: false, error: "Grup dengan nama itu sudah ada" });
    }
  });

  // Bulk reorder: the client sends ids in their new display order.
  app.post("/api/menu-groups/reorder", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "products");
    if (!access) return;

    const ids = (request.body as { ids?: number[] })?.ids;
    if (!Array.isArray(ids)) return reply.status(400).send({ success: false, error: "ids wajib berupa array" });

    await db.transaction(async (tx) => {
      for (const [index, id] of ids.entries()) {
        await tx
          .update(menuGroupsTable)
          .set({ sort_order: index, updatedAt: new Date() })
          .where(and(eq(menuGroupsTable.id, Number(id)), eq(menuGroupsTable.outlet_id, access.outlet.id)));
      }
    });

    return reply.send({ success: true });
  });

  app.delete("/api/menu-groups/:id", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "products");
    if (!access) return;

    const id = Number((request.params as { id?: string }).id);
    if (!id) return reply.status(400).send({ success: false, error: "id wajib diisi" });

    // Hard delete: products.menu_group_id is ON DELETE SET NULL, so the products
    // survive and simply become ungrouped.
    const deleted = await db
      .delete(menuGroupsTable)
      .where(and(eq(menuGroupsTable.id, id), eq(menuGroupsTable.outlet_id, access.outlet.id)))
      .returning({ id: menuGroupsTable.id });

    if (deleted.length === 0) return reply.status(404).send({ success: false, error: "Grup tidak ditemukan" });
    return reply.send({ success: true });
  });
}
