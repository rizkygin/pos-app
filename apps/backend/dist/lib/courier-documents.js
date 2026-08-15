"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COURIER_DOCUMENT_GROUPS = exports.COURIER_DOCUMENT_KINDS = void 0;
exports.courierDocumentLabel = courierDocumentLabel;
exports.isCourierDocumentKind = isCourierDocumentKind;
exports.getCourierDocuments = getCourierDocuments;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
/**
 * Every photo an applicant must produce, in the order they're asked for.
 *
 * The labels are the applicant-facing wording and live here rather than in the
 * frontend so the admin screen, the upload screen and the "what's missing"
 * message can never describe the same slot three different ways.
 */
exports.COURIER_DOCUMENT_KINDS = [
    "face_front",
    "face_right",
    "face_left",
    "face_back",
    "stnk",
    "sim_c",
    "vehicle_front",
    "vehicle_right",
    "vehicle_left",
    "vehicle_back",
];
exports.COURIER_DOCUMENT_GROUPS = [
    {
        id: "face",
        title: "Foto Wajah",
        note: "Tanpa kacamata, tanpa topi, dan tanpa aksesori lain yang menutupi wajah. Rambut disisir rapi.",
        kinds: [
            { kind: "face_front", label: "Tampak Depan" },
            { kind: "face_right", label: "Tampak Kanan" },
            { kind: "face_left", label: "Tampak Kiri" },
            { kind: "face_back", label: "Tampak Belakang" },
        ],
    },
    {
        id: "papers",
        title: "Dokumen",
        note: "Pastikan seluruh bagian dokumen terlihat, tidak terpotong, dan tulisannya terbaca.",
        kinds: [
            { kind: "stnk", label: "STNK" },
            { kind: "sim_c", label: "SIM C" },
        ],
    },
    {
        id: "vehicle",
        title: "Foto Kendaraan",
        note: "Ambil dari empat sisi, dengan plat nomor terlihat jelas.",
        kinds: [
            { kind: "vehicle_front", label: "Tampak Depan" },
            { kind: "vehicle_right", label: "Tampak Kanan" },
            { kind: "vehicle_left", label: "Tampak Kiri" },
            { kind: "vehicle_back", label: "Tampak Belakang" },
        ],
    },
];
const KIND_LABEL = new Map(exports.COURIER_DOCUMENT_GROUPS.flatMap((g) => g.kinds.map((k) => [k.kind, `${g.title} — ${k.label}`])));
function courierDocumentLabel(kind) {
    return KIND_LABEL.get(kind) ?? kind;
}
function isCourierDocumentKind(value) {
    return typeof value === "string" && exports.COURIER_DOCUMENT_KINDS.includes(value);
}
/**
 * What this courier has uploaded so far, keyed by slot, plus what's still
 * missing. Shared by the applicant's own screen and the admin review screen so
 * both agree on when an application is actually reviewable.
 */
async function getCourierDocuments(courierId) {
    const rows = await db_1.db
        .select({
        kind: schema_1.courierDocumentsTable.kind,
        image: schema_1.courierDocumentsTable.image,
        updatedAt: schema_1.courierDocumentsTable.updatedAt,
        createdAt: schema_1.courierDocumentsTable.createdAt,
    })
        .from(schema_1.courierDocumentsTable)
        .where((0, drizzle_orm_1.eq)(schema_1.courierDocumentsTable.courier_id, courierId));
    const documents = {};
    for (const row of rows) {
        documents[row.kind] = { image: row.image, uploadedAt: row.updatedAt ?? row.createdAt };
    }
    const missing = exports.COURIER_DOCUMENT_KINDS.filter((kind) => !documents[kind]);
    return { documents, missing, complete: missing.length === 0 };
}
