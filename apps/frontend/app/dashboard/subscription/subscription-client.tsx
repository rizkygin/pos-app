'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Crown,
  Sparkles,
  Check,
  X,
  Copy,
  Clock,
  Upload,
  Loader2,
  BadgeCheck,
  Hourglass,
  Landmark,
  Store,
  Monitor,
  ClipboardCheck,
  Bell,
  Percent,
  Armchair,
  ChefHat,
  History,
  Smartphone,
  QrCode,
  Receipt,
  ShoppingBag,
  Boxes,
  Wallet,
  BarChart3,
  FileBarChart,
  XCircle,
  UsersRound,
  CalendarCheck,
  ImagePlus,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { API_URL } from '@/lib/api-url';

type Plan = {
  id: number;
  tier: 'basic' | 'pro' | 'max_lite' | 'max' | 'ultimax';
  interval: 'monthly' | 'yearly';
  name: string;
  price: string;
  trial_days: number;
  features: {
    maxOutlets?: number | null;
    maxEmployees?: number;
    desktopCashier?: boolean;
    customerCanOrder?: boolean;
    salesInvoice?: boolean;
    purchaseInvoice?: boolean;
    stock?: boolean;
    cashflow?: boolean;
    report?: boolean;
    reportInvoice?: boolean;
    cashierShift?: boolean;
    pager?: boolean;
    tax?: boolean;
    tableManagement?: boolean;
    kitchenDisplay?: boolean;
    selfOrder?: boolean;
    membership?: boolean;
  };
};

type Payment = {
  id: number;
  tier: string;
  interval: 'monthly' | 'yearly';
  amount_due: string;
  status: 'pending' | 'paid' | 'rejected' | 'expired' | 'failed' | 'refunded';
  proof_image: string | null;
  review_note: string | null;
  expires_at: string | null;
  paid_at: string | null;
  period_end: string | null;
  created_at: string;
};

type Subscription = {
  id: number;
  tier: Plan['tier'] | null;
  status: 'trialing' | 'active' | 'past_due' | 'expired' | 'canceled';
  trial_ends_at: string | null;
  current_period_end: string | null;
  // Scheduled downgrade: tier switches to next_tier at next_tier_at.
  next_tier: Plan['tier'] | null;
  next_tier_at: string | null;
  // Staff quota granted to THIS account by an admin, overriding the tier's
  // number on the plan cards below. NULL = the plan's own cap applies.
  max_employees_override: number | null;
};

type Bank = { bank: string; account_number: string; account_holder: string };

// Marketing deal for THIS merchant (from the plans endpoint). NULL tier or
// interval means the deal applies to any.
type Deal = {
  pct: number;
  tier: Plan['tier'] | null;
  interval: 'monthly' | 'yearly' | null;
  note: string;
};

// Paid staff seats an admin granted this account (the price side of
// max_employees_override). seat_price is per seat per MONTH; a yearly plan
// bills 12 of them. It is added AFTER the deal — a discount is on the plan,
// these seats are not — and the backend prices the payment the same way, so
// the card total below is exactly what the merchant will be asked to transfer.
type Addon = {
  seats: number;
  seat_price: number;
  note: string;
};

const rupiah = (v: number | string) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(v) || 0);

const tglPanjang = (d: string | Date | null) =>
  d
    ? new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—';

const tglJam = (d: string) =>
  new Date(d).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

// Same calendar arithmetic the backend uses when it extends a period
// (addInterval in lib/subscription.ts): +1 month or +12.
const addInterval = (from: string | Date, interval: 'monthly' | 'yearly') => {
  const d = new Date(from);
  d.setMonth(d.getMonth() + (interval === 'monthly' ? 1 : 12));
  return d;
};

const TIER_LABEL: Record<Plan['tier'], string> = {
  basic: 'Basic',
  pro: 'Pro',
  max_lite: 'Max Lite',
  max: 'Max',
  ultimax: 'Ultimax',
};
const TIER_RANK: Record<Plan['tier'], number> = { basic: 0, pro: 1, max_lite: 2, max: 3, ultimax: 4 };
const TIER_TAGLINE: Record<Plan['tier'], string> = {
  basic: 'Untuk usaha yang baru mulai',
  pro: 'Paling pas untuk usaha berkembang',
  max_lite: 'Multi-outlet + kasir desktop',
  max: 'Tanpa batas, semua fitur',
  ultimax: 'Max + membership di semua outlet',
};
const INTERVAL_LABEL = { monthly: 'Bulanan', yearly: 'Tahunan' } as const;
const INTERVAL_SPAN = { monthly: '1 bulan', yearly: '1 tahun' } as const;

const SUB_STATUS_LABEL: Record<Subscription['status'], string> = {
  trialing: 'Masa Percobaan',
  active: 'Aktif',
  past_due: 'Terlambat',
  expired: 'Kedaluwarsa',
  canceled: 'Berhenti',
};

// A pending payment means two very different things to the merchant: no proof
// yet = THEY still owe a transfer; proof sent = WE owe a review. One "Menunggu
// konfirmasi" label for both told owners with an unpaid bill they were done.
function payStatus(p: Payment): { label: string; cls: string } {
  if (p.status === 'pending' && !p.proof_image)
    return { label: 'Belum dibayar', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' };
  if (p.status === 'pending')
    return { label: 'Dicek admin', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300' };
  const map: Record<Payment['status'], { label: string; cls: string }> = {
    pending: { label: '', cls: '' },
    paid: { label: 'Lunas', cls: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300' },
    rejected: { label: 'Ditolak', cls: 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-300' },
    // Cancelled by the merchant or never paid in time — either way, closed.
    expired: { label: 'Batal', cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
    failed: { label: 'Gagal', cls: 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-300' },
    refunded: { label: 'Refund', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  };
  return map[p.status];
}

// One plan-card feature line: rose icon when the tier includes it, muted
// struck-through with an ✗ when it doesn't (visual upsell nudge).
function FeatureRow({
  ok,
  icon: Icon,
  children,
}: {
  ok: boolean;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-2">
      {ok ? (
        <Icon className="size-3.5 shrink-0 text-rose-500" />
      ) : (
        <X className="size-3.5 shrink-0 text-muted-foreground/50" />
      )}
      <span className={ok ? '' : 'text-muted-foreground/60 line-through'}>{children}</span>
    </li>
  );
}

// Numbered step of the bill checklist; a done step trades its number for a tick.
function Step({
  n,
  title,
  done,
  active,
  className = '',
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  active?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <li className={`flex gap-3 ${className}`}>
      <span
        className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${
          done
            ? 'bg-green-600 text-white'
            : active
              ? 'bg-rose-600 text-white'
              : 'bg-muted text-muted-foreground'
        }`}
      >
        {done ? <Check className="size-4" /> : n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className={`text-sm font-bold ${done ? 'text-muted-foreground' : ''}`}>{title}</p>
        {children && <div className="mt-2">{children}</div>}
      </div>
    </li>
  );
}

export function SubscriptionClient() {
  const [loading, setLoading] = useState(true);
  // Read the clock once per visit: "days left" and "is the period still
  // running" only need day precision, and render must stay pure.
  const [now] = useState(Date.now);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [addon, setAddon] = useState<Addon | null>(null);
  const [bank, setBank] = useState<Bank | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [interval, setIntervalChoice] = useState<'monthly' | 'yearly'>('monthly');
  const [copied, setCopied] = useState<string | null>(null);

  // Two-step plan choice: the card button only OPENS this; the bill is created
  // from the dialog. A single tap used to create a real bill, and owners who
  // were only looking left unpaid bills in the admin queue.
  const [checkout, setCheckout] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [canceling, setCanceling] = useState(false);

  // proof upload form
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [senderBank, setSenderBank] = useState('');
  const [senderName, setSenderName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showResend, setShowResend] = useState(false);
  const payRef = useRef<HTMLDivElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);

  const fetchAll = useCallback(async () => {
    const [subRes, planRes] = await Promise.all([
      fetch(`${API_URL}/api/my-subscription`, { credentials: 'include' }),
      fetch(`${API_URL}/api/subscription-plans`, { credentials: 'include' }),
    ]);
    const subJson = await subRes.json();
    const planJson = await planRes.json();
    if (subJson.success) {
      setSubscription(subJson.data.subscription);
      setPayments(subJson.data.payments ?? []);
      setBank(subJson.bank);
    }
    if (planJson.success) {
      setPlans(planJson.data);
      setDeal(planJson.deal ?? null);
      setAddon(planJson.addon ?? null);
    }
  }, []);

  useEffect(() => {
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

  const proofPreview = useMemo(() => (proofFile ? URL.createObjectURL(proofFile) : null), [proofFile]);
  useEffect(
    () => () => {
      if (proofPreview) URL.revokeObjectURL(proofPreview);
    },
    [proofPreview],
  );

  // The payment the merchant can still act on: a pending one (waiting/upload),
  // or — when none is pending — the most recent REJECTED one, which can be
  // re-submitted with a corrected proof (the money may already be transferred).
  const pendingPayment = useMemo(
    () => payments.find((p) => p.status === 'pending') ?? null,
    [payments],
  );
  const rejectedPayment = useMemo(
    () => (pendingPayment ? null : (payments.find((p) => p.status === 'rejected') ?? null)),
    [payments, pendingPayment],
  );
  const actionablePayment = pendingPayment ?? rejectedPayment;
  const isRejectedResubmit = !pendingPayment && !!rejectedPayment;
  const proofSent = !!pendingPayment?.proof_image;
  // Unpaid = the only state a merchant may take back; once a proof is in, the
  // money may be in our account and the bill is the admin's to close.
  const unpaid = !!pendingPayment && !proofSent;

  const daysLeft = useMemo(() => {
    if (!subscription?.current_period_end) return null;
    const ms = new Date(subscription.current_period_end).getTime() - now;
    return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
  }, [subscription, now]);

  // Real yearly savings per tier vs paying 12× monthly — each tier's yearly
  // price is derived from a DIFFERENT monthly base, so the percentage is not
  // uniform (basic 10%, pro ~21%, ...). Computed from live plan data.
  const yearlySavingsByTier = useMemo(() => {
    const monthly = new Map(
      plans.filter((p) => p.interval === 'monthly').map((p) => [p.tier, Number(p.price)]),
    );
    const map = new Map<Plan['tier'], number>();
    for (const p of plans) {
      if (p.interval !== 'yearly') continue;
      const m = monthly.get(p.tier);
      if (!m) continue;
      map.set(p.tier, Math.round((1 - Number(p.price) / (m * 12)) * 100));
    }
    return map;
  }, [plans]);
  const maxYearlySavings = useMemo(
    () => Math.max(0, ...yearlySavingsByTier.values()),
    [yearlySavingsByTier],
  );

  // What a plan costs THIS merchant — deal on the plan, staff seats on top —
  // mirroring renewalQuote on the backend (before the 3-digit unique code).
  const priceOf = useCallback(
    (p: Plan) => {
      const dealApplies =
        !!deal &&
        (!deal.tier || deal.tier === p.tier) &&
        (!deal.interval || deal.interval === p.interval);
      const effPrice = dealApplies ? Math.round(Number(p.price) * (1 - deal!.pct / 100)) : Number(p.price);
      const addonPerMonth = addon ? addon.seats * addon.seat_price : 0;
      const addonAmount = Math.round(addonPerMonth * (p.interval === 'yearly' ? 12 : 1));
      return { dealApplies, effPrice, addonPerMonth, addonAmount, totalDue: effPrice + addonAmount };
    },
    [deal, addon],
  );

  const isLive =
    (subscription?.status === 'trialing' || subscription?.status === 'active') &&
    !!subscription.current_period_end &&
    new Date(subscription.current_period_end).getTime() > now;

  // On a phone the plans are a sideways carousel starting at Basic; open it on
  // the merchant's own plan instead so "Perpanjang" is the first thing seen.
  useEffect(() => {
    const box = carouselRef.current;
    const card = box?.querySelector<HTMLElement>('[data-current="true"]');
    if (!box || !card || box.scrollWidth <= box.clientWidth) return;
    box.scrollLeft = card.offsetLeft - (box.clientWidth - card.clientWidth) / 2;
  }, [interval, plans.length, subscription?.tier]);

  const scrollToBill = () => setTimeout(() => payRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);

  const createBill = async (plan: Plan) => {
    setCreating(true);
    try {
      const res = await fetch(`${API_URL}/api/subscription-payments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: plan.id }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || 'Gagal membuat tagihan');
        return;
      }
      setCheckout(null);
      await fetchAll();
      toast.success('Tagihan dibuat — transfer, lalu kirim bukti transfernya di sini.');
      scrollToBill();
    } catch {
      toast.error('Gagal terhubung ke server');
    } finally {
      setCreating(false);
    }
  };

  const cancelBill = async () => {
    if (!pendingPayment) return;
    setCanceling(true);
    try {
      const res = await fetch(`${API_URL}/api/subscription-payments/${pendingPayment.id}/cancel`, {
        method: 'POST',
        credentials: 'include',
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || 'Gagal membatalkan tagihan');
      } else {
        toast.success('Tagihan dibatalkan.');
      }
      setConfirmCancel(false);
      await fetchAll();
    } catch {
      toast.error('Gagal terhubung ke server');
    } finally {
      setCanceling(false);
    }
  };

  const uploadProof = async () => {
    if (!actionablePayment || !proofFile) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', proofFile);
      fd.append('sender_bank', senderBank);
      fd.append('sender_name', senderName);
      const res = await fetch(
        `${API_URL}/api/subscription-payments/${actionablePayment.id}/proof`,
        { method: 'POST', credentials: 'include', body: fd },
      );
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || 'Gagal mengunggah bukti');
        return;
      }
      setProofFile(null);
      setShowResend(false);
      await fetchAll();
      toast.success('Bukti terkirim! Admin akan mengonfirmasi, biasanya kurang dari 24 jam.');
    } catch {
      toast.error('Gagal terhubung ke server');
    } finally {
      setUploading(false);
    }
  };

  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  // ---- checkout dialog copy: say what this bill will DO before it exists ----
  const checkoutInfo = (() => {
    if (!checkout) return null;
    const label = TIER_LABEL[checkout.tier];
    const span = INTERVAL_SPAN[checkout.interval];
    const curTier = subscription?.tier ?? null;
    const end = subscription?.current_period_end ?? null;
    const isTrial = isLive && subscription?.status === 'trialing';
    const sameTier = !curTier || curTier === checkout.tier;
    let title: string;
    let effect: string;
    if (!isLive || !end) {
      title = `Langganan paket ${label}?`;
      effect = `Aktif ${span} sejak pembayaran dikonfirmasi admin.`;
    } else if (isTrial) {
      title = `Bayar paket ${label}?`;
      effect = `Menyambung setelah masa percobaan: aktif sampai ${tglPanjang(addInterval(end, checkout.interval))}.`;
    } else if (sameTier) {
      title = `Perpanjang paket ${label}?`;
      effect = `Masa aktif bertambah ${span}: dari ${tglPanjang(end)} menjadi sampai ${tglPanjang(addInterval(end, checkout.interval))}.`;
    } else if (TIER_RANK[checkout.tier] > TIER_RANK[curTier!]) {
      title = `Naik ke paket ${label}?`;
      effect = `Paket langsung naik ke ${label} begitu dikonfirmasi. Sisa masa aktif ${TIER_LABEL[curTier!]} tidak hangus — diubah jadi hari bonus di paket baru.`;
    } else {
      title = `Turun ke paket ${label}?`;
      effect = `${TIER_LABEL[curTier!]} tetap aktif sampai ${tglPanjang(end)}, lalu pindah ke ${label} sampai ${tglPanjang(addInterval(end, checkout.interval))}.`;
    }
    const replaces =
      unpaid && pendingPayment && !(pendingPayment.tier === checkout.tier && pendingPayment.interval === checkout.interval)
        ? pendingPayment
        : null;
    return { title, effect, replaces, price: priceOf(checkout) };
  })();

  return (
    <div className="mx-auto max-w-5xl space-y-6 md:space-y-8">
      {/* ================= status hero ================= */}
      <div
        className={`relative overflow-hidden rounded-3xl p-6 md:p-8 text-white shadow-lg ${
          isLive
            ? 'bg-gradient-to-br from-rose-500 via-rose-600 to-pink-600'
            : 'bg-gradient-to-br from-zinc-600 to-zinc-800'
        }`}
      >
        <Sparkles className="pointer-events-none absolute -right-6 -top-6 size-40 opacity-10" />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-white/70">
              <Crown className="size-3.5" /> Paket Pian sekarang
            </p>
            <h2 className="mt-1 text-2xl font-black tracking-tight md:text-3xl">
              {subscription?.tier ? TIER_LABEL[subscription.tier as Plan['tier']] : subscription?.status === 'trialing' ? 'Masa Percobaan' : 'Belum Berlangganan'}
            </h2>
            <p className="mt-1 text-sm text-white/80">
              {subscription
                ? `${SUB_STATUS_LABEL[subscription.status]}${
                    subscription.current_period_end
                      ? ` · sampai ${tglPanjang(subscription.current_period_end)}`
                      : ''
                  }`
                : 'Pilih paket di bawah untuk mulai — lengkap dengan masa percobaan gratis.'}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {subscription?.next_tier && subscription.next_tier_at && (
                <span className="inline-block rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold backdrop-blur">
                  ↓ Pindah ke {TIER_LABEL[subscription.next_tier]} mulai{' '}
                  {tglPanjang(subscription.next_tier_at)}
                </span>
              )}
              {/* Admin-granted seats: the plan cards below still advertise the
                  tier's number, so say the real one here. */}
              {subscription?.max_employees_override != null && (
                <span className="inline-block rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold backdrop-blur">
                  <UsersRound className="mr-1 inline size-3" />
                  Kuota khusus: {subscription.max_employees_override} akun karyawan
                  {addon ? ` · ${rupiah(addon.seats * addon.seat_price)}/bln` : ' · gratis'}
                </span>
              )}
            </div>
          </div>
          {daysLeft !== null && isLive && (
            <div className="rounded-2xl bg-white/15 px-4 py-2.5 text-center backdrop-blur">
              <p className="text-2xl font-black leading-none tabular-nums">{daysLeft}</p>
              <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-white/70">
                hari tersisa
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ================= the open bill, as a checklist =================
          unpaid → transfer + send proof (cancellable); proof sent → waiting on
          admin; rejected → reason + re-upload (same unique amount — their money
          may already be transferred). */}
      {actionablePayment && bank && (
        <div
          ref={payRef}
          className={`scroll-mt-4 overflow-hidden rounded-3xl border-2 ${
            isRejectedResubmit
              ? 'border-red-300 dark:border-red-900'
              : proofSent
                ? 'border-sky-200 dark:border-sky-900'
                : 'border-amber-300 dark:border-amber-800'
          }`}
        >
          <div
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 md:px-6 ${
              isRejectedResubmit
                ? 'bg-red-50 dark:bg-red-950/40'
                : proofSent
                  ? 'bg-sky-50 dark:bg-sky-950/40'
                  : 'bg-amber-50 dark:bg-amber-950/40'
            }`}
          >
            <div className="flex min-w-0 items-center gap-2">
              {isRejectedResubmit ? (
                <XCircle className="size-5 shrink-0 text-red-600 dark:text-red-400" />
              ) : proofSent ? (
                <BadgeCheck className="size-5 shrink-0 text-sky-600 dark:text-sky-400" />
              ) : (
                <Hourglass className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
              )}
              <div className="min-w-0">
                <p
                  className={`text-sm font-black ${
                    isRejectedResubmit
                      ? 'text-red-700 dark:text-red-300'
                      : proofSent
                        ? 'text-sky-700 dark:text-sky-300'
                        : 'text-amber-800 dark:text-amber-300'
                  }`}
                >
                  {isRejectedResubmit
                    ? 'Pembayaran ditolak — kirim ulang bukti transfer'
                    : proofSent
                      ? 'Bukti terkirim — menunggu konfirmasi admin'
                      : 'Tagihan belum dibayar'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Paket {TIER_LABEL[actionablePayment.tier as Plan['tier']] ?? actionablePayment.tier}{' '}
                  {INTERVAL_LABEL[actionablePayment.interval]}
                  {unpaid && actionablePayment.expires_at && (
                    <>
                      {' '}· <Clock className="inline size-3" /> bayar sebelum {tglJam(actionablePayment.expires_at)}
                    </>
                  )}
                </p>
              </div>
            </div>
            {unpaid && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmCancel(true)}
              >
                <X className="size-3.5" /> Batalkan tagihan
              </Button>
            )}
          </div>
          {isRejectedResubmit && actionablePayment.review_note && (
            <p className="border-b border-red-100 bg-red-50/50 px-4 py-2 text-xs text-red-700 md:px-6 dark:border-red-950 dark:bg-red-950/20 dark:text-red-400">
              Alasan admin: <b>{actionablePayment.review_note}</b>
            </p>
          )}

          <ol className="grid gap-6 p-4 md:grid-cols-2 md:gap-8 md:p-6">
            <Step n={1} title="Transfer tepat sesuai nominal" done={proofSent} active={!proofSent}>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-3xl font-black tabular-nums tracking-tight">
                      {rupiah(Number(actionablePayment.amount_due) - (Number(actionablePayment.amount_due) % 1000))
                        .replace(/ /g, ' ')
                        .slice(0, -3)}
                      <span className="rounded-md bg-rose-100 px-0.5 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                        {String(Math.round(Number(actionablePayment.amount_due)) % 1000).padStart(3, '0')}
                      </span>
                    </p>
                    <button
                      onClick={() => copy(String(Math.round(Number(actionablePayment.amount_due))), 'amount')}
                      className="flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
                    >
                      {copied === 'amount' ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
                      {copied === 'amount' ? 'Tersalin' : 'Salin'}
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    3 digit terakhir (<b className="text-rose-600 dark:text-rose-400">merah</b>) adalah kode unik
                    Pian — jangan dibulatkan, supaya transfer Pian langsung dikenali.
                  </p>
                </div>

                <div className="rounded-2xl border bg-muted/30 p-3.5">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    <Landmark className="size-3.5" /> Ke rekening
                  </p>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <div>
                      <p className="font-bold">
                        {bank.bank} <span className="font-mono tabular-nums">{bank.account_number}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">a.n. {bank.account_holder}</p>
                    </div>
                    <button
                      onClick={() => copy(bank.account_number, 'rek')}
                      className="flex items-center gap-1 rounded-lg border bg-background px-2 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
                    >
                      {copied === 'rek' ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
                      {copied === 'rek' ? 'Tersalin' : 'Salin'}
                    </button>
                  </div>
                </div>
              </div>
            </Step>

            <Step
              n={2}
              title={isRejectedResubmit ? 'Kirim ulang bukti transfer' : 'Kirim bukti transfer'}
              done={proofSent}
              active={!proofSent}
            >
              {proofSent && !showResend ? (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400">
                    <BadgeCheck className="size-4" /> Bukti sudah kami terima.
                  </p>
                  <button
                    onClick={() => setShowResend(true)}
                    className="text-xs font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    Salah kirim foto? Kirim ulang
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed p-3 transition-colors ${
                      proofFile
                        ? 'border-green-300 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20'
                        : 'border-rose-300 bg-rose-50/40 hover:bg-rose-50 dark:border-rose-800 dark:bg-rose-950/20'
                    }`}
                  >
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
                    />
                    {proofPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                      <img src={proofPreview} alt="Bukti transfer" className="size-14 shrink-0 rounded-lg border object-cover" />
                    ) : (
                      <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                        <ImagePlus className="size-6" />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block text-sm font-bold">
                        {proofFile ? 'Foto siap dikirim' : 'Pilih foto / screenshot bukti transfer'}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {proofFile ? `${proofFile.name} · ketuk untuk ganti` : 'Dari galeri atau kamera'}
                      </span>
                    </span>
                  </label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-medium text-muted-foreground">Bank pengirim (opsional)</span>
                      <Input placeholder="cth. BRI" value={senderBank} onChange={(e) => setSenderBank(e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-medium text-muted-foreground">Nama pengirim (opsional)</span>
                      <Input placeholder="sesuai rekening" value={senderName} onChange={(e) => setSenderName(e.target.value)} />
                    </label>
                  </div>
                  <Button
                    onClick={uploadProof}
                    disabled={!proofFile || uploading}
                    size="lg"
                    className="h-11 w-full bg-rose-600 text-sm font-bold text-white hover:bg-rose-700"
                  >
                    {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                    Kirim Bukti Transfer
                  </Button>
                  {!proofFile && (
                    <p className="text-center text-[11px] text-muted-foreground">
                      Pilih foto bukti dulu, lalu tekan Kirim.
                    </p>
                  )}
                </div>
              )}
            </Step>

            <Step n={3} title="Admin mengonfirmasi" active={proofSent} className="md:col-span-2">
              <p className="text-xs text-muted-foreground">
                Biasanya kurang dari 24 jam setelah bukti dikirim. Masa aktif paket otomatis
                bertambah dan kuitansi dikirim ke email Pian.
              </p>
            </Step>
          </ol>
        </div>
      )}

      {/* ================= plans ================= */}
      <div className="space-y-4 md:mx-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold tracking-tight">
              {isLive && subscription?.tier ? 'Perpanjang atau ganti paket' : 'Pilih Paket'}
            </h3>
            <p className="text-xs text-muted-foreground">
              Tagihan baru dibuat setelah Pian menekan <b>Buat Tagihan</b> di langkah berikutnya.
            </p>
          </div>
          <div className="flex items-center rounded-full border p-1">
            <button
              onClick={() => setIntervalChoice('monthly')}
              className={`rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${
                interval === 'monthly' ? 'bg-rose-600 text-white' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Bulanan
            </button>
            <button
              onClick={() => setIntervalChoice('yearly')}
              className={`rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${
                interval === 'yearly' ? 'bg-rose-600 text-white' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Tahunan{' '}
              {maxYearlySavings > 0 && (
                <span className={interval === 'yearly' ? 'text-white/80' : 'text-rose-500'}>
                  · hemat s.d. {maxYearlySavings}%
                </span>
              )}
            </button>
          </div>
        </div>

        {proofSent && (
          <p className="flex items-start gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Pembayaran Pian sedang dicek admin. Pilihan paket dibuka lagi setelah dikonfirmasi.
          </p>
        )}

        {/* Mobile: horizontal snap carousel (4 stacked cards = too much
            scrolling); sm+: normal grid. */}
        {/* pt-3/-mt-3: the badge floats 12px ABOVE its card; an
            overflow-x-auto container clips vertical overflow too, so give the
            scroll box internal top padding for the badge to live in. */}
        <div
          ref={carouselRef}
          className="-mx-4 -mt-3 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pt-3 pb-2 scrollbar-hide sm:mx-0 sm:mt-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pt-3 sm:pb-0 lg:grid-cols-3 xl:grid-cols-5"
        >
          {plans
            .filter((p) => p.interval === interval)
            .map((p) => {
              const isCurrent = isLive && subscription?.tier === p.tier;
              const highlight = p.tier === 'pro';
              const hasBill = unpaid && pendingPayment!.tier === p.tier && pendingPayment!.interval === p.interval;
              const { dealApplies, effPrice, addonPerMonth, addonAmount, totalDue } = priceOf(p);
              const perMonth = interval === 'yearly' ? effPrice / 12 : effPrice;
              const basePerMonth = interval === 'yearly' ? Number(p.price) / 12 : Number(p.price);
              const f = p.features ?? {};
              return (
                <div
                  key={p.id}
                  data-current={isCurrent}
                  className={`relative flex w-[78vw] max-w-72 shrink-0 snap-center flex-col rounded-3xl border-2 p-5 transition-shadow hover:shadow-lg sm:w-auto sm:max-w-none sm:shrink ${
                    isCurrent
                      ? 'border-rose-500 bg-gradient-to-b from-rose-50/80 to-transparent ring-4 ring-rose-500/10 dark:from-rose-950/30'
                      : highlight
                        ? 'border-rose-300 dark:border-rose-800'
                        : 'border-border'
                  }`}
                >
                  {(isCurrent || highlight) && (
                    <span
                      className={`absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-0.5 text-[10px] font-black uppercase tracking-wider shadow ${
                        isCurrent
                          ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                          : 'bg-gradient-to-r from-rose-500 to-pink-600 text-white'
                      }`}
                    >
                      {isCurrent ? 'Paket Pian' : 'Terpopuler'}
                    </span>
                  )}
                  <p className="text-sm font-black uppercase tracking-wide">{TIER_LABEL[p.tier]}</p>
                  <p className="mt-0.5 min-h-8 text-[11px] leading-snug text-muted-foreground">
                    {TIER_TAGLINE[p.tier]}
                  </p>
                  <p className="mt-3">
                    {dealApplies && (
                      <span className="mr-1.5 text-sm text-muted-foreground line-through tabular-nums">
                        {rupiah(basePerMonth)}
                      </span>
                    )}
                    <span className="text-2xl font-black tabular-nums tracking-tight">
                      {rupiah(perMonth)}
                    </span>
                    <span className="text-xs text-muted-foreground">/bln</span>
                  </p>
                  {dealApplies && (
                    <span className="mt-1 inline-block rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                      Diskon {deal!.pct}% khusus Pian 🎉
                    </span>
                  )}
                  {addonAmount > 0 && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      + {rupiah(addonPerMonth)}/bln · {addon!.seats} akun karyawan tambahan
                      {addon!.note ? ` (${addon!.note})` : ''}
                    </p>
                  )}
                  {interval === 'yearly' && (
                    <p className="text-[11px] text-muted-foreground">
                      ditagih {rupiah(totalDue)}/tahun
                      {(yearlySavingsByTier.get(p.tier) ?? 0) > 0 && (
                        <span className="font-bold text-rose-600 dark:text-rose-400">
                          {' '}· hemat {yearlySavingsByTier.get(p.tier)}%
                        </span>
                      )}
                    </p>
                  )}
                  {/* Monthly cards have no "ditagih" line to fold the add-on
                      into, so the payable total gets its own — nobody should
                      click a price and then be quoted a bigger one. */}
                  {addonAmount > 0 && interval === 'monthly' && (
                    <p className="text-[11px] font-semibold">
                      total {rupiah(totalDue)}/bln
                    </p>
                  )}
                  <ul className="mt-4 flex-1 space-y-2 text-xs">
                    <FeatureRow ok icon={Store}>
                      {f.maxOutlets == null ? 'Outlet tanpa batas' : `${f.maxOutlets} outlet`}
                    </FeatureRow>
                    <FeatureRow ok={(f.maxEmployees ?? 0) > 0} icon={UsersRound}>
                      {(f.maxEmployees ?? 0) > 0 ? `${f.maxEmployees} akun karyawan` : 'Akun karyawan'}
                    </FeatureRow>
                    <FeatureRow ok={!!f.customerCanOrder} icon={Smartphone}>
                      Pelanggan order online
                    </FeatureRow>
                    <FeatureRow ok={!!f.cashflow} icon={Wallet}>
                      Buku kas
                    </FeatureRow>
                    <FeatureRow ok={!!f.report} icon={BarChart3}>
                      Laporan penjualan
                    </FeatureRow>
                    <FeatureRow ok={!!f.salesInvoice} icon={Receipt}>
                      Faktur penjualan
                    </FeatureRow>
                    <FeatureRow ok={!!f.purchaseInvoice} icon={ShoppingBag}>
                      Faktur pembelian
                    </FeatureRow>
                    <FeatureRow ok={!!f.reportInvoice} icon={FileBarChart}>
                      Laporan faktur
                    </FeatureRow>
                    <FeatureRow ok={!!f.stock} icon={Boxes}>
                      Manajemen stok
                    </FeatureRow>
                    <FeatureRow ok={!!f.cashierShift} icon={ClipboardCheck}>
                      Shift kasir &amp; laporan penutupan
                    </FeatureRow>
                    <FeatureRow ok={!!f.pager} icon={Bell}>
                      Nomor pager &amp; tiket dapur
                    </FeatureRow>
                    <FeatureRow ok={!!f.tax} icon={Percent}>
                      Pajak kasir (PB1 / PPN)
                    </FeatureRow>
                    <FeatureRow ok={!!f.selfOrder} icon={QrCode}>
                      Pesan Mandiri — pelanggan pesan dari HP (QR)
                    </FeatureRow>
                    <FeatureRow ok={!!f.tableManagement} icon={Armchair}>
                      Manajemen meja &amp; bill meja
                    </FeatureRow>
                    <FeatureRow ok={!!f.kitchenDisplay} icon={ChefHat}>
                      Layar dapur (KDS)
                    </FeatureRow>
                    <FeatureRow ok={!!f.membership} icon={Crown}>
                      Membership, poin &amp; promo outlet
                    </FeatureRow>
                    <FeatureRow ok={!!f.desktopCashier} icon={Monitor}>
                      Aplikasi kasir desktop
                    </FeatureRow>
                    {p.trial_days > 0 && !subscription && (
                      <li className="flex items-center gap-2 font-semibold text-rose-600 dark:text-rose-400">
                        <Sparkles className="size-3.5 shrink-0" />
                        Gratis {p.trial_days} hari pertama
                      </li>
                    )}
                  </ul>
                  <Button
                    onClick={() => (hasBill ? scrollToBill() : setCheckout(p))}
                    disabled={proofSent}
                    className={`mt-4 h-10 w-full font-bold shadow-sm ${
                      hasBill
                        ? 'border-2 border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                        : isCurrent
                          ? 'bg-gradient-to-r from-rose-600 to-pink-600 text-white hover:from-rose-700 hover:to-pink-700'
                          : 'border-2 border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:border-rose-400 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/70'
                    }`}
                  >
                    {/* Current tier stays clickable: a trialing merchant still
                        has to PAY it, and an active one can renew early. */}
                    {hasBill
                      ? 'Lihat tagihan'
                      : isCurrent && subscription?.status === 'trialing'
                        ? 'Bayar Paket Ini'
                        : isCurrent
                          ? `Perpanjang ${INTERVAL_SPAN[p.interval]}`
                          : `Pilih ${TIER_LABEL[p.tier]}`}
                  </Button>
                </div>
              );
            })}
        </div>
        <p className="text-center text-[11px] text-muted-foreground sm:hidden">
          ← geser untuk melihat paket lain →
        </p>
        <p className="text-center text-[11px] text-muted-foreground">
          Ganti paket kapan saja — masa aktif yang tersisa tidak hangus, paket baru menyambung
          setelahnya.
        </p>
      </div>

      {/* ================= payment history ================= */}
      {payments.length > 0 && (
        <div className="space-y-3">
          <h3 className="flex items-center gap-1.5 text-sm font-bold tracking-tight text-muted-foreground">
            <History className="size-4" /> Riwayat Pembayaran
          </h3>
          {/* Div rows instead of a table: nothing to overflow sideways on a
              phone — left = plan + date, right = amount + status. */}
          <div className="rounded-2xl border">
            {payments.map((p) => {
              const st = payStatus(p);
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 border-b px-3.5 py-2.5 last:border-0 md:px-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {TIER_LABEL[p.tier as Plan['tier']] ?? p.tier}{' '}
                      <span className="text-xs text-muted-foreground">· {INTERVAL_LABEL[p.interval]}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(p.created_at).toLocaleDateString('id-ID', {
                        day: '2-digit',
                        month: 'short',
                        year: '2-digit',
                      })}
                      {p.status === 'paid' && p.period_end && ` · aktif s/d ${tglPanjang(p.period_end)}`}
                    </p>
                    {p.review_note && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={p.review_note}>
                        {p.review_note}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold tabular-nums">{rupiah(p.amount_due)}</p>
                    <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>
                      {st.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ================= checkout: confirm before a bill exists ================= */}
      <Dialog open={!!checkout} onOpenChange={(o) => !o && !creating && setCheckout(null)}>
        <DialogContent>
          {checkout && checkoutInfo && (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg font-black">{checkoutInfo.title}</DialogTitle>
                <DialogDescription>
                  {TIER_LABEL[checkout.tier]} {INTERVAL_LABEL[checkout.interval]}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 rounded-2xl border bg-muted/30 p-4">
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground">Yang perlu ditransfer</p>
                  <p className="text-2xl font-black tabular-nums">{rupiah(checkoutInfo.price.totalDue)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    + 3 digit kode unik (Rp 100–999) yang muncul di tagihan
                  </p>
                </div>
                <p className="flex items-start gap-2 text-xs">
                  <CalendarCheck className="mt-0.5 size-4 shrink-0 text-rose-600 dark:text-rose-400" />
                  <span>{checkoutInfo.effect}</span>
                </p>
              </div>

              {checkoutInfo.replaces && (
                <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  Tagihan {TIER_LABEL[checkoutInfo.replaces.tier as Plan['tier']] ?? checkoutInfo.replaces.tier}{' '}
                  {INTERVAL_LABEL[checkoutInfo.replaces.interval]} ({rupiah(checkoutInfo.replaces.amount_due)}) yang belum
                  dibayar akan dibatalkan dan diganti tagihan ini.
                </p>
              )}

              <div>
                <p className="text-xs font-bold">Setelah ini:</p>
                <ol className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                  <li>1. Transfer tepat sesuai nominal tagihan ke {bank?.bank ?? 'rekening'} Ulun Pesan.</li>
                  <li>2. Kirim foto bukti transfer di halaman ini.</li>
                  <li>3. Admin mengonfirmasi, biasanya kurang dari 24 jam.</li>
                </ol>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Tagihan berlaku 3 hari dan bisa dibatalkan selama bukti belum dikirim.
                </p>
              </div>

              <DialogFooter>
                <Button variant="outline" size="lg" className="h-10" onClick={() => setCheckout(null)} disabled={creating}>
                  Nanti saja
                </Button>
                <Button
                  size="lg"
                  className="h-10 bg-rose-600 font-bold text-white hover:bg-rose-700"
                  onClick={() => createBill(checkout)}
                  disabled={creating}
                >
                  {creating && <Loader2 className="size-4 animate-spin" />} Buat Tagihan
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmCancel} onOpenChange={(o) => !o && !canceling && setConfirmCancel(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Batalkan tagihan?</DialogTitle>
            <DialogDescription>
              Tagihan {pendingPayment ? rupiah(pendingPayment.amount_due) : ''} akan dihapus dari antrean.
              Kalau Pian <b>sudah transfer</b>, jangan dibatalkan — kirim bukti transfernya saja.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="lg" className="h-10" onClick={() => setConfirmCancel(false)} disabled={canceling}>
              Tidak jadi
            </Button>
            <Button variant="destructive" size="lg" className="h-10" onClick={cancelBill} disabled={canceling}>
              {canceling && <Loader2 className="size-4 animate-spin" />} Ya, batalkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
