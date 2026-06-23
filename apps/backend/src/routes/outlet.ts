import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { db } from "../db";
import { outletsTable } from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";

const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

type OutletFormData = {
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

export async function outletRoutes(app: FastifyInstance) {
  app.get("/api/outlet/me", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const [outlet] = await db
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

    return reply.send({ success: true, outlet: outlet ?? null });
  });

  app.patch("/api/outlet/me", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    try {
      const data = request.body as OutletFormData;
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

      return reply.send({ success: true, message: "Pengaturan berhasil disimpan." });
    } catch (error) {
      app.log.error(error, "Failed to update outlet");
      return reply.status(500).send({ success: false, message: "Gagal menyimpan pengaturan." });
    }
  });

  app.post("/api/outlet/me/avatar", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    try {
      const file = await request.file();
      if (!file) return reply.status(400).send({ success: false, message: "Tidak ada file gambar." });

      const buffer = await file.toBuffer();
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const filename = `avatar-${uniqueSuffix}.webp`;
      const uploadDir = path.join(UPLOADS_ROOT, "avatars");
      await fs.mkdir(uploadDir, { recursive: true });

      await sharp(buffer)
        .resize(400, 400, { fit: "cover", position: "center" })
        .webp({ quality: 85 })
        .toFile(path.join(uploadDir, filename));

      return reply.send({ success: true, imageUrl: `/uploads/avatars/${filename}` });
    } catch (error) {
      app.log.error(error, "Failed to upload avatar");
      return reply.status(500).send({ success: false, message: "Gagal mengunggah gambar." });
    }
  });
}
