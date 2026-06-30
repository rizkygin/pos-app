import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { db } from "../db";
import { productsTable, outletsTable } from "../db/schema";
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
};

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

      await db.insert(productsTable).values({
        id,
        product_name: data.product_name,
        price: data.price,
        price_mark_down: data.price_mark_down,
        buying_price: data.buying_price,
        outlet_id: data.outlet_id,
        category: data.category,
        description: data.description || "",
        unit: data.unit || "pcs",
        image: data.image || "avatar.png",
        features: data.features ?? [],
        is_for_sale: data.is_for_sale ?? true,
        track_stock: data.track_stock ?? true,
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

      await db
        .update(productsTable)
        .set({
          product_name: data.product_name,
          price: data.price,
          price_mark_down: data.price_mark_down,
          buying_price: data.buying_price,
          category: data.category,
          description: data.description,
          unit: data.unit,
          ...(data.image && { image: data.image }),
          ...(data.features !== undefined && { features: data.features }),
          ...(data.is_for_sale !== undefined && { is_for_sale: data.is_for_sale }),
          ...(data.track_stock !== undefined && { track_stock: data.track_stock }),
        })
        .where(eq(productsTable.id, productId));

      return reply.send({ success: true, message: "Product updated successfully." });
    } catch (error) {
      app.log.error(error, "Failed to update product");
      return reply.status(500).send({ success: false, message: "Failed to update product." });
    }
  });
}
