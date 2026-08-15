import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "../db";
import { phoneVerificationsTable, usersTable } from "../db/schema";
import { auth } from "../auth";
import { toWebHeaders } from "../lib/web-headers";
import { formatIndonesianPhone } from "../lib/utils/phone";
import { sendPhoneVerification, whatsappConfigured } from "../lib/whatsapp";

/**
 * WhatsApp number verification, by link — the same shape as email verification,
 * because it is the same problem: prove the contact channel actually reaches
 * this person before the app relies on it.
 *
 * Why it matters here specifically: a courier negotiates an errand price over
 * WhatsApp and an outlet calls about a delivery. A number nobody answers is not
 * a smaller problem than a wrong address, it is the same problem.
 *
 * Delivery goes through lib/whatsapp.ts (Fonnte). Read the note there before
 * touching SEND_COOLDOWN_MS or DAILY_SEND_CAP below: the sending number is an
 * unofficial WhatsApp session, and those two limits are what keep its outbound
 * pattern from looking like the spam bursts Meta bans numbers for.
 */

/** How long a link stays good. Long enough to survive a phone left on charge. */
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Minimum gap between sends. Also the anti-spam guard on someone else's phone. */
const SEND_COOLDOWN_MS = 60 * 1000;

/**
 * Hard ceiling per user per day. Each send costs money and lands on a real
 * person's phone; a user who has burned ten links in a day has a problem no
 * eleventh link solves.
 */
const DAILY_SEND_CAP = 10;

/** Tokens are compared by hash, so only the digest is ever stored. */
const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export async function phoneVerificationRoutes(app: FastifyInstance) {
  /**
   * Send (or resend) the verification link to the caller's saved number.
   */
  app.post("/api/me/phone/verify/send", async (request, reply) => {
    const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
    if (!session?.user) return reply.status(401).send({ success: false, error: "Unauthorized" });

    const [user] = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        phone: usersTable.phone,
        verified: usersTable.phone_verified,
      })
      .from(usersTable)
      .where(eq(usersTable.id, session.user.id))
      .limit(1);
    if (!user) return reply.status(404).send({ success: false, error: "User tidak ditemukan." });

    if (!user.phone) {
      return reply.status(400).send({
        success: false,
        error: "Isi nomor WhatsApp pian dulu di Pengaturan.",
        code: "no_phone",
      });
    }
    // Not an error: a second tab, or a link opened on the phone while this one
    // still shows the old state. Answering "already done" lets the caller move
    // on instead of sending a message nobody needs.
    if (user.verified) return reply.send({ success: true, alreadyVerified: true });

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await db
      .select({ sentAt: phoneVerificationsTable.sent_at })
      .from(phoneVerificationsTable)
      .where(
        and(
          eq(phoneVerificationsTable.user_id, user.id),
          gte(phoneVerificationsTable.sent_at, since),
        ),
      )
      .orderBy(desc(phoneVerificationsTable.sent_at));

    const last = recent[0]?.sentAt;
    if (last) {
      const waitMs = SEND_COOLDOWN_MS - (Date.now() - new Date(last).getTime());
      if (waitMs > 0) {
        return reply.status(429).send({
          success: false,
          error: "Tunggu sebentar sebelum kirim ulang.",
          code: "cooldown",
          secondsLeft: Math.ceil(waitMs / 1000),
        });
      }
    }
    if (recent.length >= DAILY_SEND_CAP) {
      return reply.status(429).send({
        success: false,
        error: "Sudah terlalu banyak kirim ulang hari ini. Coba lagi besok.",
        code: "daily_cap",
      });
    }

    const token = crypto.randomBytes(32).toString("base64url");

    // The old links die the moment a new one is sent. Otherwise every resend
    // leaves another working key to the same door, for a full day each.
    await db
      .update(phoneVerificationsTable)
      .set({ consumed_at: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(phoneVerificationsTable.user_id, user.id),
          isNull(phoneVerificationsTable.consumed_at),
        ),
      );

    await db.insert(phoneVerificationsTable).values({
      id: crypto.randomUUID(),
      user_id: user.id,
      phone: user.phone,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + TOKEN_TTL_MS),
    });

    try {
      await sendPhoneVerification(user.phone, user.name, token);
    } catch (err) {
      console.error("[phone-verify] send failed", err);
      return reply.status(502).send({
        success: false,
        error: "Gagal mengirim pesan WhatsApp. Coba lagi sebentar.",
        code: "send_failed",
      });
    }

    return reply.send({
      success: true,
      phoneDisplay: formatIndonesianPhone(user.phone),
      // Tells the UI to stop promising a message that no configured sender will
      // ever deliver — in that mode the token is only in the server log.
      delivered: whatsappConfigured(),
      cooldownSeconds: SEND_COOLDOWN_MS / 1000,
    });
  });

  /**
   * Consume a link. Public on purpose: the link is opened from WhatsApp, quite
   * possibly in a browser with no session — the token IS the proof, exactly as
   * with the email link.
   */
  app.post("/api/phone/verify", async (request, reply) => {
    const token = (request.body as { token?: unknown })?.token;
    if (typeof token !== "string" || !token) {
      return reply.status(400).send({ success: false, error: "Link tidak valid." });
    }

    const [row] = await db
      .select()
      .from(phoneVerificationsTable)
      .where(eq(phoneVerificationsTable.token_hash, hashToken(token)))
      .limit(1);

    if (!row) return reply.status(404).send({ success: false, error: "Link tidak valid." });
    if (row.consumed_at) {
      return reply.status(410).send({
        success: false,
        error: "Link ini sudah dipakai. Kalau perlu, minta link baru.",
        code: "used",
      });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return reply.status(410).send({
        success: false,
        error: "Link sudah kedaluwarsa. Minta link baru.",
        code: "expired",
      });
    }

    const [user] = await db
      .select({ phone: usersTable.phone })
      .from(usersTable)
      .where(eq(usersTable.id, row.user_id))
      .limit(1);
    // The number moved after the link was sent. Verifying now would stamp
    // "verified" on a number this link never proved anything about.
    if (!user || user.phone !== row.phone) {
      return reply.status(409).send({
        success: false,
        error: "Nomor WhatsApp pian sudah berubah. Minta link baru.",
        code: "phone_changed",
      });
    }

    await db
      .update(phoneVerificationsTable)
      .set({ consumed_at: new Date(), updatedAt: new Date() })
      .where(eq(phoneVerificationsTable.id, row.id));
    await db
      .update(usersTable)
      .set({ phone_verified: true })
      .where(eq(usersTable.id, row.user_id));

    return reply.send({ success: true, phoneDisplay: formatIndonesianPhone(row.phone) });
  });
}
