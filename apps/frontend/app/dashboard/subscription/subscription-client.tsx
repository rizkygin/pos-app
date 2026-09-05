'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  History,
  Smartphone,
  Receipt,
  ShoppingBag,
  Boxes,
  Wallet,
  BarChart3,
  FileBarChart,
  XCircle,
  UsersRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

const rupiah = (v: number | string) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(v) || 0);

const tglPanjang = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—';

const TIER_LABEL: Record<Plan['tier'], string> = {
  basic: 'Basic',
  pro: 'Pro',
  max_lite: 'Max Lite',
  max: 'Max',
  ultimax: 'Ultimax',
};
const TIER_TAGLINE: Record<Plan['tier'], string> = {
  basic: 'Untuk usaha yang baru mulai',
  pro: 'Paling pas untuk usaha berkembang',
  max_lite: 'Multi-outlet + kasir desktop',
  max: 'Tanpa batas, semua fitur',
  ultimax: 'Max + membership di semua outlet',
};

const SUB_STATUS_LABEL: Record<Subscription['status'], string> = {
  trialing: 'Masa Percobaan',
  active: 'Aktif',
  past_due: 'Terlambat',
  expired: 'Kedaluwarsa',
  canceled: 'Berhenti',
};

const PAY_STATUS_LABEL: Record<Payment['status'], string> = {
  pending: 'Menunggu konfirmasi',
  paid: 'Lunas',
  rejected: 'Ditolak',
  expired: 'Kedaluwarsa',
  failed: 'Gagal',
  refunded: 'Refund',
};
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

const PAY_STATUS_STYLE: Record<Payment['status'], string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  paid: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  rejected: 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-300',
  expired: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  failed: 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-300',
  refunded: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
};

export function SubscriptionClient() {
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [bank, setBank] = useState<Bank | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [interval, setIntervalChoice] = useState<'monthly' | 'yearly'>('monthly');
  const [choosing, setChoosing] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // proof upload form
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [senderBank, setSenderBank] = useState('');
  const [senderName, setSenderName] = useState('');
  const [uploading, setUploading] = useState(false);
  const payRef = useRef<HTMLDivElement>(null);

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
    }
  }, []);

  useEffect(() => {
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

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

  const daysLeft = useMemo(() => {
    if (!subscription?.current_period_end) return null;
    const ms = new Date(subscription.current_period_end).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
  }, [subscription]);

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

  const choosePlan = async (planId: number) => {
    setChoosing(planId);
    try {
      const res = await fetch(`${API_URL}/api/subscription-payments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: planId }),
      });
      const json = await res.json();
      if (!json.success) {
        alert(json.error || 'Gagal membuat tagihan');
        return;
      }
      await fetchAll();
      setTimeout(() => payRef.current?.scrollIntoView({ behavior: 'smooth' }), 150);
    } finally {
      setChoosing(null);
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
        alert(json.error || 'Gagal mengunggah bukti');
        return;
      }
      setProofFile(null);
      await fetchAll();
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

  const isLive = subscription?.status === 'trialing' || subscription?.status === 'active';

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
              <Crown className="size-3.5" /> Langganan Ulun Pesan
            </p>
            <h2 className="mt-1 text-2xl font-black tracking-tight md:text-3xl">
              {subscription?.tier ? TIER_LABEL[subscription.tier as Plan['tier']] : 'Belum Berlangganan'}
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
            {subscription?.next_tier && subscription.next_tier_at && (
              <span className="mt-2 inline-block rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold backdrop-blur">
                ↓ Pindah ke {TIER_LABEL[subscription.next_tier]} mulai{' '}
                {tglPanjang(subscription.next_tier_at)}
              </span>
            )}
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

      {/* ================= actionable payment / transfer instructions =============
          pending → transfer + upload proof; rejected → show the reason and let
          the merchant re-upload a corrected proof (same unique amount — their
          money may already be transferred). */}
      {actionablePayment && bank && (
        <div
          ref={payRef}
          className={`overflow-hidden rounded-3xl border-2 ${
            isRejectedResubmit
              ? 'border-red-300 dark:border-red-900'
              : 'border-rose-200 dark:border-rose-900'
          }`}
        >
          <div
            className={`flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 md:px-5 ${
              isRejectedResubmit ? 'bg-red-50 dark:bg-red-950/40' : 'bg-rose-50 dark:bg-rose-950/40'
            }`}
          >
            {isRejectedResubmit ? (
              <XCircle className="size-4 text-red-600 dark:text-red-400" />
            ) : (
              <Hourglass className="size-4 text-rose-600 dark:text-rose-400" />
            )}
            <p
              className={`text-sm font-bold ${
                isRejectedResubmit
                  ? 'text-red-700 dark:text-red-300'
                  : 'text-rose-700 dark:text-rose-300'
              }`}
            >
              {isRejectedResubmit
                ? 'Pembayaran ditolak — unggah ulang bukti transfer'
                : actionablePayment.proof_image
                  ? 'Bukti terkirim — menunggu konfirmasi admin'
                  : 'Selesaikan pembayaran Pian'}
            </p>
            {!isRejectedResubmit && actionablePayment.expires_at && !actionablePayment.proof_image && (
              <span className="ml-auto flex items-center gap-1 text-xs text-rose-600/80 dark:text-rose-400/80">
                <Clock className="size-3" /> sebelum{' '}
                {new Date(actionablePayment.expires_at).toLocaleDateString('id-ID', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </div>
          {isRejectedResubmit && actionablePayment.review_note && (
            <p className="border-b border-red-100 bg-red-50/50 px-5 py-2 text-xs text-red-600 dark:border-red-950 dark:bg-red-950/20 dark:text-red-400">
              Alasan admin: {actionablePayment.review_note}
            </p>
          )}

          <div className="grid gap-5 p-4 md:grid-cols-2 md:gap-6 md:p-6">
            {/* left: amount + bank */}
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Transfer TEPAT sampai 3 digit terakhir (kode unik Pian)
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <p className="text-2xl font-black tabular-nums tracking-tight md:text-3xl">
                    {rupiah(Number(actionablePayment.amount_due) - (Number(actionablePayment.amount_due) % 1000))
                      .replace(/ /g, ' ')
                      .slice(0, -3)}
                    <span className="text-rose-600 dark:text-rose-400">
                      {String(Math.round(Number(actionablePayment.amount_due)) % 1000).padStart(3, '0')}
                    </span>
                  </p>
                  <button
                    onClick={() => copy(String(Math.round(Number(actionablePayment.amount_due))), 'amount')}
                    className="rounded-lg border p-1.5 text-muted-foreground transition-colors hover:bg-muted"
                    title="Salin nominal"
                  >
                    {copied === 'amount' ? (
                      <Check className="size-4 text-green-600" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border bg-muted/30 p-4">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  <Landmark className="size-3.5" /> Rekening tujuan
                </p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div>
                    <p className="font-bold">
                      {bank.bank}{' '}
                      <span className="font-mono tabular-nums">{bank.account_number}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">a.n. {bank.account_holder}</p>
                  </div>
                  <button
                    onClick={() => copy(bank.account_number, 'rek')}
                    className="rounded-lg border p-1.5 text-muted-foreground transition-colors hover:bg-background"
                    title="Salin nomor rekening"
                  >
                    {copied === 'rek' ? (
                      <Check className="size-4 text-green-600" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </button>
                </div>
              </div>

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Nominal unik memudahkan admin mencocokkan transfer Pian. Konfirmasi biasanya
                kurang dari 24 jam setelah bukti diunggah.
              </p>
            </div>

            {/* right: proof upload */}
            <div className="space-y-3">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <Upload className="size-3.5" />{' '}
                {isRejectedResubmit
                  ? 'Unggah ulang bukti transfer'
                  : actionablePayment.proof_image
                    ? 'Kirim ulang bukti (opsional)'
                    : 'Unggah bukti transfer'}
              </p>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
                className="block w-full cursor-pointer rounded-xl border border-dashed border-rose-300 bg-rose-50/40 p-3 text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-rose-600 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-white hover:file:bg-rose-700 dark:border-rose-800 dark:bg-rose-950/20"
              />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Input
                  placeholder="Bank pengirim (cth. BRI)"
                  value={senderBank}
                  onChange={(e) => setSenderBank(e.target.value)}
                />
                <Input
                  placeholder="Nama pengirim"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                />
              </div>
              <Button
                onClick={uploadProof}
                disabled={!proofFile || uploading}
                className="w-full bg-rose-600 text-white hover:bg-rose-700"
              >
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                Kirim Bukti Transfer
              </Button>
              {actionablePayment.proof_image && !isRejectedResubmit && (
                <p className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                  <BadgeCheck className="size-3.5" /> Bukti sudah diterima, tunggu konfirmasi kami.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= plans ================= */}
      <div className="space-y-4 mx-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold tracking-tight">Pilih Paket</h3>
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

        {/* Mobile: horizontal snap carousel (4 stacked cards = too much
            scrolling); sm+: normal grid. */}
        {/* pt-3/-mt-3: the "Terpopuler" badge floats 12px ABOVE its card; an
            overflow-x-auto container clips vertical overflow too, so give the
            scroll box internal top padding for the badge to live in. */}
        <div className="-mx-4 -mt-3 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pt-3 pb-2 scrollbar-hide sm:mx-0 sm:mt-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pt-0 sm:pb-0 lg:grid-cols-3 xl:grid-cols-5">
          {plans
            .filter((p) => p.interval === interval)
            .map((p) => {
              const isCurrent = isLive && subscription?.tier === p.tier;
              const highlight = p.tier === 'pro';
              // Merchant's marketing deal, if it covers this plan's tier+interval.
              const dealApplies =
                !!deal &&
                (!deal.tier || deal.tier === p.tier) &&
                (!deal.interval || deal.interval === p.interval);
              const effPrice = dealApplies
                ? Math.round(Number(p.price) * (1 - deal!.pct / 100))
                : Number(p.price);
              const perMonth = interval === 'yearly' ? effPrice / 12 : effPrice;
              const basePerMonth = interval === 'yearly' ? Number(p.price) / 12 : Number(p.price);
              const f = p.features ?? {};
              return (
                <div
                  key={p.id}
                  className={`relative flex w-[78vw] max-w-72 shrink-0 snap-center flex-col rounded-3xl border-2 p-5 transition-shadow hover:shadow-lg sm:w-auto sm:max-w-none sm:shrink ${
                    highlight
                      ? 'border-rose-500 bg-gradient-to-b from-rose-50/80 to-transparent dark:from-rose-950/30'
                      : 'border-border'
                  }`}
                >
                  {highlight && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-rose-500 to-pink-600 px-3 py-0.5 text-[10px] font-black uppercase tracking-wider text-white shadow">
                      Terpopuler
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
                  {interval === 'yearly' && (
                    <p className="text-[11px] text-muted-foreground">
                      ditagih {rupiah(effPrice)}/tahun
                      {(yearlySavingsByTier.get(p.tier) ?? 0) > 0 && (
                        <span className="font-bold text-rose-600 dark:text-rose-400">
                          {' '}· hemat {yearlySavingsByTier.get(p.tier)}%
                        </span>
                      )}
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
                    onClick={() => choosePlan(p.id)}
                    disabled={choosing !== null}
                    className={`mt-4 w-full font-bold shadow-sm ${
                      highlight
                        ? 'bg-gradient-to-r from-rose-600 to-pink-600 text-white hover:from-rose-700 hover:to-pink-700'
                        : 'border-2 border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:border-rose-400 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/70'
                    }`}
                  >
                    {/* Current tier stays clickable: a trialing merchant still
                        has to PAY it, and an active one can renew early. */}
                    {choosing === p.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : isCurrent && subscription?.status === 'trialing' ? (
                      'Bayar Paket Ini'
                    ) : isCurrent ? (
                      'Perpanjang'
                    ) : (
                      `Pilih ${TIER_LABEL[p.tier]}`
                    )}
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
            {payments.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 border-b px-3.5 py-2.5 last:border-0 md:px-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {TIER_LABEL[p.tier as Plan['tier']] ?? p.tier}{' '}
                    <span className="text-xs text-muted-foreground">
                      · {p.interval === 'monthly' ? 'Bulanan' : 'Tahunan'}
                    </span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(p.created_at).toLocaleDateString('id-ID', {
                      day: '2-digit',
                      month: 'short',
                      year: '2-digit',
                    })}
                  </p>
                  {p.review_note && (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={p.review_note}>
                      {p.review_note}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold tabular-nums">{rupiah(p.amount_due)}</p>
                  <span
                    className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${PAY_STATUS_STYLE[p.status]}`}
                  >
                    {PAY_STATUS_LABEL[p.status]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
