import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import {
  courierSessionsTable,
  couriersTable,
  customersTable,
  errandOrdersTable,
  locationsTable,
  ratingsTable,
  usersTable,
} from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { staleShiftCutoff } from "../lib/utils/courier-availability";
import { haversineKm } from "../lib/utils/geo";
import { parseCoordPair } from "../lib/utils/coords";
import { normalizeIndonesianPhone } from "../lib/utils/phone";
import { hasVerifiedPhone, PHONE_NOT_VERIFIED } from "../lib/utils/verified-contact";
import { updateRatings } from "../lib/update-ratings";
import { sendErrandPush } from "../lib/fcm";

/**
 * "Suruh Kurir" — hiring one courier directly, with no outlet and no products.
 *
 * The negotiation happens on WhatsApp, outside the app entirely. These
 * endpoints only record the outcome: the customer names a courier, the courier
 * accepts with his own price or declines, and the job ends when he marks it
 * delivered. Nothing here computes a fee, and nothing books money — errands
 * are outside the platform's accounting by design.
 */

/**
 * How long a customer must wait before pulling out of a request.
 *
 * A floor, not a timeout: nothing expires an errand on its own. The courier is
 * held exclusively until he answers, and this is the only thing that can end
 * that wait from the other side. Short enough that a customer isn't trapped by
 * a courier who put his phone down, long enough that "he hasn't replied in
 * four seconds" doesn't burn a courier's exclusivity for nothing.
 */
const CANCEL_FLOOR_MS = 5 * 60 * 1000;

/**
 * And how long they must then wait before hiring again.
 *
 * Applies only to backing out of a job the courier already ACCEPTED — the
 * courier has committed and possibly started moving. Deliberately not applied
 * to a courier's own rejection: the customer did nothing wrong there, and
 * making them wait for someone else's decision would be a penalty for being
 * turned down.
 */
const COOLDOWN_MS = 5 * 60 * 1000;

/**
 * How close the courier must be to the customer's pin to close the job.
 *
 * "Tandai Sudah Sampai" was previously an unguarded button: a courier could end
 * the errand from anywhere, including his own house, and the customer had no
 * say in it — the job simply became `delivered`. This is the check that makes
 * the button mean what it says.
 */
const ARRIVAL_RADIUS_M = 20;

/**
 * And how imprecise a fix may be before we refuse to judge it.
 *
 * A phone reporting ±200m cannot prove anything about a 20m circle, so a
 * reading that loose is rejected as unusable rather than silently treated as
 * "too far" — the courier standing in the right place deserves "tunggu sinyal
 * membaik", not "you are not here".
 */
const MAX_ACCURACY_M = 75;

const NO_ADDRESS_MESSAGE =
  "Atur alamat utama pian dulu di halaman Alamat sebelum suruh kurir.";
const NO_PHONE_MESSAGE =
  "Nomor HP pian belum diatur. Kurir perlu nomor buat menghubungi lewat WhatsApp.";

/**
 * Session or a sent 401. Callers return immediately on null — the reply has
 * already gone out by then.
 */
async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
  if (!session?.user) {
    reply.status(401).send({ success: false, error: "Unauthorized" });
    return null;
  }
  return session.user;
}

/** "820 m" / "80 m" — metres while they still mean something to a rider. */
function formatDistance(metres: number) {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} meter`;
}

async function getCourierId(userId: string) {
  const [courier] = await db
    .select({ id: couriersTable.id })
    .from(couriersTable)
    .where(and(eq(couriersTable.user_id, userId), isNull(couriersTable.deletedAt)))
    .limit(1);
  return courier?.id ?? null;
}

/**
 * The customer's default saved address, snapshotted into the errand.
 *
 * Falls back to the most recently added location when nothing is flagged
 * default — a customer with exactly one unflagged address should not be told
 * they have none.
 */
async function getDefaultLocation(userId: string) {
  const [loc] = await db
    .select({
      address: locationsTable.address,
      lat: locationsTable.lat,
      lon: locationsTable.lon,
    })
    .from(locationsTable)
    .where(eq(locationsTable.user_id, userId))
    .orderBy(desc(locationsTable.is_default), desc(locationsTable.createdAt))
    .limit(1);
  return loc ?? null;
}

/**
 * A destination the customer chose on the screen, rather than their saved
 * default.
 *
 * Three sources feed this — a saved address, the phone's current position, or a
 * pin dropped on the map with typed directions — but they all arrive here as
 * the same thing: an address string plus a coordinate. The errand snapshots
 * that, so a later edit to the saved address never moves a job already running.
 *
 * Returns `undefined` when nothing was sent (caller falls back to the saved
 * default, which is what the older clients still do), and `null` when something
 * was sent but is unusable — the caller must reject rather than silently
 * substitute, or the courier rides to the wrong end of town.
 */
function readDestination(raw: unknown): { address: string; lat: string; lon: string } | null | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== "object") return null;

  const d = raw as { address?: unknown; lat?: unknown; lon?: unknown };
  const coords = parseCoordPair(d.lat, d.lon);
  if (!coords) return null;
  const address = typeof d.address === "string" ? d.address.trim().slice(0, 255) : "";
  if (!address) return null;

  return { address, lat: String(coords.lat), lon: String(coords.lon) };
}

/**
 * How past couriers have rated this customer.
 *
 * Not every user has a customers row — a courier can hire another courier —
 * so an absent row means "no history", which reads as a clean 5 rather than as
 * an error. Same default the ratings columns themselves carry.
 */
async function getCustomerReputation(userId: string) {
  const [row] = await db
    .select({
      ratings: customersTable.ratings,
      reviewCount: customersTable.review_count,
    })
    .from(customersTable)
    .where(and(eq(customersTable.user_id, userId), isNull(customersTable.deletedAt)))
    .limit(1);

  return {
    rating: Number(row?.ratings ?? 5),
    reviewCount: row?.reviewCount ?? 0,
  };
}

export async function errandRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------
  // Customer side
  // ------------------------------------------------------------------

  /**
   * Couriers the customer can hire right now, nearest first.
   *
   * Distance is measured from the customer's SAVED address, not their phone's
   * live position: the errand is usually "bring this to my house", and a
   * customer ordering from the office would otherwise be shown couriers near
   * the wrong end of the trip.
   *
   * The availability rules are the same three that govern dispatch — approved,
   * on an uncapped shift, and not already carrying anything (order or errand).
   * Expressed as SQL rather than by calling getCourierAvailability per courier,
   * which would be one round trip per row.
   */
  app.get("/api/errands/couriers", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    // The screen asks where the errand ends BEFORE it shows couriers, and sends
    // that back here — a pin on the map or the phone's own position is a
    // perfectly good origin, and a customer using one has no reason to be told
    // to go and save an address first. The saved default is only the fallback.
    const query = (request.query ?? {}) as { lat?: unknown; lon?: unknown; address?: unknown };
    const chosen = parseCoordPair(query.lat, query.lon);
    const location = chosen
      ? {
          address:
            typeof query.address === "string" && query.address.trim()
              ? query.address.trim().slice(0, 255)
              : "Titik yang pian pilih",
          lat: String(chosen.lat),
          lon: String(chosen.lon),
        }
      : await getDefaultLocation(user.id);
    if (!location) {
      // A distinct code, not an empty list. "No couriers available" and "you
      // have no address" look identical in a UI that only gets rows back, and
      // the second one is the customer's to fix.
      return reply
        .status(409)
        .send({ success: false, error: NO_ADDRESS_MESSAGE, code: "no_address" });
    }

    const rows = await db
      .select({
        id: couriersTable.id,
        name: usersTable.name,
        avatar: couriersTable.avatar,
        vehicleType: couriersTable.vehicle_type,
        vehiclePlate: couriersTable.vehicle_plate,
        ratings: couriersTable.ratings,
        reviewCount: couriersTable.review_count,
        lastLat: couriersTable.last_lat,
        lastLon: couriersTable.last_lon,
      })
      .from(couriersTable)
      .innerJoin(usersTable, eq(couriersTable.user_id, usersTable.id))
      .where(
        and(
          isNull(couriersTable.deletedAt),
          eq(couriersTable.verification_status, "approved"),
          // A courier cannot hire himself.
          ne(couriersTable.user_id, user.id),
          sql`EXISTS (
            SELECT 1 FROM ${courierSessionsTable}
            WHERE ${courierSessionsTable.courier_id} = ${couriersTable.id}
              AND ${courierSessionsTable.ended_at} IS NULL
              AND ${courierSessionsTable.started_at} >= ${staleShiftCutoff()}
          )`,
          sql`NOT EXISTS (
            SELECT 1 FROM orders
            WHERE orders.courier_id = ${couriersTable.id}
              AND orders.status IN ('preparing', 'ready', 'on_delivery')
          )`,
          sql`NOT EXISTS (
            SELECT 1 FROM ${errandOrdersTable}
            WHERE ${errandOrdersTable.courier_id} = ${couriersTable.id}
              AND ${errandOrdersTable.status} IN ('pending', 'on_delivery')
          )`,
        ),
      );

    const originLat = Number(location.lat);
    const originLon = Number(location.lon);
    const originValid = Number.isFinite(originLat) && Number.isFinite(originLon);

    const couriers = rows
      .map((c) => {
        const lat = c.lastLat !== null ? Number(c.lastLat) : null;
        const lon = c.lastLon !== null ? Number(c.lastLon) : null;
        const hasPosition =
          lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon);
        return {
          id: c.id,
          name: c.name,
          avatar: c.avatar,
          vehicleType: c.vehicleType,
          vehiclePlate: c.vehiclePlate,
          rating: Number(c.ratings ?? 5),
          reviewCount: c.reviewCount,
          distanceKm:
            originValid && hasPosition
              ? haversineKm(originLat, originLon, lat, lon)
              : null,
        };
      })
      // Couriers who have never reported a position sort last rather than
      // dropping out. They are genuinely available; the list just cannot say
      // how far away they are, and hiding them would shrink the pool for a
      // missing GPS ping.
      .sort((a, b) => {
        if (a.distanceKm === null) return b.distanceKm === null ? 0 : 1;
        if (b.distanceKm === null) return -1;
        return a.distanceKm - b.distanceKm;
      });

    return reply.send({ success: true, couriers, origin: { address: location.address } });
  });

  /** Hire one courier. */
  app.post("/api/errands", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const body = (request.body ?? {}) as {
      courierId?: unknown;
      note?: unknown;
      destination?: unknown;
    };
    const courierId = Number(body.courierId);
    if (!Number.isInteger(courierId)) {
      return reply.status(400).send({ success: false, error: "courierId required" });
    }
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";

    const destination = readDestination(body.destination);
    if (destination === null) {
      return reply.status(400).send({
        success: false,
        error: "Tujuan pengantaran belum lengkap. Pilih titik dan isi alamatnya.",
        code: "bad_destination",
      });
    }

    // The courier reaches the customer on WhatsApp and nowhere else, so a
    // request from someone unreachable is one nobody can act on. Checked here
    // rather than left to fail in the chat step.
    const [me] = await db
      .select({ name: usersTable.name, phone: usersTable.phone })
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .limit(1);
    if (!me?.phone) {
      return reply
        .status(409)
        .send({ success: false, error: NO_PHONE_MESSAGE, code: "no_phone" });
    }
    // Having a number is not the same as the number being real. This is the
    // flow the whole verification exists for: the courier's only way to agree a
    // price is a WhatsApp message to it.
    if (!(await hasVerifiedPhone(user.id))) {
      return reply.status(403).send(PHONE_NOT_VERIFIED);
    }

    const location = destination ?? (await getDefaultLocation(user.id));
    if (!location) {
      return reply
        .status(409)
        .send({ success: false, error: NO_ADDRESS_MESSAGE, code: "no_address" });
    }

    // One live errand per customer. Without this a customer could hold several
    // couriers hostage at once, each blocked from other work.
    const [existing] = await db
      .select({ id: errandOrdersTable.id })
      .from(errandOrdersTable)
      .where(
        and(
          eq(errandOrdersTable.user_id, user.id),
          inArray(errandOrdersTable.status, ["pending", "on_delivery"]),
        ),
      )
      .limit(1);
    if (existing) {
      return reply.status(409).send({
        success: false,
        error: "Pian masih punya pesanan kurir yang berjalan.",
        code: "already_active",
        errandId: existing.id,
      });
    }

    // Cooldown after abandoning an accepted job — see COOLDOWN_MS.
    const [recentCancel] = await db
      .select({ cancelledAt: errandOrdersTable.updatedAt })
      .from(errandOrdersTable)
      .where(
        and(
          eq(errandOrdersTable.user_id, user.id),
          eq(errandOrdersTable.status, "cancelled_by_customer"),
          gte(errandOrdersTable.updatedAt, new Date(Date.now() - COOLDOWN_MS)),
        ),
      )
      .limit(1);
    if (recentCancel?.cancelledAt) {
      const secondsLeft = Math.ceil(
        (COOLDOWN_MS - (Date.now() - new Date(recentCancel.cancelledAt).getTime())) / 1000,
      );
      return reply.status(429).send({
        success: false,
        error: "Pian baru saja membatalkan pesanan. Coba lagi sebentar.",
        code: "cooldown",
        secondsLeft,
      });
    }

    const id = crypto.randomUUID();
    try {
      await db.insert(errandOrdersTable).values({
        id,
        user_id: user.id,
        courier_id: courierId,
        note: note || null,
        destination_address: location.address,
        destination_lat: location.lat,
        destination_lon: location.lon,
      });
    } catch (err) {
      // errand_orders_courier_pending_uq. Two customers tapped the same courier
      // at the same moment and this one lost — which is the index doing its
      // job, not a fault. Reported as "already taken", not as a server error.
      if (String(err).includes("errand_orders_courier_pending_uq")) {
        return reply.status(409).send({
          success: false,
          error: "Kurir ini baru saja dapat pesanan lain. Pilih kurir lain ya.",
          code: "courier_taken",
        });
      }
      throw err;
    }

    const reputation = await getCustomerReputation(user.id);
    // Push failures must not fail the request: the errand exists, and the
    // courier can still find it in his list. Losing the row because a phone was
    // unreachable would be the worse outcome.
    void sendErrandPush(courierId, {
      errandId: id,
      customerName: me.name,
      customerPhone: me.phone,
      customerRating: reputation.rating,
      customerReviewCount: reputation.reviewCount,
      note,
      pickupAddress: location.address,
      pickupLat: Number(location.lat),
      pickupLon: Number(location.lon),
    }).catch((err) => console.error("[errand] push failed", err));

    return reply.send({ success: true, errandId: id });
  });

  /** The customer's live errand, for the activeorder screen. */
  app.get("/api/errands/active", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const [row] = await db
      .select({
        id: errandOrdersTable.id,
        status: errandOrdersTable.status,
        note: errandOrdersTable.note,
        price: errandOrdersTable.price,
        // The columns are destination_* (migration 0054); the wire keys stay
        // pickup* because the installed courier app already reads them.
        pickupAddress: errandOrdersTable.destination_address,
        pickupLat: errandOrdersTable.destination_lat,
        pickupLon: errandOrdersTable.destination_lon,
        createdAt: errandOrdersTable.createdAt,
        acceptedAt: errandOrdersTable.accepted_at,
        courierId: couriersTable.id,
        courierName: usersTable.name,
        courierPhone: usersTable.phone,
        courierAvatar: couriersTable.avatar,
        courierPlate: couriersTable.vehicle_plate,
        courierRating: couriersTable.ratings,
        courierLat: couriersTable.last_lat,
        courierLon: couriersTable.last_lon,
        courierPositionAt: couriersTable.last_location_at,
      })
      .from(errandOrdersTable)
      .innerJoin(couriersTable, eq(errandOrdersTable.courier_id, couriersTable.id))
      .innerJoin(usersTable, eq(couriersTable.user_id, usersTable.id))
      .where(
        and(
          eq(errandOrdersTable.user_id, user.id),
          inArray(errandOrdersTable.status, ["pending", "on_delivery"]),
        ),
      )
      .limit(1);

    if (!row) return reply.send({ success: true, errand: null });

    const createdMs = row.createdAt ? new Date(row.createdAt).getTime() : Date.now();
    const cancellableInMs = Math.max(0, CANCEL_FLOOR_MS - (Date.now() - createdMs));

    return reply.send({
      success: true,
      errand: {
        ...row,
        // The screen needs a countdown, not a rule it has to re-derive. One
        // place decides when cancelling opens, and the button reads it.
        cancellableInSeconds: Math.ceil(cancellableInMs / 1000),
        canCancel: cancellableInMs === 0,
      },
    });
  });

  /** Customer backs out. Allowed from pending or on_delivery, after the floor. */
  app.post("/api/errands/:id/cancel", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };

    const [errand] = await db
      .select({ status: errandOrdersTable.status, createdAt: errandOrdersTable.createdAt })
      .from(errandOrdersTable)
      .where(and(eq(errandOrdersTable.id, id), eq(errandOrdersTable.user_id, user.id)))
      .limit(1);
    if (!errand) return reply.status(404).send({ success: false, error: "Not found" });
    if (errand.status !== "pending" && errand.status !== "on_delivery") {
      return reply.status(409).send({ success: false, error: "Pesanan sudah selesai." });
    }

    const elapsed = Date.now() - new Date(errand.createdAt).getTime();
    if (elapsed < CANCEL_FLOOR_MS) {
      return reply.status(409).send({
        success: false,
        error: "Tunggu 5 menit dulu sebelum membatalkan.",
        code: "too_soon",
        secondsLeft: Math.ceil((CANCEL_FLOOR_MS - elapsed) / 1000),
      });
    }

    // Conditional update, matching how orders.ts guards its transitions: the
    // courier may be accepting in the same instant, and whoever loses that race
    // must be told rather than silently overwriting the other's result.
    const updated = await db
      .update(errandOrdersTable)
      .set({ status: "cancelled_by_customer", updatedAt: new Date() })
      .where(
        and(
          eq(errandOrdersTable.id, id),
          eq(errandOrdersTable.user_id, user.id),
          inArray(errandOrdersTable.status, ["pending", "on_delivery"]),
        ),
      )
      .returning({ id: errandOrdersTable.id });

    if (updated.length === 0) {
      return reply.status(409).send({ success: false, error: "Status pesanan sudah berubah." });
    }
    return reply.send({ success: true });
  });

  /**
   * Customer turns down the price the courier quoted. on_delivery -> rejected.
   *
   * Separate from cancelling, and deliberately free of both waits. The floor
   * exists to give the courier time to answer, and he has answered; the
   * cooldown punishes abandoning a job under way, and refusing a price is not
   * that. Either wait here would leave a customer stuck with a quote they never
   * agreed to, which is the whole point of the negotiation happening first.
   */
  app.post("/api/errands/:id/reject-price", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };

    const updated = await db
      .update(errandOrdersTable)
      .set({ status: "rejected_by_customer", updatedAt: new Date() })
      .where(
        and(
          eq(errandOrdersTable.id, id),
          eq(errandOrdersTable.user_id, user.id),
          // Only once a price exists — before that there is nothing to refuse,
          // and the same conditional-update guard as cancel keeps this from
          // overwriting a courier who marked delivered in the same instant.
          eq(errandOrdersTable.status, "on_delivery"),
          isNotNull(errandOrdersTable.price),
        ),
      )
      .returning({ id: errandOrdersTable.id });

    if (updated.length === 0) {
      return reply.status(409).send({ success: false, error: "Status pesanan sudah berubah." });
    }
    return reply.send({ success: true });
  });

  /**
   * Everything this customer has ever asked a courier to do.
   *
   * Deliberately returns EVERY status, including the ones that never became a
   * job — a request the courier turned down, or one the customer pulled out of.
   * Those are the entries a customer is most likely to come looking for ("did
   * that go through, and what did I ask for?"), and a history that quietly drops
   * them reads as data loss rather than as a filter.
   *
   * Separate from /api/get-customer-history rather than merged into it: that
   * endpoint is built on ordersTable + outlets + order items, none of which an
   * errand has. Unioning them would mean faking an outlet name and an item list
   * for every errand row.
   */
  app.get("/api/errands/history", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const rows = await db
      .select({
        id: errandOrdersTable.id,
        status: errandOrdersTable.status,
        note: errandOrdersTable.note,
        price: errandOrdersTable.price,
        rejectedReason: errandOrdersTable.rejected_reason,
        destinationAddress: errandOrdersTable.destination_address,
        createdAt: errandOrdersTable.createdAt,
        acceptedAt: errandOrdersTable.accepted_at,
        deliveredAt: errandOrdersTable.delivered_at,
        courierName: usersTable.name,
        courierPhone: usersTable.phone,
        courierAvatar: couriersTable.avatar,
        courierPlate: couriersTable.vehicle_plate,
      })
      .from(errandOrdersTable)
      .innerJoin(couriersTable, eq(errandOrdersTable.courier_id, couriersTable.id))
      .innerJoin(usersTable, eq(couriersTable.user_id, usersTable.id))
      .where(eq(errandOrdersTable.user_id, user.id))
      .orderBy(desc(errandOrdersTable.createdAt));

    // Which of these the customer has already rated. One query for the whole
    // page rather than one per row.
    const ids = rows.map((r) => r.id);
    const ratedRows = ids.length
      ? await db
          .select({ errandId: ratingsTable.errand_order_id })
          .from(ratingsTable)
          .where(
            and(
              eq(ratingsTable.reviewer, user.id),
              inArray(ratingsTable.errand_order_id, ids),
            ),
          )
      : [];
    const rated = new Set(ratedRows.map((r) => r.errandId));

    return reply.send({
      success: true,
      errands: rows.map((r) => ({
        ...r,
        rated: rated.has(r.id),
        // Mirrors the rate endpoint's own guards exactly: delivered, and not
        // already rated by this person. Note there is deliberately NO 7-day
        // window here, unlike outlet orders — nothing in the errand rating
        // path expires, so claiming otherwise on this screen would be a lie.
        canRate: r.status === "delivered" && !rated.has(r.id),
      })),
    });
  });

  // ------------------------------------------------------------------
  // Courier side
  // ------------------------------------------------------------------

  /** The request waiting for this courier, if any. */
  app.get("/api/courier/errands/pending", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const courierId = await getCourierId(user.id);
    if (!courierId) return reply.status(403).send({ success: false, error: "Not a courier" });

    const [row] = await db
      .select({
        id: errandOrdersTable.id,
        status: errandOrdersTable.status,
        note: errandOrdersTable.note,
        price: errandOrdersTable.price,
        // The columns are destination_* (migration 0054); the wire keys stay
        // pickup* because the installed courier app already reads them.
        pickupAddress: errandOrdersTable.destination_address,
        pickupLat: errandOrdersTable.destination_lat,
        pickupLon: errandOrdersTable.destination_lon,
        createdAt: errandOrdersTable.createdAt,
        customerUserId: usersTable.id,
        customerName: usersTable.name,
        customerPhone: usersTable.phone,
      })
      .from(errandOrdersTable)
      .innerJoin(usersTable, eq(errandOrdersTable.user_id, usersTable.id))
      .where(
        and(
          eq(errandOrdersTable.courier_id, courierId),
          inArray(errandOrdersTable.status, ["pending", "on_delivery"]),
        ),
      )
      .limit(1);

    if (!row) return reply.send({ success: true, errand: null });

    const reputation = await getCustomerReputation(row.customerUserId);
    // The radius travels with the errand so the button's copy and the server's
    // rule can never disagree — one constant, quoted in both places.
    return reply.send({
      success: true,
      errand: { ...row, customer: reputation, arrivalRadiusM: ARRIVAL_RADIUS_M },
    });
  });

  /**
   * Look a customer up by phone number.
   *
   * Step 3 of the flow: before agreeing to anything the courier wants to know
   * who he is dealing with. Returns reputation only — name, rating, how many
   * people have rated them — and never an address, an order history or an
   * email. This endpoint takes a phone number and is available to any courier,
   * so it must not become a way to look up where someone lives.
   */
  app.get("/api/courier/errands/lookup", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const courierId = await getCourierId(user.id);
    if (!courierId) return reply.status(403).send({ success: false, error: "Not a courier" });

    const raw = (request.query as { phone?: string })?.phone;
    const phone = normalizeIndonesianPhone(raw);
    if (!phone) return reply.status(400).send({ success: false, error: "Nomor tidak valid" });

    const [target] = await db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.phone, phone))
      .limit(1);
    if (!target) return reply.send({ success: true, customer: null });

    const reputation = await getCustomerReputation(target.id);
    const recent = await db
      .select({
        stars: ratingsTable.ratings,
        comment: ratingsTable.comment,
        at: ratingsTable.createdAt,
      })
      .from(ratingsTable)
      .where(
        and(eq(ratingsTable.reciepent, target.id), eq(ratingsTable.reciepent_as, "customer")),
      )
      .orderBy(desc(ratingsTable.createdAt))
      .limit(5);

    return reply.send({
      success: true,
      customer: { name: target.name, ...reputation, recent },
    });
  });

  /** Courier accepts, naming his own price. pending -> on_delivery. */
  app.post("/api/courier/errands/:id/accept", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const courierId = await getCourierId(user.id);
    if (!courierId) return reply.status(403).send({ success: false, error: "Not a courier" });

    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { price?: unknown };
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) {
      return reply.status(400).send({ success: false, error: "Harga tidak valid" });
    }

    const updated = await db
      .update(errandOrdersTable)
      .set({
        status: "on_delivery",
        price: String(Math.round(price)),
        accepted_at: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(errandOrdersTable.id, id),
          eq(errandOrdersTable.courier_id, courierId),
          // Guards both double-accept and accept-after-cancel: the customer may
          // have pulled out while this request was in flight.
          eq(errandOrdersTable.status, "pending"),
        ),
      )
      .returning({ id: errandOrdersTable.id });

    if (updated.length === 0) {
      return reply
        .status(409)
        .send({ success: false, error: "Pesanan sudah tidak berlaku.", code: "gone" });
    }
    return reply.send({ success: true });
  });

  /** Courier declines. pending -> rejected_by_courier. No cooldown follows. */
  app.post("/api/courier/errands/:id/reject", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const courierId = await getCourierId(user.id);
    if (!courierId) return reply.status(403).send({ success: false, error: "Not a courier" });

    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { reason?: unknown };
    const reason =
      typeof body.reason === "string" ? body.reason.trim().slice(0, 255) || null : null;

    const updated = await db
      .update(errandOrdersTable)
      .set({ status: "rejected_by_courier", rejected_reason: reason, updatedAt: new Date() })
      .where(
        and(
          eq(errandOrdersTable.id, id),
          eq(errandOrdersTable.courier_id, courierId),
          eq(errandOrdersTable.status, "pending"),
        ),
      )
      .returning({ id: errandOrdersTable.id });

    if (updated.length === 0) {
      return reply
        .status(409)
        .send({ success: false, error: "Pesanan sudah tidak berlaku.", code: "gone" });
    }
    return reply.send({ success: true });
  });

  /**
   * Job done. on_delivery -> delivered, which is also what frees the courier.
   *
   * Gated on the courier actually being at the customer's pin. The position is
   * taken from the request body — the device's live fix at the moment of the
   * press — and never from couriers.last_lat, which is a background ping that
   * may be minutes stale and is written by the same client anyway. Neither is
   * proof against a determined faker (any browser can be told to report any
   * coordinate); this stops the ordinary case of ending a job early, which is
   * what actually happens.
   */
  app.post("/api/courier/errands/:id/delivered", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const courierId = await getCourierId(user.id);
    if (!courierId) return reply.status(403).send({ success: false, error: "Not a courier" });

    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { lat?: unknown; lon?: unknown; accuracy?: unknown };
    const lat = Number(body.lat);
    const lon = Number(body.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return reply.status(400).send({
        success: false,
        error: "Lokasi pian belum terbaca. Aktifkan GPS lalu coba lagi.",
        code: "no_position",
      });
    }

    const accuracy = Number(body.accuracy);
    if (Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_M) {
      return reply.status(409).send({
        success: false,
        error: `Sinyal GPS pian masih meleset ±${Math.round(accuracy)}m. Tunggu sebentar sampai lebih akurat.`,
        code: "weak_gps",
      });
    }

    // Read before write: the distance check needs the pin, and reporting the
    // real distance back is what lets the courier tell "I am at the wrong
    // house" apart from "the button is broken".
    const [errand] = await db
      .select({
        status: errandOrdersTable.status,
        destinationLat: errandOrdersTable.destination_lat,
        destinationLon: errandOrdersTable.destination_lon,
      })
      .from(errandOrdersTable)
      .where(and(eq(errandOrdersTable.id, id), eq(errandOrdersTable.courier_id, courierId)))
      .limit(1);
    if (!errand) return reply.status(404).send({ success: false, error: "Pesanan tidak ada." });

    const pinLat = Number(errand.destinationLat);
    const pinLon = Number(errand.destinationLon);
    // An errand without a usable pin cannot be geofenced. Rather than block the
    // courier out of a job he may well have finished, the check is skipped —
    // every errand created through /api/errands snapshots a real address, so
    // this is a guard against bad data, not a supported path.
    if (Number.isFinite(pinLat) && Number.isFinite(pinLon)) {
      const distanceM = haversineKm(lat, lon, pinLat, pinLon) * 1000;
      if (distanceM > ARRIVAL_RADIUS_M) {
        return reply.status(409).send({
          success: false,
          error: `Pian masih ${formatDistance(distanceM)} dari lokasi pelanggan. Dekati dulu sampai ${ARRIVAL_RADIUS_M} meter.`,
          code: "too_far",
          distanceM: Math.round(distanceM),
          radiusM: ARRIVAL_RADIUS_M,
        });
      }
    }

    const updated = await db
      .update(errandOrdersTable)
      .set({ status: "delivered", delivered_at: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(errandOrdersTable.id, id),
          eq(errandOrdersTable.courier_id, courierId),
          eq(errandOrdersTable.status, "on_delivery"),
        ),
      )
      .returning({ id: errandOrdersTable.id });

    if (updated.length === 0) {
      return reply.status(409).send({ success: false, error: "Pesanan sudah tidak berlaku." });
    }
    // No cash-in, no outlet ledger, nothing booked. The courier collected his
    // own money; the platform takes none of it and records none of it.
    return reply.send({ success: true });
  });

  // ------------------------------------------------------------------
  // Ratings — both directions
  // ------------------------------------------------------------------

  /**
   * Rate the other party on a finished errand.
   *
   * One endpoint for both directions because the rules are identical and only
   * the roles swap: the customer rates the courier, the courier rates the
   * customer. Which one you are is derived from the errand, never taken from
   * the request — otherwise a customer could post a rating "as" the courier.
   *
   * The courier shares this as a link over WhatsApp, so it is reachable by
   * anyone who has the URL; that is why it requires a session and checks that
   * the caller is actually party to this errand. The link identifies the job,
   * the login identifies the rater.
   */
  app.post("/api/errands/:id/rate", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { rating?: unknown; comment?: unknown };
    const stars = Number(body.rating);
    if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
      return reply.status(400).send({ success: false, error: "Rating 1-5" });
    }
    const comment =
      typeof body.comment === "string" ? body.comment.trim().slice(0, 500) || null : null;

    const [errand] = await db
      .select({
        id: errandOrdersTable.id,
        status: errandOrdersTable.status,
        customerUserId: errandOrdersTable.user_id,
        courierId: couriersTable.id,
        courierUserId: couriersTable.user_id,
        courierRating: couriersTable.ratings,
        courierReviewCount: couriersTable.review_count,
      })
      .from(errandOrdersTable)
      .innerJoin(couriersTable, eq(errandOrdersTable.courier_id, couriersTable.id))
      .where(eq(errandOrdersTable.id, id))
      .limit(1);

    if (!errand) return reply.status(404).send({ success: false, error: "Not found" });
    if (errand.status !== "delivered") {
      return reply
        .status(409)
        .send({ success: false, error: "Pesanan belum selesai." });
    }

    const isCustomer = errand.customerUserId === user.id;
    const isCourier = errand.courierUserId === user.id;
    if (!isCustomer && !isCourier) {
      // Party to the errand or nobody. A shared link must not let a stranger
      // move someone's rating.
      return reply.status(403).send({ success: false, error: "Bukan pesanan pian" });
    }

    const recipientUserId = isCustomer ? errand.courierUserId : errand.customerUserId;
    const recipientAs = isCustomer ? ("courier" as const) : ("customer" as const);

    const [existing] = await db
      .select({ id: ratingsTable.id })
      .from(ratingsTable)
      .where(
        and(eq(ratingsTable.errand_order_id, id), eq(ratingsTable.reviewer, user.id)),
      )
      .limit(1);
    if (existing) {
      return reply
        .status(409)
        .send({ success: false, error: "Pian sudah memberi rating.", code: "already_rated" });
    }

    await db.transaction(async (tx) => {
      await tx.insert(ratingsTable).values({
        id: crypto.randomUUID(),
        // No order_details_id: there are no products. The CHECK constraint
        // requires exactly one target, and this is the errand branch.
        errand_order_id: id,
        ratings: String(stars),
        comment,
        reviewer: user.id,
        reciepent: recipientUserId,
        reciepent_as: recipientAs,
      });

      if (isCustomer) {
        const next = updateRatings({
          oldRating: Number(errand.courierRating ?? 5),
          reviewCount: errand.courierReviewCount,
          newRating: stars,
        });
        await tx
          .update(couriersTable)
          .set({ ratings: String(next.newAverage), review_count: next.newReviewCount })
          .where(eq(couriersTable.id, errand.courierId));
      } else {
        // Mirror on the customer side. Absent customers row = a user who has
        // never ordered through an outlet; nothing to update, and the rating
        // row itself still stands as the record.
        const [customer] = await tx
          .select({
            id: customersTable.id,
            ratings: customersTable.ratings,
            reviewCount: customersTable.review_count,
          })
          .from(customersTable)
          .where(eq(customersTable.user_id, errand.customerUserId))
          .limit(1);
        if (customer) {
          const next = updateRatings({
            oldRating: Number(customer.ratings ?? 5),
            reviewCount: customer.reviewCount,
            newRating: stars,
          });
          await tx
            .update(customersTable)
            .set({ ratings: String(next.newAverage), review_count: next.newReviewCount })
            .where(eq(customersTable.id, customer.id));
        }
      }
    });

    return reply.send({ success: true });
  });
}
