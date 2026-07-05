import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { db } from "../db";
import { productsTable, outletsTable, recipeItemsTable } from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";

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
  description?: string;
  unit?: string;
  image?: string;
  features?: string[];
  is_for_sale?: boolean;
  track_stock?: boolean;
  // Service products: a negotiable price range. When lowest_price is set the
  // product is treated as a service (price mirrors lowest_price, no stock).
  lowest_price?: string;
  highest_price?: string;
};

// A service product is priced by range. Mirror `price`/`price_mark_down` to the
// lowest price so existing "mulai dari" customer displays keep working, and force
// track_stock off (services hold no countable stock).
function serviceProductFields(data: Partial<AddProductInput>) {
  const isService = data.lowest_price != null && data.lowest_price !== "";
  if (!isService) return null;
  return {
    lowest_price: data.lowest_price!,
    highest_price: data.highest_price ?? data.lowest_price!,
    price: data.lowest_price!,
    price_mark_down: data.lowest_price!,
    track_stock: false,
    discount_percent: null,
  };
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

    const [outlet] = await db
      .select()
      .from(outletsTable)
      .where(eq(outletsTable.user_id, session.user.id))
      .limit(1);

    if (!outlet) return reply.send({ outlet: null, products: [] });

    const products = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.outlet_id, outlet.id));

    return reply.send({ outlet, products });
  });

  app.post("/api/products", async (request, reply) => {
    if (!(await requireUser(request, reply))) return;
    try {
      const data = request.body as AddProductInput;
      const id = crypto.randomUUID();
      const service = serviceProductFields(data);

      await db.insert(productsTable).values({
        id,
        product_name: data.product_name,
        price: service?.price ?? data.price,
        price_mark_down: service?.price_mark_down ?? data.price_mark_down,
        buying_price: data.buying_price,
        outlet_id: data.outlet_id,
        category: data.category,
        description: data.description || "",
        unit: data.unit || "pcs",
        image: data.image || "avatar.png",
        features: data.features ?? [],
        is_for_sale: data.is_for_sale ?? true,
        track_stock: service ? false : (data.track_stock ?? true),
        lowest_price: service?.lowest_price ?? null,
        highest_price: service?.highest_price ?? null,
      });

      return reply.send({ success: true, message: "Product added successfully." });
    } catch (error) {
      app.log.error(error, "Failed to add product");
      return reply.status(500).send({ success: false, message: "Failed to add product." });
    }
  });

  app.post("/api/products/upload-image", async (request, reply) => {
    if (!(await requireUser(request, reply))) return;
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
    if (!(await requireUser(request, reply))) return;
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
    if (!(await requireUser(request, reply))) return;
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

  app.post("/api/products/delete", async (request, reply) => {
    if (!(await requireUser(request, reply))) return;
    try {
      const { productId } = (request.body as { productId?: string }) ?? {};
      if (!productId) return reply.send({ success: false, message: "productId is required" });

      const [product] = await db
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, productId))
        .limit(1);

      // Best-effort delete of a backend-served image file
      if (product?.image?.startsWith(PRODUCTS_URL_PREFIX)) {
        const filename = product.image.slice(PRODUCTS_URL_PREFIX.length);
        try {
          await fs.unlink(path.join(PRODUCTS_DIR, filename));
        } catch (err) {
          app.log.error(err, "Failed to delete product image file");
        }
      }

      await db.delete(productsTable).where(eq(productsTable.id, productId));
      return reply.send({ success: true, message: "Product deleted successfully." });
    } catch (error) {
      app.log.error(error, "Failed to delete product");
      return reply.status(500).send({ success: false, message: "Failed to delete product." });
    }
  });

  app.post("/api/products/update", async (request, reply) => {
    if (!(await requireUser(request, reply))) return;
    try {
      const { productId, data } = (request.body as {
        productId?: string;
        data?: Partial<AddProductInput>;
      }) ?? {};
      if (!productId || !data) {
        return reply.send({ success: false, message: "productId and data are required" });
      }

      const service = serviceProductFields(data);

      await db
        .update(productsTable)
        .set({
          product_name: data.product_name,
          price: service?.price ?? data.price,
          price_mark_down: service?.price_mark_down ?? data.price_mark_down,
          buying_price: data.buying_price,
          category: data.category,
          description: data.description,
          unit: data.unit,
          ...(data.image && { image: data.image }),
          ...(data.features !== undefined && { features: data.features }),
          ...(data.is_for_sale !== undefined && { is_for_sale: data.is_for_sale }),
          ...(service
            ? { lowest_price: service.lowest_price, highest_price: service.highest_price, track_stock: false, discount_percent: null }
            : data.track_stock !== undefined && { track_stock: data.track_stock }),
        })
        .where(eq(productsTable.id, productId));

      return reply.send({ success: true, message: "Product updated successfully." });
    } catch (error) {
      app.log.error(error, "Failed to update product");
      return reply.status(500).send({ success: false, message: "Failed to update product." });
    }
  });

  // ── Recipe (bill-of-materials) ─────────────────────────────────────────
  // Strictly opt-in: only track_stock=false products can have one, and a
  // product without recipe rows simply moves no stock when sold.

  // Recipe rows + ingredient display info for the product-form editor.
  app.get("/api/products/:id/recipe", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const productId = (request.params as { id: string }).id;

    const [product] = await db
      .select({ outlet_id: productsTable.outlet_id, track_stock: productsTable.track_stock })
      .from(productsTable)
      .innerJoin(outletsTable, eq(outletsTable.id, productsTable.outlet_id))
      .where(and(eq(productsTable.id, productId), eq(outletsTable.user_id, session.user.id)))
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

    return reply.send({ success: true, items });
  });

  // Replace-on-save: the submitted list becomes the whole recipe (empty list
  // clears it). Rejected for track_stock products — one stock mode at a time.
  app.put("/api/products/:id/recipe", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const productId = (request.params as { id: string }).id;
    const body = (request.body as { items?: { ingredient_id?: string; qty?: number | string }[] }) ?? {};
    const items = Array.isArray(body.items) ? body.items : [];

    const [product] = await db
      .select({ outlet_id: productsTable.outlet_id, track_stock: productsTable.track_stock })
      .from(productsTable)
      .innerJoin(outletsTable, eq(outletsTable.id, productsTable.outlet_id))
      .where(and(eq(productsTable.id, productId), eq(outletsTable.user_id, session.user.id)))
      .limit(1);
    if (!product) return reply.status(404).send({ success: false, message: "Product not found" });
    if (product.track_stock && items.length > 0) {
      return reply.status(409).send({
        success: false,
        message: "Produk dengan stok sendiri tidak bisa punya resep — matikan 'lacak stok' dulu.",
      });
    }

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
      if (!ing.track_stock) {
        return reply.status(400).send({ success: false, message: "Bahan harus produk yang melacak stok" });
      }
      clean.push({ ingredient_id: it.ingredient_id, qty: qty.toFixed(3) });
    }

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
    });

    return reply.send({ success: true });
  });
}
