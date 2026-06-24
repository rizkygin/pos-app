import type { FastifyInstance } from "fastify";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "../db";
import { locationsTable } from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";

type LocationFormData = {
  label: string;
  address: string;
  lat: string;
  lon: string;
  note?: string;
};

export async function locationRoutes(app: FastifyInstance) {
  app.get("/api/locations", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const rows = await db
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

    return reply.send({ success: true, data: rows });
  });

  app.get("/api/locations/exists", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ exists: false });

    const rows = await db
      .select({ id: locationsTable.id })
      .from(locationsTable)
      .where(eq(locationsTable.user_id, session.user.id))
      .limit(1);

    return reply.send({ exists: rows.length > 0 });
  });

  app.post("/api/locations", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, message: "Unauthorized" });

    try {
      const data = request.body as LocationFormData;
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

      return reply.send({ success: true, message: "Alamat berhasil ditambahkan." });
    } catch {
      return reply.status(500).send({ success: false, message: "Gagal menambahkan alamat." });
    }
  });

  app.post("/api/locations/update", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, message: "Unauthorized" });

    try {
      const { id, data } = request.body as { id: number; data: LocationFormData };
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

      return reply.send({ success: true, message: "Alamat berhasil diperbarui." });
    } catch {
      return reply.status(500).send({ success: false, message: "Gagal memperbarui alamat." });
    }
  });

  app.post("/api/locations/delete", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, message: "Unauthorized" });

    try {
      const { id } = request.body as { id: number };
      const all = await db
        .select({ id: locationsTable.id })
        .from(locationsTable)
        .where(eq(locationsTable.user_id, session.user.id));

      if (all.length <= 1) {
        return reply.send({ success: false, message: "Kamu harus memiliki minimal satu alamat." });
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

      return reply.send({ success: true, message: "Alamat berhasil dihapus." });
    } catch {
      return reply.status(500).send({ success: false, message: "Gagal menghapus alamat." });
    }
  });

  app.post("/api/locations/set-default", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, message: "Unauthorized" });

    try {
      const { id } = request.body as { id: number };
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

      return reply.send({ success: true, message: "Alamat utama berhasil diubah." });
    } catch {
      return reply.status(500).send({ success: false, message: "Gagal mengubah alamat utama." });
    }
  });
}
