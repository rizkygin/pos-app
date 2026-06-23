"use server";

import { db } from "@/src/db";
import { locationsTable } from "@/src/db/schema";
import { eq, desc, and, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";

const REVALIDATE_PATH = "/dashboard/users/locations/setting";

export type LocationFormData = {
    label: string;
    address: string;
    lat: string;
    lon: string;
    note?: string;
};

export type UserLocation = {
    id: number;
    label: string;
    address: string;
    lat: string;
    lon: string;
    note: string | null;
    is_default: boolean;
};

export async function getUserLocations(): Promise<UserLocation[]> {
    const session = await getSession();
    return db
        .select({
            id: locationsTable.id,
            label: locationsTable.label,
            address: locationsTable.address,
            lat: locationsTable.lat,
            lon: locationsTable.lon,
            note: locationsTable.note,
            is_default: locationsTable.is_default,
        })
        .from(locationsTable)
        .where(eq(locationsTable.user_id, session.user.id))
        .orderBy(desc(locationsTable.is_default));
}

export async function checkUserHasLocations(): Promise<boolean> {
    const session = await getSession();
    const rows = await db
        .select({ id: locationsTable.id })
        .from(locationsTable)
        .where(eq(locationsTable.user_id, session.user.id))
        .limit(1);
    return rows.length > 0;
}

export async function addLocationAction(data: LocationFormData) {
    try {
        const session = await getSession();
        const existing = await db
            .select({ id: locationsTable.id })
            .from(locationsTable)
            .where(eq(locationsTable.user_id, session.user.id))
            .limit(1);

        await db.insert(locationsTable).values({
            user_id: session.user.id,
            label: data.label,
            address: data.address,
            lat: data.lat,
            lon: data.lon,
            note: data.note ?? "",
            is_default: existing.length === 0,
        });

        revalidatePath(REVALIDATE_PATH);
        return { success: true, message: "Alamat berhasil ditambahkan." };
    } catch {
        return { success: false, message: "Gagal menambahkan alamat." };
    }
}

export async function updateLocationAction(id: number, data: LocationFormData) {
    try {
        const session = await getSession();
        await db
            .update(locationsTable)
            .set({
                label: data.label,
                address: data.address,
                lat: data.lat,
                lon: data.lon,
                note: data.note ?? "",
            })
            .where(and(eq(locationsTable.id, id), eq(locationsTable.user_id, session.user.id)));

        revalidatePath(REVALIDATE_PATH);
        return { success: true, message: "Alamat berhasil diperbarui." };
    } catch {
        return { success: false, message: "Gagal memperbarui alamat." };
    }
}

export async function deleteLocationAction(id: number) {
    try {
        const session = await getSession();
        const all = await db
            .select({ id: locationsTable.id })
            .from(locationsTable)
            .where(eq(locationsTable.user_id, session.user.id));

        if (all.length <= 1) {
            return { success: false, message: "Kamu harus memiliki minimal satu alamat." };
        }

        const deleted = await db
            .delete(locationsTable)
            .where(and(eq(locationsTable.id, id), eq(locationsTable.user_id, session.user.id)))
            .returning({ is_default: locationsTable.is_default });

        if (deleted[0]?.is_default) {
            const first = all.find((r) => r.id !== id);
            if (first) {
                await db
                    .update(locationsTable)
                    .set({ is_default: true })
                    .where(eq(locationsTable.id, first.id));
            }
        }

        revalidatePath(REVALIDATE_PATH);
        return { success: true, message: "Alamat berhasil dihapus." };
    } catch {
        return { success: false, message: "Gagal menghapus alamat." };
    }
}

export async function setDefaultLocationAction(id: number) {
    try {
        const session = await getSession();
        await db.transaction(async (tx) => {
            await tx
                .update(locationsTable)
                .set({ is_default: false })
                .where(and(eq(locationsTable.user_id, session.user.id), ne(locationsTable.id, id)));
            await tx
                .update(locationsTable)
                .set({ is_default: true })
                .where(and(eq(locationsTable.id, id), eq(locationsTable.user_id, session.user.id)));
        });

        revalidatePath(REVALIDATE_PATH);
        return { success: true, message: "Alamat utama berhasil diubah." };
    } catch {
        return { success: false, message: "Gagal mengubah alamat utama." };
    }
}
