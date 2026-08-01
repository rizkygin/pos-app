import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  courierDocumentsTable,
  couriersTable,
  courierSessionsTable,
  ordersTable,
} from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { cappedShiftEnd, getCourierAvailability } from "../lib/utils/courier-availability";
import { parseCoordPair } from "../lib/utils/coords";
import {
  COURIER_DOCUMENT_GROUPS,
  getCourierDocuments,
  isCourierDocumentKind,
} from "../lib/courier-documents";
import { mayAcceptOrder, respondToOffer, supersedeOffers } from "../lib/dispatch";

const DOCUMENT_DIR = path.join(process.cwd(), "uploads", "couriers");
const DOCUMENT_URL_PREFIX = "/uploads/couriers/";

async function getCourierId(userId: string) {
  const [courier] = await db
    .select({ id: couriersTable.id })
    .from(couriersTable)
    .where(eq(couriersTable.user_id, userId))
    .limit(1);
  return courier?.id ?? null;
}

async function getCourierRow(userId: string) {
  const [courier] = await db
    .select({
      id: couriersTable.id,
      status: couriersTable.verification_status,
      note: couriersTable.verification_note,
      verifiedAt: couriersTable.verified_at,
    })
    .from(couriersTable)
    .where(eq(couriersTable.user_id, userId))
    .limit(1);
  return courier ?? null;
}

// Wording is shared by go-online and accept-order: whichever the courier tries
// first, they get the same reason and the same place to fix it.
const NOT_APPROVED_MESSAGE =
  "Akun kurir pian belum diverifikasi admin. Lengkapi dokumen di halaman Verifikasi Kurir dulu.";

async function closeOpenSessions(courierId: number) {
  await db
    .update(courierSessionsTable)
    // Capped, not plain now(): go-online closes any dangling session, so a
    // courier who forgot to go offline a week ago would otherwise have that
    // abandoned session stamped with today's date and recorded as a week-long
    // shift. This is how a real 665-hour row got created.
    .set({ ended_at: cappedShiftEnd })
    .where(
      and(
        eq(courierSessionsTable.courier_id, courierId),
        isNull(courierSessionsTable.ended_at),
      ),
    );
}

export async function courierRoutes(app: FastifyInstance) {
  app.post("/api/courier/go-online", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const courier = await getCourierRow(session.user.id);
    if (!courier) return reply.status(403).send({ success: false, error: "Not a courier" });

    // The gate lives here rather than only in the UI: going online is what makes
    // a courier eligible for orders, so an unverified account must not be able
    // to reach it by calling the endpoint directly.
    if (courier.status !== "approved") {
      return reply
        .status(403)
        .send({ success: false, error: NOT_APPROVED_MESSAGE, verificationStatus: courier.status });
    }
    const courierId = courier.id;

    // Close any dangling open session first, then open a new one
    await closeOpenSessions(courierId);
    await db.insert(courierSessionsTable).values({ courier_id: courierId });

    return reply.send({ success: true });
  });

  app.post("/api/courier/go-offline", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const courierId = await getCourierId(session.user.id);
    if (!courierId) return reply.status(403).send({ success: false, error: "Not a courier" });

    await closeOpenSessions(courierId);

    // Off shift means no deliveries in flight, so the stored position has no
    // remaining purpose. Clearing it here rather than trusting the client to
    // call /location/clear: a courier who closes the app or loses signal never
    // sends that request, and their last position would sit in the row.
    await db
      .update(couriersTable)
      .set({ last_lat: null, last_lon: null, last_location_at: null })
      .where(eq(couriersTable.id, courierId));

    return reply.send({ success: true });
  });

  app.post("/api/courier/accept-order", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const courier = await getCourierRow(session.user.id);
    if (!courier) return reply.status(403).send({ success: false, error: "Not a courier" });
    // Belt and braces with the go-online gate above: an approval can be revoked
    // while a courier is already online, and that must stop the next order being
    // claimed rather than waiting for them to go offline.
    if (courier.status !== "approved") {
      return reply
        .status(403)
        .send({ success: false, error: NOT_APPROVED_MESSAGE, verificationStatus: courier.status });
    }
    const courierId = courier.id;

    const { orderId } = (request.body as { orderId?: string }) ?? {};
    if (!orderId) return reply.status(400).send({ success: false, error: "orderId wajib diisi" });

    const availability = await getCourierAvailability(courierId);
    if (!availability.isOnline) {
      return reply.status(400).send({ success: false, error: "Kamu harus online untuk menerima order" });
    }
    if (availability.hasActiveOrder) {
      return reply
        .status(400)
        .send({ success: false, error: "Selesaikan pesanan aktif kamu sebelum menerima order baru" });
    }

    // Dispatch gate. Either this courier holds the live offer, or the order has
    // fallen through to the open pool where the old first-come rule still
    // applies. Without this, a courier could accept an order that was offered to
    // someone else by calling the endpoint directly — which is the race this
    // whole change removes.
    if (!(await mayAcceptOrder(courierId, orderId))) {
      return reply
        .status(409)
        .send({ success: false, error: "Order ini sedang ditawarkan ke kurir lain" });
    }

    const updated = await db
      .update(ordersTable)
      .set({ courier_id: courierId, status: "preparing", updatedAt: new Date() })
      .where(
        and(
          eq(ordersTable.id, orderId),
          eq(ordersTable.status, "confirmed"),
          isNull(ordersTable.courier_id),
          // Service and materials orders are courier-less by design; a courier
          // must never claim one. Positive filter, so new lanes stay excluded
          // unless someone deliberately adds them.
          eq(ordersTable.fulfillment, "delivery"),
        ),
      )
      .returning({ id: ordersTable.id });

    if (updated.length === 0) {
      return reply.status(409).send({ success: false, error: "Order sudah diambil kurir lain" });
    }

    // Close their offer, then retire anyone else's. The second call matters for
    // the open-pool case, where several couriers can be looking at the same
    // order and only one of them just won it.
    await respondToOffer(courierId, orderId, "accepted");
    await supersedeOffers(orderId);

    return reply.send({ success: true });
  });

  /**
   * Courier turns down the order they were offered.
   *
   * Declining is a first-class answer, not a timeout: it passes the order on
   * immediately instead of making the customer wait out a clock nobody is
   * watching, and it keeps "said no" distinguishable from "never looked" in the
   * courier's record.
   */
  app.post("/api/courier/decline-order", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const courierId = await getCourierId(session.user.id);
    if (!courierId) return reply.status(403).send({ success: false, error: "Not a courier" });

    const { orderId } = (request.body as { orderId?: string }) ?? {};
    if (!orderId) return reply.status(400).send({ success: false, error: "orderId wajib diisi" });

    const ok = await respondToOffer(courierId, orderId, "declined");
    if (!ok) {
      return reply
        .status(409)
        .send({ success: false, error: "Tawaran ini sudah tidak berlaku" });
    }

    return reply.send({ success: true });
  });

  /**
   * The applicant's own view of their application: verdict, admin note, which
   * of the ten slots are filled, and which are still missing.
   */
  app.get("/api/courier/verification", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const courier = await getCourierRow(session.user.id);
    if (!courier) return reply.status(403).send({ success: false, error: "Not a courier" });

    const { documents, missing, complete } = await getCourierDocuments(courier.id);

    return reply.send({
      success: true,
      status: courier.status,
      note: courier.note,
      verifiedAt: courier.verifiedAt,
      documents,
      missing,
      complete,
      groups: COURIER_DOCUMENT_GROUPS,
    });
  });

  /**
   * Upload (or replace) one document slot.
   *
   * One slot per request rather than all ten at once: these are phone-camera
   * photos on a mobile connection, and a single failed 20MB submission that
   * loses nine good pictures is how an applicant gives up.
   */
  app.post("/api/courier/documents", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const courier = await getCourierRow(session.user.id);
    if (!courier) return reply.status(403).send({ success: false, error: "Not a courier" });
    // An approved courier re-uploading would silently re-open their own
    // application, so the door is shut once the verdict is yes.
    if (courier.status === "approved") {
      return reply
        .status(409)
        .send({ success: false, error: "Akun pian sudah diverifikasi, dokumen tidak bisa diubah." });
    }

    const file = await request.file();
    if (!file) return reply.status(400).send({ success: false, error: "Foto wajib diunggah" });

    const kindField = (file.fields as Record<string, { value?: unknown } | undefined>)?.kind;
    const kind = typeof kindField?.value === "string" ? kindField.value : "";
    if (!isCourierDocumentKind(kind)) {
      return reply.status(400).send({ success: false, error: "Jenis dokumen tidak dikenal" });
    }

    const buffer = await file.toBuffer();
    const filename = `courier-${courier.id}-${kind}-${Date.now()}.webp`;
    await fs.mkdir(DOCUMENT_DIR, { recursive: true });
    // Bounded but still legible: an admin has to read a plate number and match a
    // face against a licence, so this keeps more resolution than a thumbnail.
    await sharp(buffer)
      .rotate()
      .resize(1400, 1400, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(path.join(DOCUMENT_DIR, filename));

    const image = `${DOCUMENT_URL_PREFIX}${filename}`;

    const [previous] = await db
      .select({ image: courierDocumentsTable.image })
      .from(courierDocumentsTable)
      .where(
        and(
          eq(courierDocumentsTable.courier_id, courier.id),
          eq(courierDocumentsTable.kind, kind),
        ),
      )
      .limit(1);

    await db
      .insert(courierDocumentsTable)
      .values({ courier_id: courier.id, kind, image })
      .onConflictDoUpdate({
        target: [courierDocumentsTable.courier_id, courierDocumentsTable.kind],
        set: { image, updatedAt: new Date() },
      });

    // The replaced photo is deleted rather than left behind. Every one of these
    // is a picture of a face or a driving licence, and an orphan nobody can
    // reach through the app is still a copy sitting on the volume. Skipped when
    // the old file is doing double duty as the courier's avatar (an admin can
    // point the avatar at a document), since that reference is still live.
    if (previous && previous.image !== image) {
      const [row] = await db
        .select({ avatar: couriersTable.avatar })
        .from(couriersTable)
        .where(eq(couriersTable.id, courier.id))
        .limit(1);

      if (row?.avatar !== previous.image) {
        await fs
          .rm(path.join(process.cwd(), previous.image.replace(/^\//, "")), { force: true })
          // Best effort: a file that's already gone, or a permissions problem on
          // the volume, must not fail an upload that otherwise succeeded.
          .catch(() => {});
      }
    }

    // A rejected application that gets a corrected photo goes back in the queue
    // by itself. Making the applicant find a separate "submit again" button
    // after fixing exactly what they were told to fix is a step that only
    // creates stuck applications.
    //
    // The note is deliberately KEPT. A rejection usually lists more than one
    // problem ("foto kiri masih pakai topi, STNK buram"), and clearing it the
    // moment the first photo is replaced deletes the instructions while the
    // applicant is still working through them. It stays readable until an admin
    // approves, which is the point where it stops being true.
    const status = courier.status === "rejected" ? "pending" : courier.status;
    if (courier.status === "rejected") {
      await db
        .update(couriersTable)
        .set({ verification_status: "pending" })
        .where(eq(couriersTable.id, courier.id));
    }

    const { documents, missing, complete } = await getCourierDocuments(courier.id);
    // status/note ride back so the page's banner reflects the new state without
    // a reload — otherwise it keeps saying "Ditolak" after the resubmit that
    // already moved the application back into the queue.
    return reply.send({
      success: true,
      image,
      status,
      note: courier.note,
      documents,
      missing,
      complete,
    });
  });

  /**
   * Courier reports where they are, so the customer's ETA reflects reality.
   *
   * Overwrites in place — this is "where are they now", never a movement trail.
   * The courier app only calls it while an order is actually in flight, and
   * clear-on-finish below wipes the point when the delivery ends, so the stored
   * data never outlives the reason for collecting it.
   */
  app.post("/api/courier/location", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const courierId = await getCourierId(session.user.id);
    if (!courierId) return reply.status(403).send({ success: false, error: "Not a courier" });

    const { lat, lon } = (request.body as { lat?: unknown; lon?: unknown }) ?? {};
    const coords = parseCoordPair(lat, lon);
    if (!coords) {
      return reply.status(400).send({ success: false, error: "Koordinat tidak valid" });
    }

    await db
      .update(couriersTable)
      .set({
        last_lat: String(coords.lat),
        last_lon: String(coords.lon),
        last_location_at: new Date(),
      })
      .where(eq(couriersTable.id, courierId));

    return reply.send({ success: true });
  });

  /**
   * Drop the stored position.
   *
   * Called when the courier goes offline or finishes their last delivery. The
   * position exists to answer a live question; once there is no delivery in
   * flight there is no reason to keep knowing where this person is.
   */
  app.post("/api/courier/location/clear", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const courierId = await getCourierId(session.user.id);
    if (!courierId) return reply.status(403).send({ success: false, error: "Not a courier" });

    await db
      .update(couriersTable)
      .set({ last_lat: null, last_lon: null, last_location_at: null })
      .where(eq(couriersTable.id, courierId));

    return reply.send({ success: true });
  });
}
