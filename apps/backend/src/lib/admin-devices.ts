import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "../db";
import { adminDevicesTable, usersTable } from "../db/schema";
import { COOKIE_DOMAIN, COOKIE_SECURE, FRONTEND_URL } from "./app-env";
import { hasAdminRow } from "./admin-rows";
import { recordAdminActivity, reportedIp } from "./admin-activity";
import { APP_TIMEZONE } from "./timezone";

// ============================================================================
// Admin sign-ins, called from auth.ts's database hooks (this module must not
// import auth.ts — that would be a cycle).
//
// Every completed admin sign-in is logged. A sign-in from a browser this admin
// has never used emails them. "Browser" = a random id in the long-lived
// `admin_device` cookie; admin_devices keeps its SHA-256 per admin. An IP
// would not do: the backend cannot resolve client IPs behind Railway's edge,
// and IPs change with every network anyway.
// ============================================================================

const FROM = "Ulun Pesan <noreply@mail.ulunpesan.com>";
const resend = new Resend(process.env.RESEND_API_KEY);

const DEVICE_COOKIE = "admin_device";
// Chrome caps cookie lifetime at 400 days.
const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

// The slice of better-auth's endpoint context these hooks need.
type HookContext = {
  path?: string;
  headers?: Headers;
  getCookie: (key: string) => string | null;
  setCookie: (key: string, value: string, options?: Record<string, unknown>) => unknown;
} | null;

type CreatedSession = { userId: string; ipAddress?: string | null; userAgent?: string | null };

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** "Chrome di Android" — enough for a person to recognise their own device. */
export function describeUserAgent(ua: string | null | undefined) {
  if (!ua) return "Perangkat tidak dikenal";
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : /curl|node|undici/i.test(ua) ? "Program/skrip"
    : "Browser lain";
  const os =
    /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod/.test(ua) ? "iPhone/iPad"
    : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux"
    : null;
  return os ? `${browser} di ${os}` : browser;
}

export async function sendNewDeviceEmail(user: { email: string; name: string }, device: string, ip: string | null) {
  const when = new Date().toLocaleString("id-ID", {
    timeZone: APP_TIMEZONE,
    dateStyle: "full",
    timeStyle: "short",
  });
  const securityUrl = `${FRONTEND_URL}/dashboard/admin/security`;
  // Resend reports a rejected send in `error` rather than by throwing.
  const { error } = await resend.emails.send({
    from: FROM,
    to: user.email,
    subject: "Login admin dari perangkat baru",
    html: `
      <p>Hai ${escapeHtml(user.name)},</p>
      <p>Akun admin Ulun Pesan <b>${escapeHtml(user.email)}</b> baru saja masuk dari perangkat yang belum pernah dipakai sebelumnya.</p>
      <ul>
        <li>Waktu: ${escapeHtml(when)} WIB</li>
        <li>Perangkat: ${escapeHtml(device)}</li>
        <li>IP: ${escapeHtml(ip || "tidak diketahui")}</li>
      </ul>
      <p>Kalau ini Anda, abaikan email ini.</p>
      <p><b>Kalau bukan Anda</b>, orang itu sudah tahu password Anda <i>dan</i> kode verifikasi dua langkah Anda. Segera:</p>
      <ol>
        <li>Ganti password lewat "Kada ingat password?" di halaman login.</li>
        <li>Buka Keamanan Admin dan pilih "Keluarkan semua perangkat lain".</li>
      </ol>
      <a href="${securityUrl}" style="display:inline-block;padding:12px 24px;background:#f43f5e;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">Buka Keamanan Admin</a>
    `,
  });
  if (error) throw new Error(`${error.name}: ${error.message}`);
}

// Endpoints whose new session is a person signing in. Others also create
// sessions (two-factor enable/disable rotate the current one) and are not.
const SIGN_IN_PATHS = new Set(["/sign-in/email", "/two-factor/verify-totp", "/two-factor/verify-backup-code"]);

/**
 * Called from auth.ts's `hooks.after` whenever an endpoint produced a new
 * session — an after hook rather than a database hook because only an after
 * hook can set the device cookie on the response. Acts only for admins, and
 * only once the sign-in is complete.
 */
export async function onSessionCreated(
  session: CreatedSession,
  ctx: NonNullable<HookContext>,
  hadSession: boolean,
) {
  try {
    if (!ctx.path || !SIGN_IN_PATHS.has(ctx.path)) return;
    // verify-totp on an already signed-in session is two-factor SETUP
    // finishing (it rotates the session), not a sign-in.
    if (ctx.path.startsWith("/two-factor/") && hadSession) return;

    const [user] = await db
      .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, twoFactorEnabled: usersTable.twoFactorEnabled })
      .from(usersTable)
      .where(eq(usersTable.id, session.userId))
      .limit(1);
    if (!user || !(await hasAdminRow(user.id))) return;

    // Password accepted, code step still to come: the twoFactor plugin's own
    // after hook (which runs after ours) deletes this session. Not a sign-in
    // yet — the verify call that follows creates the real one.
    if (ctx.path === "/sign-in/email" && user.twoFactorEnabled) return;

    const ip = session.ipAddress || (ctx.headers ? reportedIp(ctx.headers) : null);
    const userAgent = session.userAgent || ctx.headers?.get("user-agent") || null;

    const cookieValue = ctx.getCookie(DEVICE_COOKIE);
    const deviceId = cookieValue && /^[\w-]{20,100}$/.test(cookieValue) ? cookieValue : randomBytes(32).toString("base64url");
    const deviceHash = sha256(deviceId);

    const [known] = await db
      .select({ id: adminDevicesTable.id })
      .from(adminDevicesTable)
      .where(and(eq(adminDevicesTable.user_id, user.id), eq(adminDevicesTable.device_hash, deviceHash)))
      .limit(1);

    if (known) {
      await db
        .update(adminDevicesTable)
        .set({ last_seen_at: new Date(), user_agent: userAgent, ip_address: ip })
        .where(eq(adminDevicesTable.id, known.id));
    } else {
      await db
        .insert(adminDevicesTable)
        .values({ user_id: user.id, device_hash: deviceHash, user_agent: userAgent, ip_address: ip })
        .onConflictDoNothing();
    }
    // Re-sent on every sign-in, known browser or not: its lifetime then runs
    // from the latest sign-in, so a browser in regular use never ages out and
    // gets mistaken for a new one.
    ctx.setCookie(DEVICE_COOKIE, deviceId, {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: "lax",
      path: "/",
      maxAge: DEVICE_COOKIE_MAX_AGE,
      // Same parent domain as the session cookie, so the frontend's server
      // render of the Keamanan page forwards it and can mark "this device".
      ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
    });

    const device = describeUserAgent(userAgent);
    await recordAdminActivity({
      adminUserId: user.id,
      adminEmail: user.email,
      action: "login",
      target: known ? null : "perangkat baru",
      detail: { newDevice: !known, via: ctx.path ?? null, device },
      statusCode: 200,
      ip,
      userAgent,
    });

    // Not awaited: a slow or failing mail provider must not hold up sign-in.
    if (!known) {
      sendNewDeviceEmail(user, device, ip).catch((err) =>
        console.error("[admin-devices] new-device email failed", err),
      );
    }
  } catch (err) {
    // Never fail a sign-in over bookkeeping.
    console.error("[admin-devices] onSessionCreated failed", err);
  }
}

/** Two-factor changes on an admin account, for the activity log. */
export async function onAdminSecurityEvent(userId: string, action: string, ctx: HookContext) {
  try {
    if (!(await hasAdminRow(userId))) return;
    const [user] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    await recordAdminActivity({
      adminUserId: userId,
      adminEmail: user?.email ?? null,
      action,
      statusCode: 200,
      ip: ctx?.headers ? reportedIp(ctx.headers) : null,
      userAgent: ctx?.headers?.get("user-agent") ?? null,
    });
  } catch (err) {
    console.error("[admin-devices] onAdminSecurityEvent failed", err);
  }
}

/** The admin_device cookie from a raw Cookie header (Fastify has no cookie plugin here). */
export function readDeviceCookie(cookieHeader: string | undefined) {
  const match = new RegExp(`(?:^|;\\s*)${DEVICE_COOKIE}=([^;]+)`).exec(cookieHeader ?? "");
  return match ? decodeURIComponent(match[1]) : null;
}

/** The browsers an admin has signed in from, newest first; `current` marks this one. */
export async function listAdminDevices(userId: string, currentDeviceId: string | null) {
  const currentHash = currentDeviceId ? sha256(currentDeviceId) : null;
  const rows = await db
    .select({
      id: adminDevicesTable.id,
      hash: adminDevicesTable.device_hash,
      userAgent: adminDevicesTable.user_agent,
      ip: adminDevicesTable.ip_address,
      firstSeenAt: adminDevicesTable.first_seen_at,
      lastSeenAt: adminDevicesTable.last_seen_at,
    })
    .from(adminDevicesTable)
    .where(eq(adminDevicesTable.user_id, userId))
    .orderBy(desc(adminDevicesTable.last_seen_at))
    // Every cleared-cookie or private window is a new browser; the page only
    // needs the recent ones.
    .limit(20);
  return rows.map(({ hash, ...r }) => ({
    ...r,
    device: describeUserAgent(r.userAgent),
    current: hash === currentHash,
  }));
}
