'use client';

import { useRef } from 'react';
import { BellRing, ReceiptText } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CANVAS_H,
  CANVAS_W,
  STATE_STYLE,
  clamp,
  snap,
  type TableState,
  type Wall,
} from './floor-model';

/** A table as the canvas draws it — everything already worked out. */
export type TableView = {
  key: string;
  label: string;
  shape: 'square' | 'round';
  x: number;
  y: number;
  w: number;
  h: number;
  state: TableState;
  /** Under the number: "4 pax", a booking time, "blok". */
  sub: string;
  /** Running clock of the seating, or null. */
  timer: string | null;
  guest: string | null;
  alert: boolean;
  billRequested: boolean;
  unsent: boolean;
  /** The kitchen's Recall is waiting on this table. */
  kitchenCall: boolean;
};

type Selection = { kind: 'table' | 'wall'; key: string } | null;

type Props = {
  walls: Wall[];
  tables: TableView[];
  scale: number;
  editing: boolean;
  selected: Selection;
  showNames: boolean;
  onSelect: (sel: Selection) => void;
  onDrag: (kind: 'table' | 'wall', key: string, x: number, y: number) => void;
};

/**
 * The floor plan: a fixed 900x620 canvas scaled to fit, so a layout drawn on a
 * laptop reads the same on the host's tablet. In edit mode tables and walls
 * drag on a 20px grid; pointer events rather than mouse events, because the
 * device at the door is usually a touchscreen.
 */
export function FloorCanvas({
  walls,
  tables,
  scale,
  editing,
  selected,
  showNames,
  onSelect,
  onDrag,
}: Props) {
  const drag = useRef<{
    kind: 'table' | 'wall';
    key: string;
    startX: number;
    startY: number;
    ox: number;
    oy: number;
    w: number;
    h: number;
  } | null>(null);

  const startDrag = (
    e: React.PointerEvent<HTMLElement>,
    kind: 'table' | 'wall',
    key: string,
    box: { x: number; y: number; w: number; h: number },
  ) => {
    onSelect({ kind, key });
    if (!editing) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      kind,
      key,
      startX: e.clientX,
      startY: e.clientY,
      ox: box.x,
      oy: box.y,
      w: box.w,
      h: box.h,
    };
  };

  const moveDrag = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const x = clamp(snap(d.ox + (e.clientX - d.startX) / scale), 0, CANVAS_W - d.w);
    const y = clamp(snap(d.oy + (e.clientY - d.startY) / scale), 0, CANVAS_H - d.h);
    onDrag(d.kind, d.key, x, y);
  };

  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div
      style={{ width: Math.round(CANVAS_W * scale), height: Math.round(CANVAS_H * scale) }}
      className="relative shrink-0"
    >
      <div
        // Clicking empty floor clears the selection.
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onSelect(null);
        }}
        className="absolute left-0 top-0 origin-top-left rounded-xl border bg-card"
        style={{
          width: CANVAS_W,
          height: CANVAS_H,
          transform: `scale(${scale})`,
          backgroundImage:
            'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      >
        {walls.map((wl) => {
          const on = editing && selected?.kind === 'wall' && selected.key === wl.id;
          return (
            <div
              key={wl.id}
              onPointerDown={(e) => {
                if (!editing) return;
                startDrag(e, 'wall', wl.id, wl);
              }}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className={cn(
                'absolute select-none',
                wl.kind === 'bar'
                  ? 'rounded-full bg-muted-foreground/25'
                  : 'rounded-[3px] bg-muted-foreground/35',
                editing && 'cursor-grab touch-none',
                on && 'outline-2 outline-offset-2 outline-blue-600',
              )}
              style={{ left: wl.x, top: wl.y, width: wl.w, height: wl.h }}
            />
          );
        })}

        {tables.map((t) => {
          const st = STATE_STYLE[t.state];
          const on = selected?.kind === 'table' && selected.key === t.key;
          return (
            <div
              key={t.key}
              className="absolute flex flex-col items-center gap-1.5"
              style={{ left: t.x, top: t.y, width: t.w }}
            >
              <button
                type="button"
                aria-label={`Meja ${t.label}, ${st.label}`}
                onPointerDown={(e) => startDrag(e, 'table', t.key, t)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                className={cn(
                  'relative grid select-none place-items-center border-2 transition-shadow',
                  t.shape === 'round' ? 'rounded-full' : 'rounded-xl',
                  st.fill,
                  st.ink,
                  editing ? 'cursor-grab touch-none' : 'cursor-pointer',
                  on
                    ? 'shadow-[0_0_0_4px_rgba(37,99,235,0.3),0_6px_14px_rgba(0,0,0,0.14)]'
                    : 'shadow-sm',
                )}
                style={{ width: t.w, height: t.h }}
              >
                {/* Chairs, top and bottom. */}
                <span
                  className={cn('absolute -top-[7px] left-[22%] right-[22%] h-[7px] rounded-t', st.chair)}
                />
                <span
                  className={cn('absolute -bottom-[7px] left-[22%] right-[22%] h-[7px] rounded-b', st.chair)}
                />
                <span className="flex flex-col items-center leading-tight">
                  <span className={cn('font-mono font-semibold', t.w > 100 ? 'text-[22px]' : 'text-lg')}>
                    {t.label}
                  </span>
                  <span className="text-[10px] font-medium opacity-85">{t.sub}</span>
                </span>

                {t.timer && !editing && (
                  <span
                    className={cn(
                      'absolute -top-[11px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border bg-card px-1.5 font-mono text-[10.5px] font-semibold',
                      st.pill,
                    )}
                  >
                    {t.timer}
                  </span>
                )}
                {t.alert && !editing && (
                  <span className="absolute -right-[9px] -top-[9px] flex h-[19px] w-[19px] items-center justify-center rounded-full border-2 border-card bg-pink-600 text-[11px] font-bold text-white">
                    !
                  </span>
                )}
                {t.billRequested && !editing && (
                  <span
                    title="Bill sudah diberikan"
                    className="absolute -left-[9px] -top-[9px] flex h-[19px] w-[19px] items-center justify-center rounded-full border-2 border-card bg-amber-500 text-white"
                  >
                    <ReceiptText className="h-2.5 w-2.5" />
                  </span>
                )}
                {t.kitchenCall && !editing && (
                  <>
                    {/* A pulse, not a ping: it stays inside the table's own
                        footprint instead of spilling over its neighbours. */}
                    <span
                      aria-hidden
                      className={cn(
                        'pointer-events-none absolute -inset-1.5 animate-pulse border-[3px] border-red-500',
                        t.shape === 'round' ? 'rounded-full' : 'rounded-2xl',
                      )}
                    />
                    <span
                      title="Dapur memanggil pelayan"
                      className="absolute -bottom-[9px] -left-[9px] flex h-[19px] w-[19px] items-center justify-center rounded-full border-2 border-card bg-red-600 text-white"
                    >
                      <BellRing className="h-2.5 w-2.5" />
                    </span>
                  </>
                )}
                {t.unsent && !editing && (
                  <span
                    title="Ada pesanan belum dikirim ke dapur"
                    className="absolute -bottom-[5px] -right-[5px] h-3 w-3 rounded-full border-2 border-card bg-yellow-400"
                  />
                )}
              </button>
              {showNames && t.guest && (
                <span className="max-w-[140%] truncate text-[11px] text-muted-foreground">{t.guest}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
