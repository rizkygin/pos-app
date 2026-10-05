import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db";
import { adminActivityTable } from "../db/schema";

// ============================================================================
// Admin activity log. Most rows are written by ONE onResponse hook
// (logAdminResponse, registered in server.ts): requireAdmin marks a request
// that passed the guard, and when the response goes out the hook records it if
// it changed something (any non-GET) or was an admin reading a merchant's
// books (marked by requireOutletOwnerOrAdmin). So a new admin route is logged
// without doing anything. Sign-ins, two-factor changes and script actions call
// recordAdminActivity directly.
//
// Logging must never break the action it records: every write here swallows
// its own error.
// ============================================================================

export type AdminActor = {
  userId: string;
  email: string;
  sessionId: string;
  /** Log this request even though it is a GET. */
  logRead?: boolean;
};

const actors = new WeakMap<FastifyRequest, AdminActor>();

export function markAdminRequest(request: FastifyRequest, actor: AdminActor) {
  actors.set(request, { ...actors.get(request), ...actor });
}

export function getAdminActor(request: FastifyRequest) {
  return actors.get(request) ?? null;
}

type HeaderSource = Headers | Record<string, string | string[] | undefined>;

function header(source: HeaderSource, name: string) {
  if (source instanceof Headers) return source.get(name);
  const value = source[name];
  return Array.isArray(value) ? value[0] : (value ?? null);
}

/**
 * The client address as the proxy REPORTED it. Spoofable and only for reading
 * a log — never use it to decide anything (see the trustedProxies TODO in
 * auth.ts for why the backend cannot resolve a trustworthy one).
 */
export function reportedIp(source: HeaderSource): string | null {
  const real = header(source, "x-real-ip");
  if (real) return real.trim();
  const forwarded = header(source, "x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() || null : null;
}

export type ActivityEntry = {
  adminUserId: string | null;
  adminEmail: string | null;
  action: string;
  target?: string | null;
  detail?: unknown;
  statusCode?: number | null;
  ip?: string | null;
  userAgent?: string | null;
};

export async function recordAdminActivity(entry: ActivityEntry) {
  try {
    await db.insert(adminActivityTable).values({
      admin_user_id: entry.adminUserId,
      admin_email: entry.adminEmail,
      action: entry.action.slice(0, 160),
      target: entry.target ? entry.target.slice(0, 255) : null,
      detail: entry.detail ?? null,
      status_code: entry.statusCode ?? null,
      ip_address: entry.ip ?? null,
      user_agent: entry.userAgent ? entry.userAgent.slice(0, 500) : null,
    });
  } catch (err) {
    console.error("[admin-activity] failed to record", entry.action, err);
  }
}

// Field names whose values never belong in a log.
const SECRET_KEY = /pass|secret|token|otp|code/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  if (typeof value !== "object") return String(value);
  if (depth > 3) return "[…]";
  // Multipart parts and streams: the file itself is not the point.
  if (typeof (value as { pipe?: unknown }).pipe === "function") return "[file]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
    out[key] = SECRET_KEY.test(key) ? "[disembunyikan]" : sanitize(v, depth + 1);
  }
  return out;
}

// The record an action was aimed at, for the list view. The full params and
// body are in `detail`.
const TARGET_KEYS = ["id", "outletId", "adId", "userId", "courierId", "productId", "email"];

function describeTarget(params: unknown, body: unknown) {
  const parts: string[] = [];
  for (const source of [params, body]) {
    if (!source || typeof source !== "object") continue;
    for (const key of TARGET_KEYS) {
      const value = (source as Record<string, unknown>)[key];
      if (value != null && value !== "" && (typeof value === "string" || typeof value === "number")) {
        parts.push(`${key}=${value}`);
      }
    }
  }
  return parts.length ? [...new Set(parts)].join(", ") : null;
}

export async function logAdminResponse(request: FastifyRequest, reply: FastifyReply) {
  const actor = actors.get(request);
  if (!actor) return;
  if (request.method === "GET" && !actor.logRead) return;

  const route = request.routeOptions?.url ?? request.url.split("?")[0];
  const params = request.params && Object.keys(request.params as object).length ? request.params : undefined;
  const query = request.query && Object.keys(request.query as object).length ? request.query : undefined;
  const body = request.isMultipart() ? "[upload]" : request.body;

  await recordAdminActivity({
    adminUserId: actor.userId,
    adminEmail: actor.email,
    action: `${request.method} ${route}`,
    target: describeTarget(params, body),
    detail: sanitize({ params, query, body }),
    statusCode: reply.statusCode,
    ip: reportedIp(request.headers),
    userAgent: request.headers["user-agent"] ?? null,
  });
}
