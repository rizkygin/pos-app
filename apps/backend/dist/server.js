"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const multipart_1 = __importDefault(require("@fastify/multipart"));
const auth_1 = require("./auth");
const web_headers_1 = require("./lib/web-headers");
const outlet_1 = require("./routes/outlet");
const uploads_1 = require("./routes/uploads");
const public_1 = require("./routes/public");
const customer_1 = require("./routes/customer");
const owner_1 = require("./routes/owner");
const admin_1 = require("./routes/admin");
const mutations_1 = require("./routes/mutations");
const courier_1 = require("./routes/courier");
const errands_1 = require("./routes/errands");
const orders_1 = require("./routes/orders");
const ratings_1 = require("./routes/ratings");
const locations_1 = require("./routes/locations");
const products_1 = require("./routes/products");
const ads_1 = require("./routes/ads");
const me_1 = require("./routes/me");
const phone_verification_1 = require("./routes/phone-verification");
const dashboard_1 = require("./routes/dashboard");
const invoices_1 = require("./routes/invoices");
const subscriptions_1 = require("./routes/subscriptions");
const employees_1 = require("./routes/employees");
const push_1 = require("./routes/push");
const routing_1 = require("./routes/routing");
const maintenance_1 = require("./routes/maintenance");
const reports_1 = require("./routes/reports");
const dispatch_scheduler_1 = require("./lib/dispatch-scheduler");
const app_env_1 = require("./lib/app-env");
const PORT = Number(process.env.PORT ?? 4000);
// Derived from APP_ENV (lib/app-env), which also lists apex AND www for
// production — @fastify/cors reflects whichever request origin is in the list,
// which credentialed (cookie) requests require, and missing one reads as "the
// site is down" to anyone who typed it that way.
const ALLOWED_ORIGINS = app_env_1.FRONTEND_ORIGINS;
async function main() {
    const app = (0, fastify_1.default)({ logger: true });
    // Fastify's default JSON parser rejects an empty body with a 400 when
    // Content-Type: application/json is set. better-auth's sign-out POST does
    // exactly that (json content-type, no body), so sign-out was 400ing and the
    // cookie-clearing Set-Cookie never reached the browser. Treat an empty body
    // as undefined so those requests pass through to the handler.
    app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
        const text = body;
        if (text === "" || text == null)
            return done(null, undefined);
        try {
            done(null, JSON.parse(text));
        }
        catch {
            const err = new Error("Invalid JSON body");
            err.statusCode = 400;
            done(err, undefined);
        }
    });
    await app.register(cors_1.default, {
        origin: ALLOWED_ORIGINS,
        credentials: true,
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        // better-auth answers a rate-limited request with 429 + X-Retry-After.
        // Without exposing it, the browser hides the header from the frontend and
        // the "try again in Ns" countdown has nothing to count.
        exposedHeaders: ["X-Retry-After"],
    });
    // 6MB cap gives headroom over the 5MB client-side image check.
    await app.register(multipart_1.default, { limits: { fileSize: 6 * 1024 * 1024 } });
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
                headers: (0, web_headers_1.toWebHeaders)(request.headers),
                body: hasBody ? JSON.stringify(request.body) : undefined,
            });
            const response = await auth_1.auth.handler(webRequest);
            reply.status(response.status);
            response.headers.forEach((value, key) => reply.header(key, value));
            reply.send(response.body ? await response.text() : null);
        },
    });
    await app.register(outlet_1.outletRoutes);
    await app.register(uploads_1.uploadRoutes);
    await app.register(public_1.publicRoutes);
    await app.register(customer_1.customerRoutes);
    await app.register(owner_1.ownerRoutes);
    await app.register(admin_1.adminRoutes);
    await app.register(mutations_1.mutationRoutes);
    await app.register(courier_1.courierRoutes);
    await app.register(errands_1.errandRoutes);
    await app.register(orders_1.orderRoutes);
    await app.register(ratings_1.ratingRoutes);
    await app.register(locations_1.locationRoutes);
    await app.register(products_1.productRoutes);
    await app.register(ads_1.adRoutes);
    await app.register(me_1.meRoutes);
    await app.register(phone_verification_1.phoneVerificationRoutes);
    await app.register(dashboard_1.dashboardRoutes);
    await app.register(invoices_1.invoiceRoutes);
    await app.register(subscriptions_1.subscriptionRoutes);
    await app.register(employees_1.employeeRoutes);
    await app.register(push_1.pushRoutes);
    await app.register(routing_1.routingRoutes);
    await app.register(maintenance_1.maintenanceRoutes);
    await app.register(reports_1.reportRoutes);
    app.get("/health", async () => ({ ok: true }));
    // The courier dispatch clock. Started after the routes are registered so a
    // tick can never fire against a half-built app.
    (0, dispatch_scheduler_1.startDispatchScheduler)(app);
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
