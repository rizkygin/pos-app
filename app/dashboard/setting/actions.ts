"use server";

import { db } from "@/src/db";
import { outletsTable } from "@/src/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

export type OutletFormData = {
    name: string;
    phone: string;
    address: string;
    lat: string;
    lon: string;
    is_open: boolean;
    features: string[];
    tags: string[];
    avatar?: string;
};

export async function getOutletAction() {
    const session = await getSession();
    const rows = await db
        .select({
            id: outletsTable.id,
            name: outletsTable.name,
            phone: outletsTable.phone,
            address: outletsTable.address,
            lat: outletsTable.lat,
            lon: outletsTable.lon,
            avatar: outletsTable.avatar,
            is_open: outletsTable.is_open,
            features: outletsTable.features,
            tags: outletsTable.tags,
        })
        .from(outletsTable)
        .where(eq(outletsTable.user_id, session.user.id))
        .limit(1);

    return rows[0] ?? null;
}

export async function updateOutletAction(data: OutletFormData) {
    try {
        const session = await getSession();
        await db
            .update(outletsTable)
            .set({
                name: data.name,
                phone: data.phone,
                address: data.address,
                lat: data.lat,
                lon: data.lon,
                is_open: data.is_open,
                features: data.features,
                tags: data.tags,
                ...(data.avatar && { avatar: data.avatar }),
            })
            .where(eq(outletsTable.user_id, session.user.id));

        revalidatePath("/dashboard/setting");
        return { success: true, message: "Pengaturan berhasil disimpan." };
    } catch (error) {
        console.error("Failed to update outlet:", error);
        return { success: false, message: "Gagal menyimpan pengaturan." };
    }
}

export async function uploadOutletAvatar(formData: FormData) {
    try {
        const file = formData.get("image") as File | null;
        if (!file) return { success: false, message: "Tidak ada file gambar." };

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        const filename = `avatar-${uniqueSuffix}.webp`;
        const uploadDir = path.join(process.cwd(), "public", "avatars");

        await fs.mkdir(uploadDir, { recursive: true });

        await sharp(buffer)
            .resize(400, 400, { fit: "cover", position: "center" })
            .webp({ quality: 85 })
            .toFile(path.join(uploadDir, filename));

        return { success: true, imageUrl: `/avatars/${filename}` };
    } catch (error) {
        console.error("Failed to upload avatar:", error);
        return { success: false, message: "Gagal mengunggah gambar." };
    }
}
