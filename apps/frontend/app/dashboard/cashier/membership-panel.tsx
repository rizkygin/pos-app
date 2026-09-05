'use client';

import { useEffect, useRef, useState } from 'react';
import { Coins, Loader2, Ticket, UserPlus, UserRound, X } from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { formatCurrency } from '@/lib/utils/format';
import {
  TIER_BADGE,
  TIER_LABEL,
  displayPhone,
  type MembershipQuote,
} from '@/lib/membership';

/**
 * The membership block inside the cashier's cart panel: attach a member by
 * phone, type a promo code, spend points.
 *
 * It owns no arithmetic. Every figure it shows comes from the server's quote,
 * because the same function will run again at checkout with the member row
 * locked — and a counter that did its own sums would disagree with the receipt
 * the moment a promo expired or another till spent the same points.
 */

type Props = {
  /** Line total net of the manual discount, before tax. The quote's base. */
  base: number;
  phone: string;
  onPhoneChange: (v: string) => void;
  promoCode: string;
  onPromoCodeChange: (v: string) => void;
  pointsToRedeem: number;
  onPointsChange: (v: number) => void;
  quote: MembershipQuote | null;
  loading: boolean;
  /** Re-quote after a registration, so the new member attaches immediately. */
  onRegistered: () => void;
  /**
   * Drop the card chrome. Inside the header popover the popover IS the card,
   * and a border inside a border reads as a form within a form.
   */
  bare?: boolean;
};

export function MembershipPanel({
  base,
  phone,
  onPhoneChange,
  promoCode,
  onPromoCodeChange,
  pointsToRedeem,
  onPointsChange,
  quote,
  loading,
  onRegistered,
  bare = false,
}: Props) {
  const [registering, setRegistering] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const member = quote?.member ?? null;
  // "Not a member yet" is the one lookup miss worth acting on: it is the
  // moment to offer signing them up, with the number already typed.
  const notFound =
    !member && !!quote?.memberError && phone.replace(/\D/g, '').length >= 10;

  useEffect(() => {
    if (registering) nameRef.current?.focus();
  }, [registering]);

  // A member found (or the number cleared) ends any half-started registration.
  useEffect(() => {
    if (member || !phone.trim()) {
      setRegistering(false);
      setNewName('');
      setError(null);
    }
  }, [member, phone]);

  const register = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/membership/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ phone, name: newName.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        setError(body.error ?? 'Gagal mendaftarkan member.');
        return;
      }
      setRegistering(false);
      setNewName('');
      onRegistered();
    } catch {
      setError('Tidak bisa menghubungi server.');
    } finally {
      setSaving(false);
    }
  };

  const maxPoints = quote?.maxRedeemablePoints ?? 0;

  return (
    <div className={bare ? 'px-1 py-0.5' : 'mb-2 rounded-xl border bg-muted/30 px-3 py-2'}>
      {/* Phone: the member's identity at this outlet. */}
      <div className="flex items-center gap-2">
        <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          type="tel"
          inputMode="numeric"
          value={phone}
          onChange={(e) => onPhoneChange(e.target.value.replace(/[^\d+]/g, ''))}
          placeholder="No. HP member"
          aria-label="Nomor HP member"
          className="h-7 min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground"
        />
        {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
        {!!phone && !loading && (
          <button
            type="button"
            onClick={() => onPhoneChange('')}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Hapus member"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {member && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-bold">{member.name}</span>
            <span
              className={`shrink-0 rounded border px-1.5 py-px text-[10px] font-black uppercase tracking-wide ${TIER_BADGE[member.tier]}`}
            >
              {TIER_LABEL[member.tier]}
            </span>
          </div>
          <span className="shrink-0 text-xs font-bold tabular-nums text-amber-600 dark:text-amber-400">
            {member.points_balance.toLocaleString('id-ID')} poin
          </span>
        </div>
      )}

      {member && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {displayPhone(member.phone)} · {member.member_code}
        </p>
      )}

      {/* Not a member yet: sign them up without leaving the cart. */}
      {notFound && !registering && (
        <button
          type="button"
          onClick={() => setRegistering(true)}
          className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-blue-300 py-1.5 text-xs font-bold text-blue-600 transition-colors hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/40"
        >
          <UserPlus className="h-3.5 w-3.5" />
          Daftarkan sebagai member
        </button>
      )}

      {registering && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            ref={nameRef}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && register()}
            placeholder="Nama pelanggan"
            className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="button"
            onClick={register}
            disabled={saving || !newName.trim()}
            className="h-7 shrink-0 rounded-md bg-blue-600 px-2.5 text-xs font-bold text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Simpan'}
          </button>
          <button
            type="button"
            onClick={() => setRegistering(false)}
            className="h-7 shrink-0 rounded-md px-1.5 text-muted-foreground hover:bg-muted"
            aria-label="Batal daftar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {!member && !!quote?.memberError && !registering && (
        <p className="mt-1 text-[11px] text-muted-foreground">{quote.memberError}</p>
      )}
      {error && <p className="mt-1 text-[11px] font-semibold text-rose-500">{error}</p>}

      <div className="my-1.5 h-px bg-border" />

      {/* Promo code. Usable without a member unless the code says otherwise. */}
      <div className="flex items-center gap-2">
        <Ticket className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          type="text"
          value={promoCode}
          onChange={(e) => onPromoCodeChange(e.target.value.toUpperCase())}
          placeholder="Kode promo"
          aria-label="Kode promo"
          className="h-7 min-w-0 flex-1 bg-transparent text-sm font-semibold uppercase outline-none placeholder:font-normal placeholder:normal-case placeholder:text-muted-foreground"
        />
        {quote?.promo && (
          <span className="shrink-0 text-xs font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            -{formatCurrency(quote.promoDiscount)}
          </span>
        )}
      </div>
      {quote?.promo && (
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{quote.promo.title}</p>
      )}
      {quote?.promoError && (
        <p className="mt-0.5 text-[11px] font-semibold text-rose-500">{quote.promoError}</p>
      )}

      {/* Points. Only once there is a member and a bill big enough to spend on. */}
      {member && (
        <>
          <div className="my-1.5 h-px bg-border" />
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm">Tukar poin</span>
            <input
              type="number"
              min={0}
              max={maxPoints}
              value={pointsToRedeem || ''}
              onChange={(e) => onPointsChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              placeholder="0"
              aria-label="Poin ditukar"
              className="h-6 w-16 rounded-md border bg-background px-1.5 text-xs font-bold outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={() => onPointsChange(maxPoints)}
              disabled={maxPoints <= 0}
              className="shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
            >
              Maks
            </button>
            <span className="ml-auto shrink-0 text-xs font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {quote && quote.pointsDiscount > 0 ? `-${formatCurrency(quote.pointsDiscount)}` : ''}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {maxPoints > 0
              ? `Maksimal ${maxPoints.toLocaleString('id-ID')} poin untuk belanja ini`
              : 'Belum ada poin yang bisa dipakai di belanja ini'}
            {quote && quote.pointsToEarn > 0
              ? ` · dapat ${quote.pointsToEarn.toLocaleString('id-ID')} poin`
              : ''}
          </p>
          {quote?.pointsError && (
            <p className="mt-0.5 text-[11px] font-semibold text-rose-500">{quote.pointsError}</p>
          )}
        </>
      )}

      {base <= 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Tambahkan item dulu untuk memakai promo atau poin.
        </p>
      )}
    </div>
  );
}
