import type { FastifyInstance } from "fastify";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { roadRoute } from "../lib/utils/road-distance";
import { parseCoordPair } from "../lib/utils/coords";

/**
 * Server-side routing for map surfaces.
 *
 * Exists because the browser cannot call OSRM directly once it is self-hosted:
 * the container lives on Railway's private network, so `osrm.railway.internal`
 * resolves to nothing from a customer's phone. Map components that fetched
 * router.project-osrm.org straight from the browser would break the moment
 * OSRM_BASE_URL is switched over.
 *
 * Going through the backend also stops every customer's pickup and drop-off
 * coordinates being handed to a third party by their own device, and gives the
 * calls a fallback they never had client-side.
 */
export async function routingRoutes(app: FastifyInstance) {
  // "lat,lon" -> validated pair. Rejects the empty strings, NaN and swapped
  // nonsense that a query string can carry.
  function parsePoint(raw: unknown) {
    if (typeof raw !== "string") return null;
    const [lat, lon] = raw.split(",");
    return parseCoordPair(lat, lon);
  }

  app.get("/api/route", async (request, reply) => {
    // Authenticated only. Without this it is an open proxy to the routing
    // server: anyone could point a script at it and burn the quota (or, once
    // self-hosted, the CPU) of a service with no auth of its own.
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const { from, to } = request.query as { from?: string; to?: string };
    const origin = parsePoint(from);
    const destination = parsePoint(to);

    if (!origin || !destination) {
      return reply
        .status(400)
        .send({ success: false, error: "from dan to wajib diisi sebagai 'lat,lon'" });
    }

    const route = await roadRoute(origin, destination);

    return reply.send({
      success: true,
      // Already [lat, lon] — callers draw it as-is.
      geometry: route.geometry,
      distanceKm: Math.round(route.km * 10) / 10,
      minutes: route.minutes === null ? null : Math.round(route.minutes),
      // 'straight' means routing was unavailable and geometry is just the two
      // endpoints joined — a caller may want to style that differently.
      source: route.source,
    });
  });
}
