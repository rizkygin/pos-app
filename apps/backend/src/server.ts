import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { auth } from "./auth";
import { toWebHeaders } from "./lib/web-headers";
import { outletRoutes } from "./routes/outlet";
import { uploadRoutes } from "./routes/uploads";
import { publicRoutes } from "./routes/public";
import { customerRoutes } from "./routes/customer";
import { ownerRoutes } from "./routes/owner";
import { adminRoutes } from "./routes/admin";
import { mutationRoutes } from "./routes/mutations";
import { courierRoutes } from "./routes/courier";
import { orderRoutes } from "./routes/orders";
import { ratingRoutes } from "./routes/ratings";
import { locationRoutes } from "./routes/locations";
import { productRoutes } from "./routes/products";
import { adRoutes } from "./routes/ads";
import { meRoutes } from "./routes/me";
import { dashboardRoutes } from "./routes/dashboard";
import { invoiceRoutes } from "./routes/invoices";
import { subscriptionRoutes } from "./routes/subscriptions";
import { employeeRoutes } from "./routes/employees";
import { pushRoutes } from "./routes/push";
import { routingRoutes } from "./routes/routing";

const PORT = Number(process.env.PORT ?? 4000);
// FRONTEND_ORIGIN accepts a comma-separated list so apex + www (and any extra
// origins) are all allowed. @fastify/cors reflects whichever request origin is
// in the list, which credentialed (cookie) requests require.
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
const ALLOWED_ORIGINS = FRONTEND_ORIGIN.split(",")
  .map((o) => o.trim())
  .filter(Boolean);

async function main() {
  const app = Fastify({ logger: true });

  // Fastify's default JSON parser rejects an empty body with a 400 when
  // Content-Type: application/json is set. better-auth's sign-out POST does
  // exactly that (json content-type, no body), so sign-out was 400ing and the
  // cookie-clearing Set-Cookie never reached the browser. Treat an empty body
  // as undefined so those requests pass through to the handler.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      const text = body as string;
      if (text === "" || text == null) return done(null, undefined);
      try {
        done(null, JSON.parse(text));
      } catch {
        const err = new Error("Invalid JSON body") as Error & { statusCode: number };
        err.statusCode = 400;
        done(err, undefined);
      }
    }
  );

  await app.register(cors, {
    origin: ALLOWED_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    // better-auth answers a rate-limited request with 429 + X-Retry-After.
    // Without exposing it, the browser hides the header from the frontend and
    // the "try again in Ns" countdown has nothing to count.
    exposedHeaders: ["X-Retry-After"],
  });

  // 6MB cap gives headroom over the 5MB client-side image check.
  await app.register(multipart, { limits: { fileSize: 6 * 1024 * 1024 } });

  // better-auth expects a Web standard Request/Response. Fastify already parses
  // the body off the socket, so we rebuild a Request from request.body instead
  // of touching the raw stream (which would already be drained).
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    handler: async (request, reply) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body != null;
      const webRequest = new Request(url, {
        method: request.method,
        headers: toWebHeaders(request.headers),
        body: hasBody ? JSON.stringify(request.body) : undefined,
      });

      const response = await auth.handler(webRequest);

      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      reply.send(response.body ? await response.text() : null);
    },
  });

  await app.register(outletRoutes);
  await app.register(uploadRoutes);
  await app.register(publicRoutes);
  await app.register(customerRoutes);
  await app.register(ownerRoutes);
  await app.register(adminRoutes);
  await app.register(mutationRoutes);
  await app.register(courierRoutes);
  await app.register(orderRoutes);
  await app.register(ratingRoutes);
  await app.register(locationRoutes);
  await app.register(productRoutes);
  await app.register(adRoutes);
  await app.register(meRoutes);
  await app.register(dashboardRoutes);
  await app.register(invoiceRoutes);
  await app.register(subscriptionRoutes);
  await app.register(employeeRoutes);
  await app.register(pushRoutes);
  await app.register(routingRoutes);

  app.get("/health", async () => ({ ok: true }));

  // Bind IPv6 "::" (dual-stack) so the server is reachable both over Railway's
  // private network (IPv6-only, e.g. backend.railway.internal) AND the public
  // edge (IPv4-mapped, e.g. api.ulunpesan.com). "0.0.0.0" would be IPv4-only and
  // unreachable on the private network.
  await app.listen({ port: PORT, host: "::" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
