import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { couriersTable, courierSessionsTable, ordersTable } from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { cappedShiftEnd, getCourierAvailability } from "../lib/utils/courier-availability";
import { parseCoordPair } from "../lib/utils/coords";

async function getCourierId(userId: string) {
  const [courier] = await db
    .select({ id: couriersTable.id })
    .from(couriersTable)
    .where(eq(couriersTable.user_id, userId))
    .limit(1);
  return courier?.id ?? null;
}

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

    const courierId = await getCourierId(session.user.id);
    if (!courierId) return reply.status(403).send({ success: false, error: "Not a courier" });

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

    const courierId = await getCourierId(session.user.id);
    if (!courierId) return reply.status(403).send({ success: false, error: "Not a courier" });

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

    return reply.send({ success: true });
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
