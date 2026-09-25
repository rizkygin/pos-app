'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BellRing, LayoutGrid, Pencil, Plus, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import { computeTax, taxLineLabel } from '@/lib/tax';
import { API_URL } from '@/lib/api-url';
import { useOrderAlarm } from '@/lib/use-order-alarm';
import { ReceiptModal, type ReceiptData } from '@/components/dashboard/receipt-modal';
import { FloorCanvas, type TableView } from './floor-canvas';
import { floorApi, viewerTimezone, type ApiResult } from './floor-api';
import {
  BlockDialog,
  ConfirmDialog,
  MergeDialog,
  MoveItemsDialog,
  SeatDialog,
  SplitDialog,
  TablePickerDialog,
  type SplitRequest,
  type TableOption,
} from './floor-dialogs';
import {
  CANVAS_H,
  CANVAS_W,
  STATE_STYLE,
  clamp,
  clock,
  fmtElapsed,
  isOvertime,
  nextTableLabel,
  snap,
  tableState,
  tablesLabel,
  type Floor,
  type FloorSession,
  type FloorTable,
  type KitchenCall,
  type Wall,
} from './floor-model';
import { ActionsPanel, LayoutPanel, type DraftTable } from './floor-panels';
import { ReservationsDialog } from './reservations-dialog';
import { WaitlistView } from './waitlist-view';

/** A seating's bill as GET /api/table-sessions/:id returns it. */
type SessionDetail = {
  id: string;
  guestName: string | null;
  pax: number;
  splitCount: number | null;
  tables: { id: number; label: string }[];
  lines: {
    lineId: string;
    billNo: number;
    product: {
      product_name: string;
      price: string;
      price_mark_down: string;
      variant_name?: string | null;
    };
    quantity: number;
    addons: { name: string; quantity: number; price: number }[];
    note?: string;
    sentQty: number;
  }[];
};

type Draft = {
  zoneId: number;
  zoneName: string;
  originalName: string;
  tables: DraftTable[];
  walls: Wall[];
  overtime: number;
  dirty: boolean;
};

type DialogState =
  | { kind: 'seat'; table: FloorTable }
  | { kind: 'edit-guest'; session: FloorSession; table: FloorTable }
  | { kind: 'move'; session: FloorSession; table: FloorTable }
  | { kind: 'merge'; session: FloorSession }
  | { kind: 'moveitem'; session: FloorSession }
  | { kind: 'split'; session: FloorSession }
  | { kind: 'block'; table: FloorTable }
  | { kind: 'cancel'; session: FloorSession }
  | { kind: 'delete-zone'; zoneId: number; name: string };

/** Poll interval while the live stream is down. */
const POLL_MS = 6000;
/**
 * With the stream up, events drive every refresh and the poll is only a
 * safety net for an event lost in transit.
 */
const SAFETY_POLL_MS = 60_000;

// Wide enough to keep the side panel docked beside the canvas.
const WIDE_QUERY = '(min-width: 1024px)';
const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia(WIDE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};

/** Chip colours for the status strip, as the design has them. */
const CHIP = {
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300',
  indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300',
  orange: 'bg-orange-50 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300',
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  yellow: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/60 dark:text-yellow-300',
  pink: 'bg-pink-50 text-pink-700 dark:bg-pink-950/60 dark:text-pink-300',
  rose: 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
  cyan: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300',
  muted: 'bg-muted text-muted-foreground',
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
};

/** First grid spot a w×h table fits without touching another. */
function freeSpot(tables: { x: number; y: number; w: number; h: number }[], w: number, h: number) {
  const gap = 20;
  for (let y = 40; y <= CANVAS_H - h - 20; y += 20) {
    for (let x = 40; x <= CANVAS_W - w - 20; x += 20) {
      const clash = tables.some(
        (t) => x < t.x + t.w + gap && x + w + gap > t.x && y < t.y + t.h + gap && y + h + gap > t.y,
      );
      if (!clash) return { x, y };
    }
  }
  return { x: 40, y: 40 };
}

export function TablesClient({ cashierName }: { cashierName: string }) {
  const router = useRouter();
  const tz = useMemo(() => viewerTimezone(), []);

  const [floor, setFloor] = useState<Floor | null>(null);
  const [loadError, setLoadError] = useState('');
  const [syncFailing, setSyncFailing] = useState(false);
  // Live stream connected. Mirrored in a ref for the poll timer, which must
  // not be torn down and rebuilt every time the stream blinks.
  const [live, setLive] = useState(false);
  const liveRef = useRef(false);
  const lastLoadRef = useRef(0);
  const [now, setNow] = useState(0);
  const [zoneId, setZoneId] = useState<number | null>(null);
  const [view, setView] = useState<'floor' | 'waitlist'>('floor');
  const [selected, setSelected] = useState<{ kind: 'table' | 'wall'; key: string } | null>(null);
  const [panelOpen, setPanelOpen] = useState<boolean | null>(null);
  const [zoomMode, setZoomMode] = useState<'fit' | 'manual'>('fit');
  const [zoom, setZoom] = useState(100);
  const [paneW, setPaneW] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [receipt, setReceipt] = useState<{
    data: ReceiptData;
    variant: 'customer' | 'kitchen';
    heading: string;
  } | null>(null);
  const [showReservations, setShowReservations] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editError, setEditError] = useState('');

  const wide = useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );

  // ── sync ────────────────────────────────────────────────────────────────
  const load = useCallback(async (): Promise<Floor | null> => {
    lastLoadRef.current = Date.now();
    const res = await floorApi<Floor>('GET', `/api/floor?timezone=${encodeURIComponent(tz)}`);
    setNow(Date.now());
    if (!res.ok) {
      setSyncFailing(true);
      setLoadError(res.error);
      return null;
    }
    setFloor(res.data);
    setSyncFailing(false);
    setLoadError('');
    return res.data;
  }, [tz]);

  // Live updates: the server pushes "this floor changed" (SSE) the moment any
  // device commits a change — a table seated at the door, a bill paid at the
  // till — and this screen re-reads. Bursts (a merge touches several tables)
  // are coalesced into one read.
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
      // (Re)connected: one read picks up whatever happened while it was down.
      es.addEventListener('ready', () => {
        setLiveBoth(true);
        refresh();
      });
      es.addEventListener('floor', (e: MessageEvent) => {
        // A ticket moving on the kitchen screen changes nothing drawn here;
        // a Recall ("call") does, and so does everything else.
        try {
          if (JSON.parse(e.data)?.reason === 'ticket') return;
        } catch {
          /* unreadable: re-read to be safe */
        }
        refresh();
      });
      es.onerror = () => {
        setLiveBoth(false);
        // A dropped connection is retried by the browser on its own, but an
        // HTTP error (a deploy's 502, an expired session) closes the stream
        // for good. Start over ourselves; the poll covers the gap.
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

  // The poll: every few seconds while the stream is down, a slow safety net
  // while it is up. Paused while the tab is hidden; refreshed the moment it
  // is looked at again.
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

  // The seat timers run on this clock, not on the poll.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), notice.ok ? 2500 : 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const flash = (ok: boolean, text: string) => setNotice({ ok, text });

  /** One floor action: call, report, re-read. */
  const run = async <T,>(fn: () => Promise<ApiResult<T>>, okText?: string) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) {
      flash(false, res.error);
      return null;
    }
    if (okText) flash(true, okText);
    const fresh = await load();
    return { res, fresh };
  };

  // ── measure the canvas pane for "Fit" ──────────────────────────────────────
  const roRef = useRef<ResizeObserver | null>(null);
  const paneRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setPaneW(entry.contentRect.width));
    ro.observe(el);
    roRef.current = ro;
  }, []);

  // ── derived ─────────────────────────────────────────────────────────────
  const zones = floor?.zones ?? [];
  const activeZoneId = draft?.zoneId ?? (zones.some((z) => z.id === zoneId) ? zoneId : (zones[0]?.id ?? null));
  const activeZone = zones.find((z) => z.id === activeZoneId) ?? null;
  const sessionById = useMemo(() => new Map((floor?.sessions ?? []).map((s) => [s.id, s])), [floor]);
  const overtimeMin = floor?.outlet.overtimeMinutes ?? 90;
  const canFloor = !!floor?.permissions.tables;
  const canCashier = !!floor?.permissions.cashier;
  // The kitchen's Recall: unanswered calls for a waiter. The chime keeps
  // ringing until someone taps Diterima, like the incoming-order alarm.
  const kitchenCalls = useMemo(() => floor?.kitchenCalls ?? [], [floor]);
  const calledSessions = useMemo(
    () => new Set(kitchenCalls.map((c) => c.sessionId).filter((id): id is string => !!id)),
    [kitchenCalls],
  );
  const callAlarm = useOrderAlarm(kitchenCalls.length > 0, 'pos_kitchen_call_muted');

  const fitScale = paneW ? clamp((paneW - 32) / CANVAS_W, 0.3, 1) : 0.8;
  const scale = zoomMode === 'fit' ? fitScale : zoom / 100;

  const sessionOf = (t: FloorTable | undefined | null) =>
    t?.sessionId ? sessionById.get(t.sessionId) : undefined;
  const stateOf = (t: FloorTable) => tableState(t, sessionOf(t), now, overtimeMin);

  const selectedTable =
    !draft && selected?.kind === 'table'
      ? (floor?.tables.find((t) => String(t.id) === selected.key) ?? null)
      : null;
  const selectedSession = sessionOf(selectedTable);

  const tableViews: TableView[] = useMemo(() => {
    if (!floor || activeZoneId === null) return [];
    if (draft) {
      return draft.tables.map((t) => ({
        key: t.key,
        label: t.label || '?',
        shape: t.shape,
        x: t.x,
        y: t.y,
        w: t.w,
        h: t.h,
        state: 'available',
        sub: `${t.capacity} pax`,
        timer: null,
        guest: null,
        alert: false,
        billRequested: false,
        unsent: false,
        kitchenCall: false,
      }));
    }
    return floor.tables
      .filter((t) => t.zoneId === activeZoneId)
      .map((t) => {
        const s = t.sessionId ? sessionById.get(t.sessionId) : undefined;
        const state = tableState(t, s, now, overtimeMin);
        return {
          key: String(t.id),
          label: t.label,
          shape: t.shape,
          x: t.x,
          y: t.y,
          w: t.w,
          h: t.h,
          state,
          sub:
            state === 'blocked'
              ? 'blok'
              : state === 'reserved' && t.reservation
                ? clock(t.reservation.reservedAt)
                : state === 'paid'
                  ? 'lunas'
                  : `${s ? s.pax : t.capacity} pax`,
          timer: s && s.status === 'open' ? fmtElapsed(now - new Date(s.seatedAt).getTime()) : null,
          guest:
            s?.guestName ??
            (state === 'reserved' ? (t.reservation?.guestName ?? null) : state === 'blocked' ? t.blockedReason : null),
          alert: !!s?.alertAt,
          billRequested: !!s?.billRequestedAt && s.status === 'open',
          unsent: (s?.unsentQty ?? 0) > 0,
          kitchenCall: !!t.sessionId && calledSessions.has(t.sessionId),
        };
      });
  }, [floor, draft, activeZoneId, sessionById, now, overtimeMin, calledSessions]);

  const chips = useMemo(() => {
    const sessions = floor?.sessions ?? [];
    const tables = floor?.tables ?? [];
    const open = sessions.filter((s) => s.status === 'open');
    return [
      { label: 'Seated', value: open.length, tone: CHIP.blue },
      { label: 'Ordered', value: open.filter((s) => s.lines.length > 0).length, tone: CHIP.indigo },
      { label: 'Ck Drop', value: open.filter((s) => s.billRequestedAt).length, tone: CHIP.orange },
      { label: 'Paid', value: sessions.filter((s) => s.status === 'paid').length, tone: CHIP.green },
      { label: 'Unsent', value: sessions.filter((s) => s.unsentQty > 0).length, tone: CHIP.yellow },
      { label: 'Alert', value: sessions.filter((s) => s.alertAt).length, tone: CHIP.pink },
      { label: 'Over Time', value: open.filter((s) => isOvertime(s, now, overtimeMin)).length, tone: CHIP.rose },
      {
        label: 'Reserved',
        value: (floor?.reservations ?? []).filter((r) => r.status === 'booked').length,
        tone: CHIP.violet,
      },
      { label: 'Multiple', value: sessions.filter((s) => s.tableIds.length > 1).length, tone: CHIP.cyan },
      { label: 'Available', value: tables.filter((t) => !t.sessionId && !t.blockedAt).length, tone: CHIP.muted },
      { label: 'Blocked', value: tables.filter((t) => t.blockedAt).length, tone: CHIP.muted },
      { label: 'Pax', value: sessions.reduce((n, s) => n + s.pax, 0), tone: CHIP.slate },
    ];
  }, [floor, now, overtimeMin]);

  const zoneName = (id: number) => zones.find((z) => z.id === id)?.name ?? '';
  const optionOf = (t: FloorTable): TableOption => {
    const s = sessionOf(t);
    return {
      id: t.id,
      label: t.label,
      zoneName: zoneName(t.zoneId),
      pax: s ? s.pax : t.capacity,
      available: !s,
      meta: s
        ? `${STATE_STYLE[stateOf(t)].label} · ${s.guestName ? `${s.guestName} · ` : ''}${s.pax} pax`
        : `${t.capacity} kursi`,
    };
  };
  const byLabel = (a: FloorTable, b: FloorTable) => a.label.localeCompare(b.label, 'id', { numeric: true });
  const freeTableOptions = (floor?.tables ?? [])
    .filter((t) => !t.sessionId && !t.blockedAt)
    .sort(byLabel)
    .map(optionOf);
  const otherTableOptions = (s: FloorSession) =>
    (floor?.tables ?? [])
      .filter((t) => !t.blockedAt && t.sessionId !== s.id)
      .sort(byLabel)
      .map(optionOf);
  const seatingLabel = (s: FloorSession) => tablesLabel(s.tableIds, floor?.tables ?? []);
  const sourceOf = (s: FloorSession) => ({
    label: `Meja ${seatingLabel(s)} · ${s.guestName || 'Tamu'} · ${s.pax} pax`,
    right: formatCurrency(s.total),
  });

  // ── navigation to the till ─────────────────────────────────────────────────
  const goCashier = (sessionId: string, billNo = 1) =>
    router.push(`/dashboard/cashier?table=${encodeURIComponent(sessionId)}&bill=${billNo}`);

  // ── kitchen calls ─────────────────────────────────────────────────────────
  /** Who the kitchen is asking about, the way the floor says it. */
  const callTitle = (c: KitchenCall) =>
    c.source === 'table'
      ? `Meja ${c.label || '?'}`
      : c.label
        ? `Pager ${c.label}`
        : c.customer || 'Pesanan kasir';

  const answerCall = (c: KitchenCall) =>
    void run(
      () => floorApi('POST', `/api/kitchen/tickets/${c.ticketId}/ack`),
      `Panggilan dapur ${callTitle(c)} diterima`,
    );

  const selectTableById = (f: Floor | null, pick: (t: FloorTable) => boolean) => {
    const t = f?.tables.find(pick);
    if (!t) return;
    setZoneId(t.zoneId);
    setView('floor');
    setSelected({ kind: 'table', key: String(t.id) });
    setPanelOpen(true);
  };

  // ── printing ────────────────────────────────────────────────────────────
  const fetchDetail = async (sessionId: string) => {
    const res = await floorApi<{ session: SessionDetail }>('GET', `/api/table-sessions/${sessionId}`);
    if (!res.ok) {
      flash(false, res.error);
      return null;
    }
    return res.data.session;
  };

  const baseSlip = (detail: SessionDetail) => ({
    orderId: detail.id,
    customerName: detail.guestName ?? '',
    tableLabel: detail.tables.map((t) => t.label).join('+'),
    date: new Date(),
    outletName: floor?.outlet.name ?? '',
    outletAddress: floor?.outlet.address ?? '',
    outletPhone: floor?.outlet.phone ?? '',
    outletLogo: floor?.outlet.avatar ?? '',
    cashierName,
    printSettings: floor?.outlet.printerSettings,
  });

  /**
   * Cetak Bill: the pre-bill for the table (or one of its split bills), and
   * the "Ck Dropped" mark that says this table is now waiting to pay. Printed
   * before any discount or member price, which the till applies at payment.
   */
  const printBill = async (session: FloorSession, billNo: number | null) => {
    if (!floor) return;
    setBusy(true);
    const detail = await fetchDetail(session.id);
    if (!detail) return setBusy(false);
    const lines = detail.lines.filter((l) => billNo === null || l.billNo === billNo);
    const unit = (l: SessionDetail['lines'][number]) =>
      (l.product.price_mark_down && l.product.price_mark_down !== '0'
        ? parseFloat(l.product.price_mark_down)
        : parseFloat(l.product.price)) + l.addons.reduce((n, a) => n + a.price * a.quantity, 0);
    const subtotal = lines.reduce((n, l) => n + unit(l) * l.quantity, 0);
    const tax = computeTax(subtotal, floor.outlet.tax);
    await floorApi('POST', `/api/table-sessions/${session.id}/request-bill`);
    setBusy(false);
    setReceipt({
      variant: 'customer',
      heading: billNo ? `Bill ${String.fromCharCode(64 + billNo)} · Meja ${seatingLabel(session)}` : `Bill Meja ${seatingLabel(session)}`,
      data: {
        ...baseSlip(detail),
        billOnly: true,
        splitCount: billNo === null && detail.splitCount && detail.splitCount > 1 ? detail.splitCount : undefined,
        items: lines.map((l) => ({
          product_name: l.product.product_name,
          quantity: l.quantity,
          price: l.product.price,
          price_mark_down: l.product.price_mark_down,
          variant_name: l.product.variant_name ?? null,
          note: l.note,
          addons: l.addons.map((a) => ({ product_name: a.name, quantity: a.quantity, price: a.price })),
        })),
        subtotal,
        discountAmount: 0,
        discountLabel: 'Diskon',
        taxLabel: tax.applies ? taxLineLabel(floor.outlet.tax) : undefined,
        taxAmount: tax.applies ? tax.amount : undefined,
        taxInclusive: floor.outlet.tax.inclusive,
        total: tax.total,
      },
    });
    void load();
  };

  /** Kirim ke Dapur: a ticket for what the kitchen has not been told yet. */
  const sendKitchen = async (session: FloorSession) => {
    setBusy(true);
    const detail = await fetchDetail(session.id);
    if (!detail) return setBusy(false);
    const fresh = detail.lines.filter((l) => l.quantity > l.sentQty);
    if (fresh.length === 0) {
      setBusy(false);
      flash(true, 'Semua pesanan sudah dikirim ke dapur');
      return;
    }
    const res = await floorApi('POST', `/api/table-sessions/${session.id}/sent?timezone=${encodeURIComponent(tz)}`, {
      lineIds: fresh.map((l) => l.lineId),
    });
    setBusy(false);
    if (!res.ok) return flash(false, res.error);
    setReceipt({
      variant: 'kitchen',
      heading: `Tiket Dapur · Meja ${seatingLabel(session)}`,
      data: {
        ...baseSlip(detail),
        items: fresh.map((l) => ({
          product_name: l.product.product_name,
          quantity: l.quantity - l.sentQty,
          price: l.product.price,
          price_mark_down: l.product.price_mark_down,
          variant_name: l.product.variant_name ?? null,
          note: l.note,
          addons: l.addons.map((a) => ({ product_name: a.name, quantity: a.quantity, price: a.price })),
        })),
        subtotal: 0,
        discountAmount: 0,
        discountLabel: '',
        total: 0,
      },
    });
    void load();
  };

  // ── layout editing ──────────────────────────────────────────────────────
  const beginEdit = (f: Floor, id: number) => {
    const zone = f.zones.find((z) => z.id === id);
    if (!zone) return;
    setDraft({
      zoneId: id,
      zoneName: zone.name,
      originalName: zone.name,
      tables: f.tables
        .filter((t) => t.zoneId === id)
        .map((t) => ({
          key: String(t.id),
          id: t.id,
          label: t.label,
          capacity: t.capacity,
          shape: t.shape,
          x: t.x,
          y: t.y,
          w: t.w,
          h: t.h,
          occupied: !!t.sessionId,
        })),
      walls: zone.walls.map((w) => ({ ...w })),
      overtime: f.outlet.overtimeMinutes,
      dirty: false,
    });
    setZoneId(id);
    setSelected(null);
    setView('floor');
    setEditError('');
    setDialog(null);
  };

  const leaveDraftOk = () =>
    !draft?.dirty || window.confirm('Perubahan denah belum disimpan. Buang perubahan?');

  const startFirstZone = async () => {
    const r = await run(() => floorApi<{ zoneId: number }>('POST', '/api/floor/zones', { name: 'Main Zone' }));
    if (r?.fresh) beginEdit(r.fresh, r.res.data.zoneId);
  };

  const addZone = async () => {
    if (!leaveDraftOk()) return;
    const r = await run(() =>
      floorApi<{ zoneId: number }>('POST', '/api/floor/zones', { name: `Zona ${zones.length + 1}` }),
    );
    if (r?.fresh) beginEdit(r.fresh, r.res.data.zoneId);
  };

  const patchDraft = (fn: (d: Draft) => Draft) => setDraft((d) => (d ? { ...fn(d), dirty: true } : d));

  const patchTable = (key: string, patch: Partial<DraftTable>) =>
    patchDraft((d) => ({
      ...d,
      tables: d.tables.map((t) => {
        if (t.key !== key) return t;
        const next = { ...t, ...patch };
        // A bigger table near the edge is pulled back onto the canvas.
        next.x = clamp(next.x, 0, CANVAS_W - next.w);
        next.y = clamp(next.y, 0, CANVAS_H - next.h);
        return next;
      }),
    }));

  const patchWall = (id: string, patch: Partial<Wall>) =>
    patchDraft((d) => ({
      ...d,
      walls: d.walls.map((w) => {
        if (w.id !== id) return w;
        const next = { ...w, ...patch };
        next.w = clamp(next.w, 4, CANVAS_W);
        next.h = clamp(next.h, 4, CANVAS_H);
        next.x = clamp(next.x, 0, CANVAS_W - next.w);
        next.y = clamp(next.y, 0, CANVAS_H - next.h);
        return next;
      }),
    }));

  const draftTable = draft && selected?.kind === 'table' ? draft.tables.find((t) => t.key === selected.key) : null;
  const draftWall = draft && selected?.kind === 'wall' ? draft.walls.find((w) => w.id === selected.key) : null;

  const addTable = (from?: DraftTable) => {
    if (!draft || !floor) return;
    const labels = [
      ...floor.tables.filter((t) => t.zoneId !== draft.zoneId).map((t) => t.label),
      ...draft.tables.map((t) => t.label),
    ];
    const w = from?.w ?? 80;
    const h = from?.h ?? 80;
    const spot = from
      ? { x: clamp(snap(from.x + 40), 0, CANVAS_W - w), y: clamp(snap(from.y + 40), 0, CANVAS_H - h) }
      : freeSpot(draft.tables, w, h);
    const key = `new-${crypto.randomUUID()}`;
    patchDraft((d) => ({
      ...d,
      tables: [
        ...d.tables,
        {
          key,
          id: null,
          label: nextTableLabel(labels),
          capacity: from?.capacity ?? 4,
          shape: from?.shape ?? 'square',
          w,
          h,
          ...spot,
          occupied: false,
        },
      ],
    }));
    setSelected({ kind: 'table', key });
  };

  const addWall = (kind: Wall['kind']) => {
    if (!draft) return;
    const id = `w-${crypto.randomUUID().slice(0, 8)}`;
    const w = kind === 'bar' ? 220 : 180;
    const h = kind === 'bar' ? 16 : 12;
    // Somewhere empty, so a new wall never lands on top of a table.
    const spot = freeSpot([...draft.tables, ...draft.walls], w, h);
    patchDraft((d) => ({ ...d, walls: [...d.walls, { id, ...spot, w, h, kind }] }));
    setSelected({ kind: 'wall', key: id });
  };

  const saveLayout = async () => {
    if (!draft || !floor) return;
    setEditError('');
    setBusy(true);
    const layout = await floorApi('PUT', `/api/floor/zones/${draft.zoneId}/layout`, {
      tables: draft.tables.map(({ id, label, capacity, shape, x, y, w, h }) => ({
        id,
        label: label.trim(),
        capacity,
        shape,
        x,
        y,
        w,
        h,
      })),
      walls: draft.walls,
    });
    let error = layout.ok ? '' : layout.error;
    if (!error && draft.zoneName.trim() && draft.zoneName.trim() !== draft.originalName) {
      const r = await floorApi('PATCH', `/api/floor/zones/${draft.zoneId}`, { name: draft.zoneName.trim() });
      if (!r.ok) error = r.error;
    }
    if (!error && draft.overtime !== floor.outlet.overtimeMinutes) {
      const r = await floorApi('PATCH', '/api/floor/settings', { overtimeMinutes: draft.overtime });
      if (!r.ok) error = r.error;
    }
    setBusy(false);
    if (error) {
      setEditError(error);
      return;
    }
    setDraft(null);
    setSelected(null);
    flash(true, 'Denah tersimpan');
    void load();
  };

  // ── render ──────────────────────────────────────────────────────────────
  if (!floor) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        {loadError ? (
          <div className="max-w-sm rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            <p className="font-semibold">Manajemen Meja tidak bisa dibuka</p>
            <p className="mt-1">{loadError}</p>
            <Button variant="outline" className="mt-4" onClick={() => void load()}>
              Coba lagi
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Memuat denah…</p>
        )}
      </div>
    );
  }

  const editing = draft !== null;
  const panelShown = editing || (view === 'floor' && (panelOpen ?? wide));
  const liveCount = floor.sessions.length;
  const nowDate = new Date(now || Date.parse(floor.serverTime));
  const todayLabel = `Hari ini · ${nowDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const zoneHasOccupied = floor.tables.some((t) => t.zoneId === activeZoneId && t.sessionId);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex items-center gap-4 border-b px-4 py-3 md:px-5">
        <div className="flex min-w-0 flex-col leading-snug">
          <span className="text-[15px] font-semibold">Manajemen Meja</span>
          <span className="truncate text-xs text-muted-foreground">
            {todayLabel} ·{' '}
            {floor.shift ? `Shift ${floor.shift.cashierName} sejak ${clock(floor.shift.openedAt)}` : 'Belum ada shift'}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          <div
            className="hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs text-muted-foreground sm:flex"
            title={
              syncFailing
                ? loadError
                : live
                  ? 'Live — perubahan dari perangkat lain muncul seketika'
                  : 'Koneksi live terputus — denah diperbarui tiap beberapa detik'
            }
          >
            <span
              className={cn(
                'h-1.75 w-1.75 rounded-full',
                syncFailing ? 'bg-amber-500' : live ? 'animate-pulse bg-emerald-600' : 'bg-sky-500',
              )}
            />
            {syncFailing ? 'Gagal sinkron' : `${live ? 'Live' : 'Tersinkron'} · ${liveCount} meja aktif`}
          </div>
          <div className="rounded-full bg-muted px-3 py-1.5 font-mono text-xs font-medium">
            {now ? clock(nowDate) : '--:--'}
          </div>
        </div>
      </header>

      {/* The kitchen's Recall. Above everything else on purpose: it is the
          one thing on this screen somebody is actively waiting on. */}
      {kitchenCalls.length > 0 && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2.5 md:px-5 dark:border-red-900 dark:bg-red-950/40">
          <div className="flex items-center gap-2">
            <BellRing className="h-4 w-4 animate-pulse text-red-600 dark:text-red-400" />
            <span className="text-[13px] font-bold text-red-800 dark:text-red-200">
              Dapur memanggil pelayan
            </span>
            <span className="rounded-full bg-red-600 px-1.5 py-px font-mono text-[11px] font-semibold text-white">
              {kitchenCalls.length}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              {callAlarm.blocked && !callAlarm.muted && (
                <Button size="sm" variant="outline" onClick={callAlarm.enableSound}>
                  Aktifkan suara
                </Button>
              )}
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={callAlarm.toggleMuted}
                aria-label={callAlarm.muted ? 'Nyalakan suara panggilan' : 'Matikan suara panggilan'}
                title={callAlarm.muted ? 'Nyalakan suara panggilan' : 'Matikan suara panggilan'}
              >
                {callAlarm.muted ? <VolumeX /> : <Volume2 />}
              </Button>
            </div>
          </div>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-0.5">
            {kitchenCalls.map((c) => {
              const seated = c.sessionId ? floor.tables.some((t) => t.sessionId === c.sessionId) : false;
              return (
                <div
                  key={c.ticketId}
                  className="flex shrink-0 items-center gap-2.5 rounded-xl border border-red-200 bg-card px-2.5 py-2 shadow-sm dark:border-red-900"
                >
                  <span className="flex h-9 min-w-9 items-center justify-center rounded-lg bg-red-600 px-1.5 font-mono text-sm font-bold text-white">
                    #{c.ticketNo}
                  </span>
                  <div className="min-w-0 max-w-56 leading-tight">
                    <p className="truncate text-[13px] font-semibold">
                      {callTitle(c)}
                      {c.source === 'table' && c.customer ? (
                        <span className="font-normal text-muted-foreground"> · {c.customer}</span>
                      ) : null}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {c.note || 'Pelayan diminta ke dapur'} · {clock(c.callAt)}
                      {c.callCount > 1 ? ` · ${c.callCount}×` : ''}
                    </p>
                  </div>
                  {seated && !editing && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => selectTableById(floor, (t) => t.sessionId === c.sessionId)}
                    >
                      Lihat
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => answerCall(c)}
                    className="bg-red-600 text-white hover:bg-red-700"
                  >
                    Diterima
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Toolbar: zones, waitlist, counts, edit */}
      <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2.5 md:px-5">
        {zones.map((z) => {
          const active = view === 'floor' && z.id === activeZoneId;
          return (
            <button
              key={z.id}
              type="button"
              onClick={() => {
                if (editing) {
                  if (z.id !== draft.zoneId && leaveDraftOk()) beginEdit(floor, z.id);
                  return;
                }
                setZoneId(z.id);
                setView('floor');
                setSelected(null);
              }}
              className={cn(
                'rounded-lg border px-3.5 py-1.5 text-[13px] transition-colors',
                active
                  ? 'border-primary bg-primary font-semibold text-primary-foreground'
                  : 'bg-card font-medium text-muted-foreground hover:bg-muted',
              )}
            >
              {editing && z.id === draft.zoneId ? draft.zoneName || z.name : z.name}
            </button>
          );
        })}
        {editing && (
          <Button variant="outline" size="sm" disabled={busy} onClick={addZone}>
            <Plus /> Zona
          </Button>
        )}
        {!editing && (
          <>
            <span className="mx-1.5 h-6 w-px bg-border" />
            <button
              type="button"
              onClick={() => {
                setView('waitlist');
                setSelected(null);
              }}
              className={cn(
                'flex items-center gap-2 rounded-lg border border-dashed px-3.5 py-1.5 text-[13px] transition-colors',
                view === 'waitlist'
                  ? 'border-amber-500 bg-amber-50 font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                  : 'border-muted-foreground/40 font-medium text-muted-foreground hover:bg-muted',
              )}
            >
              Daftar Tunggu
              <span className="rounded-full bg-amber-500 px-1.5 py-px font-mono text-[11px] font-semibold text-white">
                {floor.waitlist.length}
              </span>
            </button>
          </>
        )}
        <div className="ml-auto flex items-center gap-3 text-[12.5px] text-muted-foreground">
          <span className="hidden sm:inline">
            <strong className="font-semibold text-foreground">{floor.today.dineIn}</strong> Dine-in
          </span>
          <span className="hidden sm:inline">
            <strong className="font-semibold text-foreground">{floor.today.takeAway}</strong> Take Away
          </span>
          {canFloor && zones.length > 0 && (
            <Button
              variant={editing ? 'default' : 'outline'}
              size="sm"
              disabled={busy || (!editing && !floor.entitled)}
              title={!floor.entitled ? 'Paket belum termasuk Manajemen Meja' : undefined}
              onClick={() => {
                if (editing) {
                  if (leaveDraftOk()) {
                    setDraft(null);
                    setSelected(null);
                  }
                } else if (activeZoneId !== null) beginEdit(floor, activeZoneId);
              }}
            >
              <Pencil /> {editing ? 'Selesai Edit' : 'Edit Layout'}
            </Button>
          )}
          {!panelShown && view === 'floor' && zones.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setPanelOpen(true)}>
              Aksi Lantai
            </Button>
          )}
        </div>
      </div>

      {!floor.entitled && (
        <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 md:px-5 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Paket Anda belum termasuk Manajemen Meja (mulai Max). Meja yang sedang terisi tetap bisa dibayar
          dan dikosongkan.
          <Link href="/dashboard/subscription" className="font-semibold underline">
            Lihat paket
          </Link>
        </div>
      )}

      {/* Body */}
      {zones.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="flex max-w-md flex-col items-center gap-3 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-muted">
              <LayoutGrid className="h-7 w-7 text-muted-foreground" />
            </span>
            <p className="text-base font-semibold">Belum ada denah meja</p>
            <p className="text-sm text-muted-foreground">
              Gambar denah outlet Anda — zona, meja, dan dindingnya — lalu dudukkan tamu, catat pesanan per meja,
              dan bayar per bill dari kasir.
            </p>
            {canFloor && floor.entitled && (
              <Button disabled={busy} onClick={startFirstZone}>
                Mulai Atur Denah
              </Button>
            )}
            {!canFloor && (
              <p className="text-xs text-muted-foreground">Minta pemilik outlet untuk mengatur denah meja.</p>
            )}
          </div>
        </div>
      ) : view === 'waitlist' ? (
        <WaitlistView
          entries={floor.waitlist}
          now={now || Date.parse(floor.serverTime)}
          outletName={floor.outlet.name}
          tableOptions={freeTableOptions}
          canAct={canFloor}
          busy={busy}
          onAdd={async (v) =>
            !!(await run(
              () => floorApi('POST', `/api/waitlist?timezone=${encodeURIComponent(tz)}`, v),
              `${v.guestName} masuk daftar tunggu`,
            ))
          }
          onCall={(e) => void run(() => floorApi('POST', `/api/waitlist/${e.id}/call`), `${e.guestName} dipanggil`)}
          onSeat={async (e, tableId) => {
            const r = await run(() =>
              floorApi<{ sessionId: string }>('POST', `/api/waitlist/${e.id}/seat`, { tableId }),
            );
            if (r) selectTableById(r.fresh, (t) => t.sessionId === r.res.data.sessionId);
          }}
          onRemove={(e) => void run(() => floorApi('DELETE', `/api/waitlist/${e.id}`))}
        />
      ) : (
        <section className="relative flex min-h-0 min-w-0 flex-1">
          <div ref={paneRef} className="relative flex min-w-0 flex-1 flex-col overflow-auto bg-muted/30">
            {notice && (
              <div
                className={cn(
                  'sticky left-0 top-0 z-10 mx-4 mt-3 rounded-lg border px-3 py-2 text-xs font-medium shadow-sm',
                  notice.ok
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200'
                    : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-200',
                )}
              >
                {notice.text}
              </div>
            )}
            <div className="flex-1 p-4">
              <FloorCanvas
                walls={draft ? draft.walls : (activeZone?.walls ?? [])}
                tables={tableViews}
                scale={scale}
                editing={editing}
                selected={selected}
                showNames={scale >= 0.7}
                onSelect={(sel) => {
                  setSelected(sel);
                  if (sel && !editing) setPanelOpen(true);
                }}
                onDrag={(kind, key, x, y) =>
                  kind === 'table' ? patchTable(key, { x, y }) : patchWall(key, { x, y })
                }
              />
            </div>
            <div className="sticky bottom-0 left-0 flex items-center gap-2 border-t bg-background/90 px-4 py-2.5 backdrop-blur md:px-6">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Perkecil"
                onClick={() => {
                  setZoomMode('manual');
                  setZoom(Math.max(30, Math.round(scale * 100) - 10));
                }}
              >
                −
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Perbesar"
                onClick={() => {
                  setZoomMode('manual');
                  setZoom(Math.min(150, Math.round(scale * 100) + 10));
                }}
              >
                +
              </Button>
              <span className="rounded-lg border px-2.5 py-1 font-mono text-xs">{Math.round(scale * 100)}%</span>
              <Button
                variant={zoomMode === 'fit' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setZoomMode('fit')}
              >
                Fit
              </Button>
              <span className="ml-3 hidden truncate text-[11.5px] text-muted-foreground sm:inline">
                {editing ? 'Geser meja atau dinding · snap grid 20px' : 'Klik meja untuk membuka Aksi Lantai'}
              </span>
            </div>
          </div>

          {panelShown && editing && draft && (
            <LayoutPanel
              zoneName={draft.zoneName}
              canDeleteZone={!zoneHasOccupied}
              dirty={draft.dirty}
              table={draftTable ?? null}
              wall={draftWall ?? null}
              overtimeMinutes={draft.overtime}
              busy={busy}
              error={editError}
              onZoneName={(name) => patchDraft((d) => ({ ...d, zoneName: name }))}
              onDeleteZone={() => setDialog({ kind: 'delete-zone', zoneId: draft.zoneId, name: draft.zoneName })}
              onPatchTable={(patch) => draftTable && patchTable(draftTable.key, patch)}
              onAddTable={() => addTable()}
              onDupTable={() => draftTable && addTable(draftTable)}
              onDelTable={() => {
                if (!draftTable || draftTable.occupied) return;
                patchDraft((d) => ({ ...d, tables: d.tables.filter((t) => t.key !== draftTable.key) }));
                setSelected(null);
              }}
              onPatchWall={(patch) => draftWall && patchWall(draftWall.id, patch)}
              onAddWall={addWall}
              onDelWall={() => {
                if (!draftWall) return;
                patchDraft((d) => ({ ...d, walls: d.walls.filter((w) => w.id !== draftWall.id) }));
                setSelected(null);
              }}
              onOvertime={(n) => patchDraft((d) => ({ ...d, overtime: n }))}
              onCancel={() => {
                if (!leaveDraftOk()) return;
                setDraft(null);
                setSelected(null);
              }}
              onSave={saveLayout}
            />
          )}

          {panelShown && !editing && (
            <ActionsPanel
              table={selectedTable}
              session={selectedSession}
              state={selectedTable ? stateOf(selectedTable) : null}
              seatingLabel={selectedSession ? seatingLabel(selectedSession) : ''}
              now={now || Date.parse(floor.serverTime)}
              canFloor={canFloor}
              canCashier={canCashier}
              busy={busy}
              onClose={() => setPanelOpen(false)}
              onQuick={(kind) => {
                if (!selectedSession || !selectedTable) return;
                if (kind === 'move') setDialog({ kind: 'move', session: selectedSession, table: selectedTable });
                else setDialog({ kind, session: selectedSession });
              }}
              onDineIn={() => {
                if (!selectedTable) return;
                if (selectedSession) goCashier(selectedSession.id, 1);
                else setDialog({ kind: 'seat', table: selectedTable });
              }}
              onTakeAway={() => router.push('/dashboard/cashier?takeaway=1')}
              onPay={(billNo) => selectedSession && goCashier(selectedSession.id, billNo)}
              onPrintBill={(billNo) => selectedSession && void printBill(selectedSession, billNo)}
              onKitchen={() => selectedSession && void sendKitchen(selectedSession)}
              onReservations={() => setShowReservations(true)}
              onBlock={() => selectedTable && setDialog({ kind: 'block', table: selectedTable })}
              onUnblock={() =>
                selectedTable &&
                void run(() => floorApi('POST', `/api/tables/${selectedTable.id}/unblock`), 'Blokir dibuka')
              }
              onToggleAlert={() =>
                selectedSession &&
                void run(() =>
                  floorApi('POST', `/api/table-sessions/${selectedSession.id}/alert`, { on: !selectedSession.alertAt }),
                )
              }
              onRelease={() =>
                selectedSession &&
                selectedTable &&
                void run(
                  () =>
                    floorApi('POST', `/api/table-sessions/${selectedSession.id}/release-table`, {
                      tableId: selectedTable.id,
                    }),
                  `Meja ${selectedTable.label} dilepas dari gabungan`,
                )
              }
              onClear={() =>
                selectedSession &&
                void run(
                  () => floorApi('POST', `/api/table-sessions/${selectedSession.id}/clear`),
                  `Meja ${seatingLabel(selectedSession)} dikosongkan`,
                )
              }
              onCancel={() => selectedSession && setDialog({ kind: 'cancel', session: selectedSession })}
              onEditGuest={() =>
                selectedSession &&
                selectedTable &&
                setDialog({ kind: 'edit-guest', session: selectedSession, table: selectedTable })
              }
              onSeatReservation={async () => {
                const r = selectedTable?.reservation;
                if (!r) return;
                const done = await run(
                  () => floorApi('POST', `/api/reservations/${r.id}/seat`, {}),
                  `${r.guestName} didudukkan`,
                );
                if (done) setPanelOpen(true);
              }}
            />
          )}
        </section>
      )}

      {/* Status strip */}
      <div className="flex items-center gap-2 overflow-x-auto border-t bg-background px-4 py-2.5 md:px-5">
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium">
          <span className={cn('h-2 w-2 rounded-full', syncFailing ? 'bg-amber-500' : 'bg-emerald-600')} />
          {todayLabel}
        </div>
        <span className="mx-1 h-5.5 w-px shrink-0 bg-border" />
        {chips.map((c) => (
          <div key={c.label} className="flex shrink-0 flex-col items-center gap-0.5">
            <span className={cn('min-w-8 rounded-md px-1.5 py-0.5 text-center font-mono text-xs font-semibold', c.tone)}>
              {c.value}
            </span>
            <span className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              {c.label}
            </span>
          </div>
        ))}
      </div>

      {/* Dialogs — mounted per use so each opens with fresh state. */}
      {dialog?.kind === 'seat' && (
        <SeatDialog
          open
          mode="seat"
          tableLabel={dialog.table.label}
          capacity={dialog.table.capacity}
          initial={{ guestName: '', pax: Math.min(2, dialog.table.capacity) }}
          warning={
            dialog.table.reservation
              ? `Meja ini dipesan ${clock(dialog.table.reservation.reservedAt)} atas nama ${dialog.table.reservation.guestName}.`
              : null
          }
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={async (v, andOrder) => {
            const r = await run(
              () => floorApi<{ sessionId: string }>('POST', `/api/tables/${dialog.table.id}/seat`, v),
              andOrder ? undefined : `Meja ${dialog.table.label} terisi`,
            );
            if (!r) return;
            setDialog(null);
            if (andOrder) goCashier(r.res.data.sessionId, 1);
          }}
        />
      )}
      {dialog?.kind === 'edit-guest' && (
        <SeatDialog
          open
          mode="edit"
          tableLabel={seatingLabel(dialog.session)}
          capacity={dialog.table.capacity}
          initial={{ guestName: dialog.session.guestName ?? '', pax: dialog.session.pax }}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={async (v) => {
            const r = await run(() => floorApi('PATCH', `/api/table-sessions/${dialog.session.id}`, v));
            if (r) setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'move' && (
        <TablePickerDialog
          open
          title="Pindah Meja"
          description="Order, timer, dan bill ikut pindah ke meja tujuan."
          source={sourceOf(dialog.session)}
          options={freeTableOptions}
          emptyText="Tidak ada meja kosong."
          cta={(l) => (l ? `Pindahkan ke Meja ${l}` : 'Pilih meja tujuan')}
          busy={busy}
          onClose={() => setDialog(null)}
          onPick={async (toTableId) => {
            const r = await run(
              () =>
                floorApi('POST', `/api/table-sessions/${dialog.session.id}/move`, {
                  fromTableId: dialog.table.id,
                  toTableId,
                }),
              'Meja dipindah',
            );
            if (!r) return;
            setDialog(null);
            selectTableById(r.fresh, (t) => t.id === toTableId);
          }}
        />
      )}
      {dialog?.kind === 'merge' && (
        <MergeDialog
          open
          source={sourceOf(dialog.session)}
          basePax={dialog.session.pax}
          options={otherTableOptions(dialog.session)}
          busy={busy}
          onClose={() => setDialog(null)}
          onMerge={async (tableIds) => {
            const r = await run(
              () => floorApi('POST', `/api/table-sessions/${dialog.session.id}/merge`, { tableIds }),
              `${tableIds.length + 1} meja digabung`,
            );
            if (r) setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'moveitem' && (
        <MoveItemsDialog
          open
          source={sourceOf(dialog.session)}
          lines={dialog.session.lines}
          targets={otherTableOptions(dialog.session)}
          busy={busy}
          onClose={() => setDialog(null)}
          onMove={async (lineIds, toTableId) => {
            const r = await run(
              () => floorApi('POST', `/api/table-sessions/${dialog.session.id}/move-lines`, { lineIds, toTableId }),
              `${lineIds.length} item dipindah`,
            );
            if (r) setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'split' && (
        <SplitDialog
          open
          source={sourceOf(dialog.session)}
          lines={dialog.session.lines}
          splitCount={dialog.session.splitCount}
          busy={busy}
          onClose={() => setDialog(null)}
          onSave={async (req: SplitRequest) => {
            const r = await run(
              () => floorApi('PUT', `/api/table-sessions/${dialog.session.id}/split`, req),
              req.mode === 'none' ? 'Bill digabung jadi satu' : 'Bill dipisah',
            );
            if (r) setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'block' && (
        <BlockDialog
          open
          tableLabel={dialog.table.label}
          busy={busy}
          onClose={() => setDialog(null)}
          onBlock={async (reason) => {
            const r = await run(
              () => floorApi('POST', `/api/tables/${dialog.table.id}/block`, { reason }),
              `Meja ${dialog.table.label} diblokir`,
            );
            if (r) setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'cancel' && (
        <ConfirmDialog
          open
          title={`Batalkan sesi Meja ${seatingLabel(dialog.session)}?`}
          message={
            dialog.session.lines.length
              ? `Masih ada ${dialog.session.lines.length} item belum dibayar senilai ${formatCurrency(dialog.session.total)}.\nItem ini tidak akan tercatat sebagai penjualan, dan meja dikosongkan.`
              : 'Meja dikosongkan tanpa transaksi.'
          }
          confirm="Batalkan Sesi"
          destructive
          busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            const r = await run(
              () => floorApi('POST', `/api/table-sessions/${dialog.session.id}/cancel`, { force: true }),
              'Sesi meja dibatalkan',
            );
            if (r) setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'delete-zone' && (
        <ConfirmDialog
          open
          title={`Hapus zona ${dialog.name}?`}
          message="Semua meja dan dinding di zona ini ikut dihapus. Reservasi pada meja-meja itu tetap ada, tanpa meja."
          confirm="Hapus Zona"
          destructive
          busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            const r = await run(() => floorApi('DELETE', `/api/floor/zones/${dialog.zoneId}`), 'Zona dihapus');
            if (!r) return;
            setDialog(null);
            setDraft(null);
            setSelected(null);
            setZoneId(null);
          }}
        />
      )}

      {showReservations && (
        <ReservationsDialog
          tables={floor.tables}
          entitled={floor.entitled}
          onClose={() => setShowReservations(false)}
          onChanged={() => void load()}
          onSeated={async (sessionId) => {
            setShowReservations(false);
            const fresh = await load();
            selectTableById(fresh, (t) => t.sessionId === sessionId);
          }}
        />
      )}

      {receipt && (
        <ReceiptModal
          data={receipt.data}
          variant={receipt.variant}
          heading={receipt.heading}
          onClose={() => setReceipt(null)}
        />
      )}
    </div>
  );
}
