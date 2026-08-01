import { eq } from "drizzle-orm";
import { db } from "../db";
import { courierDocumentsTable } from "../db/schema";

/**
 * Every photo an applicant must produce, in the order they're asked for.
 *
 * The labels are the applicant-facing wording and live here rather than in the
 * frontend so the admin screen, the upload screen and the "what's missing"
 * message can never describe the same slot three different ways.
 */
export const COURIER_DOCUMENT_KINDS = [
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
] as const;

export type CourierDocumentKind = (typeof COURIER_DOCUMENT_KINDS)[number];

export const COURIER_DOCUMENT_GROUPS: {
  id: string;
  title: string;
  note: string;
  kinds: { kind: CourierDocumentKind; label: string }[];
}[] = [
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

const KIND_LABEL = new Map<string, string>(
  COURIER_DOCUMENT_GROUPS.flatMap((g) =>
    g.kinds.map((k) => [k.kind, `${g.title} — ${k.label}`] as const),
  ),
);

export function courierDocumentLabel(kind: string): string {
  return KIND_LABEL.get(kind) ?? kind;
}

export function isCourierDocumentKind(value: unknown): value is CourierDocumentKind {
  return typeof value === "string" && (COURIER_DOCUMENT_KINDS as readonly string[]).includes(value);
}

/**
 * What this courier has uploaded so far, keyed by slot, plus what's still
 * missing. Shared by the applicant's own screen and the admin review screen so
 * both agree on when an application is actually reviewable.
 */
export async function getCourierDocuments(courierId: number) {
  const rows = await db
    .select({
      kind: courierDocumentsTable.kind,
      image: courierDocumentsTable.image,
      updatedAt: courierDocumentsTable.updatedAt,
      createdAt: courierDocumentsTable.createdAt,
    })
    .from(courierDocumentsTable)
    .where(eq(courierDocumentsTable.courier_id, courierId));

  const documents: Record<string, { image: string; uploadedAt: Date }> = {};
  for (const row of rows) {
    documents[row.kind] = { image: row.image, uploadedAt: row.updatedAt ?? row.createdAt };
  }

  const missing = COURIER_DOCUMENT_KINDS.filter((kind) => !documents[kind]);

  return { documents, missing, complete: missing.length === 0 };
}
