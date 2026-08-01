/**
 * Seed a courier application, documents included.
 *
 * The ten photos are DRAWN here, not downloaded: synthetic placeholder cards
 * rendered from SVG. That keeps the seed offline and deterministic, and it
 * avoids putting a real person's face into a test fixture — a photo scraped off
 * the web is still somebody's face, and this table exists precisely to hold
 * identity documents.
 *
 * Usage (from apps/backend):
 *   npm run db:seed-courier
 *   npm run db:seed-courier -- --email=kurir2@example.com --status=rejected
 *   npm run db:seed-courier -- --docs=partial      # 6 of 10, mid-application
 *   npm run db:seed-courier -- --docs=none         # bare account, nothing sent
 *
 * Flags:
 *   --email=<addr>    default kurir.seed@example.com
 *   --password=<pw>   default Kurir123!
 *   --name=<name>     default "Kurir Seed"
 *   --plate=<plate>   default "KH 1234 SD"
 *   --status=pending|approved|rejected     default pending
 *   --docs=all|partial|none                default all
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { auth } from "../auth";
import { db } from "./index";
import { courierDocumentsTable, couriersTable, usersTable } from "./schema";
import {
  COURIER_DOCUMENT_GROUPS,
  type CourierDocumentKind,
} from "../lib/courier-documents";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "couriers");
const URL_PREFIX = "/uploads/couriers/";

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const EMAIL = arg("email", "kurir.seed@example.com");
const PASSWORD = arg("password", "Kurir123!");
const NAME = arg("name", "Kurir Seed");
const PLATE = arg("plate", "KH 1234 SD");
const STATUS = arg("status", "pending") as "pending" | "approved" | "rejected";
const DOCS = arg("docs", "all") as "all" | "partial" | "none";

/* ── Placeholder artwork ─────────────────────────────────────────────────── */

const PALETTE: Record<string, { bg: string; bg2: string; ink: string }> = {
  face: { bg: "#312e81", bg2: "#4f46e5", ink: "#c7d2fe" },
  papers: { bg: "#78350f", bg2: "#b45309", ink: "#fde68a" },
  vehicle: { bg: "#134e4a", bg2: "#0d9488", ink: "#99f6e4" },
};

/**
 * Head-and-shoulders at one of four angles.
 *
 * The features slide across a fixed head and an ear appears on the trailing
 * side, rather than the whole head shifting — nudging the head alone left the
 * three-quarter views almost indistinguishable from the front one, which is
 * useless for spotting a slot rendering the wrong photo.
 */
function faceArt(ink: string, turn: number, showFeatures: boolean): string {
  const eyeL = 300 + turn - 48;
  const eyeR = 300 + turn + 48;
  const ear =
    turn === 0
      ? `<ellipse cx="160" cy="425" rx="20" ry="34" fill="${ink}" opacity="0.9"/>
         <ellipse cx="440" cy="425" rx="20" ry="34" fill="${ink}" opacity="0.9"/>`
      : turn > 0
        ? `<ellipse cx="176" cy="425" rx="22" ry="38" fill="${ink}" opacity="0.95"/>`
        : `<ellipse cx="424" cy="425" rx="22" ry="38" fill="${ink}" opacity="0.95"/>`;

  return `
    <ellipse cx="300" cy="700" rx="190" ry="150" fill="${ink}" opacity="0.55"/>
    ${showFeatures ? ear : ""}
    <circle cx="300" cy="420" r="140" fill="${ink}" opacity="0.75"/>
    ${
      showFeatures
        ? `<circle cx="${eyeL}" cy="400" r="14" fill="#1e1b4b"/>
           <circle cx="${eyeR}" cy="400" r="14" fill="#1e1b4b"/>
           <path d="M ${300 + turn} 415 L ${300 + turn + Math.sign(turn) * 18} 452 L ${300 + turn} 458"
                 stroke="#1e1b4b" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
           <path d="M ${eyeL + 3} 492 Q ${300 + turn} 524 ${eyeR - 3} 492" stroke="#1e1b4b" stroke-width="10" fill="none" stroke-linecap="round"/>`
        : `<path d="M 176 392 Q 300 296 424 392" stroke="#1e1b4b" stroke-width="16" fill="none" opacity="0.65"/>
           <path d="M 246 470 Q 300 500 354 470" stroke="#1e1b4b" stroke-width="10" fill="none" opacity="0.35"/>`
    }`;
}

/** A card with a portrait box and text rules — reads as STNK/SIM at a glance. */
function documentArt(ink: string, heading: string): string {
  return `
    <rect x="90" y="330" width="420" height="270" rx="22" fill="${ink}" opacity="0.9"/>
    <rect x="118" y="368" width="110" height="140" rx="10" fill="#1c1917" opacity="0.45"/>
    <text x="256" y="392" font-family="sans-serif" font-size="26" font-weight="bold" fill="#1c1917">${heading}</text>
    ${[430, 470, 510, 550]
      .map(
        (y, i) =>
          `<rect x="256" y="${y}" width="${230 - i * 34}" height="14" rx="7" fill="#1c1917" opacity="0.45"/>`,
      )
      .join("")}`;
}

/** Two wheels and a body. Enough to tell the four angles apart. */
function vehicleArt(ink: string, label: string): string {
  return `
    <circle cx="190" cy="560" r="76" fill="none" stroke="${ink}" stroke-width="20"/>
    <circle cx="420" cy="560" r="76" fill="none" stroke="${ink}" stroke-width="20"/>
    <path d="M 190 560 L 268 440 L 400 440 L 420 560" fill="none" stroke="${ink}" stroke-width="20" stroke-linejoin="round"/>
    <rect x="248" y="392" width="130" height="46" rx="10" fill="${ink}" opacity="0.85"/>
    <rect x="212" y="648" width="186" height="54" rx="8" fill="#f8fafc"/>
    <text x="305" y="686" font-family="sans-serif" font-size="30" font-weight="bold" fill="#0f172a" text-anchor="middle">${label}</text>`;
}

function slotSvg(groupId: string, kind: string, label: string, title: string): string {
  const { bg, bg2, ink } = PALETTE[groupId];

  const art =
    groupId === "face"
      ? faceArt(
          ink,
          kind === "face_right" ? 34 : kind === "face_left" ? -34 : 0,
          kind !== "face_back",
        )
      : groupId === "papers"
        ? documentArt(ink, kind === "stnk" ? "STNK" : "SIM C")
        : vehicleArt(ink, PLATE);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${bg2}"/>
        <stop offset="100%" stop-color="${bg}"/>
      </linearGradient>
    </defs>
    <rect width="600" height="800" fill="url(#g)"/>
    ${art}
    <text x="300" y="112" font-family="sans-serif" font-size="34" font-weight="bold" fill="#ffffff" text-anchor="middle">${title}</text>
    <text x="300" y="158" font-family="sans-serif" font-size="26" fill="${ink}" text-anchor="middle">${label}</text>
    <text x="300" y="762" font-family="sans-serif" font-size="20" font-weight="bold" fill="#ffffff" opacity="0.65" text-anchor="middle">DATA CONTOH — SEED</text>
  </svg>`;
}

/* ── Seed ────────────────────────────────────────────────────────────────── */

async function findOrCreateUser(): Promise<string> {
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, EMAIL))
    .limit(1);

  if (existing) {
    console.log(`• user ${EMAIL} already exists, reusing`);
    return existing.id;
  }

  const res = await auth.api.signUpEmail({
    body: { email: EMAIL, password: PASSWORD, name: NAME },
  });
  // Sign-in is gated on a verified address app-wide, so a seeded account that
  // can't log in would be useless. Marked verified directly rather than firing
  // a real email at an example.com address nobody reads.
  await db
    .update(usersTable)
    .set({ emailVerified: true })
    .where(eq(usersTable.id, res.user.id));

  console.log(`• created user ${EMAIL}`);
  return res.user.id;
}

async function main() {
  if (!["pending", "approved", "rejected"].includes(STATUS)) {
    throw new Error(`--status must be pending, approved or rejected (got "${STATUS}")`);
  }
  if (!["all", "partial", "none"].includes(DOCS)) {
    throw new Error(`--docs must be all, partial or none (got "${DOCS}")`);
  }

  const userId = await findOrCreateUser();

  let [courier] = await db
    .select({ id: couriersTable.id })
    .from(couriersTable)
    .where(eq(couriersTable.user_id, userId))
    .limit(1);

  if (!courier) {
    [courier] = await db
      .insert(couriersTable)
      .values({
        user_id: userId,
        vehicle_plate: PLATE,
        vehicle_type: "motorcycle",
        verification_status: STATUS,
        verification_note:
          STATUS === "rejected"
            ? "Foto wajah tampak kiri masih memakai topi, dan foto STNK buram."
            : null,
      })
      .returning({ id: couriersTable.id });
    console.log(`• created courier #${courier.id} (${STATUS})`);
  } else {
    await db
      .update(couriersTable)
      .set({
        verification_status: STATUS,
        verification_note:
          STATUS === "rejected"
            ? "Foto wajah tampak kiri masih memakai topi, dan foto STNK buram."
            : null,
      })
      .where(eq(couriersTable.id, courier.id));
    console.log(`• courier #${courier.id} already existed, status set to ${STATUS}`);
  }

  if (DOCS === "none") {
    console.log("• skipping documents (--docs=none)");
  } else {
    const slots = COURIER_DOCUMENT_GROUPS.flatMap((g) =>
      g.kinds.map((k) => ({ ...k, groupId: g.id, groupTitle: g.title })),
    );
    // "partial" leaves an application visibly mid-flight, which is the state
    // worth eyeballing: the admin screen has to show what's still missing and
    // refuse approval, and that path is easy to get wrong.
    const wanted = DOCS === "partial" ? slots.slice(0, 6) : slots;

    await fs.mkdir(UPLOAD_DIR, { recursive: true });

    for (const slot of wanted) {
      const filename = `courier-${courier.id}-${slot.kind}-seed.webp`;
      const svg = slotSvg(slot.groupId, slot.kind, slot.label, slot.groupTitle);

      await sharp(Buffer.from(svg)).webp({ quality: 85 }).toFile(path.join(UPLOAD_DIR, filename));

      const image = `${URL_PREFIX}${filename}`;
      await db
        .insert(courierDocumentsTable)
        .values({ courier_id: courier.id, kind: slot.kind as CourierDocumentKind, image })
        .onConflictDoUpdate({
          target: [courierDocumentsTable.courier_id, courierDocumentsTable.kind],
          set: { image, updatedAt: new Date() },
        });
    }
    console.log(`• wrote ${wanted.length} document photo(s) to uploads/couriers/`);
  }

  console.log("\n✅ Done. Log in as the courier:");
  console.log(`   email    ${EMAIL}`);
  console.log(`   password ${PASSWORD}`);
  console.log("   page     /dashboard/courier-verification");
  console.log("   admin    /dashboard/admin/courier → shield icon\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
