'use client';

import type { ReactNode } from 'react';
import {
  ArrowLeftRight,
  BellRing,
  CalendarDays,
  ChefHat,
  Combine,
  CreditCard,
  ListTree,
  Lock,
  LockOpen,
  Pencil,
  Printer,
  ShoppingBag,
  Split,
  Trash2,
  Unlink,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import { Stepper } from './floor-dialogs';
import {
  STATE_STYLE,
  billLetter,
  clock,
  fmtElapsed,
  type FloorSession,
  type FloorTable,
  type TableState,
  type Wall,
} from './floor-model';

const SECTION = 'text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

const ASIDE =
  'flex w-[312px] max-w-[calc(100vw-2rem)] shrink-0 flex-col overflow-y-auto border-l bg-card max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:shadow-[-12px_0_28px_rgba(0,0,0,0.14)]';

function Tile({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex flex-col gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-2.5 py-3 text-left text-[12.5px] font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/70 [&_svg]:size-4.25"
    >
      {icon}
      {label}
    </button>
  );
}

function Row({
  icon,
  label,
  tone = 'plain',
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  tone?: 'plain' | 'dark' | 'amber' | 'rose' | 'emerald';
  disabled?: boolean;
  onClick: () => void;
}) {
  const tones = {
    plain: 'border bg-card text-foreground hover:bg-muted',
    dark: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/85',
    amber:
      'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
    rose: 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
    emerald:
      'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left text-[13.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:size-4.25 [&_svg]:shrink-0',
        tones[tone],
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Aksi Lantai ──────────────────────────────────────────────────────────────

export type ActionsPanelProps = {
  table: FloorTable | null;
  session: FloorSession | undefined;
  state: TableState | null;
  /** "05+06" for a merged seating. */
  seatingLabel: string;
  now: number;
  canFloor: boolean;
  canCashier: boolean;
  busy: boolean;
  onClose: () => void;
  onQuick: (kind: 'move' | 'merge' | 'moveitem' | 'split') => void;
  onDineIn: () => void;
  onTakeAway: () => void;
  onPay: (billNo: number) => void;
  onPrintBill: (billNo: number | null) => void;
  onKitchen: () => void;
  onReservations: () => void;
  onBlock: () => void;
  onUnblock: () => void;
  onToggleAlert: () => void;
  onRelease: () => void;
  onClear: () => void;
  onCancel: () => void;
  onEditGuest: () => void;
  onSeatReservation: () => void;
};

export function ActionsPanel(p: ActionsPanelProps) {
  const { table, session, state } = p;
  const st = state ? STATE_STYLE[state] : null;
  const lines = session?.lines ?? [];
  const bills = [...new Set(lines.map((l) => l.billNo))].sort((a, b) => a - b);
  const multiBill = bills.length > 1;
  const hasLines = lines.length > 0;

  return (
    <aside className={ASIDE}>
      <div className="flex items-start gap-3 border-b px-4 py-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] font-semibold">Aksi Lantai</span>
          <span className="truncate text-xs text-muted-foreground">
            {table
              ? `Meja ${session && session.tableIds.length > 1 ? p.seatingLabel : table.label}` +
                (session ? ` · ${session.guestName || 'Tamu'} · ${session.pax} pax` : ` · ${table.capacity} kursi`)
              : 'Pilih meja di denah'}
          </span>
        </div>
        {st && (
          <span className={cn('ml-auto whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', st.badge)}>
            {st.label}
          </span>
        )}
        <button
          type="button"
          onClick={p.onClose}
          aria-label="Tutup panel"
          className={cn(
            'grid h-6 w-6 shrink-0 place-items-center rounded-full border text-muted-foreground hover:bg-muted',
            !st && 'ml-auto',
          )}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-col gap-5 px-4 py-4">
        {/* Who is here and for how long. */}
        {session && (
          <div className="flex flex-col gap-2 rounded-xl border px-3.5 py-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Duduk sejak {clock(session.seatedAt)}</span>
              <span className={cn('font-mono font-semibold', state === 'overtime' && 'text-rose-600')}>
                {fmtElapsed(p.now - new Date(session.seatedAt).getTime())}
              </span>
            </div>
            {session.billRequestedAt && session.status === 'open' && (
              <div className="flex items-center justify-between text-amber-700 dark:text-amber-300">
                <span>Bill diberikan {clock(session.billRequestedAt)}</span>
                <span className="font-mono">{fmtElapsed(p.now - new Date(session.billRequestedAt).getTime())}</span>
              </div>
            )}
            {session.paidTotal > 0 && (
              <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-300">
                <span>Sudah dibayar</span>
                <span className="font-mono font-semibold">{formatCurrency(session.paidTotal)}</span>
              </div>
            )}
            {session.alertAt && (
              <div className="rounded-lg bg-pink-50 px-2 py-1 text-pink-800 dark:bg-pink-950/40 dark:text-pink-200">
                Perlu perhatian{session.alertNote ? `: ${session.alertNote}` : ''}
              </div>
            )}
            {p.canFloor && (
              <button
                type="button"
                onClick={p.onEditGuest}
                className="flex items-center gap-1 self-start text-[11.5px] font-medium text-blue-600 hover:underline"
              >
                <Pencil className="h-3 w-3" /> Ubah nama / jumlah tamu
              </button>
            )}
          </div>
        )}

        {/* A booking holding a free table. */}
        {table && !session && table.reservation && (
          <div className="flex flex-col gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-3 text-xs text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200">
            <span className="font-semibold">
              Reservasi {clock(table.reservation.reservedAt)} · {table.reservation.guestName} ·{' '}
              {table.reservation.pax} pax
            </span>
            {p.canFloor && (
              <Button size="sm" className="self-start" disabled={p.busy} onClick={p.onSeatReservation}>
                Tamu reservasi datang
              </Button>
            )}
          </div>
        )}

        {table?.blockedAt && (
          <div className="rounded-xl border bg-muted/60 px-3.5 py-3 text-xs text-muted-foreground">
            Diblokir sejak {clock(table.blockedAt)}
            {table.blockedReason ? ` — ${table.blockedReason}` : ''}
          </div>
        )}

        {/* The bill, as it stands. */}
        {session && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className={SECTION}>Bill</span>
              {session.unsentQty > 0 && (
                <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[10.5px] font-semibold text-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-200">
                  {session.unsentQty} belum ke dapur
                </span>
              )}
            </div>
            {!hasLines && session.status === 'paid' && (
              // Paid off: clearing the table is the one thing left to do, so
              // it sits here rather than down in Aksi Lain.
              <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-center text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                Semua sudah dibayar.
                <Button
                  size="sm"
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                  disabled={p.busy}
                  onClick={p.onClear}
                >
                  <LockOpen /> Kosongkan Meja
                </Button>
              </div>
            )}
            {!hasLines && session.status !== 'paid' && (
              <p className="rounded-xl border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                Belum ada pesanan.
              </p>
            )}
            {bills.map((b) => {
              const billLines = lines.filter((l) => l.billNo === b);
              const total = billLines.reduce((n, l) => n + l.total, 0);
              return (
                <div key={b} className="flex flex-col gap-1.5 rounded-xl border px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold">{multiBill ? `Bill ${billLetter(b)}` : 'Total'}</span>
                    <span className="ml-auto font-mono text-sm font-semibold">{formatCurrency(total)}</span>
                  </div>
                  <ul className="flex flex-col gap-0.5">
                    {billLines.map((l) => (
                      <li key={l.id} className="flex items-baseline gap-1.5 text-[11.5px]">
                        {l.quantity > l.sentQty && (
                          <span className="h-1.5 w-1.5 shrink-0 -translate-y-px rounded-full bg-yellow-400" />
                        )}
                        <span className="min-w-0 flex-1 truncate">
                          {l.quantity}× {l.name}
                          {l.variantName ? ` (${l.variantName})` : ''}
                        </span>
                        <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                          {formatCurrency(l.total)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {!multiBill && session.splitCount && session.splitCount > 1 && (
                    <span className="text-[11px] text-cyan-700 dark:text-cyan-300">
                      Dibagi {session.splitCount}: {formatCurrency(Math.ceil(total / session.splitCount))} / orang
                    </span>
                  )}
                  {p.canCashier && (
                    <div className="mt-1 flex gap-1.5">
                      <Button size="sm" className="flex-1" onClick={() => p.onPay(b)}>
                        <CreditCard /> Bayar{multiBill ? ` ${billLetter(b)}` : ''}
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="outline"
                        title="Cetak bill"
                        aria-label="Cetak bill"
                        onClick={() => p.onPrintBill(multiBill ? b : null)}
                      >
                        <Printer />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {session && p.canFloor && (
          <div className="flex flex-col gap-2">
            <span className={SECTION}>Aksi Cepat</span>
            <div className="grid grid-cols-2 gap-2">
              <Tile icon={<ArrowLeftRight />} label="Pindah Meja" onClick={() => p.onQuick('move')} />
              <Tile icon={<Combine />} label="Gabung Meja" onClick={() => p.onQuick('merge')} />
              <Tile
                icon={<ListTree />}
                label="Pindah Item"
                disabled={!hasLines}
                onClick={() => p.onQuick('moveitem')}
              />
              <Tile icon={<Split />} label="Pisah Bill" disabled={!hasLines} onClick={() => p.onQuick('split')} />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className={SECTION}>Order Baru</span>
          {table && !table.blockedAt && (p.canCashier || p.canFloor) && (
            <Row
              icon={<UtensilsCrossed />}
              label={session ? 'Dine-in · tambah pesanan' : 'Dine-in'}
              tone="dark"
              disabled={p.busy || (!session && !p.canFloor)}
              onClick={p.onDineIn}
            />
          )}
          {p.canCashier && <Row icon={<ShoppingBag />} label="Take Away" onClick={p.onTakeAway} />}
        </div>

        <div className="flex flex-col gap-2">
          <span className={SECTION}>Aksi Lain</span>
          {session && hasLines && (
            <>
              <Row
                icon={<Printer />}
                label="Cetak Bill / Minta Bayar"
                tone="amber"
                disabled={p.busy}
                onClick={() => p.onPrintBill(null)}
              />
              <span className="px-0.5 text-[11px] leading-snug text-muted-foreground">
                Menekan ini yang menandai <strong className="font-semibold">Ck Dropped</strong> — otomatis, tanpa
                toggle manual.
              </span>
            </>
          )}
          {session && session.unsentQty > 0 && p.canCashier && (
            <Row icon={<ChefHat />} label="Kirim ke Dapur" disabled={p.busy} onClick={p.onKitchen} />
          )}
          {p.canFloor && (
            <Row icon={<CalendarDays />} label="Ringkasan Reservasi" onClick={p.onReservations} />
          )}
          {session && p.canFloor && (
            <Row
              icon={<BellRing />}
              label={session.alertAt ? 'Hapus tanda perhatian' : 'Tandai perlu perhatian'}
              disabled={p.busy}
              onClick={p.onToggleAlert}
            />
          )}
          {session && session.tableIds.length > 1 && p.canFloor && (
            <Row icon={<Unlink />} label="Lepas meja ini dari gabungan" disabled={p.busy} onClick={p.onRelease} />
          )}
          {session && !hasLines && session.status !== 'paid' && (
            // Sat down and left without ordering.
            <Row icon={<LockOpen />} label="Kosongkan Meja" disabled={p.busy} onClick={p.onClear} />
          )}
          {session && p.canFloor && (
            <Row icon={<Trash2 />} label="Batalkan Sesi Meja" tone="rose" disabled={p.busy} onClick={p.onCancel} />
          )}
          {table && !session && !table.blockedAt && p.canFloor && (
            <Row icon={<Lock />} label="Blokir Meja" tone="rose" disabled={p.busy} onClick={p.onBlock} />
          )}
          {table?.blockedAt && p.canFloor && (
            <Row icon={<LockOpen />} label="Buka Blokir" disabled={p.busy} onClick={p.onUnblock} />
          )}
        </div>
      </div>
    </aside>
  );
}

// ── Layout editor properties ─────────────────────────────────────────────────

export type DraftTable = {
  key: string;
  id: number | null;
  label: string;
  capacity: number;
  shape: 'square' | 'round';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Someone is sitting at it: it can be moved, never deleted. */
  occupied: boolean;
};

const SIZES: { label: string; w: number; h: number }[] = [
  { label: 'S', w: 60, h: 60 },
  { label: 'M', w: 80, h: 80 },
  { label: 'L', w: 120, h: 120 },
  { label: 'P ↔', w: 160, h: 80 },
  { label: 'P ↕', w: 80, h: 160 },
];

function Choice({ on, children, onClick }: { on: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 rounded-lg border px-2.5 py-2 text-[12.5px] font-medium transition-colors',
        on ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

export function LayoutPanel({
  zoneName,
  canDeleteZone,
  dirty,
  table,
  wall,
  overtimeMinutes,
  busy,
  error,
  onZoneName,
  onDeleteZone,
  onPatchTable,
  onAddTable,
  onDupTable,
  onDelTable,
  onPatchWall,
  onAddWall,
  onDelWall,
  onOvertime,
  onCancel,
  onSave,
}: {
  zoneName: string;
  canDeleteZone: boolean;
  dirty: boolean;
  table: DraftTable | null;
  wall: Wall | null;
  overtimeMinutes: number;
  busy: boolean;
  error: string;
  onZoneName: (name: string) => void;
  onDeleteZone: () => void;
  onPatchTable: (patch: Partial<DraftTable>) => void;
  onAddTable: () => void;
  onDupTable: () => void;
  onDelTable: () => void;
  onPatchWall: (patch: Partial<Wall>) => void;
  onAddWall: (kind: Wall['kind']) => void;
  onDelWall: () => void;
  onOvertime: (n: number) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const field = 'h-9 rounded-lg border bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500';
  const horizontal = wall ? wall.w >= wall.h : true;
  return (
    <aside className={ASIDE}>
      <div className="flex flex-col gap-0.5 border-b px-4 py-4">
        <span className="text-[15px] font-semibold">
          {table ? 'Properti Meja' : wall ? 'Properti Dinding' : 'Edit Denah'}
        </span>
        <span className={cn('text-xs', dirty ? 'text-amber-600' : 'text-muted-foreground')}>
          {dirty ? 'Perubahan belum disimpan' : 'Tersimpan'}
        </span>
      </div>

      <div className="flex flex-col gap-5 px-4 py-4">
        {table && (
          <>
            <div className="flex items-center gap-3 rounded-xl border px-3.5 py-3">
              <div className="grid h-11 w-11 place-items-center rounded-lg bg-muted font-mono text-base font-semibold">
                {table.label || '?'}
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <input
                  value={table.label}
                  onChange={(e) => onPatchTable({ label: e.target.value.slice(0, 10) })}
                  aria-label="Nomor meja"
                  placeholder="Nomor"
                  className={cn(field, 'w-full font-mono')}
                />
                <span className="font-mono text-[11.5px] text-muted-foreground">
                  x {table.x} · y {table.y}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className={SECTION}>Kapasitas</span>
              <Stepper
                value={table.capacity}
                onChange={(capacity) => onPatchTable({ capacity })}
                min={1}
                max={50}
                suffix="pax"
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className={SECTION}>Bentuk</span>
              <div className="flex gap-2">
                <Choice on={table.shape === 'square'} onClick={() => onPatchTable({ shape: 'square' })}>
                  Kotak
                </Choice>
                <Choice on={table.shape === 'round'} onClick={() => onPatchTable({ shape: 'round' })}>
                  Bulat
                </Choice>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className={SECTION}>Ukuran</span>
              <div className="flex flex-wrap gap-2">
                {SIZES.map((s) => (
                  <Choice
                    key={s.label}
                    on={table.w === s.w && table.h === s.h}
                    onClick={() => onPatchTable({ w: s.w, h: s.h })}
                  >
                    <span className="font-mono">{s.label}</span>
                  </Choice>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className={SECTION}>Meja</span>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={onAddTable}>
                  + Tambah
                </Button>
                <Button variant="outline" className="flex-1" onClick={onDupTable}>
                  Duplikat
                </Button>
              </div>
              <Button variant="destructive" disabled={table.occupied} onClick={onDelTable}>
                {table.occupied ? 'Meja sedang terisi' : 'Hapus meja ini'}
              </Button>
            </div>
            <span className="text-[11.5px] leading-snug text-muted-foreground">
              Geser meja atau dinding di kanvas untuk memindahkan — posisi menempel ke grid 20px. Order aktif
              tidak terpengaruh.
            </span>
          </>
        )}

        {wall && (
          <>
            <div className="flex items-center gap-3 rounded-xl border px-3.5 py-3">
              <div className="grid h-11 w-11 place-items-center rounded-lg bg-muted">
                <span className="h-1.5 w-6 rounded-sm bg-muted-foreground/60" />
              </div>
              <div className="flex flex-col leading-snug">
                <span className="text-[13px] font-medium">{wall.kind === 'bar' ? 'Bar counter' : 'Dinding'}</span>
                <span className="font-mono text-[11.5px] text-muted-foreground">
                  x {wall.x} · y {wall.y}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className={SECTION}>Jenis</span>
              <div className="flex gap-2">
                <Choice on={wall.kind === 'wall'} onClick={() => onPatchWall({ kind: 'wall' })}>
                  Dinding
                </Choice>
                <Choice on={wall.kind === 'bar'} onClick={() => onPatchWall({ kind: 'bar' })}>
                  Bar counter
                </Choice>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className={SECTION}>Orientasi</span>
              <div className="flex gap-2">
                <Choice on={horizontal} onClick={() => !horizontal && onPatchWall({ w: wall.h, h: wall.w })}>
                  Horizontal
                </Choice>
                <Choice on={!horizontal} onClick={() => horizontal && onPatchWall({ w: wall.h, h: wall.w })}>
                  Vertikal
                </Choice>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className={SECTION}>Panjang</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Perpendek"
                  onClick={() =>
                    onPatchWall(horizontal ? { w: Math.max(40, wall.w - 20) } : { h: Math.max(40, wall.h - 20) })
                  }
                >
                  −
                </Button>
                <span className="min-w-16 text-center font-mono text-sm font-semibold">
                  {horizontal ? wall.w : wall.h} px
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Perpanjang"
                  onClick={() => onPatchWall(horizontal ? { w: wall.w + 20 } : { h: wall.h + 20 })}
                >
                  +
                </Button>
              </div>
            </div>
            <Button variant="destructive" onClick={onDelWall}>
              Hapus dinding ini
            </Button>
            <span className="text-[11.5px] leading-snug text-muted-foreground">
              Klik meja mana pun di kanvas untuk kembali ke properti meja.
            </span>
          </>
        )}

        {!table && !wall && (
          <>
            <label className="flex flex-col gap-2">
              <span className={SECTION}>Nama zona</span>
              <input value={zoneName} onChange={(e) => onZoneName(e.target.value.slice(0, 40))} className={field} />
            </label>
            <div className="flex flex-col gap-2">
              <span className={SECTION}>Tambah</span>
              <Button variant="outline" onClick={onAddTable}>
                + Meja
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => onAddWall('wall')}>
                  + Dinding
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => onAddWall('bar')}>
                  + Bar counter
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className={SECTION}>Batas waktu duduk</span>
              <Stepper
                value={overtimeMinutes}
                onChange={onOvertime}
                min={10}
                max={600}
                suffix="menit"
              />
              <span className="text-[11.5px] leading-snug text-muted-foreground">
                Meja yang duduk lebih lama dari ini tampil merah (Lewat Waktu). Berlaku untuk semua zona.
              </span>
            </div>
            <Button variant="destructive" disabled={!canDeleteZone} onClick={onDeleteZone}>
              {canDeleteZone ? 'Hapus zona ini' : 'Zona ada meja terisi'}
            </Button>
          </>
        )}

        {(table || wall) && (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onAddWall('wall')}>
              + Dinding
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onAddWall('bar')}>
              + Bar
            </Button>
          </div>
        )}

        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </p>
        )}
      </div>

      <div className="sticky bottom-0 mt-auto flex gap-2 border-t bg-card px-4 py-3.5">
        <Button variant="outline" className="h-10 flex-1" onClick={onCancel}>
          Batal
        </Button>
        <Button className="h-10 flex-[1.4]" disabled={busy} onClick={onSave}>
          Simpan Layout
        </Button>
      </div>
    </aside>
  );
}
