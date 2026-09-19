'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { BellRing, Check, Minus, Plus, Settings2, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { API_URL } from '@/lib/api-url';
import { useOrderAlarm } from '@/lib/use-order-alarm';
import { floorApi } from '../tables/floor-api';

/**
 * Dapur — the Kitchen Display.
 *
 * Tickets arrive from a table's "Kirim ke Dapur" and the cashier's Dapur
 * button (see routes/kitchen.ts), move Masuk → Dikerjakan → Siap, and any of
 * them can call a waiter ("Recall"): the call shows on Manajemen Meja until a
 * waiter taps Diterima. The board is live over the floor's event stream and
 * polled as a safety net, the same way the floor page is.
 */

type Status = 'open' | 'in_progress' | 'done' | 'hold' | 'cancelled';

type Ticket = {
  id: number;
  ticketNo: number;
  source: 'table' | 'counter';
  sessionId: string | null;
  label: string | null;
  customer: string | null;
  note: string | null;
  lines: {
    lineId: string;
    qty: number;
    name: string;
    variant: string | null;
    note: string | null;
    addons: { name: string; qty: number }[];
  }[];
  status: Status;
  statusAt: string;
  startedAt: string | null;
  createdAt: string;
  call: { at: string; note: string | null; count: number; ackAt: string | null } | null;
};

type Board = {
  serverTime: string;
  entitled: boolean;
  outlet: { name: string };
  tickets: Ticket[];
};

type Filter = 'all' | 'table' | 'counter';

/** Poll interval while the live stream is down. */
const POLL_MS = 6000;
/** With the stream up, the poll only covers an event lost in transit. */
const SAFETY_POLL_MS = 60_000;
/** A new ticket rings for this long after it lands. */
const FRESH_MS = 8000;
/** Event reasons that change what this screen shows. */
const KITCHEN_REASONS = new Set(['ticket', 'kitchen', 'call']);
const SETTINGS_KEY = 'pos_kitchen_display';

const COLUMNS: { key: Status; label: string; accent: string }[] = [
  { key: 'open', label: 'Masuk', accent: 'bg-rose-600' },
  { key: 'in_progress', label: 'Dikerjakan', accent: 'bg-amber-600' },
  { key: 'done', label: 'Siap', accent: 'bg-emerald-600' },
  { key: 'hold', label: 'Ditahan', accent: 'bg-slate-500' },
  { key: 'cancelled', label: 'Batal', accent: 'bg-neutral-400' },
];

type Action = { label: string; to: Status | 'call'; tone: keyof typeof TONE };

/**
 * What each stage's two buttons do. Siap's primary is the Recall: food is up,
 * come and take it. Every other live stage reaches the Recall through the bell.
 */
const ACTIONS: Record<Status, { primary: Action; secondary: Action | null }> = {
  open: {
    primary: { label: 'Mulai', to: 'in_progress', tone: 'blue' },
    secondary: { label: 'Tahan', to: 'hold', tone: 'plain' },
  },
  in_progress: {
    primary: { label: 'Selesai', to: 'done', tone: 'green' },
    secondary: { label: 'Tahan', to: 'hold', tone: 'plain' },
  },
  done: {
    primary: { label: 'Recall', to: 'call', tone: 'recall' },
    secondary: { label: 'Batal', to: 'cancelled', tone: 'plain' },
  },
  hold: {
    primary: { label: 'Lanjut', to: 'open', tone: 'blue' },
    secondary: { label: 'Batal', to: 'cancelled', tone: 'plain' },
  },
  cancelled: { primary: { label: 'Buka', to: 'open', tone: 'plain' }, secondary: null },
};

const TONE = {
  blue: 'bg-blue-600 text-white hover:bg-blue-700',
  green: 'bg-emerald-600 text-white hover:bg-emerald-700',
  recall:
    'border border-red-200 bg-card text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40',
  plain: 'border bg-card text-foreground hover:bg-muted',
};

/** Why the kitchen is calling — one tap each. The note is what the floor reads. */
const CALL_REASONS: { label: string; note: string | null }[] = [
  { label: 'Pesanan siap diantar', note: 'Pesanan siap diantar' },
  { label: 'Ada pertanyaan soal pesanan', note: 'Ada pertanyaan soal pesanan' },
  { label: 'Menu habis', note: 'Menu habis' },
  { label: 'Sebagian sudah siap', note: 'Sebagian sudah siap' },
  { label: 'Panggil saja', note: null },
];
const READY_NOTE = 'Pesanan siap diantar';

const isLive = (s: Status) => s === 'open' || s === 'in_progress' || s === 'hold';

/** Where the ticket's clock runs from: waiting since it came in, cooking since Mulai, ready since Selesai. */
const clockFrom = (t: Ticket) =>
  t.status === 'in_progress'
    ? (t.startedAt ?? t.statusAt)
    : t.status === 'open' || t.status === 'hold'
      ? t.createdAt
      : t.statusAt;

const fmtAge = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}j ${String(m).padStart(2, '0')}m` : `${m}:${String(s).padStart(2, '0')}`;
};

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** The name the pass calls out: the table, the pager, or just the till. */
const channelOf = (t: Ticket) =>
  t.source === 'table' ? `Meja ${t.label || '?'}` : t.label ? `Pager ${t.label}` : 'Kasir';

type Settings = { lateAfterMin: number; showCancelled: boolean };
const DEFAULT_SETTINGS: Settings = { lateAfterMin: 8, showCancelled: true };

/** Per-device preferences: a bar and a grill disagree on what "late" is. */
function readSettings(): Settings {
  try {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS;
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const v = JSON.parse(raw);
    return {
      lateAfterMin:
        Number.isInteger(v?.lateAfterMin) && v.lateAfterMin >= 1 && v.lateAfterMin <= 30
          ? v.lateAfterMin
          : DEFAULT_SETTINGS.lateAfterMin,
      showCancelled: typeof v?.showCancelled === 'boolean' ? v.showCancelled : DEFAULT_SETTINGS.showCancelled,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function KitchenClient() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loadError, setLoadError] = useState('');
  const [syncFailing, setSyncFailing] = useState(false);
  // Live stream connected; mirrored in a ref for the poll timer.
  const [live, setLive] = useState(false);
  const liveRef = useRef(false);
  const lastLoadRef = useRef(0);
  const [now, setNow] = useState(0);
  // Server clock minus ours, so a tablet whose clock drifts still times tickets right.
  const [skew, setSkew] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  // Read once, lazily: the first render (server and client alike) is the
  // loading screen, which no setting touches, so there is nothing to mismatch.
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set());
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // ── sync ────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    lastLoadRef.current = Date.now();
    const res = await floorApi<Board>('GET', '/api/kitchen/tickets');
    setNow(Date.now());
    if (!res.ok) {
      setSyncFailing(true);
      setLoadError(res.error);
      return;
    }
    setSkew(Date.parse(res.data.serverTime) - Date.now());
    setBoard(res.data);
    setSyncFailing(false);
    setLoadError('');
  }, []);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    let es: EventSource | null = null;
    let retry: number | undefined;
    let debounce: number | undefined;
    let disposed = false;
    const setLiveBoth = (v: boolean) => {
      liveRef.current = v;
      setLive(v);
    };
    const refresh = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void load(), 150);
    };
    const connect = () => {
      es = new EventSource(`${API_URL}/api/floor/stream`, { withCredentials: true });
      es.addEventListener('ready', () => {
        setLiveBoth(true);
        refresh();
      });
      es.addEventListener('floor', (e: MessageEvent) => {
        // The floor's own traffic (a seating, a layout edit) is not ours.
        try {
          if (!KITCHEN_REASONS.has(JSON.parse(e.data)?.reason)) return;
        } catch {
          /* unreadable: re-read to be safe */
        }
        refresh();
      });
      es.onerror = () => {
        setLiveBoth(false);
        // See tables-client.tsx: an HTTP error closes the stream for good.
        if (es?.readyState === EventSource.CLOSED && !disposed) {
          es.close();
          retry = window.setTimeout(connect, 5000);
        }
      };
    };
    connect();
    return () => {
      disposed = true;
      window.clearTimeout(retry);
      window.clearTimeout(debounce);
      es?.close();
      liveRef.current = false;
    };
  }, [load]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (liveRef.current && Date.now() - lastLoadRef.current < SAFETY_POLL_MS) return;
      void load();
    };
    const first = window.setTimeout(() => void load(), 0);
    const poll = window.setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(poll);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // Ticket timers and the header clock.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), notice.ok ? 2500 : 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const saveSettings = (patch: Partial<Settings>) =>
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* this device only, and only a preference */
      }
      return next;
    });

  // ── derived ─────────────────────────────────────────────────────────────
  // `now` is set by the first load, so by the time there is a board to draw
  // it is a real clock reading.
  const serverNow = now + skew;
  const lateAfterMs = settings.lateAfterMin * 60_000;
  const tickets = useMemo(() => board?.tickets ?? [], [board]);
  const visible = tickets.filter((t) => filter === 'all' || t.source === filter);
  const ageOf = (t: Ticket) => serverNow - Date.parse(clockFrom(t));
  const isLate = (t: Ticket) => (t.status === 'open' || t.status === 'in_progress') && ageOf(t) > lateAfterMs;

  // A ticket that just landed in Masuk rings, a few chimes and done — the
  // kitchen is loud and the screen is not always being looked at.
  const freshArrival =
    now > 0 && tickets.some((t) => t.status === 'open' && serverNow - Date.parse(t.createdAt) < FRESH_MS);
  const alarm = useOrderAlarm(freshArrival, 'pos_kitchen_ticket_muted');

  // ── actions ─────────────────────────────────────────────────────────────
  const flash = (ok: boolean, text: string) => setNotice({ ok, text });
  const hold = (id: number, on: boolean) =>
    setPending((p) => {
      const next = new Set(p);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const move = async (t: Ticket, to: Status) => {
    hold(t.id, true);
    // Moved under the finger at once; the re-read below settles it. The
    // screen clock is at most a second behind, which is all the timer shows.
    const at = new Date(now + skew).toISOString();
    setBoard((b) =>
      b && {
        ...b,
        tickets: b.tickets.map((x) =>
          x.id === t.id
            ? { ...x, status: to, statusAt: at, startedAt: to === 'in_progress' ? at : x.startedAt }
            : x,
        ),
      },
    );
    const res = await floorApi('POST', `/api/kitchen/tickets/${t.id}/status`, { status: to });
    hold(t.id, false);
    if (!res.ok) flash(false, res.error);
    void load();
  };

  const callWaiter = async (t: Ticket, note: string | null) => {
    hold(t.id, true);
    const res = await floorApi('POST', `/api/kitchen/tickets/${t.id}/call`, { note });
    hold(t.id, false);
    if (res.ok) flash(true, `Pelayan dipanggil · ${channelOf(t)} #${t.ticketNo}`);
    else flash(false, res.error);
    void load();
  };

  // ── render ──────────────────────────────────────────────────────────────
  if (!board) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        {loadError ? (
          <div className="max-w-sm rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            <p className="font-semibold">Layar Dapur tidak bisa dibuka</p>
            <p className="mt-1">{loadError}</p>
            <Button variant="outline" className="mt-4" onClick={() => void load()}>
              Coba lagi
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Memuat tiket dapur…</p>
        )}
      </div>
    );
  }

  const activeCount = (f: Filter) =>
    tickets.filter((t) => (f === 'all' || t.source === f) && isLive(t.status)).length;
  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'Semua' },
    { key: 'table', label: 'Meja' },
    { key: 'counter', label: 'Kasir' },
  ];
  const tally = (s: Status) => visible.filter((t) => t.status === s).length;
  const summary = [
    { label: 'Masuk', count: tally('open'), dot: 'bg-rose-600', tone: 'bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200' },
    { label: 'Dikerjakan', count: tally('in_progress'), dot: 'bg-amber-600', tone: 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200' },
    { label: 'Telat', count: visible.filter(isLate).length, dot: 'bg-red-600', tone: 'bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-200' },
    { label: 'Siap', count: tally('done'), dot: 'bg-emerald-600', tone: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200' },
  ];
  const columns = COLUMNS.filter((c) => c.key !== 'cancelled' || settings.showCancelled).map((c) => ({
    ...c,
    // Oldest first: whoever has waited longest is the next one out.
    tickets: visible.filter((t) => t.status === c.key).sort((a, b) => ageOf(b) - ageOf(a)),
  }));
  const clockNow = new Date(serverNow);
  const clockText = now
    ? [clockNow.getHours(), clockNow.getMinutes(), clockNow.getSeconds()]
        .map((n) => String(n).padStart(2, '0'))
        .join(':')
    : '--:--:--';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-4.5 gap-y-3 border-b bg-card px-4 py-3 shadow-xs">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            title={
              syncFailing
                ? loadError
                : live
                  ? 'Live — tiket baru muncul seketika'
                  : 'Koneksi live terputus — layar diperbarui tiap beberapa detik'
            }
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              syncFailing
                ? 'bg-amber-500'
                : live
                  ? 'animate-pulse bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]'
                  : 'bg-sky-500',
            )}
          />
          <div className="flex min-w-0 flex-col leading-tight">
            <strong className="text-[clamp(17px,1.5vw,22px)] font-black tracking-tight">Dapur</strong>
            <span className="truncate text-[clamp(11px,0.9vw,13px)] text-muted-foreground">
              {board.outlet.name} · Kitchen Display
            </span>
          </div>
        </div>

        <div className="flex gap-1.5 rounded-xl border bg-muted/60 p-1">
          {filters.map((f) => {
            const on = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  'flex min-h-11 items-center gap-2 rounded-[9px] px-3.5 text-[clamp(12px,1vw,15px)] font-bold transition-colors',
                  on ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {f.label}
                <span
                  className={cn(
                    'rounded-full px-1.75 py-0.5 font-mono text-[0.8em] font-semibold',
                    on ? 'bg-white/20 dark:bg-slate-900/15' : 'bg-muted',
                  )}
                >
                  {activeCount(f.key)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3.5">
          <div className="flex flex-wrap items-center gap-2">
            {summary.map((s) => (
              <div key={s.label} className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1.5', s.tone)}>
                <span className={cn('h-1.75 w-1.75 rounded-full', s.dot)} />
                <span className="text-[clamp(11px,0.85vw,13px)] font-bold">{s.label}</span>
                <span className="font-mono text-[clamp(11px,0.85vw,13px)] font-semibold">{s.count}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {alarm.blocked && !alarm.muted && (
              <Button size="sm" variant="outline" onClick={alarm.enableSound}>
                Aktifkan suara
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              onClick={alarm.toggleMuted}
              aria-label={alarm.muted ? 'Nyalakan suara tiket baru' : 'Matikan suara tiket baru'}
              title={alarm.muted ? 'Nyalakan suara tiket baru' : 'Matikan suara tiket baru'}
            >
              {alarm.muted ? <VolumeX /> : <Volume2 />}
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button size="icon" variant="ghost" aria-label="Pengaturan layar dapur" title="Pengaturan layar dapur">
                  <Settings2 />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 space-y-3 p-3">
                <p className="text-xs font-bold">Layar ini</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px]">Telat setelah</span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="icon-sm"
                      variant="outline"
                      aria-label="Kurangi"
                      disabled={settings.lateAfterMin <= 1}
                      onClick={() => saveSettings({ lateAfterMin: settings.lateAfterMin - 1 })}
                    >
                      <Minus />
                    </Button>
                    <span className="w-14 text-center font-mono text-[13px] font-semibold">
                      {settings.lateAfterMin} mnt
                    </span>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      aria-label="Tambah"
                      disabled={settings.lateAfterMin >= 30}
                      onClick={() => saveSettings({ lateAfterMin: settings.lateAfterMin + 1 })}
                    >
                      <Plus />
                    </Button>
                  </div>
                </div>
                <label className="flex cursor-pointer items-center justify-between gap-2 text-[13px]">
                  Tampilkan kolom Batal
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-slate-900 dark:accent-slate-100"
                    checked={settings.showCancelled}
                    onChange={(e) => saveSettings({ showCancelled: e.target.checked })}
                  />
                </label>
              </PopoverContent>
            </Popover>
          </div>
          <span className="font-mono text-[clamp(15px,1.3vw,20px)] font-semibold tracking-tight">{clockText}</span>
        </div>
      </header>

      {!board.entitled && (
        <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Paket Anda belum termasuk Layar Dapur (mulai Max Lite). Tiket yang sudah masuk tetap bisa diselesaikan.
          <Link href="/dashboard/subscription" className="font-semibold underline">
            Lihat paket
          </Link>
        </div>
      )}

      {notice && (
        <div
          className={cn(
            'mx-4 mt-3 rounded-lg border px-3 py-2 text-xs font-medium shadow-sm',
            notice.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200'
              : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-200',
          )}
        >
          {notice.text}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fit,minmax(230px,1fr))] items-start gap-3 overflow-y-auto px-4 pb-5 pt-3">
        {columns.map((col) => (
          <section key={col.key} className="flex min-w-0 flex-col gap-2.5">
            <div className="flex items-center gap-2 px-0.5">
              <span className={cn('h-2.5 w-2.5 rounded-[3px]', col.accent)} />
              <h2 className="text-[clamp(12px,1vw,15px)] font-extrabold uppercase tracking-wider">{col.label}</h2>
              <span className="font-mono text-[clamp(11px,0.9vw,13px)] font-semibold text-muted-foreground">
                {col.tickets.length}
              </span>
            </div>
            <div className="flex flex-col gap-2.5 pr-0.5 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto">
              {col.tickets.map((t) => (
                <TicketCard
                  key={t.id}
                  ticket={t}
                  age={fmtAge(ageOf(t))}
                  late={isLate(t)}
                  busy={pending.has(t.id)}
                  onMove={(to) => void move(t, to)}
                  onCall={(note) => void callWaiter(t, note)}
                />
              ))}
              {col.tickets.length === 0 && (
                <div className="rounded-[14px] border border-dashed px-3 py-4.5 text-center text-[clamp(11px,0.9vw,13px)] text-muted-foreground">
                  Kosong
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function TicketCard({
  ticket: t,
  age,
  late,
  busy,
  onMove,
  onCall,
}: {
  ticket: Ticket;
  age: string;
  late: boolean;
  busy: boolean;
  onMove: (to: Status) => void;
  onCall: (note: string | null) => void;
}) {
  const actions = ACTIONS[t.status];
  const strip =
    t.status === 'cancelled'
      ? 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
      : late
        ? 'bg-red-600 text-white'
        : t.status === 'in_progress'
          ? 'bg-amber-600 text-white'
          : t.status === 'done'
            ? 'bg-emerald-600 text-white'
            : t.status === 'hold'
              ? 'bg-slate-500 text-white'
              : 'bg-rose-600 text-white';
  const calling = !!t.call && !t.call.ackAt;
  const [asking, setAsking] = useState(false);
  const run = (a: Action) => (a.to === 'call' ? onCall(READY_NOTE) : onMove(a.to));

  return (
    <article
      className={cn(
        'shrink-0 overflow-hidden rounded-[14px] border bg-card shadow-xs animate-in fade-in slide-in-from-bottom-1.5 duration-200',
        t.status === 'cancelled' && 'opacity-65',
      )}
    >
      <div className={cn('flex items-center justify-between gap-2 px-2.5 py-2', strip)}>
        <div className="flex min-w-0 items-baseline gap-2">
          <strong className="font-mono text-[clamp(16px,1.3vw,20px)] font-semibold tracking-tight">
            #{t.ticketNo}
          </strong>
          <span className="truncate font-mono text-[clamp(10px,0.8vw,12px)] opacity-85">{hhmm(t.createdAt)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {late && (
            <span className="animate-pulse rounded-[5px] bg-white/20 px-1.5 py-0.5 text-[clamp(9px,0.7vw,11px)] font-extrabold tracking-wider">
              TELAT
            </span>
          )}
          <span className="font-mono text-[clamp(12px,1vw,15px)] font-semibold">{age}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-1.5 pt-2">
        <span className="text-[clamp(11px,0.9vw,13px)] font-bold">{channelOf(t)}</span>
        {t.customer && (
          <span className="min-w-0 truncate text-[clamp(11px,0.9vw,13px)] text-muted-foreground">{t.customer}</span>
        )}
        <span className="ml-auto flex shrink-0 gap-1.25">
          <span
            className={cn(
              'rounded-full px-1.75 py-0.75 text-[clamp(9px,0.75vw,11px)] font-extrabold tracking-wide',
              t.source === 'table'
                ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                : 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
            )}
          >
            {t.source === 'table' ? 'DINE-IN' : 'KASIR'}
          </span>
          {t.call && (
            <span
              title={
                calling
                  ? `Menunggu pelayan${t.call.note ? ` · ${t.call.note}` : ''}`
                  : `Pelayan sudah menjawab${t.call.note ? ` · ${t.call.note}` : ''}`
              }
              className={cn(
                'flex items-center gap-1 rounded-full bg-red-100 px-1.75 py-0.75 text-[clamp(9px,0.75vw,11px)] font-extrabold tracking-wide text-red-700 dark:bg-red-950 dark:text-red-300',
                calling && 'animate-pulse',
              )}
            >
              RECALL {t.call.count}×{!calling && <Check className="h-3 w-3" />}
            </span>
          )}
        </span>
      </div>

      {t.note && (
        <p className="px-2.5 pb-1 text-[clamp(11px,0.9vw,13px)] font-semibold leading-snug text-amber-700 dark:text-amber-400">
          {t.note}
        </p>
      )}

      <ul className="flex flex-col gap-1.75 px-2.5 pb-2.5 pt-0.5">
        {t.lines.map((ln) => (
          <li key={ln.lineId} className="grid grid-cols-[auto_1fr] items-baseline gap-2">
            <span className="font-mono text-[clamp(12px,1vw,15px)] font-semibold text-muted-foreground">{ln.qty}×</span>
            <div className="min-w-0">
              <div className="text-[clamp(13px,1.1vw,17px)] font-bold leading-tight text-pretty">{ln.name}</div>
              {ln.variant && (
                <div className="text-[clamp(11px,0.9vw,13px)] leading-snug text-muted-foreground">{ln.variant}</div>
              )}
              {ln.note && (
                <div className="text-[clamp(11px,0.9vw,13px)] font-semibold leading-snug text-amber-700 dark:text-amber-400">
                  {ln.note}
                </div>
              )}
              {ln.addons.map((a, i) => (
                <div key={i} className="text-[clamp(11px,0.9vw,13px)] leading-snug text-muted-foreground">
                  + {a.name}
                  {a.qty > 1 ? ` ×${a.qty}` : ''}
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>

      <div className="flex gap-2 px-2.5 pb-2.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => run(actions.primary)}
          className={cn(
            'flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[10px] text-[clamp(12px,1vw,15px)] font-extrabold transition-colors disabled:opacity-60',
            TONE[actions.primary.tone],
          )}
        >
          {actions.primary.to === 'call' && <BellRing className="h-4 w-4" />}
          {actions.primary.label}
        </button>
        {actions.secondary && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(actions.secondary!)}
            className={cn(
              'min-h-11 flex-1 rounded-[10px] text-[clamp(12px,1vw,15px)] font-bold transition-colors disabled:opacity-60',
              TONE[actions.secondary.tone],
            )}
          >
            {actions.secondary.label}
          </button>
        )}
        {isLive(t.status) && (
          // The Recall, any time before the food is up: a question about the
          // order, a dish that ran out.
          <Popover open={asking} onOpenChange={setAsking}>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={busy}
                aria-label="Recall — panggil pelayan"
                title="Recall — panggil pelayan"
                className={cn(
                  'flex min-h-11 w-11 shrink-0 items-center justify-center rounded-[10px] transition-colors disabled:opacity-60',
                  TONE.recall,
                )}
              >
                <BellRing className="h-4.5 w-4.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-1.5">
              <p className="px-2 pb-1.5 pt-1 text-xs font-bold">
                Panggil pelayan · {channelOf(t)} #{t.ticketNo}
              </p>
              {CALL_REASONS.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => {
                    setAsking(false);
                    onCall(r.note);
                  }}
                  className="flex min-h-11 w-full items-center rounded-lg px-2.5 text-left text-[13px] font-semibold hover:bg-muted"
                >
                  {r.label}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}
      </div>
    </article>
  );
}
