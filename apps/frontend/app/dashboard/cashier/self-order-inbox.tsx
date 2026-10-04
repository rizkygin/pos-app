'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Armchair,
  Bell,
  BellOff,
  Check,
  Loader2,
  MapPin,
  Smartphone,
  Volume2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { API_URL } from '@/lib/api-url';
import { formatCurrency } from '@/lib/utils/format';
import { useOrderAlarm } from '@/lib/use-order-alarm';
import { SERVICE_TYPE_LABEL, isServiceType } from '@/lib/service-type';
import type { CartAddon, Product } from './cashier-client';

/**
 * Pesan Mandiri at the till: orders customers sent from their own phones
 * (/menu/[outlet]), waiting to be taken.
 *
 * It rings for as long as anything is waiting — the till is loud on purpose,
 * a customer is standing there with their phone — and stops on every till the
 * moment one of them takes it, because the stream tells them all.
 *
 * Accepting is the whole hand-over: the server either puts the lines on the
 * table's bill (a table QR, on a plan with Manajemen Meja) or hands them back
 * as cart lines, and the parent opens that as a tab. From there it is an
 * ordinary sale — Dapur, discounts, payment and Checkout exactly as if the
 * cashier had typed it in.
 */

export type SelfOrderCartLine = {
  lineId: string;
  product: Product;
  quantity: number;
  addons: CartAddon[];
  note?: string;
};

export type StaffSelfOrder = {
  id: string;
  queueNo: number;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired';
  customerName: string;
  note: string | null;
  serviceType: string | null;
  tableId: number | null;
  tableLabel: string | null;
  summary: {
    name: string;
    variantName: string | null;
    quantity: number;
    addons: string[];
    note: string | null;
    unitPrice: number;
    total: number;
  }[];
  cart: SelfOrderCartLine[];
  itemCount: number;
  subtotal: number;
  distanceM: number | null;
  sessionId: string | null;
  createdAt: string;
  acceptedAt: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  cancelledAt: string | null;
};

const REJECT_PRESETS = ['Menu habis', 'Outlet akan tutup', 'Pesan langsung di kasir, ya'];

const minutesAgo = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return m < 1 ? 'baru saja' : `${m} menit lalu`;
};

/**
 * The inbox's data: one read, kept fresh by the stream, polled as a safety net.
 * `onNew` fires when a read brings an order this till has not seen before.
 */
function useSelfOrders(enabled: boolean, onNew: () => void) {
  const [pending, setPending] = useState<StaffSelfOrder[]>([]);
  const [recent, setRecent] = useState<StaffSelfOrder[]>([]);
  const [live, setLive] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());
  const onNewRef = useRef(onNew);
  useEffect(() => {
    onNewRef.current = onNew;
  }, [onNew]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/self-orders`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) return;
      const next: StaffSelfOrder[] = data.pending ?? [];
      const fresh = next.some((o) => !seenRef.current.has(o.id));
      for (const o of next) seenRef.current.add(o.id);
      setPending(next);
      setRecent(data.recent ?? []);
      if (fresh) onNewRef.current();
    } catch {
      /* keep the last list; the next event or poll retries */
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const refresh = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => void load(), 200);
    };
    const connect = () => {
      es = new EventSource(`${API_URL}/api/self-orders/stream`, { withCredentials: true });
      // (Re)connected: anything sent while we were not listening shows up now.
      es.addEventListener('ready', () => {
        setLive(true);
        refresh();
      });
      es.addEventListener('self-order', refresh);
      es.onerror = () => {
        setLive(false);
        // An HTTP error (401/403) closes the stream for good; a dropped
        // connection reconnects on its own.
        if (es?.readyState === EventSource.CLOSED && !disposed) {
          es.close();
          retry = setTimeout(connect, 5000);
        }
      };
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearTimeout(debounce);
      es?.close();
    };
  }, [enabled, load]);

  // The stream is the signal; this only catches what a dropped event missed.
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => void load(), live ? 60_000 : 8_000);
    return () => clearInterval(t);
  }, [enabled, live, load]);

  return { pending, recent, live, load };
}

export function SelfOrderInbox({
  enabled,
  onAccepted,
  openTabIds,
}: {
  enabled: boolean;
  /** The order is ours: open it as a tab (or its table's bill). */
  onAccepted: (order: StaffSelfOrder) => void;
  /** Self orders already open as a tab on this device. */
  openTabIds: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  // The counter is kept alive across menus: leaving hides this rather than
  // unmounting it, and the list should not be standing open on the way back.
  useLayoutEffect(() => () => setOpen(false), []);
  // A new order pops the list open — unless the cashier is typing somewhere,
  // where stealing focus would land keystrokes in the wrong field.
  const popOpen = useCallback(() => {
    const el = document.activeElement;
    const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    if (!typing) setOpen(true);
  }, []);
  const { pending, recent, live, load } = useSelfOrders(enabled, popOpen);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const { muted, toggleMuted, blocked, enableSound } = useOrderAlarm(
    enabled && pending.length > 0,
    'pos_self_order_alarm_muted',
  );

  const accept = async (o: StaffSelfOrder) => {
    setBusy(o.id);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/self-orders/${encodeURIComponent(o.id)}/accept`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        setError(data?.error || 'Pesanan belum bisa diterima.');
        void load();
        return;
      }
      setOpen(false);
      onAccepted(data.order as StaffSelfOrder);
      void load();
    } catch {
      setError('Tidak bisa terhubung ke server.');
    } finally {
      setBusy(null);
    }
  };

  const reject = async (o: StaffSelfOrder) => {
    setBusy(o.id);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/self-orders/${encodeURIComponent(o.id)}/reject`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) setError(data?.error || 'Pesanan belum bisa ditolak.');
      setRejecting(null);
      setReason('');
      void load();
    } catch {
      setError('Tidak bisa terhubung ke server.');
    } finally {
      setBusy(null);
    }
  };

  if (!enabled) return null;
  const waiting = pending.length;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void load();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Pesan Mandiri — pesanan dari HP pelanggan"
          title="Pesan Mandiri — pesanan dari HP pelanggan"
          className={`relative flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-sm font-bold shadow-sm transition-colors ${
            waiting > 0
              ? 'border-amber-400 bg-amber-400 text-black hover:bg-amber-300'
              : 'bg-background/90 text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          {waiting > 0 && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 animate-ping rounded-xl border-2 border-amber-400"
            />
          )}
          <Smartphone className="h-4 w-4" />
          <span className="hidden @xl:inline">Pesanan HP</span>
          {waiting > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-rose-600 px-1 text-[11px] font-extrabold leading-none text-white">
              {waiting}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-1rem)] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <div>
            <p className="text-sm font-bold">Pesanan dari HP</p>
            <p className="text-[11px] text-muted-foreground">
              {live ? 'Tersambung langsung' : 'Menyambung ulang…'} · pelanggan bayar di kasir
            </p>
          </div>
          <div className="flex items-center gap-1">
            {blocked && waiting > 0 && (
              <Button type="button" size="sm" variant="outline" onClick={enableSound}>
                <Volume2 className="h-3.5 w-3.5" /> Nyalakan suara
              </Button>
            )}
            <button
              type="button"
              onClick={toggleMuted}
              title={muted ? 'Bunyikan dering' : 'Senyapkan dering'}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && (
          <p className="mx-3 mt-2.5 rounded-lg bg-rose-50 px-2.5 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </p>
        )}

        <div className="max-h-[70vh] overflow-y-auto p-2.5">
          {waiting === 0 ? (
            <p className="px-1 py-5 text-center text-xs text-muted-foreground">
              Belum ada pesanan baru. Bel berbunyi begitu pelanggan mengirim dari HP.
            </p>
          ) : (
            <div className="space-y-2">
              {pending.map((o) => (
                <div key={o.id} className="rounded-xl border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
                  <div className="flex items-start gap-2.5">
                    <span className="flex h-9 min-w-11 shrink-0 items-center justify-center rounded-lg bg-amber-500 px-1.5 text-base font-black text-black">
                      #{o.queueNo}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{o.customerName}</p>
                      <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                        {o.tableLabel ? (
                          <span className="inline-flex items-center gap-0.5 font-semibold text-indigo-600 dark:text-indigo-300">
                            <Armchair className="h-3 w-3" /> Meja {o.tableLabel}
                          </span>
                        ) : isServiceType(o.serviceType) ? (
                          <span className="font-semibold">{SERVICE_TYPE_LABEL[o.serviceType]}</span>
                        ) : null}
                        <span>{minutesAgo(o.createdAt)}</span>
                        {o.distanceM !== null && (
                          <span className="inline-flex items-center gap-0.5" title="Jarak HP ke titik outlet saat mengirim">
                            <MapPin className="h-3 w-3" />
                            {o.distanceM} m
                          </span>
                        )}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-black tabular-nums">{formatCurrency(o.subtotal)}</span>
                  </div>

                  <ul className="mt-2 space-y-0.5 text-[13px]">
                    {o.summary.map((l, i) => (
                      <li key={i}>
                        <span className="font-bold">{l.quantity}×</span> {l.name}
                        {l.addons.length > 0 && (
                          <span className="text-muted-foreground"> + {l.addons.join(', ')}</span>
                        )}
                        {l.note && <span className="block pl-5 text-[11px] italic text-amber-700 dark:text-amber-300">“{l.note}”</span>}
                      </li>
                    ))}
                  </ul>
                  {o.note && (
                    <p className="mt-1.5 rounded-md bg-background/70 px-2 py-1 text-[11px] italic">Catatan: {o.note}</p>
                  )}

                  {rejecting === o.id ? (
                    <div className="mt-2.5 space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {REJECT_PRESETS.map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setReason(p)}
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                              reason === p ? 'border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' : 'hover:bg-muted'
                            }`}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value.slice(0, 120))}
                        placeholder="Alasan (dilihat pelanggan)"
                        className="h-8 w-full rounded-lg border bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-rose-400"
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          onClick={() => {
                            setRejecting(null);
                            setReason('');
                          }}
                        >
                          Batal
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          className="flex-1"
                          disabled={busy === o.id}
                          onClick={() => void reject(o)}
                        >
                          Tolak pesanan
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2.5 flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => {
                          setRejecting(o.id);
                          setReason('');
                        }}
                      >
                        <X className="h-3.5 w-3.5" /> Tolak
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
                        disabled={busy !== null}
                        onClick={() => void accept(o)}
                      >
                        {busy === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Terima{o.tableLabel ? ` ke Meja ${o.tableLabel}` : ' & buka tab'}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {recent.length > 0 && (
            <div className="mt-3">
              <p className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Terakhir
              </p>
              <div className="space-y-1">
                {recent.map((o) => {
                  const reopen =
                    o.status === 'accepted' && !o.sessionId && !openTabIds.has(o.id);
                  return (
                    <div key={o.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs">
                      <span className="font-black tabular-nums">#{o.queueNo}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {o.customerName}
                        {o.tableLabel ? ` · Meja ${o.tableLabel}` : ''}
                      </span>
                      <span
                        className={`shrink-0 font-semibold ${
                          o.status === 'accepted'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {o.status === 'accepted'
                          ? 'Diterima'
                          : o.status === 'rejected'
                            ? 'Ditolak'
                            : o.status === 'cancelled'
                              ? 'Dibatalkan'
                              : 'Kedaluwarsa'}
                      </span>
                      {reopen && (
                        // Only the cashier who accepted it gets the lines back
                        // (the server replays the accept for them alone) — the
                        // way back to a tab lost to a crash or a closed window.
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void accept(o)}
                          className="shrink-0 rounded-md border px-1.5 py-0.5 font-semibold hover:bg-muted"
                        >
                          Buka tab
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
