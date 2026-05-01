"use server";

import { db } from "@/src/db";
import { productsTable } from "@/src/db/schema";
import { revalidatePath } from "next/cache";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { eq } from "drizzle-orm";

export type AddProductInput = {
    product_name: string;
    price: string;
    price_mark_down: string;
    outlet_id: number;
    category: string;
    description?: string;
    unit?: string;
    image?: string;
};

export async function addProductAction(data: AddProductInput) {
    try {
        const id = crypto.randomUUID();

        await db.insert(productsTable).values({
            id,
            product_name: data.product_name,
            price: data.price,
            price_mark_down: data.price_mark_down,
            outlet_id: data.outlet_id,
            category: data.category,
            description: data.description || "",
            unit: data.unit || "pcs",
            image: data.image || "avatar.png",
        });

        revalidatePath("/dashboard/addproducts");
        return { success: true, message: "Product added successfully." };
    } catch (error) {
        console.error("Failed to add product:", error);
        return { success: false, message: "Failed to add product." };
    }
}

export async function uploadImage(formData: FormData) {
    try {
        const file = formData.get("image") as File | null;
        if (!file) {
            return { success: false, message: "No image file provided." };
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Generate a unique filename
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const filename = `product-${uniqueSuffix}.webp`;
        const uploadDir = path.join(process.cwd(), "public", "products");

        // Resize and save image
        await sharp(buffer)
            .resize(400, 600, {
                fit: "cover",
                position: "center"
            })
            .webp({ quality: 80 })
            .toFile(path.join(uploadDir, filename));

        const imageUrl = `/products/${filename}`;

        return { success: true, imageUrl };
    } catch (error) {
        console.error("Failed to upload image:", error);
        return { success: false, message: "Failed to process and upload image." };
    }
}

export async function deleteProductAction(productId: string) {
    try {
        const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId)).limit(1);

        if (product && product.image && product.image.startsWith("/products/")) {
            const filePath = path.join(process.cwd(), "public", product.image);
            try {
                await fs.unlink(filePath);
            } catch (err) {
                console.error("Failed to delete image file:", err);
            }
        }

        await db.delete(productsTable).where(eq(productsTable.id, productId));
        revalidatePath("/dashboard/addproducts");
        return { success: true, message: "Product deleted successfully." };
    } catch (error) {
        console.error("Failed to delete product:", error);
        return { success: false, message: "Failed to delete product." };
    }
}

export async function updateProductAction(productId: string, data: Partial<AddProductInput>) {
    try {
        await db.update(productsTable)
            .set({
                product_name: data.product_name,
                price: data.price,
                price_mark_down: data.price_mark_down,
                category: data.category,
                description: data.description,
                unit: data.unit,
                ...(data.image && { image: data.image })
            })
            .where(eq(productsTable.id, productId));

        revalidatePath("/dashboard/addproducts");
        return { success: true, message: "Product updated successfully." };
    } catch (error) {
        console.error("Failed to update product:", error);
        return { success: false, message: "Failed to update product." };
    }
}
