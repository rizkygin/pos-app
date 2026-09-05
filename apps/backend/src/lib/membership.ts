import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  memberPointMovementsTable,
  orderDetailsTable,
  ordersTable,
  outletMemberTiersTable,
  outletMembershipSettingsTable,
  outletPromoUsesTable,
  outletPromosTable,
  outletsMembersTable,
} from "../db/schema";
import { normalizeIndonesianPhone } from "./utils/phone";

/**
 * Membership: the outlet's own customers, their points, tiers and promo codes.
 *
 * Everything money-shaped in here follows one order of operations, and the
 * cashier screen never works it out for itself — it asks `quoteMembership` for
 * a preview and the checkout handler runs the same function again, inside the
 * transaction, with the member row locked:
 *
 *   base            what the client sends as `total`: line prices net of the
 *                   cashier's manual discount, BEFORE tax
 *   - promo         the outlet promo code, if one applies
 *   - points        redeemed points × redeem_rp_per_point, capped
 *   = net           what the customer pays before tax. Tax is charged on it.
 *
 * Points are EARNED on `net` — after the points that were just spent — so a
 * balance can never feed itself. Earning on the pre-redemption figure is how
 * loyalty programmes quietly bleed.
 *
 * The balance is a ledger (member_point_movements) with a cache on the member
 * row. `postPointMovement` is the only writer of either; a cancelled sale is a
 * reversal row, never an update to a cached number.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

export const MEMBER_TIERS = ["silver", "gold", "platinum", "diamond"] as const;
export type MemberTier = (typeof MEMBER_TIERS)[number];

export const TIER_RANK: Record<MemberTier, number> = {
  silver: 0,
  gold: 1,
  platinum: 2,
  diamond: 3,
};
export const TIER_LABEL: Record<MemberTier, string> = {
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  diamond: "Diamond",
};

export function isMemberTier(v: unknown): v is MemberTier {
  return typeof v === "string" && (MEMBER_TIERS as readonly string[]).includes(v);
}

export type MembershipSettings = {
  enabled: boolean;
  earn_rp_per_point: number;
  redeem_rp_per_point: number;
  max_redeem_percent: number;
  min_redeem_points: number;
};

export type TierRule = { earn_multiplier: number; min_lifetime_spend: number };
export type TierRules = Record<MemberTier, TierRule>;

export const DEFAULT_SETTINGS: MembershipSettings = {
  enabled: false,
  earn_rp_per_point: 10000,
  redeem_rp_per_point: 1000,
  max_redeem_percent: 100,
  min_redeem_points: 1,
};

// Starting ladder. Thresholds are lifetime net spend; the owner is expected to
// tune them to their own ticket size.
export const DEFAULT_TIERS: TierRules = {
  silver: { earn_multiplier: 1, min_lifetime_spend: 0 },
  gold: { earn_multiplier: 1.25, min_lifetime_spend: 2_000_000 },
  platinum: { earn_multiplier: 1.5, min_lifetime_spend: 5_000_000 },
  diamond: { earn_multiplier: 2, min_lifetime_spend: 10_000_000 },
};

export type MembershipConfig = { settings: MembershipSettings; tiers: TierRules };

/** Settings + tier ladder for an outlet, defaults filled in for anything unset. */
export async function getMembershipConfig(dbx: DbOrTx, outletId: number): Promise<MembershipConfig> {
  const [row] = await dbx
    .select()
    .from(outletMembershipSettingsTable)
    .where(eq(outletMembershipSettingsTable.outlet_id, outletId))
    .limit(1);
  const settings: MembershipSettings = row
    ? {
        enabled: row.enabled,
        earn_rp_per_point: row.earn_rp_per_point,
        redeem_rp_per_point: row.redeem_rp_per_point,
        max_redeem_percent: row.max_redeem_percent,
        min_redeem_points: row.min_redeem_points,
      }
    : { ...DEFAULT_SETTINGS };

  const tierRows = await dbx
    .select()
    .from(outletMemberTiersTable)
    .where(eq(outletMemberTiersTable.outlet_id, outletId));
  const tiers: TierRules = { ...DEFAULT_TIERS };
  for (const t of tierRows) {
    if (!isMemberTier(t.tier)) continue;
    tiers[t.tier] = {
      earn_multiplier: Number(t.earn_multiplier),
      min_lifetime_spend: Number(t.min_lifetime_spend),
    };
  }
  return { settings, tiers };
}

/** Owner saves the programme. Validated here so every caller gets the same rules. */
export async function saveMembershipConfig(
  outletId: number,
  input: { settings: Partial<MembershipSettings>; tiers?: Partial<Record<MemberTier, Partial<TierRule>>> },
): Promise<MembershipConfig> {
  const current = await getMembershipConfig(db, outletId);
  const s = { ...current.settings, ...pickSettings(input.settings) };

  const posInt = (v: number, name: string, min = 1) => {
    if (!Number.isInteger(v) || v < min) throw new Error(`${name} harus bilangan bulat ≥ ${min}`);
  };
  posInt(s.earn_rp_per_point, "Rupiah per poin (dapat)");
  posInt(s.redeem_rp_per_point, "Nilai 1 poin (tukar)");
  posInt(s.min_redeem_points, "Minimal poin ditukar");
  if (!Number.isInteger(s.max_redeem_percent) || s.max_redeem_percent < 1 || s.max_redeem_percent > 100) {
    throw new Error("Maksimal potongan poin harus 1–100%");
  }

  const tiers: TierRules = { ...current.tiers };
  for (const tier of MEMBER_TIERS) {
    const patch = input.tiers?.[tier];
    if (!patch) continue;
    const next = { ...tiers[tier] };
    if (patch.earn_multiplier !== undefined) {
      const m = Number(patch.earn_multiplier);
      if (!Number.isFinite(m) || m < 0 || m > 10) throw new Error(`Pengali poin ${TIER_LABEL[tier]} harus 0–10`);
      next.earn_multiplier = Math.round(m * 100) / 100;
    }
    if (patch.min_lifetime_spend !== undefined) {
      const v = Number(patch.min_lifetime_spend);
      if (!Number.isFinite(v) || v < 0) throw new Error(`Batas belanja ${TIER_LABEL[tier]} tidak valid`);
      next.min_lifetime_spend = Math.round(v);
    }
    tiers[tier] = next;
  }
  // Silver is the floor by definition, and a ladder that goes down is not a
  // ladder — a member would be promoted past a tier they never reached.
  tiers.silver.min_lifetime_spend = 0;
  if (
    tiers.gold.min_lifetime_spend > tiers.platinum.min_lifetime_spend ||
    tiers.platinum.min_lifetime_spend > tiers.diamond.min_lifetime_spend
  ) {
    throw new Error("Batas belanja tier harus berurutan: Gold ≤ Platinum ≤ Diamond");
  }

  await db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .insert(outletMembershipSettingsTable)
      .values({ outlet_id: outletId, ...s, updatedAt: now })
      .onConflictDoUpdate({
        target: outletMembershipSettingsTable.outlet_id,
        set: { ...s, updatedAt: now },
      });
    for (const tier of MEMBER_TIERS) {
      const values = {
        earn_multiplier: String(tiers[tier].earn_multiplier),
        min_lifetime_spend: String(tiers[tier].min_lifetime_spend),
        updatedAt: now,
      };
      await tx
        .insert(outletMemberTiersTable)
        .values({ outlet_id: outletId, tier, ...values })
        .onConflictDoUpdate({
          target: [outletMemberTiersTable.outlet_id, outletMemberTiersTable.tier],
          set: values,
        });
    }
  });
  return { settings: s, tiers };
}

function pickSettings(p: Partial<MembershipSettings>): Partial<MembershipSettings> {
  const out: Partial<MembershipSettings> = {};
  if (p.enabled !== undefined) out.enabled = !!p.enabled;
  for (const k of ["earn_rp_per_point", "redeem_rp_per_point", "max_redeem_percent", "min_redeem_points"] as const) {
    if (p[k] !== undefined) out[k] = Number(p[k]);
  }
  return out;
}

// ── Members ─────────────────────────────────────────────────────────────────

export type MemberRow = typeof outletsMembersTable.$inferSelect;

// No 0/O, 1/I/L: the code gets read aloud across a counter.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function generateMemberCode(): string {
  let s = "M";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

export async function findMemberByPhone(
  dbx: DbOrTx,
  outletId: number,
  rawPhone: unknown,
): Promise<MemberRow | null> {
  const phone = normalizeIndonesianPhone(rawPhone);
  if (!phone) return null;
  const [m] = await dbx
    .select()
    .from(outletsMembersTable)
    .where(
      and(
        eq(outletsMembersTable.outlet_id, outletId),
        eq(outletsMembersTable.phone, phone),
        isNull(outletsMembersTable.deletedAt),
      ),
    )
    .limit(1);
  return m ?? null;
}

export async function findMemberById(dbx: DbOrTx, outletId: number, id: number): Promise<MemberRow | null> {
  const [m] = await dbx
    .select()
    .from(outletsMembersTable)
    .where(
      and(
        eq(outletsMembersTable.id, id),
        eq(outletsMembersTable.outlet_id, outletId),
        isNull(outletsMembersTable.deletedAt),
      ),
    )
    .limit(1);
  return m ?? null;
}

/**
 * Register a member at the counter. Two fields, because that is all a
 * cashier has time to ask for. Returns MEMBER_EXISTS when the phone is
 * already on this outlet's list, with the existing row attached.
 */
export async function registerMember(
  outletId: number,
  input: { phone: unknown; name: unknown; note?: unknown; tier?: unknown },
): Promise<{ member: MemberRow; created: boolean }> {
  const phone = normalizeIndonesianPhone(input.phone);
  if (!phone) throw new Error("Nomor HP tidak valid");
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Nama wajib diisi");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 255) || null : null;
  const tier = isMemberTier(input.tier) ? input.tier : "silver";

  const existing = await findMemberByPhone(db, outletId, phone);
  if (existing) return { member: existing, created: false };

  // The code is random; a collision inside one outlet is a retry, not a bug.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [member] = await db
        .insert(outletsMembersTable)
        .values({
          outlet_id: outletId,
          phone,
          name: name.slice(0, 100),
          member_code: generateMemberCode(),
          tier,
          tier_manual: tier !== "silver",
          note,
        })
        .returning();
      return { member, created: true };
    } catch (err: any) {
      const code = err?.code ?? err?.cause?.code;
      if (code !== "23505") throw err;
      // Phone raced in between the check and the insert: hand back that row.
      const raced = await findMemberByPhone(db, outletId, phone);
      if (raced) return { member: raced, created: false };
      // Otherwise it was the member_code — loop and draw another.
    }
  }
  throw new Error("Gagal membuat kode member, coba lagi");
}

/**
 * THE single writer of the points ledger and the cached balance.
 *
 * Locks the member row so two sales redeeming from one balance at the same
 * moment serialise: the second one re-reads the balance the first one left.
 */
export async function postPointMovement(
  tx: Tx,
  input: {
    memberId: number;
    outletId: number;
    kind: "earn" | "redeem" | "reversal" | "adjust" | "expire";
    delta: number;
    orderId?: string | null;
    note?: string | null;
    actorUserId?: string | null;
  },
): Promise<{ balanceAfter: number }> {
  if (!Number.isInteger(input.delta)) throw new Error("Poin harus bilangan bulat");
  const [m] = await tx
    .select({ id: outletsMembersTable.id, balance: outletsMembersTable.points_balance })
    .from(outletsMembersTable)
    .where(and(eq(outletsMembersTable.id, input.memberId), eq(outletsMembersTable.outlet_id, input.outletId)))
    .for("update")
    .limit(1);
  if (!m) throw new Error("Member tidak ditemukan");

  const balanceAfter = m.balance + input.delta;
  // A redeem or a downward adjust cannot spend what is not there. Reversals
  // are exempt: undoing an earn after the points were spent elsewhere is an
  // honest negative, and hiding it would make the ledger lie.
  if (balanceAfter < 0 && input.kind !== "reversal") throw new Error("Saldo poin tidak cukup");

  await tx.insert(memberPointMovementsTable).values({
    member_id: input.memberId,
    outlet_id: input.outletId,
    order_id: input.orderId ?? null,
    kind: input.kind,
    delta: input.delta,
    balance_after: balanceAfter,
    note: input.note?.slice(0, 255) ?? null,
    actor_user_id: input.actorUserId ?? null,
  });
  await tx
    .update(outletsMembersTable)
    .set({ points_balance: balanceAfter, updatedAt: new Date() })
    .where(eq(outletsMembersTable.id, input.memberId));
  return { balanceAfter };
}

// ── Quote: what a sale would do ─────────────────────────────────────────────

export type QuoteInput = {
  outletId: number;
  /** Line prices net of the manual discount, before tax. */
  base: number;
  memberId?: number | null;
  memberPhone?: string | null;
  promoCode?: string | null;
  pointsToRedeem?: number | null;
};

export type QuotedMember = {
  id: number;
  name: string;
  phone: string;
  member_code: string;
  tier: MemberTier;
  points_balance: number;
};

export type MembershipQuote = {
  enabled: boolean;
  member: QuotedMember | null;
  memberError: string | null;
  promo: { id: number; code: string; title: string } | null;
  promoError: string | null;
  promoDiscount: number;
  pointsRedeemed: number;
  pointsDiscount: number;
  pointsError: string | null;
  /** Most points this bill could absorb given balance, cap and value. */
  maxRedeemablePoints: number;
  redeemRpPerPoint: number;
  net: number;
  pointsToEarn: number;
  tierMultiplier: number;
};

const EMPTY_QUOTE = (base: number): MembershipQuote => ({
  enabled: false,
  member: null,
  memberError: null,
  promo: null,
  promoError: null,
  promoDiscount: 0,
  pointsRedeemed: 0,
  pointsDiscount: 0,
  pointsError: null,
  maxRedeemablePoints: 0,
  redeemRpPerPoint: 0,
  net: Math.max(0, base),
  pointsToEarn: 0,
  tierMultiplier: 1,
});

/**
 * Resolve member + promo + points against the programme's rules. Pure read
 * unless `lock` is set, in which case the member row is SELECT … FOR UPDATE so
 * the caller (the checkout transaction) can act on the numbers it got back.
 */
export async function quoteMembership(
  dbx: DbOrTx,
  input: QuoteInput,
  opts: { lock?: boolean } = {},
): Promise<MembershipQuote> {
  const base = Math.max(0, Math.round(Number(input.base) || 0));
  const { settings, tiers } = await getMembershipConfig(dbx, input.outletId);
  if (!settings.enabled) return EMPTY_QUOTE(base);

  const q = EMPTY_QUOTE(base);
  q.enabled = true;
  q.redeemRpPerPoint = settings.redeem_rp_per_point;

  // ── Member ──
  let member: MemberRow | null = null;
  if (input.memberId) {
    member = await findMemberById(dbx, input.outletId, Number(input.memberId));
    if (!member) q.memberError = "Member tidak ditemukan";
  } else if (input.memberPhone && String(input.memberPhone).trim()) {
    if (!normalizeIndonesianPhone(input.memberPhone)) q.memberError = "Nomor HP tidak valid";
    else {
      member = await findMemberByPhone(dbx, input.outletId, input.memberPhone);
      if (!member) q.memberError = "Belum terdaftar sebagai member";
    }
  }
  if (member && opts.lock) {
    // Re-read under lock: the balance used below must be the one no
    // concurrent sale can change under us.
    const [locked] = await dbx
      .select()
      .from(outletsMembersTable)
      .where(eq(outletsMembersTable.id, member.id))
      .for("update")
      .limit(1);
    member = locked ?? member;
  }
  const tier: MemberTier = member && isMemberTier(member.tier) ? member.tier : "silver";
  if (member) {
    q.member = {
      id: member.id,
      name: member.name,
      phone: member.phone,
      member_code: member.member_code,
      tier,
      points_balance: member.points_balance,
    };
    q.tierMultiplier = tiers[tier].earn_multiplier;
  }

  // ── Promo ──
  let afterPromo = base;
  const code = String(input.promoCode ?? "").trim().toUpperCase();
  if (code) {
    const [promo] = await dbx
      .select()
      .from(outletPromosTable)
      .where(
        and(
          eq(outletPromosTable.outlet_id, input.outletId),
          eq(outletPromosTable.code, code),
          isNull(outletPromosTable.deletedAt),
        ),
      )
      .limit(1);
    const now = new Date();
    if (!promo || !promo.is_active) q.promoError = "Kode promo tidak ditemukan";
    else if (promo.valid_from && promo.valid_from > now) q.promoError = "Promo belum berlaku";
    else if (promo.valid_until && promo.valid_until < now) q.promoError = "Promo sudah berakhir";
    else if (promo.usage_limit !== null && promo.used_count >= promo.usage_limit) q.promoError = "Kuota promo sudah habis";
    else if (base < promo.min_order) q.promoError = `Minimal belanja Rp ${promo.min_order.toLocaleString("id-ID")}`;
    else if (promo.member_only && !member) q.promoError = "Promo khusus member";
    else if (promo.member_only && promo.tiers.length > 0 && !promo.tiers.includes(tier)) {
      q.promoError = `Promo khusus tier ${promo.tiers.map((t) => TIER_LABEL[t as MemberTier] ?? t).join("/")}`;
    } else {
      if (member && promo.per_member_limit !== null) {
        const [used] = await dbx
          .select({ n: sql<number>`count(*)::int` })
          .from(outletPromoUsesTable)
          .where(and(eq(outletPromoUsesTable.promo_id, promo.id), eq(outletPromoUsesTable.member_id, member.id)));
        if ((used?.n ?? 0) >= promo.per_member_limit) q.promoError = "Member ini sudah memakai promo ini";
      }
      if (!q.promoError) {
        let discount =
          promo.discount_type === "percent"
            ? Math.floor((base * Math.min(100, promo.discount_value)) / 100)
            : promo.discount_value;
        if (promo.discount_type === "percent" && promo.max_discount !== null) {
          discount = Math.min(discount, promo.max_discount);
        }
        discount = Math.max(0, Math.min(discount, base));
        q.promo = { id: promo.id, code: promo.code, title: promo.title };
        q.promoDiscount = discount;
        afterPromo = base - discount;
      }
    }
  }

  // ── Points ──
  if (member) {
    const capByBill = Math.floor((afterPromo * settings.max_redeem_percent) / 100 / settings.redeem_rp_per_point);
    q.maxRedeemablePoints = Math.max(0, Math.min(member.points_balance, capByBill));
    const requested = Math.max(0, Math.floor(Number(input.pointsToRedeem) || 0));
    if (requested > 0) {
      if (requested > member.points_balance) q.pointsError = "Saldo poin tidak cukup";
      else if (requested < settings.min_redeem_points) q.pointsError = `Minimal tukar ${settings.min_redeem_points} poin`;
      else {
        // Silently clip to what the bill can take rather than refuse: the
        // cashier typed "use 100" and the bill only has room for 80.
        q.pointsRedeemed = Math.min(requested, q.maxRedeemablePoints);
        q.pointsDiscount = q.pointsRedeemed * settings.redeem_rp_per_point;
      }
    }
  }

  q.net = Math.max(0, afterPromo - q.pointsDiscount);
  if (member) {
    q.pointsToEarn = Math.floor((q.net / settings.earn_rp_per_point) * q.tierMultiplier);
  }
  return q;
}

// ── Checkout: commit what the quote said ────────────────────────────────────

export type AppliedMembership = {
  memberId: number | null;
  memberName: string | null;
  tier: MemberTier | null;
  tierBefore: MemberTier | null;
  pointsEarned: number;
  pointsRedeemed: number;
  pointsBalance: number | null;
  promoId: number | null;
  promoCode: string | null;
  promoDiscount: number;
  pointsDiscount: number;
};

/**
 * Write the ledger rows, the promo use and the member's running totals for a
 * sale that has just been inserted. Called INSIDE the checkout transaction
 * with a quote produced under lock.
 */
export async function applyMembershipToOrder(
  tx: Tx,
  input: { outletId: number; orderId: string; quote: MembershipQuote; actorUserId: string | null },
): Promise<AppliedMembership> {
  const { quote } = input;
  const out: AppliedMembership = {
    memberId: quote.member?.id ?? null,
    memberName: quote.member?.name ?? null,
    tier: quote.member?.tier ?? null,
    tierBefore: quote.member?.tier ?? null,
    pointsEarned: 0,
    pointsRedeemed: 0,
    pointsBalance: quote.member?.points_balance ?? null,
    promoId: quote.promo?.id ?? null,
    promoCode: quote.promo?.code ?? null,
    promoDiscount: quote.promoDiscount,
    pointsDiscount: quote.pointsDiscount,
  };

  if (quote.promo) {
    await tx.insert(outletPromoUsesTable).values({
      promo_id: quote.promo.id,
      order_id: input.orderId,
      member_id: quote.member?.id ?? null,
      discount_amount: String(quote.promoDiscount),
    });
    await tx
      .update(outletPromosTable)
      .set({ used_count: sql`${outletPromosTable.used_count} + 1`, updatedAt: new Date() })
      .where(eq(outletPromosTable.id, quote.promo.id));
  }

  if (!quote.member) return out;
  const memberId = quote.member.id;

  // Redeem before earn, so the ledger reads in the order the customer saw it:
  // points went out, sale happened, points came in.
  if (quote.pointsRedeemed > 0) {
    const r = await postPointMovement(tx, {
      memberId,
      outletId: input.outletId,
      kind: "redeem",
      delta: -quote.pointsRedeemed,
      orderId: input.orderId,
      note: `Tukar poin, order ${input.orderId.split("-")[0]}`,
      actorUserId: input.actorUserId,
    });
    out.pointsRedeemed = quote.pointsRedeemed;
    out.pointsBalance = r.balanceAfter;
  }
  if (quote.pointsToEarn > 0) {
    const r = await postPointMovement(tx, {
      memberId,
      outletId: input.outletId,
      kind: "earn",
      delta: quote.pointsToEarn,
      orderId: input.orderId,
      note: `Belanja Rp ${quote.net.toLocaleString("id-ID")}`,
      actorUserId: input.actorUserId,
    });
    out.pointsEarned = quote.pointsToEarn;
    out.pointsBalance = r.balanceAfter;
  }

  // Running totals, then the ladder. Promotion only ever goes UP, and never
  // touches a tier the owner set by hand.
  const [updated] = await tx
    .update(outletsMembersTable)
    .set({
      lifetime_spend: sql`${outletsMembersTable.lifetime_spend} + ${String(quote.net)}`,
      visit_count: sql`${outletsMembersTable.visit_count} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(outletsMembersTable.id, memberId))
    .returning({ lifetime_spend: outletsMembersTable.lifetime_spend, tier_manual: outletsMembersTable.tier_manual });

  if (updated && !updated.tier_manual) {
    const { tiers } = await getMembershipConfig(tx, input.outletId);
    const earned = tierForSpend(tiers, Number(updated.lifetime_spend));
    if (TIER_RANK[earned] > TIER_RANK[quote.member.tier]) {
      await tx
        .update(outletsMembersTable)
        .set({ tier: earned, updatedAt: new Date() })
        .where(eq(outletsMembersTable.id, memberId));
      out.tier = earned;
    }
  }
  return out;
}

/** Highest tier whose threshold the spend clears. Silver always qualifies. */
export function tierForSpend(tiers: TierRules, spend: number): MemberTier {
  let best: MemberTier = "silver";
  for (const t of MEMBER_TIERS) {
    if (t === "silver") continue;
    if (spend >= tiers[t].min_lifetime_spend && TIER_RANK[t] > TIER_RANK[best]) best = t;
  }
  return best;
}

/**
 * Undo a cancelled sale's membership effects: reverse its earn and redeem,
 * hand the promo use back, and pull the sale out of the running totals. No
 * tier change — demoting someone because a cashier voided a mistake is not a
 * decision to make by arithmetic.
 */
export async function reverseOrderMembership(
  tx: Tx,
  input: { outletId: number; orderId: string; actorUserId: string | null },
): Promise<void> {
  const [order] = await tx
    .select({
      member_id: ordersTable.member_id,
      outlet_promo_id: ordersTable.outlet_promo_id,
      points_earned: ordersTable.points_earned,
      points_redeemed: ordersTable.points_redeemed,
      note: ordersTable.note,
    })
    .from(ordersTable)
    .where(and(eq(ordersTable.id, input.orderId), eq(ordersTable.outlet_id, input.outletId)))
    .limit(1);
  if (!order) return;

  if (order.outlet_promo_id) {
    await tx.delete(outletPromoUsesTable).where(eq(outletPromoUsesTable.order_id, input.orderId));
    await tx
      .update(outletPromosTable)
      .set({ used_count: sql`greatest(${outletPromosTable.used_count} - 1, 0)`, updatedAt: new Date() })
      .where(eq(outletPromosTable.id, order.outlet_promo_id));
  }

  if (!order.member_id) return;
  const short = input.orderId.split("-")[0];
  if ((order.points_earned ?? 0) > 0) {
    await postPointMovement(tx, {
      memberId: order.member_id,
      outletId: input.outletId,
      kind: "reversal",
      delta: -(order.points_earned ?? 0),
      orderId: input.orderId,
      note: `Batal order ${short}: poin ditarik`,
      actorUserId: input.actorUserId,
    });
  }
  if ((order.points_redeemed ?? 0) > 0) {
    await postPointMovement(tx, {
      memberId: order.member_id,
      outletId: input.outletId,
      kind: "reversal",
      delta: order.points_redeemed ?? 0,
      orderId: input.orderId,
      note: `Batal order ${short}: poin dikembalikan`,
      actorUserId: input.actorUserId,
    });
  }

  // What the sale added to lifetime_spend was its net: lines less every
  // discount. Same arithmetic the cancel handler's fallback uses.
  const [sum] = await tx
    .select({ total: sql<string>`coalesce(sum(cast(${orderDetailsTable.summary_price} as numeric)), 0)` })
    .from(orderDetailsTable)
    .where(eq(orderDetailsTable.order_id, input.orderId));
  const discount = Number((order.note as any)?.discountAmount ?? 0);
  const net = Math.max(0, Number(sum?.total ?? 0) - (Number.isFinite(discount) ? discount : 0));
  await tx
    .update(outletsMembersTable)
    .set({
      lifetime_spend: sql`greatest(${outletsMembersTable.lifetime_spend} - ${String(net)}, 0)`,
      visit_count: sql`greatest(${outletsMembersTable.visit_count} - 1, 0)`,
      updatedAt: new Date(),
    })
    .where(eq(outletsMembersTable.id, order.member_id));
}

/** Recent ledger rows for one member, newest first. */
export async function listPointMovements(outletId: number, memberId: number, limit = 50) {
  return db
    .select()
    .from(memberPointMovementsTable)
    .where(and(eq(memberPointMovementsTable.member_id, memberId), eq(memberPointMovementsTable.outlet_id, outletId)))
    .orderBy(desc(memberPointMovementsTable.created_at), desc(memberPointMovementsTable.id))
    .limit(limit);
}
