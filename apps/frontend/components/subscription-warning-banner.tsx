'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, Clock, CreditCard, Hourglass, X } from 'lucide-react';
import { API_URL } from '@/lib/api-url';

type Subscription = {
  status: 'trialing' | 'active' | 'past_due' | 'expired' | 'canceled';
  current_period_end: string | null;
};
type Payment = { status: string; proof_image: string | null };

// Session-only dismissal by design: plain state, no localStorage — the banner
// must reappear on every browser refresh until the underlying state resolves.
export function SubscriptionWarningBanner() {
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/my-subscription`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.success) {
          setSub(j.data.subscription);
          setPayments(j.data.payments ?? []);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const daysLeft = useMemo(() => {
    if (!sub?.current_period_end) return null;
    return Math.max(
      0,
      Math.ceil((new Date(sub.current_period_end).getTime() - Date.now()) / 86400000),
    );
  }, [sub]);

  // Priority: payment being verified > dead subscription > trial > expiring soon.
  const warning = useMemo(() => {
    const verifying = payments.some((p) => p.status === 'pending' && p.proof_image);
    if (verifying)
      return {
        tone: 'info' as const,
        icon: Hourglass,
        text: 'Pembayaran Pian sedang diverifikasi — konfirmasi biasanya kurang dari 24 jam.',
        cta: 'Lihat Status',
      };
    if (!sub)
      return {
        tone: 'promo' as const,
        icon: CreditCard,
        text: 'Pian belum berlangganan — coba semua fitur gratis 14 hari.',
        cta: 'Pilih Paket',
      };
    if (sub.status === 'expired' || sub.status === 'past_due' || sub.status === 'canceled')
      return {
        tone: 'danger' as const,
        icon: AlertTriangle,
        text: 'Langganan Pian sudah berakhir — perpanjang untuk terus menikmati semua fitur.',
        cta: 'Perpanjang',
      };
    if (sub.status === 'trialing')
      return {
        tone: 'warn' as const,
        icon: Clock,
        text: `Masa percobaan berakhir dalam ${daysLeft ?? 0} hari — pilih paket agar usaha Pian tetap jalan.`,
        cta: 'Pilih Paket',
      };
    if (sub.status === 'active' && daysLeft !== null && daysLeft <= 7)
      return {
        tone: 'warn' as const,
        icon: Clock,
        text: `Langganan Pian berakhir dalam ${daysLeft} hari.`,
        cta: 'Perpanjang',
      };
    return null;
  }, [sub, payments, daysLeft]);

  // The banner links to the subscription page; showing it THERE is just noise.
  if (!loaded || dismissed || !warning || pathname?.startsWith('/dashboard/subscription'))
    return null;

  const TONE = {
    promo:
      'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200',
    info: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200',
    warn: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
    danger:
      'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200',
  }[warning.tone];
  const CTA_TONE = {
    promo: 'bg-rose-600 hover:bg-rose-700',
    info: 'bg-sky-600 hover:bg-sky-700',
    warn: 'bg-amber-600 hover:bg-amber-700',
    danger: 'bg-red-600 hover:bg-red-700',
  }[warning.tone];
  const Icon = warning.icon;

  return (
    <div className="animate-in fade-in slide-in-from-top-2 px-3 pt-3 duration-500 md:px-4">
      <div
        className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-xs font-medium shadow-sm ${TONE}`}
      >
        <Icon className="size-4 shrink-0 animate-pulse" />
        <p className="min-w-0 flex-1 leading-snug">{warning.text}</p>
        <Link
          href="/dashboard/subscription"
          className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold text-white transition-colors ${CTA_TONE}`}
        >
          {warning.cta}
        </Link>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Tutup peringatan"
          className="shrink-0 rounded-md p-1 opacity-60 transition-opacity hover:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
