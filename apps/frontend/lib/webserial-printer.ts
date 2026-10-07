/* Raw ESC/POS over Web Serial — desktop Chrome/Edge 117+.
 *
 * This is ThermalBridge without the Android app. A classic Bluetooth thermal
 * printer speaks the Serial Port Profile (SPP) — the same RFCOMM channel
 * ThermalBridge opens — and once the printer is paired with the computer
 * (Windows: Settings → Bluetooth; macOS: System Settings → Bluetooth) Chrome
 * lists it in its serial-port picker. The same picker also lists a Windows
 * "Standard Serial over Bluetooth link" COM port and a printer on a USB-serial
 * cable; all of them take the same bytes, so this file doesn't tell them apart
 * beyond the label it shows.
 *
 * Writes are paced exactly like ThermalBridge's PrinterIO.writeBluetooth: the
 * link has no flow control a browser can see, so a fast write overruns the
 * printer's few-KB input buffer, drops the link mid-raster, and leaves the logo
 * on the paper with the rest of the receipt missing. See PrinterIO.kt for the
 * arithmetic behind 512 B / 40 ms.
 *
 * Requires a secure context (https, or localhost in dev). Pairing needs a user
 * gesture and only happens in Pengaturan → Printer; a print never opens the
 * picker, it uses the port the browser already granted.
 */

// Minimal Web Serial surface. lib.dom ships no Serial types and
// @types/w3c-web-serial isn't a dependency, so declare only what's used here.
type SerialPortInfo = {
  usbVendorId?: number;
  usbProductId?: number;
  bluetoothServiceClassId?: number | string;
};
type SerialPortLike = {
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): SerialPortInfo;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  // Chrome 103+. Revokes this origin's grant; without it a forgotten port keeps
  // coming back from getPorts().
  forget?(): Promise<void>;
};
type Serial = {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(options?: { filters?: SerialPortInfo[] }): Promise<SerialPortLike>;
};

const serial = (): Serial | null =>
  typeof navigator !== "undefined" && "serial" in navigator
    ? (navigator as unknown as { serial: Serial }).serial
    : null;

/** Web Serial present and usable (secure context). */
export const isWebSerialSupported = () =>
  !!serial() && typeof window !== "undefined" && window.isSecureContext;

// Which granted port is the printer. The grant itself is persisted by the
// browser per origin; this records the port's identity so a second granted
// port (a scanner, a scale) is never mistaken for it.
const PORT_KEY = "pos_serial_printer";
// Only a wired USB-serial printer reads this — an RFCOMM link ignores the baud
// rate entirely. 9600 is the factory default on nearly every ESC/POS board.
const BAUD_KEY = "pos_serial_baud";
export const BAUD_RATES = [9600, 19200, 38400, 57600, 115200] as const;
const DEFAULT_BAUD = 9600;

export function readSerialBaud(): number {
  try {
    const v = Number(localStorage.getItem(BAUD_KEY));
    return (BAUD_RATES as readonly number[]).includes(v) ? v : DEFAULT_BAUD;
  } catch {
    return DEFAULT_BAUD;
  }
}

export function writeSerialBaud(v: number) {
  try {
    localStorage.setItem(BAUD_KEY, String(v));
  } catch {
    /* ignore */
  }
}

const sameInfo = (a: SerialPortInfo, b: SerialPortInfo) =>
  String(a.usbVendorId) === String(b.usbVendorId) &&
  String(a.usbProductId) === String(b.usbProductId) &&
  String(a.bluetoothServiceClassId) === String(b.bluetoothServiceClassId);

function recalledInfo(): SerialPortInfo | null {
  try {
    const raw = localStorage.getItem(PORT_KEY);
    return raw ? (JSON.parse(raw) as SerialPortInfo) : null;
  } catch {
    return null;
  }
}

/** What to call a port in the UI. Web Serial exposes no device name. */
export function serialPortLabel(port: SerialPortLike): string {
  const info = port.getInfo();
  if (info.bluetoothServiceClassId !== undefined) return "Printer Bluetooth (SPP)";
  if (info.usbVendorId !== undefined) {
    const hex = (n?: number) => (n ?? 0).toString(16).padStart(4, "0").toUpperCase();
    return `Printer USB-serial (${hex(info.usbVendorId)}:${hex(info.usbProductId)})`;
  }
  // A COM port the OS made for a paired Bluetooth printer reports nothing.
  return "Port serial (COM / Bluetooth)";
}

/**
 * The printer this device was paired with, or null. Never prompts.
 */
export async function getSerialPrinter(): Promise<SerialPortLike | null> {
  const s = serial();
  if (!s) return null;
  const ports = await s.getPorts();
  if (!ports.length) return null;
  const info = recalledInfo();
  if (!info) return null; // granted by something else, never picked as the printer
  return ports.find((p) => sameInfo(p.getInfo(), info)) ?? (ports.length === 1 ? ports[0] : null);
}

/**
 * Open the browser's serial-port picker. Must run from a click, once per click.
 *
 * Every other port this origin was granted is forgotten first: a COM port
 * reports no identity, so two granted ones are indistinguishable at print time
 * and the wrong one (Windows makes an incoming AND an outgoing port per paired
 * printer) would print nothing.
 *
 * Returns null if the picker was closed without a pick; throws an
 * operator-readable Indonesian message otherwise.
 */
export async function pairSerialPrinter(): Promise<SerialPortLike | null> {
  const s = serial();
  if (!s) throw new Error("Browser ini tidak mendukung printer Bluetooth langsung. Pakai Chrome atau Edge di komputer.");
  const startedAt = Date.now();
  let port: SerialPortLike;
  try {
    // No filters: lists wired COM ports, ports the OS mapped for a paired
    // Bluetooth printer, and unmapped Bluetooth SPP services — all three print.
    port = await s.requestPort();
  } catch (e) {
    const err = e as { name?: string; message?: string };
    if (err.name === "NotFoundError") {
      // Same fast-rejection test as the USB picker: a blocked site setting
      // rejects before any chooser could have been read.
      if (Date.now() - startedAt < 200) {
        throw new Error(
          "Izin port serial ditolak otomatis. Buka ikon gembok di address bar → Setelan situs → Port serial, ubah dari \"Blokir\", lalu muat ulang halaman.",
        );
      }
      return null;
    }
    if (err.name === "SecurityError") {
      throw new Error("Akses port serial diblokir untuk situs ini. Buka lewat HTTPS dan izinkan port serial di setelan situs.");
    }
    throw new Error(err.message || "Gagal membuka pemilih printer.");
  }

  // Let go of the old printer's link before its grant is revoked.
  await releaseSerialPrinter();
  for (const other of await s.getPorts()) {
    if (other !== port) await other.forget?.().catch(() => {});
  }
  try {
    localStorage.setItem(PORT_KEY, JSON.stringify(port.getInfo()));
  } catch {
    /* ignore */
  }
  return port;
}

/** Forget the paired printer and revoke the browser grant. */
export async function forgetSerialPrinter() {
  await releaseSerialPrinter();
  const port = await getSerialPrinter().catch(() => null);
  try {
    await port?.forget?.();
  } catch {
    /* older Chrome without forget(): the grant stays, nothing else to do */
  }
  try {
    localStorage.removeItem(PORT_KEY);
  } catch {
    /* ignore */
  }
}

const CHUNK = 512;
const CHUNK_DELAY_MS = 40;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// How long the link stays up after the last print. Connecting an RFCOMM link
// takes a second or more; held briefly, a receipt and the kitchen ticket right
// behind it share one connect. Kept short on purpose: while this tab holds the
// printer, no phone (ThermalBridge) or other tab can connect to it.
const IDLE_CLOSE_MS = 2_000;
// ...but never shorter than the printer needs to take in the last job: closing
// discards whatever the link still holds, and a raster block prints slowly —
// PrinterIO's max(500, size/4) ms rule. A receipt with logo and QR is ~3 s.
const drainMs = (size: number) => Math.max(500, size / 4);

// One job at a time: the port can only be open once, and a receipt followed
// by a kitchen ticket is the normal case, not the edge case. Opening and
// closing go through here too, so nothing closes the port under a job.
let queue: Promise<unknown> = Promise.resolve();
// The port held open between jobs, or null.
let held: SerialPortLike | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

async function closeQuietly(port: SerialPortLike) {
  try {
    await port.close();
  } catch {
    /* already closed, or never opened */
  }
}

async function release() {
  clearTimeout(idleTimer);
  const port = held;
  held = null;
  if (port) await closeQuietly(port);
}

/** Close the link once it has been quiet long enough, given the last job's size. */
function holdOpen(lastJobBytes = 0) {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void enqueue(release), Math.max(IDLE_CLOSE_MS, drainMs(lastJobBytes)));
}

// Nearly always one of these three, and the browser can't say which: an RFCOMM
// connect that fails reports the same NetworkError for all of them.
const connectError = () =>
  new Error(
    "Tidak bisa terhubung ke printer. Pastikan printer menyala, sudah di-pair di Bluetooth komputer, dan tidak sedang tersambung ke HP atau tab lain.",
  );

/** Open the port unless this tab already holds it open. Returns whether it was reused. */
async function connect(port: SerialPortLike): Promise<boolean> {
  clearTimeout(idleTimer);
  if (held === port && port.writable) return true;
  await release();
  const open = () => port.open({ baudRate: readSerialBaud() });
  try {
    await open();
  } catch (e) {
    if ((e as { name?: string }).name !== "InvalidStateError") throw connectError();
    // Left open by a job that died mid-way; one retry from a clean state.
    await closeQuietly(port);
    await open().catch(() => {
      throw connectError();
    });
  }
  held = port;
  return false;
}

/** Throws with `sentAny` saying whether any of the job reached the link. */
async function writeAll(port: SerialPortLike, data: Uint8Array) {
  const writable = port.writable;
  if (!writable) {
    throw Object.assign(new Error("Printer tidak bisa ditulisi. Pilih ulang printer di Pengaturan → Printer."), {
      sentAny: false,
    });
  }
  const writer = writable.getWriter();
  let sent = 0;
  try {
    for (let i = 0; i < data.length; i += CHUNK) {
      await writer.write(data.subarray(i, i + CHUNK));
      sent += CHUNK;
      await sleep(CHUNK_DELAY_MS);
    }
  } catch (e) {
    const err = e as { name?: string };
    throw Object.assign(
      new Error(`Pengiriman ke printer terputus (${err.name || "Error"}). Dekatkan printer lalu coba lagi.`),
      { sentAny: sent > 0 },
    );
  } finally {
    writer.releaseLock();
  }
}

async function send(port: SerialPortLike, data: Uint8Array) {
  const reused = await connect(port);
  try {
    await writeAll(port, data);
  } catch (e) {
    // A held link the printer has dropped since (switched off, slept, carried
    // out of range) fails on its first write, before anything reached paper:
    // reconnect and send once more. A failure part-way through is reported
    // instead — resending would print the first half of the receipt twice.
    if (!reused || (e as { sentAny?: boolean }).sentAny) throw e;
    await release();
    await connect(port);
    await writeAll(port, data);
  }
}

/**
 * Send raw ESC/POS bytes to the paired printer.
 *
 * Resolves once every byte is handed to the link — that is when the receipt is
 * as good as printed. The link then stays open briefly for a job right behind
 * it (see IDLE_CLOSE_MS); after a failure it is closed, so the next job starts
 * clean.
 */
export function printBytesOverSerial(port: SerialPortLike, bytes: number[] | Uint8Array): Promise<void> {
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes.map((b) => b & 0xff));
  return enqueue(async () => {
    try {
      await send(port, data);
      holdOpen(data.length);
    } catch (e) {
      await release();
      throw e;
    }
  });
}

/**
 * Connect ahead of the click — called when a receipt appears, so the link is
 * usually up by the time Cetak is pressed. Never throws: a printer that is off
 * is reported by the print itself.
 */
export function warmSerialPrinter(port: SerialPortLike): Promise<void> {
  return enqueue(async () => {
    try {
      await connect(port);
      holdOpen();
    } catch {
      await release();
    }
  });
}

/** Close a held link now (re-pairing, forgetting). */
export const releaseSerialPrinter = () => enqueue(release);
