/**
 * ESC/POS text-building primitives for thermal slips.
 *
 * Every slip this app prints is the same shape underneath — initialise, emit
 * lines of ASCII with alignment/bold/size escapes, feed, cut — and the fiddly
 * parts are identical each time: the printer takes bytes, not UTF-8 strings, so
 * "Rp 1.550.000" with a non-breaking space or a curly quote in it has to be
 * flattened before btoa() will even accept it, and a label/value row has to be
 * padded by hand because the printer has no notion of a right margin.
 *
 * Character width is the one thing that differs: Font A fits 32 characters on
 * 58mm paper and 48 on 80mm, which is why the caller picks a paper width and
 * everything else follows from it.
 *
 * NOTE: components/dashboard/receipt-modal.tsx predates this module and still
 * carries its own copies of these primitives (the customer receipt and the
 * kitchen ticket). They are verified on real hardware; this exists so new
 * slips don't add a third copy, not as a reason to go rewrite those two.
 */

/** Which thermal paper the printer takes; picked once per device. */
export type PaperWidth = '58' | '80';

/** localStorage key holding this device's paper width. */
export const PAPER_KEY = 'pos_paper_width';

/** Font A characters per line: 32 on 58mm paper, 48 on 80mm. */
export const LINE_CHARS: Record<PaperWidth, number> = { '58': 32, '80': 48 };

export function readPaperWidth(): PaperWidth {
  if (typeof window === 'undefined') return '80';
  try {
    return window.localStorage.getItem(PAPER_KEY) === '58' ? '58' : '80';
  } catch {
    return '80';
  }
}

export function writePaperWidth(w: PaperWidth) {
  try {
    window.localStorage.setItem(PAPER_KEY, w);
  } catch {
    // Private browsing / storage disabled: the pick just doesn't persist.
  }
}

/**
 * Flatten a string to printable 7-bit ASCII.
 *
 * The printer's code page is not UTF-8 and btoa() throws on any code point
 * above 0xFF, so this is a hard requirement, not a nicety. Non-breaking spaces
 * (Intl's currency formatter emits them) become real spaces, accents are
 * stripped via NFKD rather than dropped, and anything still outside the
 * printable range becomes '?' so a stray character can never abort a print.
 */
export const ascii = (s: string) =>
  String(s ?? '')
    .replace(/ /g, ' ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');

/**
 * A byte buffer with the ESC/POS verbs written on it.
 *
 * `row` is the one that carries the layout: label on the left, value hard
 * against the right margin, padded with spaces to the line width. That is how
 * every figure on a receipt lines up, and there is no printer-side equivalent.
 */
export function escposBuilder(paper: PaperWidth) {
  const LINE = LINE_CHARS[paper];
  const ESC = 0x1b;
  const GS = 0x1d;
  const bytes: number[] = [];

  const push = (...b: number[]) => bytes.push(...b);
  const text = (s: string) => {
    for (const ch of ascii(s)) push(ch.charCodeAt(0));
  };
  const line = (s = '') => {
    text(s);
    push(0x0a);
  };

  return {
    width: LINE,
    push,
    line,
    /** 0 left, 1 center, 2 right */
    align: (n: 0 | 1 | 2) => push(ESC, 0x61, n),
    bold: (on: boolean) => push(ESC, 0x45, on ? 1 : 0),
    /** 0x00 normal, 0x01 double height, 0x11 double both, 0x22 quadruple */
    size: (n: number) => push(GS, 0x21, n),
    divider: (ch = '-') => line(ch.repeat(LINE)),
    /** Label left, value right-justified on the same line. */
    row: (left: string, right: string) => {
      const l = ascii(left);
      const r = ascii(right);
      const gap = Math.max(1, LINE - l.length - r.length);
      line(l + ' '.repeat(gap) + r);
    },
    /** Centre a string in the line width using spaces, for double-width text. */
    init: () => push(ESC, 0x40),
    /** Feed clear of the tear bar, then full cut. */
    finish: () => {
      push(0x0a, 0x0a, 0x0a);
      push(GS, 0x56, 0x00);
    },
    /** base64 of the assembled bytes, ready for a print bridge. */
    toBase64: () => {
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b & 0xff);
      return btoa(bin);
    },
  };
}

/**
 * Hand raw ESC/POS bytes to whichever Android print bridge is installed:
 * ThermalBridge first (back=1 returns to the browser after printing), RawBT as
 * the fallback.
 *
 * Navigating to a custom scheme nobody handles is a silent no-op in Android
 * Chrome, so "installed" is detected by the page losing focus before the timer
 * fires: ThermalBridge's print popup only blurs the page (it stays visible
 * underneath), while a full app switch also hides it — watch for either.
 */
export function openAndroidPrintApp(base64: string) {
  const b64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const thermalBridgeUrl = `thermalbridge://print?back=1&data=${b64url}`;
  const rawbtUrl = `rawbt:base64,${base64}`;

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
    window.location.href = rawbtUrl;
  }, 1500);
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', onVisibility);
  window.location.href = thermalBridgeUrl;
}

export const isAndroid = () =>
  typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);

/**
 * Open a print window for the desktop/iOS fallback, auto-printing then closing.
 * Returns false when the popup was blocked, so the caller can say so.
 */
export function printHtmlWindow(html: string): boolean {
  const w = window.open('', '_blank', 'width=360,height=640');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}

/** Auto-print script + page CSS shared by the HTML fallbacks. */
export function thermalPageCss(paper: PaperWidth) {
  const mm = `${paper}mm`;
  return `
  @page { size: ${mm} auto; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${mm}; }
  body { font-family: 'Courier New', monospace; font-size: 11px; line-height: 1.35; color: #000; padding: 3mm 2mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .c { text-align: center; }
  .b { font-weight: bold; }
  .lg { font-size: 14px; }
  .sm { font-size: 10px; }
  .dv { border-top: 1px dashed #000; margin: 5px 0; }
  .eq { border-top: 2px solid #000; margin: 5px 0; }
  .row { display: flex; justify-content: space-between; gap: 6px; }
  .row span:last-child { text-align: right; white-space: nowrap; }
`;
}

export const AUTO_PRINT_SCRIPT =
  `<script>window.onload=function(){window.focus();window.print();window.onafterprint=function(){window.close();};setTimeout(function(){try{window.close();}catch(e){}},2000);};</script>`;

/** HTML-escape for the fallback markup. */
export const escapeHtml = (s: string) =>
  String(s ?? '').replace(
    /[&<>]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string,
  );
