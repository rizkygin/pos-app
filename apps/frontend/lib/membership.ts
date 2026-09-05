// Shared membership vocabulary for the counter and the dashboard.
//
// The tier set is fixed on purpose (it is a database enum), so everything that
// renders a badge, filters a promo or prints a receipt can name a tier without
// asking the server what the tiers are.

export const MEMBER_TIERS = ['silver', 'gold', 'platinum', 'diamond'] as const;
export type MemberTier = (typeof MEMBER_TIERS)[number];

export const TIER_LABEL: Record<MemberTier, string> = {
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  diamond: 'Diamond',
};

// Badge colours, light and dark. Metal-ish rather than the app's rose, so a
// tier badge never reads as a call to action.
export const TIER_BADGE: Record<MemberTier, string> = {
  silver:
    'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  gold: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
  platinum:
    'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-900',
  diamond:
    'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-900',
};

export type QuotedMember = {
  id: number;
  name: string;
  phone: string;
  member_code: string;
  tier: MemberTier;
  points_balance: number;
};

/** What POST /api/membership/quote answers. Mirrors MembershipQuote on the backend. */
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
  maxRedeemablePoints: number;
  redeemRpPerPoint: number;
  net: number;
  pointsToEarn: number;
  tierMultiplier: number;
};

/** Canonical 628… back to the 08… form Indonesian readers expect. */
export function displayPhone(canonical: string): string {
  return canonical.startsWith('62') ? `0${canonical.slice(2)}` : canonical;
}
