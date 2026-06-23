import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";

const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

const CONTENT_TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export async function uploadRoutes(app: FastifyInstance) {
  app.get("/uploads/*", async (request, reply) => {
    const segments = (request.params as { "*": string })["*"].split("/");
    const filePath = path.join(UPLOADS_ROOT, ...segments);

    if (!filePath.startsWith(UPLOADS_ROOT + path.sep)) {
      return reply.status(404).send("Not found");
    }

    const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()];
    if (!contentType) {
      return reply.status(404).send("Not found");
    }

    try {
      const file = await fs.readFile(filePath);
      reply.header("Content-Type", contentType);
      reply.header("Cache-Control", "public, max-age=0, must-revalidate");
      return reply.send(file);
    } catch {
      return reply.status(404).send("Not found");
    }
  });
}
