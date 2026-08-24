"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRoutes = adminRoutes;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const sharp_1 = __importDefault(require("sharp"));
const drizzle_orm_1 = require("drizzle-orm");
const pg_core_1 = require("drizzle-orm/pg-core");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const OFFLINE_CUSTOMER_EMAIL = "rizkygin1@gmail.com";
const auth_1 = require("../auth");
const web_headers_1 = require("../lib/web-headers");
const order_scope_1 = require("../lib/order-scope");
const courier_availability_1 = require("../lib/utils/courier-availability");
const courier_documents_1 = require("../lib/courier-documents");
// Same folder the applicant's own uploads land in (routes/courier.ts) — one
// place on disk for everything attached to a courier.
const COURIER_UPLOAD_DIR = node_path_1.default.join(process.cwd(), "uploads", "couriers");
const COURIER_UPLOAD_URL_PREFIX = "/uploads/couriers/";
const service_area_1 = require("../lib/service-area");
const coords_1 = require("../lib/utils/coords");
async function requireAdmin(userId) {
    const [admin] = await db_1.db
        .select({ id: schema_1.adminsTable.id })
        .from(schema_1.adminsTable)
        .where((0, drizzle_orm_1.eq)(schema_1.adminsTable.user_id, userId))
        .limit(1);
    return !!admin;
}
function formatTimeSlot(slot) {
    const day = slot.day.charAt(0).toUpperCase() + slot.day.slice(1);
    return `${day} ${slot.hour}:00`;
}
async function adminRoutes(app) {
    app.get("/api/admin/ads", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        const isAdmin = await requireAdmin(session.user.id);
        if (!isAdmin)
            return reply.status(403).send({ success: false, error: "Forbidden" });
        const { page = "1", limit = "10", status = "" } = request.query;
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.max(1, Number(limit) || 10);
        const offset = (pageNum - 1) * limitNum;
        const conditions = [];
        if (status === "pending" || status === "approved" || status === "rejected") {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.productAdsTable.status, status));
        }
        const where = conditions.length ? (0, drizzle_orm_1.and)(...conditions) : undefined;
        const [rows, countRows] = await Promise.all([
            db_1.db
                .select({
                id: schema_1.productAdsTable.id,
                title: schema_1.productAdsTable.title,
                description: schema_1.productAdsTable.description,
                banner_image: schema_1.productAdsTable.banner_image,
                status: schema_1.productAdsTable.status,
                is_active: schema_1.productAdsTable.is_active,
                rejection_reason: schema_1.productAdsTable.rejection_reason,
                outlet_id: schema_1.productAdsTable.outlet_id,
                outlet_name: schema_1.outletsTable.name,
                product_id: schema_1.productAdsTable.product_id,
                product_name: schema_1.productsTable.product_name,
                starts_at: schema_1.productAdsTable.starts_at,
                ends_at: schema_1.productAdsTable.ends_at,
            })
                .from(schema_1.productAdsTable)
                .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.productAdsTable.outlet_id, schema_1.outletsTable.id))
                .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.productAdsTable.product_id, schema_1.productsTable.id))
                .where(where)
                .orderBy((0, drizzle_orm_1.desc)(schema_1.productAdsTable.createdAt))
                .limit(limitNum)
                .offset(offset),
            db_1.db.select({ total: (0, drizzle_orm_1.count)() }).from(schema_1.productAdsTable).where(where),
        ]);
        const adIds = rows.map((row) => row.id);
        const scheduleRows = adIds.length
            ? await db_1.db
                .select({
                adId: schema_1.productAdsSchedule.productAdsSchedule_id,
                time: schema_1.scheduleProductAdsTable.time,
            })
                .from(schema_1.productAdsSchedule)
                .innerJoin(schema_1.scheduleProductAdsTable, (0, drizzle_orm_1.eq)(schema_1.productAdsSchedule.scheduleProductAdsTable_id, schema_1.scheduleProductAdsTable.id))
                .where((0, drizzle_orm_1.inArray)(schema_1.productAdsSchedule.productAdsSchedule_id, adIds))
            : [];
        const scheduleByAd = new Map();
        for (const row of scheduleRows) {
            if (!row.time)
                continue;
            const slots = scheduleByAd.get(row.adId) ?? [];
            slots.push(row.time);
            scheduleByAd.set(row.adId, slots);
        }
        const data = rows.map((row) => {
            const slots = scheduleByAd.get(row.id) ?? [];
            let time_start = null;
            let time_end = null;
            if (slots.length > 0) {
                const sorted = [...slots].sort((a, b) => Number(a.hour) - Number(b.hour));
                time_start = formatTimeSlot(sorted[0]);
                time_end = formatTimeSlot(sorted[sorted.length - 1]);
            }
            return { ...row, time_start, time_end };
        });
        return {
            success: true,
            data,
            count: countRows[0]?.total ?? 0,
        };
    });
    app.get("/api/admin/products", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        const isAdmin = await requireAdmin(session.user.id);
        if (!isAdmin)
            return reply.status(403).send({ success: false, error: "Forbidden" });
        const { page = "1", limit = "10", search = "", outletId = "", minRating = "", minPrice = "", maxPrice = "", sortBy = "", sortOrder = "desc" } = request.query;
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.max(1, Number(limit) || 10);
        const offset = (pageNum - 1) * limitNum;
        const now = new Date();
        const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const trafficSubquery = (since) => (0, drizzle_orm_1.sql) `COALESCE((SELECT SUM(${schema_1.orderDetailsTable.quantity}) FROM ${schema_1.orderDetailsTable} WHERE ${schema_1.orderDetailsTable.product_id} = ${schema_1.productsTable.id} AND ${schema_1.orderDetailsTable.created_at} >= ${since}), 0)`.mapWith(Number);
        const conditions = [(0, drizzle_orm_1.isNull)(schema_1.productsTable.deletedAt)];
        if (search) {
            conditions.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.ilike)(schema_1.productsTable.product_name, `%${search}%`), (0, drizzle_orm_1.ilike)(schema_1.outletsTable.name, `%${search}%`)));
        }
        if (outletId) {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, Number(outletId)));
        }
        if (minRating) {
            conditions.push((0, drizzle_orm_1.sql) `CAST(${schema_1.productsTable.ratings} AS NUMERIC) >= ${Number(minRating)}`);
        }
        if (minPrice) {
            conditions.push((0, drizzle_orm_1.sql) `CAST(${schema_1.productsTable.price} AS NUMERIC) >= ${Number(minPrice)}`);
        }
        if (maxPrice) {
            conditions.push((0, drizzle_orm_1.sql) `CAST(${schema_1.productsTable.price} AS NUMERIC) <= ${Number(maxPrice)}`);
        }
        const where = (0, drizzle_orm_1.and)(...conditions);
        const sortColumns = {
            price: (0, drizzle_orm_1.sql) `CAST(${schema_1.productsTable.price} AS NUMERIC)`,
            rating: (0, drizzle_orm_1.sql) `CAST(${schema_1.productsTable.ratings} AS NUMERIC)`,
            traffic_today: trafficSubquery(dayStart),
            traffic_week: trafficSubquery(weekStart),
            traffic_month: trafficSubquery(monthStart),
        };
        const orderByColumn = sortColumns[sortBy];
        const isSortAsc = sortOrder === "asc";
        const [rows, countRows, outlets] = await Promise.all([
            db_1.db
                .select({
                id: schema_1.productsTable.id,
                product_name: schema_1.productsTable.product_name,
                image: schema_1.productsTable.image,
                category: schema_1.productsTable.category,
                price: schema_1.productsTable.price,
                price_mark_down: schema_1.productsTable.price_mark_down,
                ratings: schema_1.productsTable.ratings,
                review_count: schema_1.productsTable.review_count,
                is_recommended: schema_1.productsTable.is_recommended,
                outlet_id: schema_1.productsTable.outlet_id,
                outlet_name: schema_1.outletsTable.name,
                traffic_today: trafficSubquery(dayStart),
                traffic_week: trafficSubquery(weekStart),
                traffic_month: trafficSubquery(monthStart),
            })
                .from(schema_1.productsTable)
                .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, schema_1.outletsTable.id))
                .where(where)
                .orderBy(orderByColumn ? (isSortAsc ? (0, drizzle_orm_1.asc)(orderByColumn) : (0, drizzle_orm_1.desc)(orderByColumn)) : (0, drizzle_orm_1.desc)(schema_1.productsTable.createdAt))
                .limit(limitNum)
                .offset(offset),
            db_1.db.select({ total: (0, drizzle_orm_1.count)() }).from(schema_1.productsTable).innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.productsTable.outlet_id, schema_1.outletsTable.id)).where(where),
            db_1.db.select({ id: schema_1.outletsTable.id, name: schema_1.outletsTable.name }).from(schema_1.outletsTable),
        ]);
        return {
            success: true,
            data: rows,
            count: countRows[0]?.total ?? 0,
            outlets,
        };
    });
    app.get("/api/admin/outlets", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        const isAdmin = await requireAdmin(session.user.id);
        if (!isAdmin)
            return reply.status(403).send({ success: false, error: "Forbidden" });
        const { page = "1", limit = "10", search = "", is_open = "", minRating = "", features = "", sortBy = "", sortOrder = "desc" } = request.query;
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.max(1, Number(limit) || 10);
        const offset = (pageNum - 1) * limitNum;
        const conditions = [(0, drizzle_orm_1.isNull)(schema_1.outletsTable.deletedAt)];
        if (search) {
            conditions.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.ilike)(schema_1.outletsTable.name, `%${search}%`), (0, drizzle_orm_1.ilike)(schema_1.outletsTable.address, `%${search}%`), (0, drizzle_orm_1.ilike)(schema_1.outletsTable.email, `%${search}%`), (0, drizzle_orm_1.ilike)(schema_1.outletsTable.phone, `%${search}%`)));
        }
        if (is_open === "true") {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.outletsTable.is_open, true));
        }
        else if (is_open === "false") {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.outletsTable.is_open, false));
        }
        if (minRating) {
            conditions.push((0, drizzle_orm_1.gte)((0, drizzle_orm_1.sql) `CAST(${schema_1.outletsTable.ratings} AS NUMERIC)`, Number(minRating)));
        }
        if (features) {
            const slugs = features.split(",").filter(Boolean);
            if (slugs.length > 0) {
                conditions.push((0, drizzle_orm_1.sql) `${schema_1.outletsTable.features} @> ARRAY[${drizzle_orm_1.sql.join(slugs.map((s) => (0, drizzle_orm_1.sql) `${s}`), (0, drizzle_orm_1.sql) `, `)}]::text[]`);
            }
        }
        const where = (0, drizzle_orm_1.and)(...conditions);
        const sortMap = {
            name: schema_1.outletsTable.name,
            ratings: (0, drizzle_orm_1.sql) `CAST(${schema_1.outletsTable.ratings} AS NUMERIC)`,
            review_count: schema_1.outletsTable.review_count,
            created_at: schema_1.outletsTable.createdAt,
        };
        const orderByCol = sortMap[sortBy];
        const isSortAsc = sortOrder === "asc";
        const [rows, countRows] = await Promise.all([
            db_1.db
                .select({
                id: schema_1.outletsTable.id,
                name: schema_1.outletsTable.name,
                phone: schema_1.outletsTable.phone,
                email: schema_1.outletsTable.email,
                address: schema_1.outletsTable.address,
                avatar: schema_1.outletsTable.avatar,
                ratings: schema_1.outletsTable.ratings,
                review_count: schema_1.outletsTable.review_count,
                is_open: schema_1.outletsTable.is_open,
                tags: schema_1.outletsTable.tags,
                features: schema_1.outletsTable.features,
                created_at: schema_1.outletsTable.createdAt,
            })
                .from(schema_1.outletsTable)
                .where(where)
                .orderBy(orderByCol ? (isSortAsc ? (0, drizzle_orm_1.asc)(orderByCol) : (0, drizzle_orm_1.desc)(orderByCol)) : (0, drizzle_orm_1.desc)(schema_1.outletsTable.createdAt))
                .limit(limitNum)
                .offset(offset),
            db_1.db.select({ total: (0, drizzle_orm_1.count)() }).from(schema_1.outletsTable).where(where),
        ]);
        return {
            success: true,
            data: rows,
            count: countRows[0]?.total ?? 0,
        };
    });
    app.get("/api/admin/product-ratings", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        const isAdmin = await requireAdmin(session.user.id);
        if (!isAdmin)
            return reply.status(403).send({ success: false, error: "Forbidden" });
        const { productId = "" } = request.query;
        if (!productId)
            return reply.status(400).send({ success: false, error: "productId is required" });
        const where = (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.ratingsTable.product_id, productId), (0, drizzle_orm_1.eq)(schema_1.ratingsTable.reciepent_as, "product"));
        const [rows, countRows] = await Promise.all([
            db_1.db
                .select({
                id: schema_1.ratingsTable.id,
                rating: schema_1.ratingsTable.ratings,
                comment: schema_1.ratingsTable.comment,
                created_at: schema_1.ratingsTable.createdAt,
                reviewer_name: schema_1.usersTable.name,
            })
                .from(schema_1.ratingsTable)
                .leftJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.ratingsTable.reviewer, schema_1.usersTable.id))
                .where(where)
                .orderBy((0, drizzle_orm_1.desc)(schema_1.ratingsTable.createdAt))
                .limit(25),
            db_1.db.select({ total: (0, drizzle_orm_1.count)() }).from(schema_1.ratingsTable).where(where),
        ]);
        const data = rows.map((r) => ({
            id: r.id,
            rating: Number(r.rating) || 5,
            comment: r.comment ?? "",
            created_at: r.created_at,
            reviewer_name: r.reviewer_name ?? "Anonim",
        }));
        const average = data.length > 0 ? data.reduce((acc, r) => acc + r.rating, 0) / data.length : 0;
        return {
            success: true,
            data,
            total: countRows[0]?.total ?? 0,
            average,
        };
    });
    // Toggle a product's recommended flag
    app.post("/api/admin/set-recommended", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, message: "Unauthorized" });
        const isAdmin = await requireAdmin(session.user.id);
        if (!isAdmin)
            return reply.status(403).send({ success: false, message: "Forbidden" });
        try {
            const { productId, isRecommended } = request.body ?? {};
            if (!productId)
                return reply.status(400).send({ success: false, message: "productId is required" });
            await db_1.db
                .update(schema_1.productsTable)
                .set({ is_recommended: !!isRecommended })
                .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, productId));
            return reply.send({ success: true });
        }
        catch (error) {
            app.log.error(error, "Failed to update recommended status");
            return reply.status(500).send({ success: false, message: "Failed to update recommended status." });
        }
    });
    // Admin edits a product's core fields
    app.post("/api/admin/update-product", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, message: "Unauthorized" });
        const isAdmin = await requireAdmin(session.user.id);
        if (!isAdmin)
            return reply.status(403).send({ success: false, message: "Forbidden" });
        try {
            const { productId, data } = request.body ?? {};
            if (!productId || !data) {
                return reply.status(400).send({ success: false, message: "productId and data are required" });
            }
            await db_1.db
                .update(schema_1.productsTable)
                .set({
                product_name: data.product_name,
                price: data.price,
                price_mark_down: data.price_mark_down,
                category: data.category,
                description: data.description,
            })
                .where((0, drizzle_orm_1.eq)(schema_1.productsTable.id, productId));
            return reply.send({ success: true, message: "Product updated successfully." });
        }
        catch (error) {
            app.log.error(error, "Failed to update product");
            return reply.status(500).send({ success: false, message: "Failed to update product." });
        }
    });
    // ---- Manage Courier ----
    app.get("/api/admin/couriers", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        if (!(await requireAdmin(session.user.id)))
            return reply.status(403).send({ success: false, error: "Forbidden" });
        const { page = "1", limit = "10", search = "", sortBy = "", sortOrder = "desc" } = request.query;
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.max(1, Number(limit) || 10);
        const offset = (pageNum - 1) * limitNum;
        const conditions = [(0, drizzle_orm_1.isNull)(schema_1.couriersTable.deletedAt)];
        if (search) {
            conditions.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.ilike)(schema_1.usersTable.name, `%${search}%`), (0, drizzle_orm_1.ilike)(schema_1.usersTable.email, `%${search}%`), (0, drizzle_orm_1.ilike)(schema_1.couriersTable.vehicle_plate, `%${search}%`)));
        }
        const where = (0, drizzle_orm_1.and)(...conditions);
        const sortMap = {
            ratings: (0, drizzle_orm_1.sql) `CAST(${schema_1.couriersTable.ratings} AS NUMERIC)`,
            review_count: schema_1.couriersTable.review_count,
            created_at: schema_1.couriersTable.createdAt,
        };
        const orderByCol = sortMap[sortBy];
        const isSortAsc = sortOrder === "asc";
        const [data, countRows] = await Promise.all([
            db_1.db
                .select({
                id: schema_1.couriersTable.id,
                user_id: schema_1.couriersTable.user_id,
                name: schema_1.usersTable.name,
                email: schema_1.usersTable.email,
                phone: schema_1.usersTable.phone,
                avatar: schema_1.couriersTable.avatar,
                vehicle_plate: schema_1.couriersTable.vehicle_plate,
                vehicle_type: schema_1.couriersTable.vehicle_type,
                ratings: schema_1.couriersTable.ratings,
                review_count: schema_1.couriersTable.review_count,
                created_at: schema_1.couriersTable.createdAt,
                verification_status: schema_1.couriersTable.verification_status,
                verification_note: schema_1.couriersTable.verification_note,
                verified_at: schema_1.couriersTable.verified_at,
                // How far along the application is, so the table can show "6/10"
                // without a second request per row.
                document_count: (0, drizzle_orm_1.sql) `(
            SELECT COUNT(*)::int FROM ${schema_1.courierDocumentsTable}
            WHERE ${schema_1.courierDocumentsTable.courier_id} = ${schema_1.couriersTable.id}
          )`,
            })
                .from(schema_1.couriersTable)
                .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, schema_1.usersTable.id))
                .where(where)
                .orderBy(orderByCol ? (isSortAsc ? (0, drizzle_orm_1.asc)(orderByCol) : (0, drizzle_orm_1.desc)(orderByCol)) : (0, drizzle_orm_1.desc)(schema_1.couriersTable.createdAt))
                .limit(limitNum)
                .offset(offset),
            db_1.db.select({ total: (0, drizzle_orm_1.count)() }).from(schema_1.couriersTable).innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, schema_1.usersTable.id)).where(where),
        ]);
        return { success: true, data, count: countRows[0]?.total ?? 0 };
    });
    app.post("/api/admin/couriers/update", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        if (!(await requireAdmin(session.user.id)))
            return reply.status(403).send({ success: false, error: "Forbidden" });
        const { id, vehicle_plate, vehicle_type } = request.body;
        if (!id)
            return reply.status(400).send({ success: false, message: "id is required" });
        await db_1.db
            .update(schema_1.couriersTable)
            .set({
            ...(vehicle_plate !== undefined && { vehicle_plate }),
            ...(vehicle_type !== undefined && { vehicle_type }),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.id, id));
        return reply.send({ success: true, message: "Courier updated." });
    });
    // ---- Courier verification ----
    /** Everything an admin needs to judge one application, on one screen. */
    app.get("/api/admin/couriers/:id/verification", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        if (!(await requireAdmin(session.user.id)))
            return reply.status(403).send({ success: false, error: "Forbidden" });
        const id = Number(request.params.id);
        if (!id)
            return reply.status(400).send({ success: false, error: "id tidak valid" });
        const [courier] = await db_1.db
            .select({
            id: schema_1.couriersTable.id,
            user_id: schema_1.couriersTable.user_id,
            name: schema_1.usersTable.name,
            email: schema_1.usersTable.email,
            phone: schema_1.usersTable.phone,
            avatar: schema_1.couriersTable.avatar,
            vehicle_plate: schema_1.couriersTable.vehicle_plate,
            vehicle_type: schema_1.couriersTable.vehicle_type,
            verification_status: schema_1.couriersTable.verification_status,
            verification_note: schema_1.couriersTable.verification_note,
            verified_at: schema_1.couriersTable.verified_at,
            created_at: schema_1.couriersTable.createdAt,
        })
            .from(schema_1.couriersTable)
            .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, schema_1.usersTable.id))
            .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.id, id))
            .limit(1);
        if (!courier)
            return reply.status(404).send({ success: false, error: "Kurir tidak ditemukan" });
        const { documents, missing, complete } = await (0, courier_documents_1.getCourierDocuments)(id);
        return reply.send({
            success: true,
            courier,
            documents,
            missing,
            complete,
            groups: courier_documents_1.COURIER_DOCUMENT_GROUPS,
        });
    });
    /**
     * The verdict.
     *
     * Approving with slots still empty is refused: "yes" is supposed to mean an
     * admin looked at all ten photographs, and an application that can be waved
     * through half-finished makes the whole checklist decorative. Rejecting is
     * allowed at any point — you don't need the vehicle shots to know the face
     * photo is somebody in a motorcycle helmet.
     */
    app.post("/api/admin/couriers/:id/verify", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        if (!(await requireAdmin(session.user.id)))
            return reply.status(403).send({ success: false, error: "Forbidden" });
        const id = Number(request.params.id);
        const { approve, note } = request.body ?? {};
        if (!id)
            return reply.status(400).send({ success: false, error: "id tidak valid" });
        if (typeof approve !== "boolean") {
            return reply.status(400).send({ success: false, error: "approve wajib true atau false" });
        }
        const [courier] = await db_1.db
            .select({ id: schema_1.couriersTable.id })
            .from(schema_1.couriersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.id, id))
            .limit(1);
        if (!courier)
            return reply.status(404).send({ success: false, error: "Kurir tidak ditemukan" });
        if (approve) {
            const { missing } = await (0, courier_documents_1.getCourierDocuments)(id);
            if (missing.length > 0) {
                return reply.status(409).send({
                    success: false,
                    error: `Dokumen belum lengkap: ${missing.map(courier_documents_1.courierDocumentLabel).join(", ")}`,
                    missing,
                });
            }
        }
        else if (!note?.trim()) {
            // A rejection the applicant can't act on just produces the same photos
            // again, so the reason is required rather than optional.
            return reply
                .status(400)
                .send({ success: false, error: "Alasan penolakan wajib diisi" });
        }
        await db_1.db
            .update(schema_1.couriersTable)
            .set({
            verification_status: approve ? "approved" : "rejected",
            verification_note: approve ? null : note.trim().slice(0, 500),
            verified_at: new Date(),
            verified_by: session.user.id,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.id, id));
        // A rejected courier mid-shift stops being offered work immediately;
        // getCourierAvailability already refuses them, and closing the session makes
        // the app agree with that instead of showing them as online.
        if (!approve) {
            await db_1.db
                .update(schema_1.courierSessionsTable)
                .set({ ended_at: courier_availability_1.cappedShiftEnd })
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.courierSessionsTable.courier_id, id), (0, drizzle_orm_1.isNull)(schema_1.courierSessionsTable.ended_at)));
        }
        return reply.send({ success: true, status: approve ? "approved" : "rejected" });
    });
    /**
     * Admin replaces one of the courier's document photos.
     *
     * Exists for retouching, not for fabricating a submission: the intended use is
     * an admin cleaning up the background of a face shot so the courier looks
     * presentable to customers. That's why it works after approval too — the
     * courier's own upload route is closed once they're verified, and the tidying
     * usually happens exactly then.
     *
     * Whatever is replaced is gone: the old file is deleted, and the slot's
     * unique constraint means there is one current answer per angle. An admin who
     * replaces a document is changing the record, so this is an admin-only route
     * and stays out of the courier's hands.
     */
    app.post("/api/admin/couriers/:id/documents", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        if (!(await requireAdmin(session.user.id)))
            return reply.status(403).send({ success: false, error: "Forbidden" });
        const id = Number(request.params.id);
        if (!id)
            return reply.status(400).send({ success: false, error: "id tidak valid" });
        const [courier] = await db_1.db
            .select({ id: schema_1.couriersTable.id, avatar: schema_1.couriersTable.avatar })
            .from(schema_1.couriersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.id, id))
            .limit(1);
        if (!courier)
            return reply.status(404).send({ success: false, error: "Kurir tidak ditemukan" });
        const file = await request.file();
        if (!file)
            return reply.status(400).send({ success: false, error: "Foto wajib diunggah" });
        const kindField = file.fields?.kind;
        const kind = typeof kindField?.value === "string" ? kindField.value : "";
        if (!(0, courier_documents_1.isCourierDocumentKind)(kind)) {
            return reply.status(400).send({ success: false, error: "Jenis dokumen tidak dikenal" });
        }
        // `setAvatar` on the same request, because replacing the front face shot to
        // clean up its background and then having to click again to actually use it
        // is two steps for one intention.
        const setAvatarField = file.fields
            ?.setAvatar;
        const setAvatar = setAvatarField?.value === "true";
        const buffer = await file.toBuffer();
        const filename = `courier-${id}-${kind}-admin-${Date.now()}.webp`;
        await promises_1.default.mkdir(COURIER_UPLOAD_DIR, { recursive: true });
        await (0, sharp_1.default)(buffer)
            .rotate()
            .resize(1400, 1400, { fit: "inside", withoutEnlargement: true })
            .webp({ quality: 82 })
            .toFile(node_path_1.default.join(COURIER_UPLOAD_DIR, filename));
        const image = `${COURIER_UPLOAD_URL_PREFIX}${filename}`;
        const [previous] = await db_1.db
            .select({ image: schema_1.courierDocumentsTable.image })
            .from(schema_1.courierDocumentsTable)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.courierDocumentsTable.courier_id, id), (0, drizzle_orm_1.eq)(schema_1.courierDocumentsTable.kind, kind)))
            .limit(1);
        await db_1.db
            .insert(schema_1.courierDocumentsTable)
            .values({ courier_id: id, kind, image })
            .onConflictDoUpdate({
            target: [schema_1.courierDocumentsTable.courier_id, schema_1.courierDocumentsTable.kind],
            set: { image, updatedAt: new Date() },
        });
        if (setAvatar) {
            await db_1.db.update(schema_1.couriersTable).set({ avatar: image }).where((0, drizzle_orm_1.eq)(schema_1.couriersTable.id, id));
        }
        // Same rule as the courier's own upload: the replaced file goes, unless the
        // avatar is still pointing at it.
        if (previous && previous.image !== image && courier.avatar !== previous.image) {
            await promises_1.default
                .rm(node_path_1.default.join(process.cwd(), previous.image.replace(/^\//, "")), { force: true })
                .catch(() => { });
        }
        const { documents, missing, complete } = await (0, courier_documents_1.getCourierDocuments)(id);
        return reply.send({ success: true, image, documents, missing, complete });
    });
    /**
     * Replace the courier's avatar — the photo a customer sees on a live delivery.
     *
     * Two ways in, because an admin normally wants one of the face shots that was
     * just approved (`fromDocument`), and occasionally a file of their own
     * (multipart). Writes couriers.avatar only: users.image is the person's own
     * account picture and isn't the platform's to overwrite.
     */
    app.post("/api/admin/couriers/:id/avatar", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        if (!(await requireAdmin(session.user.id)))
            return reply.status(403).send({ success: false, error: "Forbidden" });
        const id = Number(request.params.id);
        if (!id)
            return reply.status(400).send({ success: false, error: "id tidak valid" });
        const [courier] = await db_1.db
            .select({ id: schema_1.couriersTable.id })
            .from(schema_1.couriersTable)
            .where((0, drizzle_orm_1.eq)(schema_1.couriersTable.id, id))
            .limit(1);
        if (!courier)
            return reply.status(404).send({ success: false, error: "Kurir tidak ditemukan" });
        let avatar = null;
        if (request.isMultipart()) {
            const file = await request.file();
            if (!file)
                return reply.status(400).send({ success: false, error: "Foto wajib diunggah" });
            const buffer = await file.toBuffer();
            const filename = `courier-avatar-${id}-${Date.now()}.webp`;
            await promises_1.default.mkdir(COURIER_UPLOAD_DIR, { recursive: true });
            // Square-cropped: it is rendered in a circle everywhere it appears, and
            // cropping here beats every call site guessing at object-fit.
            await (0, sharp_1.default)(buffer)
                .rotate()
                .resize(512, 512, { fit: "cover" })
                .webp({ quality: 85 })
                .toFile(node_path_1.default.join(COURIER_UPLOAD_DIR, filename));
            avatar = `${COURIER_UPLOAD_URL_PREFIX}${filename}`;
        }
        else {
            const { fromDocument } = request.body ?? {};
            if (!(0, courier_documents_1.isCourierDocumentKind)(fromDocument)) {
                return reply.status(400).send({ success: false, error: "Pilih foto dokumen yang valid" });
            }
            const { documents } = await (0, courier_documents_1.getCourierDocuments)(id);
            const doc = documents[fromDocument];
            if (!doc) {
                return reply.status(404).send({ success: false, error: "Foto tersebut belum diunggah" });
            }
            // Points at the same stored file rather than copying it: the document is
            // already immutable per slot (re-upload writes a new filename), so there
            // is nothing for the avatar to drift away from.
            avatar = doc.image;
        }
        await db_1.db.update(schema_1.couriersTable).set({ avatar }).where((0, drizzle_orm_1.eq)(schema_1.couriersTable.id, id));
        return reply.send({ success: true, avatar });
    });
    app.post("/api/admin/couriers/delete", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        if (!(await requireAdmin(session.user.id)))
            return reply.status(403).send({ success: false, error: "Forbidden" });
        const { id } = request.body;
        if (!id)
            return reply.status(400).send({ success: false, message: "id is required" });
        await db_1.db.update(schema_1.couriersTable).set({ deletedAt: new Date() }).where((0, drizzle_orm_1.eq)(schema_1.couriersTable.id, id));
        return reply.send({ success: true, message: "Courier removed." });
    });
    // ---- Manage Customer ----
    app.get("/api/admin/customers", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        if (!(await requireAdmin(session.user.id)))
            return reply.status(403).send({ success: false, error: "Forbidden" });
        const { page = "1", limit = "10", search = "", sortBy = "", sortOrder = "desc" } = request.query;
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.max(1, Number(limit) || 10);
        const offset = (pageNum - 1) * limitNum;
        const conditions = [(0, drizzle_orm_1.isNull)(schema_1.customersTable.deletedAt)];
        if (search) {
            conditions.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.ilike)(schema_1.usersTable.name, `%${search}%`), (0, drizzle_orm_1.ilike)(schema_1.usersTable.email, `%${search}%`)));
        }
        const where = (0, drizzle_orm_1.and)(...conditions);
        const sortMap = {
            ratings: (0, drizzle_orm_1.sql) `CAST(${schema_1.customersTable.ratings} AS NUMERIC)`,
            review_count: schema_1.customersTable.review_count,
            created_at: schema_1.customersTable.createdAt,
        };
        const orderByCol = sortMap[sortBy];
        const isSortAsc = sortOrder === "asc";
        const [data, countRows] = await Promise.all([
            db_1.db
                .select({
                id: schema_1.customersTable.id,
                user_id: schema_1.customersTable.user_id,
                name: schema_1.usersTable.name,
                email: schema_1.usersTable.email,
                phone: schema_1.usersTable.phone,
                image: schema_1.usersTable.image,
                ratings: schema_1.customersTable.ratings,
                review_count: schema_1.customersTable.review_count,
                created_at: schema_1.customersTable.createdAt,
            })
                .from(schema_1.customersTable)
                .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, schema_1.usersTable.id))
                .where(where)
                .orderBy(orderByCol ? (isSortAsc ? (0, drizzle_orm_1.asc)(orderByCol) : (0, drizzle_orm_1.desc)(orderByCol)) : (0, drizzle_orm_1.desc)(schema_1.customersTable.createdAt))
                .limit(limitNum)
                .offset(offset),
            db_1.db.select({ total: (0, drizzle_orm_1.count)() }).from(schema_1.customersTable).innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, schema_1.usersTable.id)).where(where),
        ]);
        return { success: true, data, count: countRows[0]?.total ?? 0 };
    });
    app.post("/api/admin/customers/delete", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        if (!(await requireAdmin(session.user.id)))
            return reply.status(403).send({ success: false, error: "Forbidden" });
        const { id } = request.body;
        if (!id)
            return reply.status(400).send({ success: false, message: "id is required" });
        await db_1.db.update(schema_1.customersTable).set({ deletedAt: new Date() }).where((0, drizzle_orm_1.eq)(schema_1.customersTable.id, id));
        return reply.send({ success: true, message: "Customer removed." });
    });
    // ---- Manage User ----
    app.get("/api/admin/users", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        if (!(await requireAdmin(session.user.id)))
            return reply.status(403).send({ success: false, error: "Forbidden" });
        const { page = "1", limit = "10", search = "", sortBy = "", sortOrder = "desc" } = request.query;
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.max(1, Number(limit) || 10);
        const offset = (pageNum - 1) * limitNum;
        const conditions = [(0, drizzle_orm_1.isNull)(schema_1.usersTable.deletedAt)];
        if (search) {
            conditions.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.ilike)(schema_1.usersTable.name, `%${search}%`), (0, drizzle_orm_1.ilike)(schema_1.usersTable.email, `%${search}%`), (0, drizzle_orm_1.ilike)(schema_1.usersTable.phone, `%${search}%`)));
        }
        const where = (0, drizzle_orm_1.and)(...conditions);
        const sortMap = {
            name: schema_1.usersTable.name,
            email: schema_1.usersTable.email,
            created_at: schema_1.usersTable.createdAt,
        };
        const orderByCol = sortMap[sortBy];
        const isSortAsc = sortOrder === "asc";
        // Derived role via correlated existence subqueries on the role tables.
        // Use the qualified "users"."id" so it isn't shadowed by the subquery tables.
        const roleExpr = (0, drizzle_orm_1.sql) `
      CASE
        WHEN EXISTS (SELECT 1 FROM admins a WHERE a.user_id = "users"."id") THEN 'admin'
        WHEN EXISTS (SELECT 1 FROM outlets o WHERE o.user_id = "users"."id") THEN 'owner'
        WHEN EXISTS (SELECT 1 FROM couriers c WHERE c.user_id = "users"."id") THEN 'courier'
        WHEN EXISTS (SELECT 1 FROM customers cu WHERE cu.user_id = "users"."id") THEN 'customer'
        ELSE 'none'
      END
    `;
        const [data, countRows] = await Promise.all([
            db_1.db
                .select({
                id: schema_1.usersTable.id,
                name: schema_1.usersTable.name,
                email: schema_1.usersTable.email,
                phone: schema_1.usersTable.phone,
                address: schema_1.usersTable.address,
                image: schema_1.usersTable.image,
                emailVerified: schema_1.usersTable.emailVerified,
                role: roleExpr,
                created_at: schema_1.usersTable.createdAt,
            })
                .from(schema_1.usersTable)
                .where(where)
                .orderBy(orderByCol ? (isSortAsc ? (0, drizzle_orm_1.asc)(orderByCol) : (0, drizzle_orm_1.desc)(orderByCol)) : (0, drizzle_orm_1.desc)(schema_1.usersTable.createdAt))
                .limit(limitNum)
                .offset(offset),
            db_1.db.select({ total: (0, drizzle_orm_1.count)() }).from(schema_1.usersTable).where(where),
        ]);
        return { success: true, data, count: countRows[0]?.total ?? 0 };
    });
    app.post("/api/admin/users/update", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        if (!(await requireAdmin(session.user.id)))
            return reply.status(403).send({ success: false, error: "Forbidden" });
        const { id, name, phone, address } = request.body;
        if (!id)
            return reply.status(400).send({ success: false, message: "id is required" });
        await db_1.db
            .update(schema_1.usersTable)
            .set({
            ...(name !== undefined && { name }),
            ...(phone !== undefined && { phone }),
            ...(address !== undefined && { address }),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.usersTable.id, id));
        return reply.send({ success: true, message: "User updated." });
    });
    app.post("/api/admin/users/delete", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        if (!(await requireAdmin(session.user.id)))
            return reply.status(403).send({ success: false, error: "Forbidden" });
        const { id } = request.body;
        if (!id)
            return reply.status(400).send({ success: false, message: "id is required" });
        await db_1.db.update(schema_1.usersTable).set({ deletedAt: new Date() }).where((0, drizzle_orm_1.eq)(schema_1.usersTable.id, id));
        return reply.send({ success: true, message: "User removed." });
    });
    // ---- Admin dashboard analytics ----
    app.get("/api/admin/dashboard", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        if (!(await requireAdmin(session.user.id)))
            return reply.status(403).send({ success: false, error: "Forbidden" });
        const now = new Date();
        const currentPeriodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const previousPeriodStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
        const subtotalSubquery = (0, drizzle_orm_1.sql) `COALESCE((
      SELECT SUM(CAST(${schema_1.orderDetailsTable.summary_price} AS NUMERIC))
      FROM ${schema_1.orderDetailsTable}
      WHERE ${schema_1.orderDetailsTable.order_id} = ${schema_1.ordersTable.id}
    ), 0)`.mapWith(Number);
        const revenueExpr = (0, drizzle_orm_1.sql) `COALESCE(SUM(
      ${subtotalSubquery} + CAST(COALESCE(${schema_1.ordersTable.delivery_fee}, '0') AS NUMERIC) - CAST(COALESCE(${schema_1.ordersTable.discount_amount}, '0') AS NUMERIC)
    ), 0)`.mapWith(Number);
        const customerUser = (0, pg_core_1.alias)(schema_1.usersTable, "customer_user");
        const courierUser = (0, pg_core_1.alias)(schema_1.usersTable, "courier_user");
        const [[{ total: currentRevenue }], [{ total: previousRevenue }], [{ total: pendingOrdersCount }], [{ total: activeOrdersCount }], [{ total: onlineCouriersCount }], [{ total: totalOutlets }], [{ total: totalCouriers }], [{ total: totalCustomers }], recentOrdersRaw,] = await Promise.all([
            db_1.db
                .select({ total: revenueExpr })
                .from(schema_1.ordersTable)
                .where((0, drizzle_orm_1.and)(order_scope_1.orderNotDeleted, (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "delivered"), (0, drizzle_orm_1.gte)(schema_1.ordersTable.createdAt, currentPeriodStart))),
            db_1.db
                .select({ total: revenueExpr })
                .from(schema_1.ordersTable)
                .where((0, drizzle_orm_1.and)(order_scope_1.orderNotDeleted, (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "delivered"), (0, drizzle_orm_1.gte)(schema_1.ordersTable.createdAt, previousPeriodStart), (0, drizzle_orm_1.lt)(schema_1.ordersTable.createdAt, currentPeriodStart))),
            db_1.db
                .select({ total: (0, drizzle_orm_1.count)() })
                .from(schema_1.ordersTable)
                .where((0, drizzle_orm_1.and)(order_scope_1.orderNotDeleted, (0, drizzle_orm_1.eq)(schema_1.ordersTable.status, "pending"))),
            db_1.db
                .select({ total: (0, drizzle_orm_1.count)() })
                .from(schema_1.ordersTable)
                .where((0, drizzle_orm_1.and)(order_scope_1.orderNotDeleted, (0, drizzle_orm_1.notInArray)(schema_1.ordersTable.status, ["pending", "delivered", "cancelled"]))),
            db_1.db
                .select({ total: (0, drizzle_orm_1.countDistinct)(schema_1.courierSessionsTable.courier_id) })
                .from(schema_1.courierSessionsTable)
                // Abandoned sessions past the 12h cap aren't "online" — without this
                // the couriers-online KPI only ever climbs.
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.isNull)(schema_1.courierSessionsTable.ended_at), (0, drizzle_orm_1.gte)(schema_1.courierSessionsTable.started_at, (0, courier_availability_1.staleShiftCutoff)()))),
            db_1.db.select({ total: (0, drizzle_orm_1.count)() }).from(schema_1.outletsTable).where((0, drizzle_orm_1.isNull)(schema_1.outletsTable.deletedAt)),
            db_1.db.select({ total: (0, drizzle_orm_1.count)() }).from(schema_1.couriersTable).where((0, drizzle_orm_1.isNull)(schema_1.couriersTable.deletedAt)),
            db_1.db.select({ total: (0, drizzle_orm_1.count)() }).from(schema_1.customersTable).where((0, drizzle_orm_1.isNull)(schema_1.customersTable.deletedAt)),
            db_1.db
                .select({
                id: schema_1.ordersTable.id,
                status: schema_1.ordersTable.status,
                delivery_fee: schema_1.ordersTable.delivery_fee,
                discount_amount: schema_1.ordersTable.discount_amount,
                created_at: schema_1.ordersTable.createdAt,
                outlet_name: schema_1.outletsTable.name,
                customer_name: customerUser.name,
                customer_email: customerUser.email,
                subtotal: subtotalSubquery,
            })
                .from(schema_1.ordersTable)
                .innerJoin(schema_1.customersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, schema_1.customersTable.id))
                .innerJoin(customerUser, (0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, customerUser.id))
                .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, schema_1.outletsTable.id))
                .leftJoin(schema_1.couriersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.courier_id, schema_1.couriersTable.id))
                .leftJoin(courierUser, (0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, courierUser.id))
                .where(order_scope_1.orderNotDeleted)
                .orderBy((0, drizzle_orm_1.desc)(schema_1.ordersTable.createdAt))
                .limit(5),
        ]);
        const recentOrders = recentOrdersRaw.map((r) => {
            const deliveryFee = Number(r.delivery_fee ?? 0);
            const discount = Number(r.discount_amount ?? 0);
            return {
                id: r.id,
                status: r.status,
                outlet_name: r.outlet_name,
                customer_name: r.customer_name,
                total_paid: r.subtotal + deliveryFee - discount,
                is_offline: r.customer_email === OFFLINE_CUSTOMER_EMAIL,
            };
        });
        const revenuePercentageChange = previousRevenue > 0
            ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
            : currentRevenue > 0
                ? 100
                : 0;
        return reply.send({
            success: true,
            revenue30Days: currentRevenue,
            revenuePercentageChange,
            pendingOrdersCount,
            activeOrdersCount,
            onlineCouriersCount,
            totalOutlets,
            totalCouriers,
            totalCustomers,
            recentOrders,
        });
    });
    // ---- Manage Order ----
    app.get("/api/admin/orders", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        if (!(await requireAdmin(session.user.id)))
            return reply.status(403).send({ success: false, error: "Forbidden" });
        const ORDER_STATUSES = ["pending", "confirmed", "preparing", "ready", "on_delivery", "delivered", "cancelled"];
        const { page = "1", limit = "10", search = "", status = "", type = "", sortOrder = "desc" } = request.query;
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.max(1, Number(limit) || 10);
        const offset = (pageNum - 1) * limitNum;
        const order = sortOrder === "asc" ? drizzle_orm_1.asc : drizzle_orm_1.desc;
        const customerUser = (0, pg_core_1.alias)(schema_1.usersTable, "customer_user");
        const courierUser = (0, pg_core_1.alias)(schema_1.usersTable, "courier_user");
        const conditions = [order_scope_1.orderNotDeleted];
        if (search) {
            conditions.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.ilike)(schema_1.ordersTable.id, `%${search}%`), (0, drizzle_orm_1.ilike)(customerUser.name, `%${search}%`), (0, drizzle_orm_1.ilike)(schema_1.outletsTable.name, `%${search}%`)));
        }
        if (status && ORDER_STATUSES.includes(status)) {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.ordersTable.status, status));
        }
        if (type === "offline") {
            conditions.push((0, drizzle_orm_1.eq)(customerUser.email, OFFLINE_CUSTOMER_EMAIL));
        }
        else if (type === "online") {
            conditions.push((0, drizzle_orm_1.sql) `${customerUser.email} != ${OFFLINE_CUSTOMER_EMAIL}`);
        }
        const where = conditions.length ? (0, drizzle_orm_1.and)(...conditions) : undefined;
        const subtotalSubquery = (0, drizzle_orm_1.sql) `COALESCE((
      SELECT SUM(CAST(${schema_1.orderDetailsTable.summary_price} AS NUMERIC))
      FROM ${schema_1.orderDetailsTable}
      WHERE ${schema_1.orderDetailsTable.order_id} = ${schema_1.ordersTable.id}
    ), 0)`.mapWith(Number);
        const [rows, [{ total }]] = await Promise.all([
            db_1.db
                .select({
                id: schema_1.ordersTable.id,
                status: schema_1.ordersTable.status,
                delivery_fee: schema_1.ordersTable.delivery_fee,
                discount_amount: schema_1.ordersTable.discount_amount,
                created_at: schema_1.ordersTable.createdAt,
                outlet_name: schema_1.outletsTable.name,
                customer_name: customerUser.name,
                customer_email: customerUser.email,
                courier_name: courierUser.name,
                subtotal: subtotalSubquery,
            })
                .from(schema_1.ordersTable)
                .innerJoin(schema_1.customersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, schema_1.customersTable.id))
                .innerJoin(customerUser, (0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, customerUser.id))
                .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, schema_1.outletsTable.id))
                .leftJoin(schema_1.couriersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.courier_id, schema_1.couriersTable.id))
                .leftJoin(courierUser, (0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, courierUser.id))
                .where(where)
                .orderBy(order(schema_1.ordersTable.createdAt))
                .limit(limitNum)
                .offset(offset),
            db_1.db
                .select({ total: (0, drizzle_orm_1.count)() })
                .from(schema_1.ordersTable)
                .innerJoin(schema_1.customersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, schema_1.customersTable.id))
                .innerJoin(customerUser, (0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, customerUser.id))
                .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, schema_1.outletsTable.id))
                .where(where),
        ]);
        const data = rows.map((r) => {
            const subtotal = r.subtotal;
            const deliveryFee = Number(r.delivery_fee ?? 0);
            const discount = Number(r.discount_amount ?? 0);
            return {
                id: r.id,
                status: r.status,
                outlet_name: r.outlet_name,
                customer_name: r.customer_name,
                courier_name: r.courier_name,
                subtotal,
                delivery_fee: deliveryFee,
                discount_amount: discount,
                total_paid: subtotal + deliveryFee - discount,
                is_offline: r.customer_email === OFFLINE_CUSTOMER_EMAIL,
                created_at: r.created_at,
            };
        });
        return reply.send({ success: true, data, count: total });
    });
    app.get("/api/admin/orders/:id", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        if (!(await requireAdmin(session.user.id)))
            return reply.status(403).send({ success: false, error: "Forbidden" });
        const { id: orderId } = request.params;
        const courierUser = (0, pg_core_1.alias)(schema_1.usersTable, "courier_user");
        const [order] = await db_1.db
            .select({
            id: schema_1.ordersTable.id,
            status: schema_1.ordersTable.status,
            delivery_fee: schema_1.ordersTable.delivery_fee,
            discount_amount: schema_1.ordersTable.discount_amount,
            note: schema_1.ordersTable.note,
            rejected_by: schema_1.ordersTable.rejected_by,
            rejected_reason: schema_1.ordersTable.rejected_reason,
            scheduled_at: schema_1.ordersTable.scheduled_at,
            created_at: schema_1.ordersTable.createdAt,
            updated_at: schema_1.ordersTable.updatedAt,
            outlet_name: schema_1.outletsTable.name,
            outlet_address: schema_1.outletsTable.address,
            outlet_phone: schema_1.outletsTable.phone,
            customer_name: schema_1.usersTable.name,
            customer_email: schema_1.usersTable.email,
            customer_phone: schema_1.usersTable.phone,
            customer_address: schema_1.usersTable.address,
            courier_name: courierUser.name,
            courier_phone: courierUser.phone,
            courier_plate: schema_1.couriersTable.vehicle_plate,
            courier_vehicle: schema_1.couriersTable.vehicle_type,
        })
            .from(schema_1.ordersTable)
            .innerJoin(schema_1.customersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.customer_id, schema_1.customersTable.id))
            .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.customersTable.user_id, schema_1.usersTable.id))
            .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, schema_1.outletsTable.id))
            .leftJoin(schema_1.couriersTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.courier_id, schema_1.couriersTable.id))
            .leftJoin(courierUser, (0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, courierUser.id))
            .where((0, drizzle_orm_1.and)(order_scope_1.orderNotDeleted, (0, drizzle_orm_1.eq)(schema_1.ordersTable.id, orderId)))
            .limit(1);
        if (!order)
            return reply.status(404).send({ success: false, error: "Not found" });
        const items = await db_1.db
            .select({
            detail_id: schema_1.orderDetailsTable.id,
            quantity: schema_1.orderDetailsTable.quantity,
            note: schema_1.orderDetailsTable.note_product,
            summary_price: schema_1.orderDetailsTable.summary_price,
            product_name: schema_1.productsTable.product_name,
            price: schema_1.productsTable.price,
            category: schema_1.productsTable.category,
            unit: schema_1.productsTable.unit,
        })
            .from(schema_1.orderDetailsTable)
            .innerJoin(schema_1.productsTable, (0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.product_id, schema_1.productsTable.id))
            .where((0, drizzle_orm_1.eq)(schema_1.orderDetailsTable.order_id, orderId));
        return reply.send({ success: true, order, items });
    });
    // Courier shift log. Sessions are platform-wide (couriers have no outlet_id),
    // so this is admin-only — an outlet owner has no basis to see a courier's
    // whole working day, only the orders of theirs that courier carried.
    //
    // Returns two lists rather than one paginated feed: "who is on shift right
    // now" is the operational question, and it must not get buried under history.
    /**
     * Who answers dispatch offers, and who lets them run out.
     *
     * Two shapes in one response because they answer two different questions.
     * The per-courier summary is the one that matters for a fairness argument —
     * "this courier ignored 8 of 10 offers" is a conversation; a single ignored
     * offer is a red light or a bad signal. The recent log underneath it is what
     * makes that number checkable rather than something the platform asserts.
     *
     * `expired` and `declined` are kept apart deliberately: declining is
     * answering, and a courier who says no quickly is behaving better than one
     * who lets a customer wait out the clock.
     */
    app.get("/api/admin/courier-offers", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        if (!(await requireAdmin(session.user.id))) {
            return reply.status(403).send({ success: false, error: "Forbidden" });
        }
        const { days = "7", limit = "50", courierId: courierIdRaw, } = request.query;
        const windowDays = Math.min(Math.max(Number(days) || 7, 1), 90);
        const logLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
        const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
        // Narrow to one courier when the admin is investigating a specific person,
        // which is what this page is usually opened for. Both queries below then
        // touch a fraction of the window instead of aggregating every courier.
        const courierId = Number(courierIdRaw);
        const onlyCourier = Number.isInteger(courierId) && courierId > 0 ? courierId : null;
        const scope = onlyCourier
            ? (0, drizzle_orm_1.and)((0, drizzle_orm_1.gte)(schema_1.orderOffersTable.offered_at, since), (0, drizzle_orm_1.eq)(schema_1.orderOffersTable.courier_id, onlyCourier))
            : (0, drizzle_orm_1.gte)(schema_1.orderOffersTable.offered_at, since);
        // Bounds the per-courier table. Rows are already ranked worst-first, so the
        // cut only ever drops couriers the admin scrolled past anyway.
        const SUMMARY_LIMIT = 50;
        const summary = await db_1.db
            .select({
            courierId: schema_1.couriersTable.id,
            name: schema_1.usersTable.name,
            email: schema_1.usersTable.email,
            phone: schema_1.usersTable.phone,
            avatar: schema_1.couriersTable.avatar,
            verificationStatus: schema_1.couriersTable.verification_status,
            ratings: schema_1.couriersTable.ratings,
            offered: (0, drizzle_orm_1.count)(),
            accepted: (0, drizzle_orm_1.sql) `COUNT(*) FILTER (WHERE ${schema_1.orderOffersTable.state} = 'accepted')::int`,
            declined: (0, drizzle_orm_1.sql) `COUNT(*) FILTER (WHERE ${schema_1.orderOffersTable.state} = 'declined')::int`,
            expired: (0, drizzle_orm_1.sql) `COUNT(*) FILTER (WHERE ${schema_1.orderOffersTable.state} = 'expired')::int`,
            superseded: (0, drizzle_orm_1.sql) `COUNT(*) FILTER (WHERE ${schema_1.orderOffersTable.state} = 'superseded')::int`,
            // Seconds to answer, counted only over offers actually answered —
            // averaging in a 30-second timeout would flatter nobody and mislead
            // everybody.
            avgResponseSeconds: (0, drizzle_orm_1.sql) `ROUND(AVG(
          EXTRACT(EPOCH FROM (${schema_1.orderOffersTable.responded_at} - ${schema_1.orderOffersTable.offered_at}))
        ) FILTER (WHERE ${schema_1.orderOffersTable.state} IN ('accepted', 'declined')))::int`,
            lastOfferedAt: (0, drizzle_orm_1.sql) `MAX(${schema_1.orderOffersTable.offered_at})`,
        })
            .from(schema_1.orderOffersTable)
            .innerJoin(schema_1.couriersTable, (0, drizzle_orm_1.eq)(schema_1.orderOffersTable.courier_id, schema_1.couriersTable.id))
            .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, schema_1.usersTable.id))
            .where(scope)
            .groupBy(schema_1.couriersTable.id, schema_1.usersTable.name, schema_1.usersTable.email, schema_1.usersTable.phone)
            // Most ignored first: that is the list an admin opened this page to see.
            .orderBy((0, drizzle_orm_1.desc)((0, drizzle_orm_1.sql) `COUNT(*) FILTER (WHERE ${schema_1.orderOffersTable.state} = 'expired')`), (0, drizzle_orm_1.desc)((0, drizzle_orm_1.count)()))
            .limit(SUMMARY_LIMIT);
        const log = await db_1.db
            .select({
            id: schema_1.orderOffersTable.id,
            orderId: schema_1.orderOffersTable.order_id,
            courierId: schema_1.orderOffersTable.courier_id,
            courierName: schema_1.usersTable.name,
            state: schema_1.orderOffersTable.state,
            round: schema_1.orderOffersTable.round,
            offeredAt: schema_1.orderOffersTable.offered_at,
            respondedAt: schema_1.orderOffersTable.responded_at,
            outletName: schema_1.outletsTable.name,
            deliveryFee: schema_1.ordersTable.delivery_fee,
        })
            .from(schema_1.orderOffersTable)
            .innerJoin(schema_1.couriersTable, (0, drizzle_orm_1.eq)(schema_1.orderOffersTable.courier_id, schema_1.couriersTable.id))
            .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, schema_1.usersTable.id))
            .innerJoin(schema_1.ordersTable, (0, drizzle_orm_1.eq)(schema_1.orderOffersTable.order_id, schema_1.ordersTable.id))
            .innerJoin(schema_1.outletsTable, (0, drizzle_orm_1.eq)(schema_1.ordersTable.outlet_id, schema_1.outletsTable.id))
            .where(scope)
            .orderBy((0, drizzle_orm_1.desc)(schema_1.orderOffersTable.offered_at))
            .limit(logLimit);
        // Aggregated in SQL rather than summed from `summary`: that list is capped
        // at SUMMARY_LIMIT couriers, so folding it would silently under-report the
        // headline figures the moment a 51st courier appears in the window.
        const [totals] = await db_1.db
            .select({
            offered: (0, drizzle_orm_1.count)(),
            accepted: (0, drizzle_orm_1.sql) `COUNT(*) FILTER (WHERE ${schema_1.orderOffersTable.state} = 'accepted')::int`,
            declined: (0, drizzle_orm_1.sql) `COUNT(*) FILTER (WHERE ${schema_1.orderOffersTable.state} = 'declined')::int`,
            expired: (0, drizzle_orm_1.sql) `COUNT(*) FILTER (WHERE ${schema_1.orderOffersTable.state} = 'expired')::int`,
        })
            .from(schema_1.orderOffersTable)
            .where(scope);
        return reply.send({
            success: true,
            windowDays,
            courierId: onlyCourier,
            totals: totals ?? { offered: 0, accepted: 0, declined: 0, expired: 0 },
            couriers: summary,
            log,
        });
    });
    app.get("/api/admin/courier-sessions", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        if (!(await requireAdmin(session.user.id))) {
            return reply.status(403).send({ success: false, error: "Forbidden" });
        }
        const { limit = "50" } = request.query;
        const historyLimit = Math.min(200, Math.max(1, Number(limit) || 50));
        // Tidy overran shifts before reading so the log self-heals: this page is
        // the one place a human looks at session data, and it's not hot enough for
        // the write to matter.
        await (0, courier_availability_1.closeStaleCourierSessions)();
        const baseFields = {
            sessionId: schema_1.courierSessionsTable.id,
            courierId: schema_1.couriersTable.id,
            courierName: schema_1.usersTable.name,
            courierPhone: schema_1.usersTable.phone,
            avatar: schema_1.couriersTable.avatar,
            vehiclePlate: schema_1.couriersTable.vehicle_plate,
            vehicleType: schema_1.couriersTable.vehicle_type,
            startedAt: schema_1.courierSessionsTable.started_at,
            endedAt: schema_1.courierSessionsTable.ended_at,
        };
        const [online, history] = await Promise.all([
            // DISTINCT ON courier: a courier with more than one open row (crashed
            // client, missed go-offline) is still one person on shift, and listing
            // them twice would misreport the headcount. Newest open session wins.
            db_1.db
                .selectDistinctOn([schema_1.courierSessionsTable.courier_id], baseFields)
                .from(schema_1.courierSessionsTable)
                .innerJoin(schema_1.couriersTable, (0, drizzle_orm_1.eq)(schema_1.courierSessionsTable.courier_id, schema_1.couriersTable.id))
                .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, schema_1.usersTable.id))
                .where((0, drizzle_orm_1.isNull)(schema_1.courierSessionsTable.ended_at))
                .orderBy(schema_1.courierSessionsTable.courier_id, (0, drizzle_orm_1.desc)(schema_1.courierSessionsTable.started_at)),
            db_1.db
                .select(baseFields)
                .from(schema_1.courierSessionsTable)
                .innerJoin(schema_1.couriersTable, (0, drizzle_orm_1.eq)(schema_1.courierSessionsTable.courier_id, schema_1.couriersTable.id))
                .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, schema_1.usersTable.id))
                .where((0, drizzle_orm_1.sql) `${schema_1.courierSessionsTable.ended_at} is not null`)
                .orderBy((0, drizzle_orm_1.desc)(schema_1.courierSessionsTable.started_at))
                .limit(historyLimit),
        ]);
        return reply.send({ success: true, online, history });
    });
    /**
     * Every "Tugaskan Kurir" errand on the platform.
     *
     * Errands are outside the platform's accounting — no outlet, no commission,
     * nothing booked — so they never appear in /api/admin/orders, which is built
     * on ordersTable. Without this endpoint the whole feature is invisible to
     * admins: a customer complaint about a courier who took the money and never
     * arrived has no record anywhere an admin can reach.
     *
     * Read-only by design. The negotiation happens on WhatsApp and the lifecycle
     * belongs to the two people in it; an admin watching is not a party to it and
     * has nothing to move.
     */
    app.get("/api/admin/errands", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        if (!(await requireAdmin(session.user.id))) {
            return reply.status(403).send({ success: false, error: "Forbidden" });
        }
        const { limit = "100", status } = request.query;
        const rowLimit = Math.min(300, Math.max(1, Number(limit) || 100));
        // Two joins onto users — the customer and the courier's own user row — so
        // one of them needs an alias or Postgres cannot tell the columns apart.
        const courierUser = (0, pg_core_1.alias)(schema_1.usersTable, "errand_courier_user");
        const statuses = [
            "pending",
            "on_delivery",
            "delivered",
            "cancelled_by_customer",
            "rejected_by_courier",
            "rejected_by_customer",
        ];
        const wanted = statuses.find((s) => s === status);
        const [rows, tallies] = await Promise.all([
            db_1.db
                .select({
                id: schema_1.errandOrdersTable.id,
                status: schema_1.errandOrdersTable.status,
                note: schema_1.errandOrdersTable.note,
                price: schema_1.errandOrdersTable.price,
                rejectedReason: schema_1.errandOrdersTable.rejected_reason,
                destinationAddress: schema_1.errandOrdersTable.destination_address,
                destinationLat: schema_1.errandOrdersTable.destination_lat,
                destinationLon: schema_1.errandOrdersTable.destination_lon,
                createdAt: schema_1.errandOrdersTable.createdAt,
                acceptedAt: schema_1.errandOrdersTable.accepted_at,
                deliveredAt: schema_1.errandOrdersTable.delivered_at,
                customerId: schema_1.usersTable.id,
                customerName: schema_1.usersTable.name,
                customerPhone: schema_1.usersTable.phone,
                courierId: schema_1.couriersTable.id,
                courierName: courierUser.name,
                courierPhone: courierUser.phone,
                courierPlate: schema_1.couriersTable.vehicle_plate,
                courierVehicle: schema_1.couriersTable.vehicle_type,
            })
                .from(schema_1.errandOrdersTable)
                .innerJoin(schema_1.usersTable, (0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.user_id, schema_1.usersTable.id))
                .innerJoin(schema_1.couriersTable, (0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.courier_id, schema_1.couriersTable.id))
                .innerJoin(courierUser, (0, drizzle_orm_1.eq)(schema_1.couriersTable.user_id, courierUser.id))
                .where(wanted ? (0, drizzle_orm_1.eq)(schema_1.errandOrdersTable.status, wanted) : undefined)
                .orderBy((0, drizzle_orm_1.desc)(schema_1.errandOrdersTable.createdAt))
                .limit(rowLimit),
            // Counted over the whole table, not the returned page: the tab badges
            // must not shrink as the row limit trims the list.
            db_1.db
                .select({
                status: schema_1.errandOrdersTable.status,
                total: (0, drizzle_orm_1.count)(),
            })
                .from(schema_1.errandOrdersTable)
                .groupBy(schema_1.errandOrdersTable.status),
        ]);
        const counts = Object.fromEntries(statuses.map((s) => [s, tallies.find((t) => t.status === s)?.total ?? 0]));
        return reply.send({ success: true, errands: rows, counts });
    });
    /**
     * Courier coverage area — the circle admins draw on the map.
     *
     * Also returns every outlet's position so the map can show which ones fall
     * inside and which are stranded. Moving the centre has real consequences for
     * existing outlets, and an admin should be able to see them before saving
     * rather than discovering them through support tickets.
     */
    app.get("/api/admin/service-area", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false });
        if (!(await requireAdmin(session.user.id)))
            return reply.status(403).send({ success: false, error: "Admin only" });
        const area = await (0, service_area_1.getServiceArea)();
        const outlets = await db_1.db
            .select({
            id: schema_1.outletsTable.id,
            name: schema_1.outletsTable.name,
            lat: schema_1.outletsTable.lat,
            lon: schema_1.outletsTable.lon,
            isOpen: schema_1.outletsTable.is_open,
            reachable: schema_1.outletsTable.courier_reachable,
        })
            .from(schema_1.outletsTable)
            .where((0, drizzle_orm_1.isNull)(schema_1.outletsTable.deletedAt));
        return reply.send({
            success: true,
            area,
            outlets: outlets
                .map((o) => {
                const coords = (0, coords_1.parseCoordPair)(o.lat, o.lon);
                return coords
                    ? { id: o.id, name: o.name, isOpen: o.isOpen, reachable: o.reachable, ...coords }
                    : null;
            })
                // Outlets with unusable coordinates simply can't be plotted. Dropped
                // rather than defaulted, so the map never invents a position.
                .filter((o) => o !== null),
        });
    });
    app.put("/api/admin/service-area", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false });
        if (!(await requireAdmin(session.user.id)))
            return reply.status(403).send({ success: false, error: "Admin only" });
        const body = (request.body ?? {});
        const coords = (0, coords_1.parseCoordPair)(body.lat, body.lon);
        if (!coords) {
            return reply.status(400).send({ success: false, error: "Titik pusat tidak valid" });
        }
        const radiusKm = Number(body.radiusKm ?? 50);
        if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 500) {
            return reply.status(400).send({ success: false, error: "Radius harus antara 1 dan 500 km" });
        }
        // Insert, not update: each change is a new row, so the centre's history is
        // preserved and getServiceArea() reads the newest.
        await db_1.db.insert(schema_1.serviceAreaTable).values({
            center_lat: String(coords.lat),
            center_lon: String(coords.lon),
            radius_km: Math.round(radiusKm),
            updated_by: session.user.id,
        });
        // Moving the circle changes who is inside it, so every outlet is
        // re-evaluated here. Doing it at save time — rather than lazily — means the
        // admin finds out immediately how many outlets they just affected, instead
        // of it surfacing days later as a support ticket.
        const changed = await (0, service_area_1.recomputeCourierReachable)();
        return reply.send({ success: true, area: await (0, service_area_1.getServiceArea)(), changed });
    });
    /**
     * Manual override of a single outlet's reachability.
     *
     * The circle is an approximation of where couriers actually go. When it
     * disagrees with reality — a shop just past the line that a courier passes
     * anyway — an admin should be able to correct that one outlet without
     * reshaping the geometry for everyone else.
     *
     * Note this is overwritten the next time the service area is saved, since
     * that recomputes every outlet from the circle. Deliberate: the geometry is
     * the rule, and an override is a patch on top of the current rule, not a
     * permanent exemption from future ones.
     */
    app.put("/api/admin/outlet/:outletId/reachable", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false });
        if (!(await requireAdmin(session.user.id)))
            return reply.status(403).send({ success: false, error: "Admin only" });
        const { outletId } = request.params;
        const id = Number(outletId);
        if (!Number.isInteger(id)) {
            return reply.status(400).send({ success: false, error: "outletId tidak valid" });
        }
        const reachable = request.body?.reachable;
        if (typeof reachable !== "boolean") {
            return reply.status(400).send({ success: false, error: "reachable harus true/false" });
        }
        const updated = await db_1.db
            .update(schema_1.outletsTable)
            .set({ courier_reachable: reachable })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.outletsTable.id, id), (0, drizzle_orm_1.isNull)(schema_1.outletsTable.deletedAt)))
            .returning({ id: schema_1.outletsTable.id });
        if (updated.length === 0)
            return reply.status(404).send({ success: false, error: "Outlet tidak ditemukan" });
        return reply.send({ success: true, reachable });
    });
}
