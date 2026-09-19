'use client';

import { useMemo, useState } from 'react';
import { Minus, Plus, Split } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import { billLetter, type BillLine } from './floor-model';

/** A table offered as a choice in a dialog. */
export type TableOption = {
  id: number;
  label: string;
  zoneName: string;
  /** "Tersedia · 4 kursi", "Terisi · Budi · 3 pax". */
  meta: string;
  pax: number;
  available: boolean;
};

const SECTION = 'text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

function Stepper({
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label="Kurangi"
      >
        <Minus />
      </Button>
      <span className="min-w-10 text-center font-mono text-base font-semibold tabular-nums">{value}</span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="Tambah"
      >
        <Plus />
      </Button>
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );
}
export { Stepper };

function Checkbox({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        'grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border-[1.5px] text-[11px] font-bold text-white',
        on ? 'border-blue-600 bg-blue-600' : 'border-muted-foreground/40 bg-card',
      )}
    >
      {on ? '✓' : ''}
    </span>
  );
}

// ── Seat / edit guest ────────────────────────────────────────────────────────

export function SeatDialog({
  open,
  mode,
  tableLabel,
  capacity,
  initial,
  warning,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: 'seat' | 'edit';
  tableLabel: string;
  capacity: number;
  initial: { guestName: string; pax: number };
  /** Shown above the form, e.g. the booking this table is being held for. */
  warning?: string | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (v: { guestName: string; pax: number }, andOrder: boolean) => void;
}) {
  const [guestName, setGuestName] = useState(initial.guestName);
  const [pax, setPax] = useState(initial.pax);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'seat' ? `Dudukkan Tamu · Meja ${tableLabel}` : `Ubah Tamu · Meja ${tableLabel}`}</DialogTitle>
          <DialogDescription>
            {mode === 'seat'
              ? `Kapasitas ${capacity} kursi. Timer meja mulai berjalan saat tamu didudukkan.`
              : 'Nama dan jumlah tamu di meja ini.'}
          </DialogDescription>
        </DialogHeader>
        {warning && (
          <p className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200">
            {warning}
          </p>
        )}
        <form
          id="seat-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ guestName: guestName.trim(), pax }, false);
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className={SECTION}>Nama tamu</span>
            <input
              autoFocus
              value={guestName}
              onChange={(e) => setGuestName(e.target.value.slice(0, 100))}
              placeholder="Opsional"
              className="h-10 rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className={SECTION}>Jumlah tamu</span>
            <Stepper value={pax} onChange={setPax} min={1} max={200} suffix="pax" />
            {pax > capacity && (
              <span className="text-xs text-amber-600">
                Melebihi {capacity} kursi — pertimbangkan Gabung Meja.
              </span>
            )}
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Batal
          </Button>
          {mode === 'seat' ? (
            <>
              <Button type="submit" form="seat-form" variant="outline" disabled={busy}>
                Dudukkan saja
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => onSubmit({ guestName: guestName.trim(), pax }, true)}
              >
                Dudukkan &amp; Pesan
              </Button>
            </>
          ) : (
            <Button type="submit" form="seat-form" disabled={busy}>
              Simpan
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Pick one table ───────────────────────────────────────────────────────────

export function TablePickerDialog({
  open,
  title,
  description,
  source,
  options,
  emptyText,
  cta,
  busy,
  onClose,
  onPick,
}: {
  open: boolean;
  title: string;
  description: string;
  /** "Dari" strip: what is being moved or seated. */
  source?: { label: string; right?: string };
  options: TableOption[];
  emptyText: string;
  cta: (label: string | null) => string;
  busy: boolean;
  onClose: () => void;
  onPick: (tableId: number) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const chosen = options.find((o) => o.id === picked) ?? null;
  const zones = useMemo(() => [...new Set(options.map((o) => o.zoneName))], [options]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {source && (
          <div className="-mx-6 flex items-center gap-3 border-y bg-muted/50 px-6 py-3">
            <span className={SECTION}>Dari</span>
            <span className="text-sm font-medium">{source.label}</span>
            {source.right && (
              <span className="ml-auto font-mono text-sm font-semibold">{source.right}</span>
            )}
          </div>
        )}
        {options.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {zones.map((z) => (
              <div key={z} className="flex flex-col gap-2">
                {zones.length > 1 && <span className={SECTION}>{z}</span>}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                  {options
                    .filter((o) => o.zoneName === z)
                    .map((o) => {
                      const on = picked === o.id;
                      return (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => setPicked(o.id)}
                          className={cn(
                            'flex flex-col items-center gap-0.5 rounded-xl border-[1.5px] px-2 py-3 transition-colors',
                            on
                              ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                              : 'border-border bg-card hover:bg-muted',
                          )}
                        >
                          <span className={cn('font-mono text-[17px]', on ? 'font-semibold' : 'font-medium')}>
                            {o.label}
                          </span>
                          <span className="text-center text-[11px] opacity-75">{o.meta}</span>
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button
            type="button"
            disabled={!chosen || busy}
            onClick={() => chosen && onPick(chosen.id)}
          >
            {cta(chosen?.label ?? null)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Merge ────────────────────────────────────────────────────────────────────

export function MergeDialog({
  open,
  source,
  basePax,
  options,
  busy,
  onClose,
  onMerge,
}: {
  open: boolean;
  source: { label: string; right?: string };
  basePax: number;
  options: TableOption[];
  busy: boolean;
  onClose: () => void;
  onMerge: (tableIds: number[]) => void;
}) {
  const [sel, setSel] = useState<number[]>([]);
  // Only an occupied table brings guests along; a free one only adds chairs.
  const pax =
    basePax +
    options.filter((o) => sel.includes(o.id) && !o.available).reduce((n, o) => n + o.pax, 0);
  const toggle = (id: number) =>
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Gabung Meja</DialogTitle>
          <DialogDescription>
            Meja yang digabung tampil sebagai satu sesi. Bill meja yang sudah terisi ikut digabung.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-6 flex items-center gap-3 border-y bg-muted/50 px-6 py-3">
          <span className={SECTION}>Dari</span>
          <span className="text-sm font-medium">{source.label}</span>
          {source.right && <span className="ml-auto font-mono text-sm font-semibold">{source.right}</span>}
        </div>
        <span className={SECTION}>Pilih meja untuk digabung</span>
        {options.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Tidak ada meja lain yang bisa digabung.</p>
        ) : (
          <div className="flex max-h-[45vh] flex-col gap-2 overflow-y-auto">
            {options.map((o) => {
              const on = sel.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggle(o.id)}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                    on ? 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40' : 'bg-card hover:bg-muted',
                  )}
                >
                  <Checkbox on={on} />
                  <span className="text-sm font-medium">Meja {o.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{o.meta}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="rounded-xl bg-cyan-50 px-3 py-2.5 text-sm font-medium text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-200">
          {pax} pax gabungan
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button type="button" disabled={sel.length === 0 || busy} onClick={() => onMerge(sel)}>
            {sel.length ? `Gabungkan ${sel.length + 1} meja` : 'Pilih meja untuk digabung'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Move items ───────────────────────────────────────────────────────────────

export function MoveItemsDialog({
  open,
  source,
  lines,
  targets,
  busy,
  onClose,
  onMove,
}: {
  open: boolean;
  source: { label: string; right?: string };
  lines: BillLine[];
  targets: TableOption[];
  busy: boolean;
  onClose: () => void;
  onMove: (lineIds: string[], tableId: number) => void;
}) {
  const [sel, setSel] = useState<string[]>([]);
  const [target, setTarget] = useState<number | null>(null);
  const sum = lines.filter((l) => sel.includes(l.id)).reduce((n, l) => n + l.total, 0);
  const ready = sel.length > 0 && target !== null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pindah Item</DialogTitle>
          <DialogDescription>Pilih item yang mau dipindah ke bill meja lain.</DialogDescription>
        </DialogHeader>
        <div className="-mx-6 flex items-center gap-3 border-y bg-muted/50 px-6 py-3">
          <span className={SECTION}>Dari</span>
          <span className="text-sm font-medium">{source.label}</span>
          {source.right && <span className="ml-auto font-mono text-sm font-semibold">{source.right}</span>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-2">
            <span className={SECTION}>Item di bill ini</span>
            <div className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto">
              {lines.map((l) => {
                const on = sel.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() =>
                      setSel((s) => (s.includes(l.id) ? s.filter((x) => x !== l.id) : [...s, l.id]))
                    }
                    className={cn(
                      'flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors',
                      on ? 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40' : 'bg-card hover:bg-muted',
                    )}
                  >
                    <Checkbox on={on} />
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate text-sm font-medium">
                        {l.quantity}× {l.name}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {[l.variantName, ...l.addons, l.note].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {formatCurrency(l.total)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <span className={SECTION}>Pindah ke bill meja</span>
            <div className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto">
              {targets.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">Tidak ada meja tujuan.</p>
              )}
              {targets.map((t) => {
                const on = target === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTarget(t.id)}
                    className={cn(
                      'flex items-center gap-2 rounded-xl border-[1.5px] px-3 py-2.5 text-left transition-colors',
                      on
                        ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                        : 'border-border bg-card hover:bg-muted',
                    )}
                  >
                    <span className="text-sm font-medium">Meja {t.label}</span>
                    <span className="ml-auto text-[11px] opacity-70">{t.meta}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter className="items-center">
          <div className="mr-auto flex flex-col leading-tight">
            <span className="text-xs text-muted-foreground">{sel.length} item dipilih</span>
            <span className="font-mono text-sm font-semibold">{formatCurrency(sum)}</span>
          </div>
          <Button type="button" variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button
            type="button"
            disabled={!ready || busy}
            onClick={() => ready && onMove(sel, target!)}
          >
            {ready ? `Pindahkan ${sel.length} item` : 'Pilih item & meja tujuan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Split bill ───────────────────────────────────────────────────────────────

export type SplitRequest =
  | { mode: 'even'; count: number }
  | { mode: 'none' }
  | { mode: 'item'; allocations: { lineId: string; billNo: number; qty: number }[] };

/**
 * Pisah Bill. Two honest ways to split, because they are two different
 * things at the till:
 *   Bagi rata — one bill, read as N equal shares. It is still paid as ONE
 *               order; the shares are printed so the table can settle it.
 *   Per item  — lines assigned to separate bills, each paid on its own with
 *               its own method. A line of 3 can be broken 2 + 1.
 */
export function SplitDialog({
  open,
  source,
  lines,
  splitCount,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  source: { label: string; right?: string };
  lines: BillLine[];
  splitCount: number | null;
  busy: boolean;
  onClose: () => void;
  onSave: (req: SplitRequest) => void;
}) {
  const maxBill = Math.max(1, ...lines.map((l) => l.billNo));
  const [mode, setMode] = useState<'even' | 'item'>(maxBill > 1 ? 'item' : 'even');
  const [count, setCount] = useState(Math.max(2, splitCount ?? maxBill));
  // lineId -> quantity on each bill (index 0 = bill A).
  const [alloc, setAlloc] = useState<Record<string, number[]>>(() =>
    Object.fromEntries(
      lines.map((l) => {
        const row = Array.from({ length: 20 }, () => 0);
        row[l.billNo - 1] = l.quantity;
        return [l.id, row];
      }),
    ),
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const total = lines.reduce((n, l) => n + l.total, 0);
  const assign = (lineId: string, bill: number, qty: number) =>
    setAlloc((a) => ({ ...a, [lineId]: a[lineId].map((q, i) => (i === bill ? qty : q)) }));
  const wholeTo = (l: BillLine, bill: number) =>
    setAlloc((a) => ({
      ...a,
      [l.id]: a[l.id].map((_, i) => (i === bill ? l.quantity : 0)),
    }));

  // Anything allocated beyond `count` bills is off the end and invalid.
  const perLine = lines.map((l) => {
    const row = alloc[l.id] ?? [];
    const inRange = row.slice(0, count).reduce((n, q) => n + q, 0);
    const beyond = row.slice(count).reduce((n, q) => n + q, 0);
    return { line: l, row, ok: inRange === l.quantity && beyond === 0, assigned: inRange };
  });
  const itemValid = perLine.every((p) => p.ok);
  const billTotals = Array.from({ length: count }, (_, b) =>
    perLine.reduce(
      (acc, p) => ({
        total: acc.total + (p.row[b] ?? 0) * p.line.unitPrice,
        qty: acc.qty + (p.row[b] ?? 0),
      }),
      { total: 0, qty: 0 },
    ),
  );
  const share = Math.ceil(total / count);

  const save = () => {
    if (mode === 'even') return onSave({ mode: 'even', count });
    onSave({
      mode: 'item',
      allocations: perLine.flatMap((p) =>
        p.row
          .slice(0, count)
          .map((qty, i) => ({ lineId: p.line.id, billNo: i + 1, qty }))
          .filter((a) => a.qty > 0),
      ),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pisah Bill</DialogTitle>
          <DialogDescription>Pecah satu sesi jadi beberapa bill sebelum pembayaran.</DialogDescription>
        </DialogHeader>
        <div className="-mx-6 flex items-center gap-3 border-y bg-muted/50 px-6 py-3">
          <span className={SECTION}>Dari</span>
          <span className="text-sm font-medium">{source.label}</span>
          <span className="ml-auto font-mono text-sm font-semibold">{formatCurrency(total)}</span>
        </div>

        <div className="flex flex-col gap-2">
          <span className={SECTION}>Cara memisah</span>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['even', 'Bagi rata'],
                ['item', 'Per item'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMode(k)}
                className={cn(
                  'rounded-lg border px-4 py-2 text-[13px] font-medium transition-colors',
                  mode === k
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:bg-muted',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Jumlah bill</span>
          <Stepper value={count} onChange={setCount} min={2} max={mode === 'item' ? 20 : 20} />
        </div>

        {mode === 'item' && (
          <div className="flex max-h-[34vh] flex-col gap-2 overflow-y-auto">
            {perLine.map(({ line: l, row, ok, assigned }) => {
              const split = expanded[l.id] || row.slice(0, count).filter((q) => q > 0).length > 1;
              return (
                <div
                  key={l.id}
                  className={cn('rounded-xl border px-3 py-2', !ok && 'border-amber-300 dark:border-amber-800')}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {l.quantity}× {l.name}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {formatCurrency(l.total)}
                    </span>
                  </div>
                  {!split ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {Array.from({ length: count }, (_, b) => (
                        <button
                          key={b}
                          type="button"
                          onClick={() => wholeTo(l, b)}
                          className={cn(
                            'h-7 min-w-8 rounded-md border px-2 text-xs font-semibold',
                            row[b] === l.quantity
                              ? 'border-blue-600 bg-blue-600 text-white'
                              : 'bg-card text-muted-foreground hover:bg-muted',
                          )}
                        >
                          {billLetter(b + 1)}
                        </button>
                      ))}
                      {l.quantity > 1 && (
                        <button
                          type="button"
                          onClick={() => setExpanded((e) => ({ ...e, [l.id]: true }))}
                          className="ml-auto flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                        >
                          <Split className="h-3 w-3" /> Pecah jumlah
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                      {Array.from({ length: count }, (_, b) => (
                        <div key={b} className="flex items-center gap-1.5">
                          <span className="w-4 text-xs font-semibold">{billLetter(b + 1)}</span>
                          <button
                            type="button"
                            className="grid h-6 w-6 place-items-center rounded border"
                            onClick={() => assign(l.id, b, Math.max(0, (row[b] ?? 0) - 1))}
                            aria-label="Kurangi"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-5 text-center font-mono text-xs tabular-nums">{row[b] ?? 0}</span>
                          <button
                            type="button"
                            className="grid h-6 w-6 place-items-center rounded border"
                            onClick={() => assign(l.id, b, (row[b] ?? 0) + 1)}
                            disabled={assigned >= l.quantity}
                            aria-label="Tambah"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {!ok && (
                    <p className="mt-1 text-[11px] text-amber-600">
                      Terbagi {assigned} dari {l.quantity}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
          {billTotals.map((b, i) => (
            <div key={i} className="flex flex-col gap-0.5 rounded-xl border px-3 py-2.5">
              <span className="text-xs font-semibold text-muted-foreground">Bill {billLetter(i + 1)}</span>
              <span className="font-mono text-sm font-semibold">
                {formatCurrency(mode === 'even' ? share : b.total)}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {mode === 'even' ? 'bagi rata' : `${b.qty} item`}
              </span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {mode === 'even'
            ? 'Bagi rata tetap dibayar sebagai satu transaksi; bagian per orang dicetak di bill. Sebelum pajak & diskon.'
            : 'Setiap bill dibayar terpisah di kasir, dengan metode bayarnya sendiri. Sebelum pajak & diskon.'}
        </p>

        <DialogFooter>
          {(splitCount || maxBill > 1) && (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto"
              disabled={busy}
              onClick={() => onSave({ mode: 'none' })}
            >
              Jadikan satu bill
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button type="button" disabled={busy || (mode === 'item' && !itemValid)} onClick={save}>
            Buat {count} bill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Block ────────────────────────────────────────────────────────────────────

export function BlockDialog({
  open,
  tableLabel,
  busy,
  onClose,
  onBlock,
}: {
  open: boolean;
  tableLabel: string;
  busy: boolean;
  onClose: () => void;
  onBlock: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Blokir Meja {tableLabel}</DialogTitle>
          <DialogDescription>Meja yang diblokir tidak bisa didudukkan sampai blokirnya dibuka.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {['Servis AC', 'Rusak', 'Acara khusus', 'Kotor'].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className="rounded-full border px-3 py-1 text-xs hover:bg-muted"
            >
              {r}
            </button>
          ))}
        </div>
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 100))}
          placeholder="Alasan (opsional)"
          className="h-10 rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => onBlock(reason.trim())}>
            Blokir Meja
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Confirm ──────────────────────────────────────────────────────────────────

export function ConfirmDialog({
  open,
  title,
  message,
  confirm,
  destructive,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirm: string;
  destructive?: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="whitespace-pre-line">{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
