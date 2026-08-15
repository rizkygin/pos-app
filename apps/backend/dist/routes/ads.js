"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adRoutes = adRoutes;
const drizzle_orm_1 = require("drizzle-orm");
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = __importDefault(require("node:fs/promises"));
const sharp_1 = __importDefault(require("sharp"));
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../auth");
const web_headers_1 = require("../lib/web-headers");
const outlet_id_1 = require("../lib/outlet-id");
const UPLOADS_ROOT = node_path_1.default.join(process.cwd(), "uploads");
const ADS_DIR = node_path_1.default.join(UPLOADS_ROOT, "ads");
const ADS_URL_PREFIX = "/uploads/ads/";
const WEEKEND_DAYS = ["saturday", "sunday"];
const WEEKDAY_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];
function resolveDays(display_as, day) {
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
function resolveHours(hour_start, hour_end) {
    const start = Number(hour_start);
    const end = Number(hour_end);
    const hours = [];
    for (let h = start; h <= end; h++) {
        hours.push(String(h).padStart(2, "0"));
    }
    return hours;
}
function resolveEndsAt(display_as, starts_at, duration) {
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
async function isAdmin(userId) {
    const [admin] = await db_1.db
        .select({ id: schema_1.adminsTable.id })
        .from(schema_1.adminsTable)
        .where((0, drizzle_orm_1.eq)(schema_1.adminsTable.user_id, userId))
        .limit(1);
    return !!admin;
}
// Best-effort delete of a backend-served banner file (legacy /ads/ live in the
// frontend public dir and can't be reached from here).
async function unlinkBanner(app, banner_image) {
    if (!banner_image?.startsWith(ADS_URL_PREFIX))
        return;
    const filename = banner_image.slice(ADS_URL_PREFIX.length);
    const filePath = node_path_1.default.join(ADS_DIR, filename);
    if (!filePath.startsWith(ADS_DIR + node_path_1.default.sep))
        return;
    try {
        await promises_1.default.unlink(filePath);
    }
    catch (err) {
        app.log.error(err, "Failed to delete banner file");
    }
}
async function adRoutes(app) {
    // --- Owner endpoints ---
    // Composed payload for the promote page: the outlet's promotable products +
    // its ads, each with their schedule days/hours aggregated. { outlet: null }
    // when the caller has no outlet.
    app.get("/api/ads/mine", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false });
        const outlet = await (0, outlet_id_1.getOutletByUserId)(session.user.id);
        if (!outlet)
            return reply.send({ outlet: null, products: [], ads: [] });
        const products = await db_1.db
            .select({
            id: schema_1.productsTable.id,
            product_name: schema_1.productsTable.product_name,
            image: schema_1.productsTable.image,
        })
            .from(schema_1.productsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, outlet.id), (0, drizzle_orm_1.isNull)(schema_1.productsTable.deletedAt)));
        const ads = await db_1.db
            .select({
            id: schema_1.productAdsTable.id,
            product_id: schema_1.productAdsTable.product_id,
            product_name: schema_1.productsTable.product_name,
            title: schema_1.productAdsTable.title,
            description: schema_1.productAdsTable.description,
            banner_image: schema_1.productAdsTable.banner_image,
            status: schema_1.productAdsTable.status,
            is_active: schema_1.productAdsTable.is_active,
            rejection_reason: schema_1.productAdsTable.rejection_reason,
            ends_at: schema_1.productAdsTable.ends_at,
        })
            .from(schema_1.productAdsTable)
            .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.productAdsTable.product_id, schema_1.productsTable.id))
            .where((0, drizzle_orm_1.eq)(schema_1.productAdsTable.outlet_id, outlet.id))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.productAdsTable.createdAt));
        const schedules = await db_1.db
            .select({
            ad_id: schema_1.productAdsSchedule.productAdsSchedule_id,
            time: schema_1.scheduleProductAdsTable.time,
        })
            .from(schema_1.productAdsSchedule)
            .innerJoin(schema_1.scheduleProductAdsTable, (0, drizzle_orm_1.eq)(schema_1.productAdsSchedule.scheduleProductAdsTable_id, schema_1.scheduleProductAdsTable.id));
        const scheduleByAdId = new Map();
        for (const { ad_id, time } of schedules) {
            if (!time)
                continue;
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
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, message: "Unauthorized" });
        try {
            const file = await request.file();
            if (!file)
                return reply.send({ success: false, message: "No image file provided." });
            const buffer = await file.toBuffer();
            const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
            const filename = `ad-${uniqueSuffix}.webp`;
            await promises_1.default.mkdir(ADS_DIR, { recursive: true });
            await (0, sharp_1.default)(buffer)
                .resize(1200, 500, { fit: "cover", position: "center" })
                .webp({ quality: 80 })
                .toFile(node_path_1.default.join(ADS_DIR, filename));
            return reply.send({ success: true, imageUrl: `${ADS_URL_PREFIX}${filename}` });
        }
        catch (error) {
            app.log.error(error, "Failed to upload ad banner");
            return reply.status(500).send({ success: false, message: "Failed to process and upload image." });
        }
    });
    app.post("/api/ads", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, message: "Unauthorized" });
        try {
            const outlet = await (0, outlet_id_1.getOutletByUserId)(session.user.id);
            if (!outlet)
                return reply.send({ success: false, message: "Outlet not found." });
            const data = request.body;
            const days = resolveDays(data.display_as, data.day);
            const hours = resolveHours(data.hour_start, data.hour_end);
            if (days.length === 0 || hours.length === 0) {
                return reply.send({ success: false, message: "Jadwal tampil iklan tidak valid." });
            }
            const starts_at = new Date();
            const ends_at = resolveEndsAt(data.display_as, starts_at, data.duration);
            const [newAd] = await db_1.db
                .insert(schema_1.productAdsTable)
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
                .returning({ id: schema_1.productAdsTable.id });
            const slots = await db_1.db.select().from(schema_1.scheduleProductAdsTable);
            const matchedSlots = slots.filter((slot) => slot.time && days.includes(slot.time.day) && hours.includes(slot.time.hour));
            if (matchedSlots.length > 0) {
                await db_1.db.insert(schema_1.productAdsSchedule).values(matchedSlots.map((slot) => ({
                    scheduleProductAdsTable_id: slot.id,
                    productAdsSchedule_id: newAd.id,
                })));
            }
            return reply.send({ success: true, message: "Ad submitted for review." });
        }
        catch (error) {
            app.log.error(error, "Failed to create ad");
            return reply.status(500).send({ success: false, message: "Failed to create ad." });
        }
    });
    app.post("/api/ads/toggle-active", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, message: "Unauthorized" });
        try {
            const outlet = await (0, outlet_id_1.getOutletByUserId)(session.user.id);
            if (!outlet)
                return reply.send({ success: false, message: "Outlet not found." });
            const { adId, isActive } = request.body ?? {};
            const [ad] = await db_1.db
                .select()
                .from(schema_1.productAdsTable)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productAdsTable.id, adId), (0, drizzle_orm_1.eq)(schema_1.productAdsTable.outlet_id, outlet.id)))
                .limit(1);
            if (!ad)
                return reply.send({ success: false, message: "Ad not found." });
            if (ad.status !== "approved")
                return reply.send({ success: false, message: "Ad is not approved yet." });
            await db_1.db
                .update(schema_1.productAdsTable)
                .set({ is_active: !!isActive })
                .where((0, drizzle_orm_1.eq)(schema_1.productAdsTable.id, adId));
            return reply.send({ success: true });
        }
        catch (error) {
            app.log.error(error, "Failed to toggle ad");
            return reply.status(500).send({ success: false, message: "Failed to update ad." });
        }
    });
    app.post("/api/ads/delete", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, message: "Unauthorized" });
        try {
            const outlet = await (0, outlet_id_1.getOutletByUserId)(session.user.id);
            if (!outlet)
                return reply.send({ success: false, message: "Outlet not found." });
            const { adId } = request.body ?? {};
            const [ad] = await db_1.db
                .select()
                .from(schema_1.productAdsTable)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.productAdsTable.id, adId), (0, drizzle_orm_1.eq)(schema_1.productAdsTable.outlet_id, outlet.id)))
                .limit(1);
            if (!ad)
                return reply.send({ success: false, message: "Ad not found." });
            await unlinkBanner(app, ad.banner_image);
            await db_1.db.delete(schema_1.productAdsSchedule).where((0, drizzle_orm_1.eq)(schema_1.productAdsSchedule.productAdsSchedule_id, adId));
            await db_1.db.delete(schema_1.productAdsTable).where((0, drizzle_orm_1.eq)(schema_1.productAdsTable.id, adId));
            return reply.send({ success: true, message: "Ad deleted successfully." });
        }
        catch (error) {
            app.log.error(error, "Failed to delete ad");
            return reply.status(500).send({ success: false, message: "Failed to delete ad." });
        }
    });
    // --- Admin moderation endpoints ---
    app.post("/api/ads/approve", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, message: "Unauthorized" });
        if (!(await isAdmin(session.user.id)))
            return reply.status(403).send({ success: false, message: "Forbidden" });
        try {
            const { adId } = request.body ?? {};
            await db_1.db
                .update(schema_1.productAdsTable)
                .set({ status: "approved", rejection_reason: null })
                .where((0, drizzle_orm_1.eq)(schema_1.productAdsTable.id, adId));
            return reply.send({ success: true });
        }
        catch (error) {
            app.log.error(error, "Failed to approve ad");
            return reply.status(500).send({ success: false, message: "Failed to approve ad." });
        }
    });
    app.post("/api/ads/reject", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, message: "Unauthorized" });
        if (!(await isAdmin(session.user.id)))
            return reply.status(403).send({ success: false, message: "Forbidden" });
        try {
            const { adId, reason } = request.body ?? {};
            await db_1.db
                .update(schema_1.productAdsTable)
                .set({ status: "rejected", is_active: false, rejection_reason: reason })
                .where((0, drizzle_orm_1.eq)(schema_1.productAdsTable.id, adId));
            return reply.send({ success: true });
        }
        catch (error) {
            app.log.error(error, "Failed to reject ad");
            return reply.status(500).send({ success: false, message: "Failed to reject ad." });
        }
    });
    app.post("/api/ads/admin-delete", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, message: "Unauthorized" });
        if (!(await isAdmin(session.user.id)))
            return reply.status(403).send({ success: false, message: "Forbidden" });
        try {
            const { adId } = request.body ?? {};
            const [ad] = await db_1.db
                .select()
                .from(schema_1.productAdsTable)
                .where((0, drizzle_orm_1.eq)(schema_1.productAdsTable.id, adId))
                .limit(1);
            if (!ad)
                return reply.send({ success: false, message: "Ad not found." });
            await unlinkBanner(app, ad.banner_image);
            await db_1.db.delete(schema_1.productAdsSchedule).where((0, drizzle_orm_1.eq)(schema_1.productAdsSchedule.productAdsSchedule_id, adId));
            await db_1.db.delete(schema_1.productAdsTable).where((0, drizzle_orm_1.eq)(schema_1.productAdsTable.id, adId));
            return reply.send({ success: true, message: "Ad deleted successfully." });
        }
        catch (error) {
            app.log.error(error, "Failed to delete ad");
            return reply.status(500).send({ success: false, message: "Failed to delete ad." });
        }
    });
}
