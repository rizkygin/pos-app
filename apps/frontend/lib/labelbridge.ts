/**
 * Product labels for a thermal label printer, via the LabelBridge Android app.
 *
 * This is the label-printer counterpart to lib/escpos.ts. The two are separate
 * on purpose: a receipt printer takes a stream of ESC/POS text and cuts at the
 * end, while a label printer takes a page description — fixed size, gap between
 * labels, elements placed at coordinates — and TSPL/ZPL/CPCL are not ESC/POS.
 *
 * Who owns what: LabelBridge holds the media setup chosen once per device —
 * language, gap, media type, density, speed, direction, dpi — and a job that
 * omits a key inherits it. This module sends exactly one thing beyond the
 * layout, the label's width and height, because the coordinates below are
 * computed from them and both ends have to agree on the page they describe.
 *
 * Nothing else is sent, deliberately. A key present in the job overrides the
 * device setting, so sending gap "just in case" would silently defeat the gap
 * control in LabelBridge — and gap changes nothing about where an element
 * lands, so this module has no business having an opinion about it.
 *
 * Coordinates are dots: dots = mm x dpi / 25.4, so at 203 dpi 1 mm = 8 dots and
 * a 50x30 mm label is 400x240 dots.
 */

import { ascii } from './escpos';

/** Dots per inch of the printer. 203 on essentially every desktop label unit. */
const DPI = 203;

/** localStorage key holding this device's label stock, as "50x30" (mm). */
export const LABEL_SIZE_KEY = 'pos_label_size';

/**
 * The label stock's dimensions — and only those. Gap, language, density and
 * the rest of the media setup belong to LabelBridge: the job sends width and
 * height because the element coordinates below are computed from them, and
 * sending anything else would silently override a setting the user made there.
 */
export type LabelSize = { width: number; height: number };

/** 50x30 mm is the common product-tag stock; the rest of the layout adapts. */
export const DEFAULT_LABEL_SIZE: LabelSize = { width: 50, height: 30 };

/** The die-cut stocks shops actually buy, offered as one-tap presets. */
export const LABEL_PRESETS: LabelSize[] = [
  { width: 33, height: 15 },
  { width: 40, height: 30 },
  { width: 50, height: 30 },
  { width: 58, height: 40 },
];

/**
 * The label stock this device is loaded with. Stored as "WxH" so a shop with
 * 40x30 rolls can switch without a rebuild; anything unparseable falls back to
 * the default rather than printing off the edge of the label.
 */
export function readLabelSize(): LabelSize {
  if (typeof window === 'undefined') return DEFAULT_LABEL_SIZE;
  try {
    const raw = window.localStorage.getItem(LABEL_SIZE_KEY);
    if (!raw) return DEFAULT_LABEL_SIZE;
    const [w, h] = raw.split('x').map((n) => Number(n.trim()));
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 10 || h < 10) {
      return DEFAULT_LABEL_SIZE;
    }
    return { width: w, height: h };
  } catch {
    return DEFAULT_LABEL_SIZE;
  }
}

export function writeLabelSize(size: LabelSize) {
  try {
    window.localStorage.setItem(LABEL_SIZE_KEY, `${size.width}x${size.height}`);
  } catch {
    // Private browsing / storage disabled: the pick just doesn't persist.
  }
}

export const mmToDots = (mm: number) => Math.round((mm * DPI) / 25.4);

/** Character cell widths of LabelBridge's fonts '2', '3' and '4', in dots. */
const CHAR_W: Record<string, number> = { '1': 8, '2': 12, '3': 16, '4': 24, '5': 32 };
const LINE_H: Record<string, number> = { '1': 14, '2': 24, '3': 30, '4': 38, '5': 54 };

/**
 * Break a string into at most [maxLines] lines of [maxChars], on word
 * boundaries where possible. A word longer than the line is hard-split rather
 * than allowed to run off the label, and overflow ends in an ellipsis so the
 * cashier can see the name was cut rather than silently wrong.
 */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = ascii(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current && (current + ' ' + word).length <= maxChars) {
      current += ' ' + word;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    while (current.length > maxChars) {
      lines.push(current.slice(0, maxChars));
      current = current.slice(maxChars);
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  if (lines.length > maxLines) lines.length = maxLines;
  const last = lines.length - 1;
  if (last >= 0 && words.join(' ').length > lines.join(' ').length) {
    // ".." rather than a single dot, which reads as part of the name.
    lines[last] = lines[last].slice(0, Math.max(1, maxChars - 2)) + '..';
  }
  return lines;
}

/** One product's worth of label content. */
export type ProductLabel = {
  name: string;
  price: string;
  barcode?: string | null;
  /** Per-line kitchen note, printed small under the price when present. */
  note?: string | null;
  /** How many copies of this label to print — the cart line's quantity. */
  copies: number;
};

/**
 * The elements a product label is made of. Deliberately narrow: the on-screen
 * preview renders from this exact list, so what the cashier sees is what the
 * printer was told to do, not a second drawing that can drift from it.
 */
export type LabelElement =
  | { t: 'text'; x: number; y: number; font: string; v: string }
  | {
      t: 'barcode';
      x: number;
      y: number;
      v: string;
      bt: string;
      h: number;
      hri: boolean;
      narrow: number;
      wide: number;
    };

export type BuiltLabel = { copies: number; elements: LabelElement[] };

export type LabelBatchJob = {
  width: number;
  height: number;
  labels: BuiltLabel[];
};

/** Dots per character cell, exported so the preview can size text to match. */
export const FONT_CELL = { char: CHAR_W, line: LINE_H };

/**
 * How wide a Code 128 symbol will print, in dots.
 *
 * The symbol count is what matters, not the character count: Code C packs two
 * digits into one symbol, so an all-numeric barcode is close to half the width
 * of the same length in letters. Estimating one symbol per character instead
 * would flag a 13-digit EAN as overflowing 40x30 stock, which it does not.
 *
 * Width is 11 modules per symbol across start, data and checksum, plus a
 * 13-module stop pattern — hence (symbols + 3) * 11 + 2.
 */
export function estimateCode128Width(value: string, narrow: number) {
  const numeric = /^\d+$/.test(value);
  const symbols = numeric
    ? // Code C, two digits per symbol. An odd length leaves one digit that
      // needs a code-set switch plus its own symbol.
      Math.ceil(value.length / 2) + (value.length % 2 === 0 ? 0 : 1)
    : value.length;
  return (11 * (symbols + 3) + 2) * narrow;
}

/**
 * Lay out one product label.
 *
 * The name goes at the top at the largest size that still fits two lines, the
 * price under it, the note under that when there is one, and the barcode is
 * anchored to the bottom edge so labels stay visually consistent whether or
 * not a note pushed the middle down.
 */
function buildLabel(item: ProductLabel, size: LabelSize): BuiltLabel {
  const W = mmToDots(size.width);
  const H = mmToDots(size.height);
  const margin = mmToDots(2);
  const inner = W - margin * 2;

  const elements: LabelElement[] = [];
  let y = margin;

  // Name — font '3', wrapped to two lines.
  const nameFont = '3';
  const nameLines = wrap(item.name, Math.floor(inner / CHAR_W[nameFont]), 2);
  for (const line of nameLines) {
    elements.push({ t: 'text', x: margin, y, font: nameFont, v: line });
    y += LINE_H[nameFont];
  }

  y += 4;
  elements.push({ t: 'text', x: margin, y, font: '4', v: ascii(item.price) });
  y += LINE_H['4'];

  const note = ascii(item.note ?? '').trim();
  if (note) {
    for (const line of wrap(note, Math.floor(inner / CHAR_W['2']), 1)) {
      elements.push({ t: 'text', x: margin, y, font: '2', v: line });
      y += LINE_H['2'];
    }
  }

  // Barcode anchored to the bottom. Code 128 encodes any ASCII, but an empty
  // string is not a valid symbol — so a product with no barcode gets nothing
  // rather than a job the printer rejects.
  const code = ascii(item.barcode ?? '').trim();
  if (code) {
    const hriHeight = 28;
    const barHeight = Math.max(28, Math.min(70, H - y - margin - hriHeight));
    if (barHeight >= 28) {
      elements.push({
        t: 'barcode',
        x: margin,
        y: H - margin - barHeight - hriHeight,
        v: code,
        bt: '128',
        h: barHeight,
        hri: true,
        narrow: 2,
        wide: 2,
      });
    }
  }

  return { copies: Math.max(1, Math.min(99, item.copies)), elements };
}

/**
 * Build the whole cart as one batch job.
 *
 * One job, not one per line: LabelBridge renders the batch into a single
 * command stream, so the printer sees one connection and one paper path. Firing
 * a deep link per cart line would instead queue a popup per line and race.
 */
export function buildLabelBatch(
  items: ProductLabel[],
  size = readLabelSize(),
): LabelBatchJob {
  return {
    width: size.width,
    height: size.height,
    labels: items.map((item) => buildLabel(item, size)),
  };
}

/** Total labels a batch will produce — one per unit, across every line. */
export const labelCount = (items: ProductLabel[]) =>
  items.reduce((total, item) => total + Math.max(1, item.copies), 0);

const base64url = (json: string) =>
  btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Hand a batch to LabelBridge.
 *
 * Unlike receipts there is no second app to fall back to, so a missing
 * LabelBridge has to be reported rather than silently doing nothing: navigating
 * to a custom scheme nobody handles is a no-op in Android Chrome. Installed is
 * detected the same way lib/escpos.ts does it — the page losing focus before
 * the timer fires, since LabelBridge's popup blurs the page without hiding it.
 */
export function openLabelApp(job: unknown, onMissing?: () => void) {
  const encoded = base64url(JSON.stringify(job));

  const cancel = () => {
    window.clearTimeout(timer);
    window.removeEventListener('blur', cancel);
    document.removeEventListener('visibilitychange', onVisibility);
  };
  const onVisibility = () => {
    if (document.hidden) cancel();
  };
  const timer = window.setTimeout(() => {
    window.removeEventListener('blur', cancel);
    document.removeEventListener('visibilitychange', onVisibility);
    onMissing?.();
  }, 1500);
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', onVisibility);

  window.location.href = `labelbridge://print?back=1&job=${encoded}`;
}

export type OrderLabel = {
  orderId: string;
  customerName: string;
  productName: string;
  variant?: string | null;
  addons?: string[] | null;
  date: Date;
  outletName: string;
  logoUrl?: string | null;
};

function buildOrderLabel(item: OrderLabel, size: LabelSize): BuiltLabel {
  const W = mmToDots(size.width);
  const H = mmToDots(size.height);
  const margin = mmToDots(1.5);
  const inner = W - margin * 2;

  const elements: LabelElement[] = [];
  let y = margin;

  // Watermark: "ulunpesan - [order_id]" at top, font '2'
  const shortId = item.orderId.split('-')[0].toUpperCase();
  elements.push({
    t: 'text',
    x: margin,
    y,
    font: '2',
    v: ascii(`ulunpesan - ${shortId}`),
  });
  y += LINE_H['2'] + 3;

  // Customer name, font '3'
  if (item.customerName) {
    const custLines = wrap(item.customerName, Math.floor(inner / CHAR_W['3']), 1);
    for (const line of custLines) {
      elements.push({ t: 'text', x: margin, y, font: '3', v: line });
      y += LINE_H['3'];
    }
    y += 2;
  }

  // Product name, font '4' (largest, bold-ish via larger font)
  const prodLines = wrap(item.productName, Math.floor(inner / CHAR_W['4']), 2);
  for (const line of prodLines) {
    elements.push({ t: 'text', x: margin, y, font: '4', v: line });
    y += LINE_H['4'];
  }
  y += 2;

  // Variant, font '2'
  if (item.variant) {
    const varLines = wrap(item.variant, Math.floor(inner / CHAR_W['2']), 1);
    for (const line of varLines) {
      elements.push({ t: 'text', x: margin, y, font: '2', v: line });
      y += LINE_H['2'];
    }
    y += 2;
  }

  // Add-ons, font '2', comma-separated
  if (item.addons && item.addons.length > 0) {
    const addonText = item.addons.join(', ');
    const addonLines = wrap(addonText, Math.floor(inner / CHAR_W['2']), 2);
    for (const line of addonLines) {
      elements.push({ t: 'text', x: margin, y, font: '2', v: `+ ${line}` });
      y += LINE_H['2'];
    }
    y += 2;
  }

  // Bottom: date, time, outlet name - font '1'
  const dateStr = item.date.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
  });
  const timeStr = item.date.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
  y = H - margin - LINE_H['1'] * 2 - 4;
  elements.push({
    t: 'text',
    x: margin,
    y,
    font: '1',
    v: ascii(`${dateStr} ${timeStr}`),
  });
  y += LINE_H['1'] + 2;
  elements.push({
    t: 'text',
    x: margin,
    y,
    font: '1',
    v: ascii(item.outletName),
  });

  return { copies: 1, elements };
}

export function buildOrderLabelBatch(
  items: OrderLabel[],
  size = readLabelSize(),
): LabelBatchJob {
  return {
    width: size.width,
    height: size.height,
    labels: items.map((item) => buildOrderLabel(item, size)),
  };
}

export function openOrderLabelApp(job: unknown, onMissing?: () => void) {
  openLabelApp(job, onMissing);
}
