import type { FastifyInstance } from "fastify";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { outletPromosTable, outletsMembersTable } from "../db/schema";
import { hasFeature, requireOutletAccess } from "../lib/outlet-access";
import {
  MEMBER_TIERS,
  findMemberById,
  getMembershipConfig,
  isMemberTier,
  listPointMovements,
  postPointMovement,
  quoteMembership,
  registerMember,
  saveMembershipConfig,
  tierForSpend,
  type MemberTier,
} from "../lib/membership";
import { normalizeIndonesianPhone } from "../lib/utils/phone";

/**
 * Membership: the outlet's own customer database, points, tiers, promo codes.
 *
 * PLAN GATING lives here rather than in gateBlocks, because membership is not a
 * permission group — it is a feature inside pages the cashier already has. Read
 * and write both require the flag: unlike a shift there is nothing to strand
 * (no drawer to reconcile), and a merchant who lapses keeps every row, they
 * simply stop being offered the controls until they resubscribe.
 *
 * Split by permission, deliberately:
 *   cashier — look a member up, register one at the counter, quote a bill.
 *   owner   — settings, tier thresholds, promo codes, adjusting points by hand.
 * A cashier handing out points at will is the fraud this split exists to stop.
 */

const FEATURE = "membership";
const UPGRADE_MESSAGE =
  "Membership tersedia mulai paket Ultimax — upgrade paket untuk membukanya.";

function memberJson(m: typeof outletsMembersTable.$inferSelect) {
  return {
    id: m.id,
    name: m.name,
    phone: m.phone,
    member_code: m.member_code,
    tier: m.tier,
    tier_manual: m.tier_manual,
    points_balance: m.points_balance,
    lifetime_spend: Number(m.lifetime_spend),
    visit_count: m.visit_count,
    note: m.note,
    created_at: m.createdAt,
  };
}

export async function membershipRoutes(app: FastifyInstance) {
  // ── Settings (owner) ──────────────────────────────────────────────────────

  app.get("/api/membership/settings", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "owner");
    if (!access) return;
    const canUse = hasFeature(access.gate, FEATURE);
    const config = await getMembershipConfig(db, access.outlet.id);
    return { success: true, canUseMembership: canUse, ...config };
  });

  app.patch("/api/membership/settings", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "owner");
    if (!access) return;
    if (!hasFeature(access.gate, FEATURE)) {
      return reply.status(403).send({ success: false, error: UPGRADE_MESSAGE, code: "PLAN_FEATURE" });
    }
    const body = (request.body as any) ?? {};
    try {
      const config = await saveMembershipConfig(access.outlet.id, {
        settings: body.settings ?? body,
        tiers: body.tiers,
      });
      return { success: true, ...config, message: "Pengaturan membership disimpan." };
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message ?? "Gagal menyimpan" });
    }
  });

  // ── Members ───────────────────────────────────────────────────────────────

  /**
   * Search this outlet's members. `q` matches name, phone or member code —
   * a cashier has whichever of the three the customer said out loud.
   */
  app.get("/api/membership/members", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "cashier");
    if (!access) return;
    if (!hasFeature(access.gate, FEATURE)) {
      return reply.status(403).send({ success: false, error: UPGRADE_MESSAGE, code: "PLAN_FEATURE" });
    }
    const { q, tier, limit } = (request.query as Record<string, string>) ?? {};
    const take = Math.min(200, Math.max(1, Number(limit) || 50));
    const term = (q ?? "").trim();
    const phoneTerm = normalizeIndonesianPhone(term);

    const filters = [
      eq(outletsMembersTable.outlet_id, access.outlet.id),
      isNull(outletsMembersTable.deletedAt),
    ];
    if (term) {
      filters.push(
        or(
          ilike(outletsMembersTable.name, `%${term}%`),
          ilike(outletsMembersTable.member_code, `%${term}%`),
          // Both the typed digits and their canonical form, so "0812…" and
          // "62812…" find the same person.
          ilike(outletsMembersTable.phone, `%${term.replace(/\D/g, "")}%`),
          ...(phoneTerm ? [eq(outletsMembersTable.phone, phoneTerm)] : []),
        )!,
      );
    }
    if (tier && isMemberTier(tier)) filters.push(eq(outletsMembersTable.tier, tier));

    const rows = await db
      .select()
      .from(outletsMembersTable)
      .where(and(...filters))
      .orderBy(desc(outletsMembersTable.createdAt))
      .limit(take);
    return { success: true, members: rows.map(memberJson) };
  });

  /** One member by phone — the counter lookup. 404 means "not a member yet". */
  app.get("/api/membership/members/by-phone/:phone", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "cashier");
    if (!access) return;
    if (!hasFeature(access.gate, FEATURE)) {
      return reply.status(403).send({ success: false, error: UPGRADE_MESSAGE, code: "PLAN_FEATURE" });
    }
    const { phone } = request.params as { phone: string };
    const canonical = normalizeIndonesianPhone(phone);
    if (!canonical) return reply.status(400).send({ success: false, error: "Nomor HP tidak valid" });
    const [m] = await db
      .select()
      .from(outletsMembersTable)
      .where(
        and(
          eq(outletsMembersTable.outlet_id, access.outlet.id),
          eq(outletsMembersTable.phone, canonical),
          isNull(outletsMembersTable.deletedAt),
        ),
      )
      .limit(1);
    if (!m) return reply.status(404).send({ success: false, error: "Belum terdaftar sebagai member" });
    return { success: true, member: memberJson(m) };
  });

  /** Register at the counter. An existing phone returns that member, not an error. */
  app.post("/api/membership/members", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "cashier");
    if (!access) return;
    if (!hasFeature(access.gate, FEATURE)) {
      return reply.status(403).send({ success: false, error: UPGRADE_MESSAGE, code: "PLAN_FEATURE" });
    }
    const body = (request.body as any) ?? {};
    try {
      // Only an owner may hand out a starting tier; a cashier's registration
      // always begins at silver.
      const { member, created } = await registerMember(access.outlet.id, {
        phone: body.phone,
        name: body.name,
        note: body.note,
        tier: access.isOwner ? body.tier : undefined,
      });
      return {
        success: true,
        created,
        member: memberJson(member),
        message: created ? "Member terdaftar." : "Nomor ini sudah terdaftar.",
      };
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message ?? "Gagal mendaftarkan member" });
    }
  });

  app.get("/api/membership/members/:id", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "cashier");
    if (!access) return;
    if (!hasFeature(access.gate, FEATURE)) {
      return reply.status(403).send({ success: false, error: UPGRADE_MESSAGE, code: "PLAN_FEATURE" });
    }
    const id = Number((request.params as { id: string }).id);
    const member = await findMemberById(db, access.outlet.id, id);
    if (!member) return reply.status(404).send({ success: false, error: "Member tidak ditemukan" });
    const movements = await listPointMovements(access.outlet.id, id);
    return { success: true, member: memberJson(member), movements };
  });

  /** Edit a member (owner). Setting a tier by hand pins it against auto-upgrade. */
  app.patch("/api/membership/members/:id", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "owner");
    if (!access) return;
    if (!hasFeature(access.gate, FEATURE)) {
      return reply.status(403).send({ success: false, error: UPGRADE_MESSAGE, code: "PLAN_FEATURE" });
    }
    const id = Number((request.params as { id: string }).id);
    const member = await findMemberById(db, access.outlet.id, id);
    if (!member) return reply.status(404).send({ success: false, error: "Member tidak ditemukan" });

    const body = (request.body as any) ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 100);
    if (body.phone !== undefined) {
      const phone = normalizeIndonesianPhone(body.phone);
      if (!phone) return reply.status(400).send({ success: false, error: "Nomor HP tidak valid" });
      patch.phone = phone;
    }
    if (body.note !== undefined) {
      patch.note = typeof body.note === "string" ? body.note.trim().slice(0, 255) || null : null;
    }
    if (body.tier !== undefined) {
      if (!isMemberTier(body.tier)) return reply.status(400).send({ success: false, error: "Tier tidak valid" });
      patch.tier = body.tier;
      // A hand-set tier is a decision, and the ladder must not quietly
      // override it later. Dropping back to the computed tier un-pins it.
      const { tiers } = await getMembershipConfig(db, access.outlet.id);
      patch.tier_manual = body.tier !== tierForSpend(tiers, Number(member.lifetime_spend));
    }
    try {
      const [updated] = await db
        .update(outletsMembersTable)
        .set(patch)
        .where(eq(outletsMembersTable.id, id))
        .returning();
      return { success: true, member: memberJson(updated), message: "Member diperbarui." };
    } catch (err: any) {
      if ((err?.code ?? err?.cause?.code) === "23505") {
        return reply.status(409).send({ success: false, error: "Nomor HP itu sudah dipakai member lain" });
      }
      throw err;
    }
  });

  /** Soft delete. The ledger stays: points that were given were still given. */
  app.delete("/api/membership/members/:id", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "owner");
    if (!access) return;
    if (!hasFeature(access.gate, FEATURE)) {
      return reply.status(403).send({ success: false, error: UPGRADE_MESSAGE, code: "PLAN_FEATURE" });
    }
    const id = Number((request.params as { id: string }).id);
    const member = await findMemberById(db, access.outlet.id, id);
    if (!member) return reply.status(404).send({ success: false, error: "Member tidak ditemukan" });
    await db
      .update(outletsMembersTable)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(outletsMembersTable.id, id));
    return { success: true, message: "Member dihapus." };
  });

  /** Owner correction, in either direction. Always a ledger row, never a set. */
  app.post("/api/membership/members/:id/points", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "owner");
    if (!access) return;
    if (!hasFeature(access.gate, FEATURE)) {
      return reply.status(403).send({ success: false, error: UPGRADE_MESSAGE, code: "PLAN_FEATURE" });
    }
    const id = Number((request.params as { id: string }).id);
    const member = await findMemberById(db, access.outlet.id, id);
    if (!member) return reply.status(404).send({ success: false, error: "Member tidak ditemukan" });

    const body = (request.body as any) ?? {};
    const delta = Math.trunc(Number(body.delta));
    if (!Number.isFinite(delta) || delta === 0) {
      return reply.status(400).send({ success: false, error: "Jumlah poin tidak valid" });
    }
    try {
      const result = await db.transaction((tx) =>
        postPointMovement(tx, {
          memberId: id,
          outletId: access.outlet.id,
          kind: "adjust",
          delta,
          note: typeof body.note === "string" ? body.note : "Penyesuaian manual",
          actorUserId: access.userId,
        }),
      );
      return { success: true, points_balance: result.balanceAfter, message: "Poin disesuaikan." };
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message ?? "Gagal menyesuaikan poin" });
    }
  });

  // ── Quote (cashier) ───────────────────────────────────────────────────────

  /**
   * What this bill would do: which member, which promo, how many points may be
   * spent, what would be earned. Preview only — checkout recomputes all of it
   * under lock, so nothing here is a promise the server has to keep.
   */
  app.post("/api/membership/quote", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "cashier");
    if (!access) return;
    if (!hasFeature(access.gate, FEATURE)) {
      return reply.status(403).send({ success: false, error: UPGRADE_MESSAGE, code: "PLAN_FEATURE" });
    }
    const body = (request.body as any) ?? {};
    const quote = await quoteMembership(db, {
      outletId: access.outlet.id,
      base: Number(body.total) || 0,
      memberId: body.memberId ?? null,
      memberPhone: body.memberPhone ?? null,
      promoCode: body.promoCode ?? null,
      pointsToRedeem: body.pointsToRedeem ?? null,
    });
    return { success: true, quote };
  });

  // ── Promo codes (owner) ───────────────────────────────────────────────────

  app.get("/api/membership/promos", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "cashier");
    if (!access) return;
    if (!hasFeature(access.gate, FEATURE)) {
      return reply.status(403).send({ success: false, error: UPGRADE_MESSAGE, code: "PLAN_FEATURE" });
    }
    const rows = await db
      .select()
      .from(outletPromosTable)
      .where(and(eq(outletPromosTable.outlet_id, access.outlet.id), isNull(outletPromosTable.deletedAt)))
      .orderBy(desc(outletPromosTable.createdAt));
    return { success: true, promos: rows };
  });

  function parsePromoBody(body: any): Record<string, unknown> {
    const code = String(body.code ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9._-]{3,30}$/.test(code)) {
      throw new Error("Kode promo 3–30 karakter, huruf/angka tanpa spasi");
    }
    const title = String(body.title ?? "").trim();
    if (!title) throw new Error("Judul promo wajib diisi");
    const type = body.discount_type === "amount" ? "amount" : "percent";
    const value = Math.trunc(Number(body.discount_value));
    if (!Number.isFinite(value) || value < 1) throw new Error("Nilai diskon tidak valid");
    if (type === "percent" && value > 100) throw new Error("Diskon persen maksimal 100");

    const tiers = Array.isArray(body.tiers)
      ? (body.tiers.filter((t: unknown) => isMemberTier(t)) as MemberTier[])
      : [];
    const optInt = (v: unknown) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Math.trunc(Number(v));
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const optDate = (v: unknown) => {
      if (!v) return null;
      const d = new Date(String(v));
      return Number.isNaN(d.getTime()) ? null : d;
    };
    return {
      code,
      title: title.slice(0, 100),
      discount_type: type,
      discount_value: value,
      min_order: Math.max(0, Math.trunc(Number(body.min_order) || 0)),
      max_discount: type === "percent" ? optInt(body.max_discount) : null,
      tiers,
      member_only: body.member_only !== false,
      valid_from: optDate(body.valid_from),
      valid_until: optDate(body.valid_until),
      usage_limit: optInt(body.usage_limit),
      per_member_limit: optInt(body.per_member_limit),
      is_active: body.is_active !== false,
    };
  }

  app.post("/api/membership/promos", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "owner");
    if (!access) return;
    if (!hasFeature(access.gate, FEATURE)) {
      return reply.status(403).send({ success: false, error: UPGRADE_MESSAGE, code: "PLAN_FEATURE" });
    }
    try {
      const values = parsePromoBody((request.body as any) ?? {});
      const [promo] = await db
        .insert(outletPromosTable)
        .values({ outlet_id: access.outlet.id, ...(values as any) })
        .returning();
      return { success: true, promo, message: "Promo dibuat." };
    } catch (err: any) {
      if ((err?.code ?? err?.cause?.code) === "23505") {
        return reply.status(409).send({ success: false, error: "Kode itu sudah dipakai di outlet ini" });
      }
      return reply.status(400).send({ success: false, error: err.message ?? "Gagal membuat promo" });
    }
  });

  app.patch("/api/membership/promos/:id", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "owner");
    if (!access) return;
    if (!hasFeature(access.gate, FEATURE)) {
      return reply.status(403).send({ success: false, error: UPGRADE_MESSAGE, code: "PLAN_FEATURE" });
    }
    const id = Number((request.params as { id: string }).id);
    const body = (request.body as any) ?? {};
    try {
      // A bare toggle is the common edit and must not require re-sending the
      // whole promo, so it is handled before the full-body parse.
      const patch =
        Object.keys(body).length === 1 && body.is_active !== undefined
          ? { is_active: !!body.is_active }
          : parsePromoBody(body);
      const [promo] = await db
        .update(outletPromosTable)
        .set({ ...(patch as any), updatedAt: new Date() })
        .where(
          and(
            eq(outletPromosTable.id, id),
            eq(outletPromosTable.outlet_id, access.outlet.id),
            isNull(outletPromosTable.deletedAt),
          ),
        )
        .returning();
      if (!promo) return reply.status(404).send({ success: false, error: "Promo tidak ditemukan" });
      return { success: true, promo, message: "Promo diperbarui." };
    } catch (err: any) {
      if ((err?.code ?? err?.cause?.code) === "23505") {
        return reply.status(409).send({ success: false, error: "Kode itu sudah dipakai di outlet ini" });
      }
      return reply.status(400).send({ success: false, error: err.message ?? "Gagal memperbarui promo" });
    }
  });

  app.delete("/api/membership/promos/:id", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "owner");
    if (!access) return;
    if (!hasFeature(access.gate, FEATURE)) {
      return reply.status(403).send({ success: false, error: UPGRADE_MESSAGE, code: "PLAN_FEATURE" });
    }
    const id = Number((request.params as { id: string }).id);
    const [promo] = await db
      .update(outletPromosTable)
      .set({ deletedAt: new Date(), is_active: false, updatedAt: new Date() })
      .where(and(eq(outletPromosTable.id, id), eq(outletPromosTable.outlet_id, access.outlet.id)))
      .returning();
    if (!promo) return reply.status(404).send({ success: false, error: "Promo tidak ditemukan" });
    return { success: true, message: "Promo dihapus." };
  });

  // ── Overview (owner) ──────────────────────────────────────────────────────

  /** Headline numbers for the membership page. */
  app.get("/api/membership/summary", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "owner");
    if (!access) return;
    if (!hasFeature(access.gate, FEATURE)) {
      return reply.status(403).send({ success: false, error: UPGRADE_MESSAGE, code: "PLAN_FEATURE" });
    }
    const [totals] = await db
      .select({
        members: sql<number>`count(*)::int`,
        points: sql<number>`coalesce(sum(${outletsMembersTable.points_balance}), 0)::int`,
        spend: sql<string>`coalesce(sum(${outletsMembersTable.lifetime_spend}), 0)`,
      })
      .from(outletsMembersTable)
      .where(and(eq(outletsMembersTable.outlet_id, access.outlet.id), isNull(outletsMembersTable.deletedAt)));

    const byTierRows = await db
      .select({ tier: outletsMembersTable.tier, n: sql<number>`count(*)::int` })
      .from(outletsMembersTable)
      .where(and(eq(outletsMembersTable.outlet_id, access.outlet.id), isNull(outletsMembersTable.deletedAt)))
      .groupBy(outletsMembersTable.tier);
    const byTier = Object.fromEntries(MEMBER_TIERS.map((t) => [t, 0])) as Record<MemberTier, number>;
    for (const r of byTierRows) if (isMemberTier(r.tier)) byTier[r.tier] = r.n;

    return {
      success: true,
      summary: {
        members: totals?.members ?? 0,
        outstandingPoints: totals?.points ?? 0,
        lifetimeSpend: Number(totals?.spend ?? 0),
        byTier,
      },
    };
  });
}
