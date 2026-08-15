"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadRoutes = uploadRoutes;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const UPLOADS_ROOT = node_path_1.default.join(process.cwd(), "uploads");
const CONTENT_TYPES = {
    ".webp": "image/webp",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
};
async function uploadRoutes(app) {
    app.get("/uploads/*", async (request, reply) => {
        const segments = request.params["*"].split("/");
        const filePath = node_path_1.default.join(UPLOADS_ROOT, ...segments);
        if (!filePath.startsWith(UPLOADS_ROOT + node_path_1.default.sep)) {
            return reply.status(404).send("Not found");
        }
        const contentType = CONTENT_TYPES[node_path_1.default.extname(filePath).toLowerCase()];
        if (!contentType) {
            return reply.status(404).send("Not found");
        }
        try {
            const file = await promises_1.default.readFile(filePath);
            reply.header("Content-Type", contentType);
            reply.header("Cache-Control", "public, max-age=0, must-revalidate");
            return reply.send(file);
        }
        catch {
            return reply.status(404).send("Not found");
        }
    });
}
