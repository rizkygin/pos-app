import Fastify from "fastify";
import cors from "@fastify/cors";
import { auth } from "./auth";

const PORT = Number(process.env.PORT ?? 4000);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: FRONTEND_ORIGIN,
    credentials: true,
  });

  // better-auth expects a Web standard Request/Response. Fastify already parses
  // the body off the socket, so we rebuild a Request from request.body instead
  // of touching the raw stream (which would already be drained).
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    handler: async (request, reply) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value) headers.append(key, Array.isArray(value) ? value.join(", ") : value);
      }

      const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body != null;
      const webRequest = new Request(url, {
        method: request.method,
        headers,
        body: hasBody ? JSON.stringify(request.body) : undefined,
      });

      const response = await auth.handler(webRequest);

      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      reply.send(response.body ? await response.text() : null);
    },
  });

  app.get("/health", async () => ({ ok: true }));

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
