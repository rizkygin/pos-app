'use client';

import { useMemo, useState } from 'react';
import { X, Tag, AlertTriangle } from 'lucide-react';
import {
  FONT_CELL,
  LABEL_PRESETS,
  buildOrderLabelBatch,
  estimateCode128Width,
  mmToDots,
  readLabelSize,
  writeLabelSize,
  type BuiltLabel,
  type LabelSize,
  type OrderLabel,
} from '@/lib/labelbridge';

/**
 * On-screen proof of what the label printer is about to do.
 *
 * The preview draws from the same element list that gets sent to the printer,
 * positioned at the same dot coordinates and scaled down — so a name that will
 * truncate, a price that will collide, or a barcode too wide for the stock all
 * show up here rather than on a wasted roll.
 *
 * The bars themselves are indicative, not a real Code 128 rendering; the width
 * is computed from the encoder's worst case so an overflow still surfaces.
 */

/** How wide, in CSS px, one label is drawn. Everything else scales from this. */
const PREVIEW_W = 260;

function LabelCard({
  label,
  widthDots,
  heightDots,
}: {
  label: BuiltLabel;
  widthDots: number;
  heightDots: number;
}) {
  const scale = PREVIEW_W / widthDots;
  const margin = mmToDots(2);

  // Anything reaching past the printable area would be clipped by the printer.
  const overflow = label.elements.some((el) => {
    if (el.t === 'barcode') {
      return (
        el.x + estimateCode128Width(el.v, el.narrow) > widthDots - margin ||
        el.y + el.h > heightDots
      );
    }
    return el.x + el.v.length * FONT_CELL.char[el.font] > widthDots;
  });

  return (
    <div className="shrink-0">
      <div
        className={`relative overflow-hidden rounded-md border bg-white ${
          overflow ? 'border-rose-400' : 'border-gray-300'
        }`}
        style={{ width: PREVIEW_W, height: heightDots * scale }}
      >
        {label.elements.map((el, i) => {
          if (el.t === 'text') {
            const cell = FONT_CELL.char[el.font] ?? 16;
            return (
              <span
                key={i}
                className="absolute whitespace-pre font-mono leading-none text-black"
                style={{
                  left: el.x * scale,
                  top: el.y * scale,
                  // Monospace advance is ~0.6em, so this makes one preview
                  // character occupy the same width the printer's cell will.
                  fontSize: (cell * scale) / 0.6,
                }}
              >
                {el.v}
              </span>
            );
          }
          const barWidth = estimateCode128Width(el.v, el.narrow);
          return (
            <div
              key={i}
              className="absolute"
              style={{ left: el.x * scale, top: el.y * scale }}
            >
              <div
                style={{
                  width: barWidth * scale,
                  height: el.h * scale,
                  background:
                    'repeating-linear-gradient(90deg,#000 0 1.5px,transparent 1.5px 3px,#000 3px 4.5px,transparent 4.5px 7px)',
                }}
              />
              {el.hri && (
                <div
                  className="text-center font-mono leading-none text-black"
                  style={{ width: barWidth * scale, fontSize: 11 * scale * 1.6 }}
                >
                  {el.v}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-center text-[11px] font-semibold text-muted-foreground">
        {label.copies > 1 ? `${label.copies} lembar` : '1 lembar'}
        {overflow && <span className="ml-1 text-rose-500">melebihi label</span>}
      </p>
    </div>
  );
}

export function LabelPreviewModal({
  items,
  onConfirm,
  onClose,
}: {
  items: OrderLabel[];
  onConfirm: () => void;
  onClose: () => void;
}) {
  // The stock this device is loaded with. Changing it re-flows the layout
  // below, which is the point: the size decides where everything lands, so it
  // belongs next to the preview rather than buried in another app's settings.
  const [size, setSize] = useState<LabelSize>(readLabelSize);

  const batch = useMemo(() => buildOrderLabelBatch(items, size), [items, size]);
  const total = useMemo(() => items.length, [items]);

  const widthDots = mmToDots(size.width);
  const heightDots = mmToDots(size.height);
  const anyOverflow = batch.labels.some((label) =>
    label.elements.some((el) =>
      el.t === 'barcode'
        ? el.x + estimateCode128Width(el.v, el.narrow) > widthDots - mmToDots(2)
        : el.x + el.v.length * FONT_CELL.char[el.font] > widthDots,
    ),
  );

  const chooseSize = (next: LabelSize) => {
    setSize(next);
    writeLabelSize(next);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-foreground" />
            <span className="text-base font-bold">Pratinjau Label</span>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-2 text-sm text-muted-foreground">
            {total} label dari {batch.labels.length} item
          </p>

          {/* Ukuran label — the layout is computed from this, so it lives here
              rather than in LabelBridge, whose size setting the job overrides. */}
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Ukuran label (mm)
          </p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {LABEL_PRESETS.map((preset) => {
              const active =
                preset.width === size.width && preset.height === size.height;
              return (
                <button
                  key={`${preset.width}x${preset.height}`}
                  onClick={() => chooseSize(preset)}
                  className={`rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${
                    active
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-gray-300 text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {preset.width}&times;{preset.height}
                </button>
              );
            })}
          </div>

          {anyOverflow && (
            <div className="mb-3 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                Ada isi yang melebihi lebar label — akan terpotong saat dicetak.
                Coba ukuran yang lebih besar atau perpendek nama produk.
              </span>
            </div>
          )}

          <div className="flex flex-col items-center gap-4">
            {batch.labels.map((label, i) => (
              <LabelCard
                key={i}
                label={label}
                widthDots={widthDots}
                heightDots={heightDots}
              />
            ))}
          </div>
        </div>

        <div className="flex gap-2 border-t px-5 py-4">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl bg-muted py-3 font-bold text-foreground transition-colors hover:bg-muted/70"
          >
            Batal
          </button>
          <button
            onClick={() => onConfirm()}
            className="flex-1 rounded-xl bg-foreground py-3 font-bold text-background transition-opacity hover:opacity-90"
          >
            Cetak {total} Label
          </button>
        </div>
      </div>
    </div>
  );
}
