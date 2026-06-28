import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { db } from "../db";
import {
  adminsTable,
  productsTable,
  productAdsTable,
  productAdsSchedule,
  scheduleProductAdsTable,
} from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { getOutletByUserId } from "../lib/outlet-id";

const UPLOADS_ROOT = path.join(process.cwd(), "uploads");
const ADS_DIR = path.join(UPLOADS_ROOT, "ads");
const ADS_URL_PREFIX = "/uploads/ads/";

type DisplayAs = "once a week" | "only 1 day" | "only weekend" | "only weekdays";

type CreateAdInput = {
  product_id: string;
  title: string;
  description?: string;
  banner_image: string;
  display_as: DisplayAs;
  day?: string;
  hour_start: string;
  hour_end: string;
  duration?: number;
};

const WEEKEND_DAYS = ["saturday", "sunday"];
const WEEKDAY_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];

function resolveDays(display_as: DisplayAs, day?: string): string[] {
  switch (display_as) {
    case "only weekend":
      return WEEKEND_DAYS;
    case "only weekdays":
      return WEEKDAY_DAYS;
    case "once a week":
    case "only 1 day":
    default:
      return day ? [day] : [];
  }
}

function resolveHours(hour_start: string, hour_end: string): string[] {
  const start = Number(hour_start);
  const end = Number(hour_end);
  const hours: string[] = [];
  for (let h = start; h <= end; h++) {
    hours.push(String(h).padStart(2, "0"));
  }
  return hours;
}

function resolveEndsAt(display_as: DisplayAs, starts_at: Date, duration?: number): Date | null {
  switch (display_as) {
    case "once a week":
      return null;
    case "only 1 day":
      return new Date(starts_at.getTime() + 7 * 24 * 60 * 60 * 1000);
    case "only weekend":
    case "only weekdays":
    default: {
      const weeks = duration && duration > 0 ? duration : 1;
      return new Date(starts_at.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
    }
  }
}

async function isAdmin(userId: string) {
  const [admin] = await db
    .select({ id: adminsTable.id })
    .from(adminsTable)
    .where(eq(adminsTable.user_id, userId))
    .limit(1);
  return !!admin;
}

// Best-effort delete of a backend-served banner file (legacy /ads/ live in the
// frontend public dir and can't be reached from here).
async function unlinkBanner(app: FastifyInstance, banner_image: string | null | undefined) {
  if (!banner_image?.startsWith(ADS_URL_PREFIX)) return;
  const filename = banner_image.slice(ADS_URL_PREFIX.length);
  const filePath = path.join(ADS_DIR, filename);
  if (!filePath.startsWith(ADS_DIR + path.sep)) return;
  try {
    await fs.unlink(filePath);
  } catch (err) {
    app.log.error(err, "Failed to delete banner file");
  }
}

export async function adRoutes(app: FastifyInstance) {
  // --- Owner endpoints ---

  // Composed payload for the promote page: the outlet's promotable products +
  // its ads, each with their schedule days/hours aggregated. { outlet: null }
  // when the caller has no outlet.
  app.get("/api/ads/mine", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false });

    const outlet = await getOutletByUserId(session.user.id);
    if (!outlet) return reply.send({ outlet: null, products: [], ads: [] });

    const products = await db
      .select({
        id: productsTable.id,
        product_name: productsTable.product_name,
        image: productsTable.image,
      })
      .from(productsTable)
      .where(and(eq(productsTable.outlet_id, outlet.id), isNull(productsTable.deletedAt)));

    const ads = await db
      .select({
        id: productAdsTable.id,
        product_id: productAdsTable.product_id,
        product_name: productsTable.product_name,
        title: productAdsTable.title,
        description: productAdsTable.description,
        banner_image: productAdsTable.banner_image,
        status: productAdsTable.status,
        is_active: productAdsTable.is_active,
        rejection_reason: productAdsTable.rejection_reason,
        ends_at: productAdsTable.ends_at,
      })
      .from(productAdsTable)
      .innerJoin(productsTable, eq(productAdsTable.product_id, productsTable.id))
      .where(eq(productAdsTable.outlet_id, outlet.id))
      .orderBy(desc(productAdsTable.createdAt));

    const schedules = await db
      .select({
        ad_id: productAdsSchedule.productAdsSchedule_id,
        time: scheduleProductAdsTable.time,
      })
      .from(productAdsSchedule)
      .innerJoin(
        scheduleProductAdsTable,
        eq(productAdsSchedule.scheduleProductAdsTable_id, scheduleProductAdsTable.id),
      );

    const scheduleByAdId = new Map<number, { days: Set<string>; hours: Set<string> }>();
    for (const { ad_id, time } of schedules) {
      if (!time) continue;
      const entry = scheduleByAdId.get(ad_id) ?? { days: new Set(), hours: new Set() };
      entry.days.add(time.day);
      entry.hours.add(time.hour);
      scheduleByAdId.set(ad_id, entry);
    }

    const adsOut = ads.map((ad) => {
      const schedule = scheduleByAdId.get(ad.id);
      return {
        ...ad,
        description: ad.description ?? "",
        rejection_reason: ad.rejection_reason ?? null,
        ends_at: ad.ends_at ? ad.ends_at.toISOString() : null,
        schedule_days: schedule ? Array.from(schedule.days) : [],
        schedule_hours: schedule ? Array.from(schedule.hours).sort() : [],
      };
    });

    return reply.send({ outlet: outlet.id, products, ads: adsOut });
  });

  app.post("/api/ads/upload-banner", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, message: "Unauthorized" });

    try {
      const file = await request.file();
      if (!file) return reply.send({ success: false, message: "No image file provided." });

      const buffer = await file.toBuffer();
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const filename = `ad-${uniqueSuffix}.webp`;
      await fs.mkdir(ADS_DIR, { recursive: true });

      await sharp(buffer)
        .resize(1200, 500, { fit: "cover", position: "center" })
        .webp({ quality: 80 })
        .toFile(path.join(ADS_DIR, filename));

      return reply.send({ success: true, imageUrl: `${ADS_URL_PREFIX}${filename}` });
    } catch (error) {
      app.log.error(error, "Failed to upload ad banner");
      return reply.status(500).send({ success: false, message: "Failed to process and upload image." });
    }
  });

  app.post("/api/ads", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, message: "Unauthorized" });

    try {
      const outlet = await getOutletByUserId(session.user.id);
      if (!outlet) return reply.send({ success: false, message: "Outlet not found." });

      const data = request.body as CreateAdInput;
      const days = resolveDays(data.display_as, data.day);
      const hours = resolveHours(data.hour_start, data.hour_end);
      if (days.length === 0 || hours.length === 0) {
        return reply.send({ success: false, message: "Jadwal tampil iklan tidak valid." });
      }

      const starts_at = new Date();
      const ends_at = resolveEndsAt(data.display_as, starts_at, data.duration);

      const [newAd] = await db
        .insert(productAdsTable)
        .values({
          outlet_id: outlet.id,
          product_id: data.product_id,
          title: data.title,
          description: data.description || "",
          banner_image: data.banner_image,
          status: "pending",
          starts_at,
          ends_at,
        })
        .returning({ id: productAdsTable.id });

      const slots = await db.select().from(scheduleProductAdsTable);
      const matchedSlots = slots.filter(
        (slot) => slot.time && days.includes(slot.time.day) && hours.includes(slot.time.hour),
      );

      if (matchedSlots.length > 0) {
        await db.insert(productAdsSchedule).values(
          matchedSlots.map((slot) => ({
            scheduleProductAdsTable_id: slot.id,
            productAdsSchedule_id: newAd.id,
          })),
        );
      }

      return reply.send({ success: true, message: "Ad submitted for review." });
    } catch (error) {
      app.log.error(error, "Failed to create ad");
      return reply.status(500).send({ success: false, message: "Failed to create ad." });
    }
  });

  app.post("/api/ads/toggle-active", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, message: "Unauthorized" });

    try {
      const outlet = await getOutletByUserId(session.user.id);
      if (!outlet) return reply.send({ success: false, message: "Outlet not found." });

      const { adId, isActive } = (request.body as { adId?: number; isActive?: boolean }) ?? {};

      const [ad] = await db
        .select()
        .from(productAdsTable)
        .where(and(eq(productAdsTable.id, adId!), eq(productAdsTable.outlet_id, outlet.id)))
        .limit(1);

      if (!ad) return reply.send({ success: false, message: "Ad not found." });
      if (ad.status !== "approved") return reply.send({ success: false, message: "Ad is not approved yet." });

      await db
        .update(productAdsTable)
        .set({ is_active: !!isActive })
        .where(eq(productAdsTable.id, adId!));

      return reply.send({ success: true });
    } catch (error) {
      app.log.error(error, "Failed to toggle ad");
      return reply.status(500).send({ success: false, message: "Failed to update ad." });
    }
  });

  app.post("/api/ads/delete", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, message: "Unauthorized" });

    try {
      const outlet = await getOutletByUserId(session.user.id);
      if (!outlet) return reply.send({ success: false, message: "Outlet not found." });

      const { adId } = (request.body as { adId?: number }) ?? {};

      const [ad] = await db
        .select()
        .from(productAdsTable)
        .where(and(eq(productAdsTable.id, adId!), eq(productAdsTable.outlet_id, outlet.id)))
        .limit(1);

      if (!ad) return reply.send({ success: false, message: "Ad not found." });

      await unlinkBanner(app, ad.banner_image);
      await db.delete(productAdsSchedule).where(eq(productAdsSchedule.productAdsSchedule_id, adId!));
      await db.delete(productAdsTable).where(eq(productAdsTable.id, adId!));

      return reply.send({ success: true, message: "Ad deleted successfully." });
    } catch (error) {
      app.log.error(error, "Failed to delete ad");
      return reply.status(500).send({ success: false, message: "Failed to delete ad." });
    }
  });

  // --- Admin moderation endpoints ---

  app.post("/api/ads/approve", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, message: "Unauthorized" });
    if (!(await isAdmin(session.user.id))) return reply.status(403).send({ success: false, message: "Forbidden" });

    try {
      const { adId } = (request.body as { adId?: number }) ?? {};
      await db
        .update(productAdsTable)
        .set({ status: "approved", rejection_reason: null })
        .where(eq(productAdsTable.id, adId!));
      return reply.send({ success: true });
    } catch (error) {
      app.log.error(error, "Failed to approve ad");
      return reply.status(500).send({ success: false, message: "Failed to approve ad." });
    }
  });

  app.post("/api/ads/reject", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, message: "Unauthorized" });
    if (!(await isAdmin(session.user.id))) return reply.status(403).send({ success: false, message: "Forbidden" });

    try {
      const { adId, reason } = (request.body as { adId?: number; reason?: string }) ?? {};
      await db
        .update(productAdsTable)
        .set({ status: "rejected", is_active: false, rejection_reason: reason })
        .where(eq(productAdsTable.id, adId!));
      return reply.send({ success: true });
    } catch (error) {
      app.log.error(error, "Failed to reject ad");
      return reply.status(500).send({ success: false, message: "Failed to reject ad." });
    }
  });

  app.post("/api/ads/admin-delete", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, message: "Unauthorized" });
    if (!(await isAdmin(session.user.id))) return reply.status(403).send({ success: false, message: "Forbidden" });

    try {
      const { adId } = (request.body as { adId?: number }) ?? {};

      const [ad] = await db
        .select()
        .from(productAdsTable)
        .where(eq(productAdsTable.id, adId!))
        .limit(1);

      if (!ad) return reply.send({ success: false, message: "Ad not found." });

      await unlinkBanner(app, ad.banner_image);
      await db.delete(productAdsSchedule).where(eq(productAdsSchedule.productAdsSchedule_id, adId!));
      await db.delete(productAdsTable).where(eq(productAdsTable.id, adId!));

      return reply.send({ success: true, message: "Ad deleted successfully." });
    } catch (error) {
      app.log.error(error, "Failed to delete ad");
      return reply.status(500).send({ success: false, message: "Failed to delete ad." });
    }
  });
}
