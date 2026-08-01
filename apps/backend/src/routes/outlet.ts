import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { db } from "../db";
import { outletsTable } from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { parseActiveOutletId, getSubscriptionGate } from "../lib/outlet-access";
import { parseCoordPair } from "../lib/utils/coords";
import { recomputeCourierReachable } from "../lib/service-area";
import { and, sql } from "drizzle-orm";

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

// The owner's ACTIVE outlet: prefers the active_outlet cookie when that outlet
// is theirs, else their first. Null when the caller owns no outlet.
async function activeOwnedOutlet(request: import("fastify").FastifyRequest, userId: string) {
  const owned = await db
    .select()
    .from(outletsTable)
    .where(eq(outletsTable.user_id, userId))
    .orderBy(outletsTable.id);
  if (!owned.length) return null;
  const preferred = parseActiveOutletId(request);
  return owned.find((o) => o.id === preferred) ?? owned[0];
}

// Cookie attributes mirror the auth cookie's environment handling so the
// active-outlet choice reaches api.ulunpesan.com from the browser.
function activeOutletCookie(id: number) {
  const isProduction = process.env.NODE_ENV === "production";
  const secure = process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === "true"
    : isProduction;
  const domain = process.env.COOKIE_DOMAIN ?? (isProduction ? ".ulunpesan.com" : undefined);
  return [
    `active_outlet=${id}`,
    "Path=/",
    "Max-Age=31536000",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
    ...(domain ? [`Domain=${domain}`] : []),
  ].join("; ");
}

export async function outletRoutes(app: FastifyInstance) {
  // All outlets the caller owns + which one is active + the plan's cap.
  app.get("/api/my-outlets", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });
    const owned = await db
      .select({
        id: outletsTable.id,
        name: outletsTable.name,
        address: outletsTable.address,
        avatar: outletsTable.avatar,
        is_open: outletsTable.is_open,
      })
      .from(outletsTable)
      .where(eq(outletsTable.user_id, session.user.id))
      .orderBy(outletsTable.id);
    if (!owned.length) return reply.send({ success: true, data: [], active_id: null, max_outlets: 0 });
    const preferred = parseActiveOutletId(request);
    const active = owned.find((o) => o.id === preferred) ?? owned[0];
    const gate = await getSubscriptionGate(session.user.id);
    const cap = Number(gate.features.maxOutlets);
    return reply.send({
      success: true,
      data: owned,
      active_id: active.id,
      max_outlets: Number.isFinite(cap) && cap > 0 ? cap : 1,
    });
  });

  // Switch the active outlet (sets the cookie the resolvers read).
  app.post("/api/outlets/active", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });
    const { outlet_id } = (request.body ?? {}) as { outlet_id?: number };
    const [owned] = await db
      .select({ id: outletsTable.id })
      .from(outletsTable)
      .where(and(eq(outletsTable.user_id, session.user.id), eq(outletsTable.id, Number(outlet_id))))
      .limit(1);
    if (!owned) return reply.status(404).send({ success: false, error: "Outlet tidak ditemukan" });
    reply.header("set-cookie", activeOutletCookie(owned.id));
    return reply.send({ success: true, active_id: owned.id });
  });

  // Create an additional outlet — capped by the plan's maxOutlets.
  app.post("/api/outlets", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const [{ n: ownedCount }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(outletsTable)
      .where(eq(outletsTable.user_id, session.user.id));
    if (!ownedCount) return reply.status(403).send({ success: false, error: "Daftar sebagai pemilik dulu" });

    const gate = await getSubscriptionGate(session.user.id);
    if (!gate.alive)
      return reply.status(403).send({ success: false, error: "Langganan berakhir — perpanjang untuk menambah outlet" });
    const cap = Number(gate.features.maxOutlets);
    const max = Number.isFinite(cap) && cap > 0 ? cap : 1;
    if (ownedCount >= max)
      return reply.status(409).send({ success: false, error: `Paket Pian dibatasi ${max} outlet — upgrade paket untuk menambah` });

    const body = (request.body ?? {}) as Partial<OutletFormData> & { email?: string };
    const name = String(body.name ?? "").trim();
    const address = String(body.address ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!name || !address || !phone || !email)
      return reply.status(400).send({ success: false, error: "Nama, alamat, WhatsApp, dan email outlet wajib diisi" });
    const [taken] = await db
      .select({ id: outletsTable.id })
      .from(outletsTable)
      .where(eq(outletsTable.email, email))
      .limit(1);
    if (taken)
      return reply.status(409).send({ success: false, error: "Email outlet sudah digunakan, silakan pakai email lain" });

    // A location is optional at creation, but a *broken* one is not acceptable:
    // `String(body.lat ?? default)` only defaulted on null/undefined, so the
    // form's empty strings were stored verbatim in a notNull varchar and read
    // back as NaN, crashing the map picker. Fall back to Banjarmasin instead.
    const coords = parseCoordPair(body.lat, body.lon) ?? { lat: -3.3199, lon: 114.5907 };

    const [created] = await db
      .insert(outletsTable)
      .values({
        name,
        address,
        phone,
        email,
        user_id: session.user.id,
        avatar: "avatar.png",
        lat: String(coords.lat),
        lon: String(coords.lon),
        // Starts empty and stays derived: a brand-new outlet has no products,
        // so it is browsable under nothing until it adds some.
        features: [],
        is_open: false,
      })
      .returning();
    // Make the new outlet active right away.
    reply.header("set-cookie", activeOutletCookie(created.id));
    return reply.status(201).send({ success: true, data: created });
  });

  app.get("/api/outlet/me", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const outlet = await activeOwnedOutlet(request, session.user.id);
    if (!outlet) return reply.send({ success: true, outlet: null });
    const { id, name, phone, address, lat, lon, avatar, is_open, features, tags, courier_reachable } = outlet;
    return reply.send({
      success: true,
      // courier_reachable rides along so the order lobby can decide whether to
      // mount and poll at all, rather than discovering it four requests in.
      outlet: { id, name, phone, address, lat, lon, avatar, is_open, features, tags, courier_reachable },
    });
  });

  app.patch("/api/outlet/me", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    try {
      const target = await activeOwnedOutlet(request, session.user.id);
      if (!target) return reply.status(403).send({ success: false, message: "Outlet tidak ditemukan." });
      const data = request.body as OutletFormData;
      // Reject rather than silently defaulting: an owner editing their outlet
      // is deliberately setting a pin, so a bad value here is a real error and
      // quietly relocating their shop would be worse than saying no.
      const coords = parseCoordPair(data.lat, data.lon);
      if (!coords)
        return reply
          .status(400)
          .send({ success: false, message: "Titik lokasi outlet tidak valid." });
      await db
        .update(outletsTable)
        .set({
          name: data.name,
          phone: data.phone,
          address: data.address,
          lat: String(coords.lat),
          lon: String(coords.lon),
          is_open: data.is_open,
          // `features` is deliberately NOT settable here. It is derived from the
          // outlet's products by recalcOutletFeatures — an owner-maintained
          // checklist drifted from reality and left outlets listed under
          // categories they had no products for.
          tags: data.tags,
          ...(data.avatar && { avatar: data.avatar }),
        })
        .where(eq(outletsTable.id, target.id));

      // The pin may have moved, which changes whether couriers reach here.
      // Recomputed on save rather than on read: the order lobby polls every two
      // seconds and shouldn't be measuring distances to answer a question that
      // only changes when someone drags a marker.
      await recomputeCourierReachable(target.id);

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
