"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.locationRoutes = locationRoutes;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../auth");
const web_headers_1 = require("../lib/web-headers");
const coords_1 = require("../lib/utils/coords");
async function locationRoutes(app) {
    app.get("/api/locations", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, error: "Unauthorized" });
        const rows = await db_1.db
            .select({
            id: schema_1.locationsTable.id,
            label: schema_1.locationsTable.label,
            address: schema_1.locationsTable.address,
            lat: schema_1.locationsTable.lat,
            lon: schema_1.locationsTable.lon,
            note: schema_1.locationsTable.note,
            is_default: schema_1.locationsTable.is_default,
        })
            .from(schema_1.locationsTable)
            .where((0, drizzle_orm_1.eq)(schema_1.locationsTable.user_id, session.user.id))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.locationsTable.is_default));
        return reply.send({ success: true, data: rows });
    });
    app.get("/api/locations/exists", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ exists: false });
        const rows = await db_1.db
            .select({ id: schema_1.locationsTable.id })
            .from(schema_1.locationsTable)
            .where((0, drizzle_orm_1.eq)(schema_1.locationsTable.user_id, session.user.id))
            .limit(1);
        return reply.send({ exists: rows.length > 0 });
    });
    app.post("/api/locations", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, message: "Unauthorized" });
        try {
            const data = request.body;
            // A delivery address the courier can't navigate to is not worth storing.
            // '' and the literal "NaN" both used to pass straight into the notNull
            // varchar and come back as NaN, crashing the customer's map picker.
            const coords = (0, coords_1.parseCoordPair)(data.lat, data.lon);
            if (!coords)
                return reply
                    .status(400)
                    .send({ success: false, message: "Titik lokasi alamat tidak valid." });
            const existing = await db_1.db
                .select({ id: schema_1.locationsTable.id })
                .from(schema_1.locationsTable)
                .where((0, drizzle_orm_1.eq)(schema_1.locationsTable.user_id, session.user.id))
                .limit(1);
            await db_1.db.insert(schema_1.locationsTable).values({
                user_id: session.user.id,
                label: data.label,
                address: data.address,
                lat: String(coords.lat),
                lon: String(coords.lon),
                note: data.note ?? "",
                is_default: existing.length === 0,
            });
            return reply.send({ success: true, message: "Alamat berhasil ditambahkan." });
        }
        catch {
            return reply.status(500).send({ success: false, message: "Gagal menambahkan alamat." });
        }
    });
    app.post("/api/locations/update", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, message: "Unauthorized" });
        try {
            const { id, data } = request.body;
            const coords = (0, coords_1.parseCoordPair)(data.lat, data.lon);
            if (!coords)
                return reply
                    .status(400)
                    .send({ success: false, message: "Titik lokasi alamat tidak valid." });
            await db_1.db
                .update(schema_1.locationsTable)
                .set({
                label: data.label,
                address: data.address,
                lat: String(coords.lat),
                lon: String(coords.lon),
                note: data.note ?? "",
            })
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.locationsTable.id, id), (0, drizzle_orm_1.eq)(schema_1.locationsTable.user_id, session.user.id)));
            return reply.send({ success: true, message: "Alamat berhasil diperbarui." });
        }
        catch {
            return reply.status(500).send({ success: false, message: "Gagal memperbarui alamat." });
        }
    });
    app.post("/api/locations/delete", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, message: "Unauthorized" });
        try {
            const { id } = request.body;
            const all = await db_1.db
                .select({ id: schema_1.locationsTable.id })
                .from(schema_1.locationsTable)
                .where((0, drizzle_orm_1.eq)(schema_1.locationsTable.user_id, session.user.id));
            if (all.length <= 1) {
                return reply.send({ success: false, message: "Kamu harus memiliki minimal satu alamat." });
            }
            const deleted = await db_1.db
                .delete(schema_1.locationsTable)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.locationsTable.id, id), (0, drizzle_orm_1.eq)(schema_1.locationsTable.user_id, session.user.id)))
                .returning({ is_default: schema_1.locationsTable.is_default });
            if (deleted[0]?.is_default) {
                const first = all.find((r) => r.id !== id);
                if (first) {
                    await db_1.db
                        .update(schema_1.locationsTable)
                        .set({ is_default: true })
                        .where((0, drizzle_orm_1.eq)(schema_1.locationsTable.id, first.id));
                }
            }
            return reply.send({ success: true, message: "Alamat berhasil dihapus." });
        }
        catch {
            return reply.status(500).send({ success: false, message: "Gagal menghapus alamat." });
        }
    });
    app.post("/api/locations/set-default", async (request, reply) => {
        const session = await auth_1.auth.api.getSession({ headers: (0, web_headers_1.toWebHeaders)(request.headers) });
        if (!session?.user)
            return reply.status(401).send({ success: false, message: "Unauthorized" });
        try {
            const { id } = request.body;
            await db_1.db.transaction(async (tx) => {
                await tx
                    .update(schema_1.locationsTable)
                    .set({ is_default: false })
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.locationsTable.user_id, session.user.id), (0, drizzle_orm_1.ne)(schema_1.locationsTable.id, id)));
                await tx
                    .update(schema_1.locationsTable)
                    .set({ is_default: true })
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.locationsTable.id, id), (0, drizzle_orm_1.eq)(schema_1.locationsTable.user_id, session.user.id)));
            });
            return reply.send({ success: true, message: "Alamat utama berhasil diubah." });
        }
        catch {
            return reply.status(500).send({ success: false, message: "Gagal mengubah alamat utama." });
        }
    });
}
