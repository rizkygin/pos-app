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

const PORT = Number(process.env.PORT ?? 4000);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: FRONTEND_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });

  await app.register(multipart);

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

  app.get("/health", async () => ({ ok: true }));

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
