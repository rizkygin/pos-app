/* Raw ESC/POS over WebUSB — desktop Chrome/Edge only.
 *
 * The browser print dialog can drive a USB thermal printer, but only by
 * rasterizing the page through the vendor driver: slow, and no auto-cut unless
 * the driver is configured for it. This path writes the ESC/POS bytes straight
 * to the printer's bulk OUT endpoint, exactly like the Android
 * ThermalBridge/RawBT route does — native font speed, real GS V cut.
 *
 * The trade-off, and the thing to tell users first: the OS driver and WebUSB
 * cannot both hold the interface. On Windows the printer must be bound to
 * WinUSB (Zadig) rather than the vendor's spooler driver; on Linux the
 * usblp kernel module claims printer-class devices and has to be unloaded or
 * shadowed by a udev rule. macOS generally lets the claim through. When the
 * claim fails we surface that as advice rather than a stack trace, because
 * "printer is busy" is nearly always this and not a real fault.
 *
 * Requires a secure context (https, or localhost in dev).
 */

// Minimal WebUSB surface. lib.dom ships no USB types and @types/w3c-web-usb
// isn't a dependency, so declare only what's used here.
type UsbEndpoint = { endpointNumber: number; direction: "in" | "out"; type: string };
type UsbAlternate = { alternateSetting: number; interfaceClass: number; endpoints: UsbEndpoint[] };
type UsbInterface = { interfaceNumber: number; claimed: boolean; alternates: UsbAlternate[] };
type UsbConfiguration = { configurationValue: number; interfaces: UsbInterface[] };
type UsbDevice = {
  vendorId: number;
  productId: number;
  productName?: string;
  opened: boolean;
  configuration: UsbConfiguration | null;
  configurations: UsbConfiguration[];
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  releaseInterface(n: number): Promise<void>;
  selectAlternateInterface(n: number, alt: number): Promise<void>;
  // Chrome 101+. Revokes this origin's permission for the device; without it a
  // "forgotten" printer keeps coming back from getDevices() and the picker
  // never reopens.
  forget?(): Promise<void>;
  transferOut(endpoint: number, data: Uint8Array): Promise<{ status: string; bytesWritten: number }>;
};
type Usb = {
  getDevices(): Promise<UsbDevice[]>;
  requestDevice(options: { filters: { vendorId?: number; productId?: number; classCode?: number }[] }): Promise<UsbDevice>;
};

const usb = (): Usb | null =>
  typeof navigator !== "undefined" && "usb" in navigator ? ((navigator as unknown as { usb: Usb }).usb) : null;

/** WebUSB present and usable (secure context). */
export const isWebUsbSupported = () =>
  !!usb() && typeof window !== "undefined" && window.isSecureContext;

// Remembered printer, so the picker only appears once per device. WebUSB
// permission itself is persisted by the browser per origin; this just records
// which of the granted devices is the printer.
const DEVICE_KEY = "pos_usb_printer";

function rememberDevice(d: UsbDevice) {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify({ vendorId: d.vendorId, productId: d.productId }));
  } catch {
    /* ignore */
  }
}

function recalledIds(): { vendorId: number; productId: number } | null {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return typeof v?.vendorId === "number" && typeof v?.productId === "number" ? v : null;
  } catch {
    return null;
  }
}

/** Forget the paired printer so the next print re-opens the browser picker.
    Revokes the WebUSB grant itself — clearing only DEVICE_KEY would leave the
    device in getDevices(), and the picker would never be shown again. */
export async function forgetUsbPrinter() {
  const device = await getPairedPrinter().catch(() => null);
  try {
    await device?.forget?.();
  } catch {
    /* older Chrome without forget(): the grant stays, nothing else to do */
  }
  try {
    localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * The previously paired printer, or null. Never prompts — pairing needs a user
 * gesture, so the picker is only opened from the print handler itself.
 */
export async function getPairedPrinter(): Promise<UsbDevice | null> {
  const u = usb();
  if (!u) return null;
  const devices = await u.getDevices();
  if (!devices.length) return null;
  const ids = recalledIds();
  const match = ids && devices.find((d) => d.vendorId === ids.vendorId && d.productId === ids.productId);
  // Without a remembered id, fall back only to a device that could actually be
  // a printer: the origin may hold grants for other hardware entirely.
  return match || devices.find((d) => !!findBulkOut(d)) || null;
}

/**
 * Open the browser's device picker. Printer-class devices only by default; many
 * cheap ESC/POS boards declare themselves vendor-specific instead, so
 * `allDevices` widens the filter to everything.
 *
 * Must be called from a user gesture, and only ONCE per gesture: requestDevice
 * consumes the transient activation, so a filtered-then-unfiltered retry inside
 * one click is rejected without a picker ever appearing. The wide picker needs
 * its own click.
 *
 * Returns null if the user closes the picker without choosing. Every other
 * failure throws with an operator-actionable Indonesian message — silently
 * returning null there is what makes a blocked permission look like nothing
 * happening at all.
 */
export async function pairUsbPrinter(allDevices = false): Promise<UsbDevice | null> {
  const u = usb();
  if (!u) throw new Error("WebUSB tidak didukung browser ini.");
  const startedAt = Date.now();
  try {
    // classCode 7 = printer. An empty filter list lists everything.
    const device = await u.requestDevice({ filters: allDevices ? [] : [{ classCode: 7 }] });
    rememberDevice(device);
    return device;
  } catch (e) {
    const err = e as { name?: string; message?: string };
    if (err.name === "SecurityError") {
      // Chrome's wording for "requestDevice outside a user gesture". Its own
      // activation was consumed by an earlier requestDevice in the same click.
      if (/user gesture|activation/i.test(err.message ?? "")) {
        throw new Error("Dialog printer harus dibuka dari klik langsung. Klik tombolnya sekali lagi.");
      }
      throw new Error(
        "Akses USB diblokir untuk situs ini (Permissions-Policy atau koneksi tidak aman). Buka lewat HTTPS dan izinkan perangkat USB di setelan situs.",
      );
    }
    if (err.name === "NotFoundError") {
      // A blocked site setting rejects with NotFoundError too — the same error a
      // cancelled picker throws, with no flag to tell them apart. Nobody opens,
      // reads and dismisses a chooser in a fifth of a second, so a rejection
      // this fast means no chooser was ever drawn: report the block.
      if (Date.now() - startedAt < 200) {
        throw new Error(
          "Izin perangkat USB ditolak otomatis — dialog pemilih printer tidak sempat muncul. Buka ikon gembok di address bar → Setelan situs → Perangkat USB, ubah dari \"Blokir\", lalu muat ulang halaman.",
        );
      }
      return null; // picker closed without a pick
    }
    throw new Error(err.message || "Gagal membuka pemilih printer USB.");
  }
}

/* The first bulk OUT endpoint on the device, with the interface/alternate it
   belongs to. Printer-class interfaces are preferred; vendor-specific ones are
   accepted as a fallback since many ESC/POS boards misdeclare themselves. */
function findBulkOut(device: UsbDevice) {
  const config = device.configuration ?? device.configurations[0];
  if (!config) return null;
  const candidates: { iface: number; alt: number; endpoint: number; printerClass: boolean }[] = [];
  for (const iface of config.interfaces) {
    for (const alt of iface.alternates) {
      for (const ep of alt.endpoints) {
        if (ep.direction === "out" && ep.type === "bulk") {
          candidates.push({
            iface: iface.interfaceNumber,
            alt: alt.alternateSetting,
            endpoint: ep.endpointNumber,
            printerClass: alt.interfaceClass === 7,
          });
        }
      }
    }
  }
  if (!candidates.length) return null;
  return { configValue: config.configurationValue, ...(candidates.find((c) => c.printerClass) || candidates[0]) };
}

// USB full-speed bulk transfers are 64 bytes a packet; a logo raster is tens of
// kilobytes. Chunking keeps any one transferOut short enough that a stalled
// printer surfaces as an error instead of a hung promise.
const CHUNK = 8 * 1024;

/**
 * Send raw ESC/POS bytes to a paired USB printer.
 *
 * Throws with a human-readable Indonesian message — the caller shows it as-is,
 * since every realistic failure here (no claim, no endpoint, unplugged) is
 * something the operator can act on.
 */
export async function printBytesOverUsb(device: UsbDevice, bytes: number[] | Uint8Array): Promise<void> {
  const target = findBulkOut(device);
  if (!target) throw new Error("Perangkat ini tidak punya endpoint printer (bulk OUT).");

  if (!device.opened) await device.open();
  try {
    if (!device.configuration) await device.selectConfiguration(target.configValue);
    try {
      await device.claimInterface(target.iface);
    } catch {
      // Almost always the OS driver holding the interface — see the file header.
      // keepPairing: the grant is fine, the interface is not — re-pairing would
      // only make the operator pick the same printer again to hit the same wall.
      throw Object.assign(
        new Error(
          "Printer sedang dipakai driver sistem. Lepaskan driver printer (Windows: Zadig/WinUSB, Linux: unload usblp) lalu coba lagi.",
        ),
        { keepPairing: true },
      );
    }
    if (target.alt !== 0) {
      try {
        await device.selectAlternateInterface(target.iface, target.alt);
      } catch {
        // Some firmware rejects this even when the alternate is the only one;
        // the endpoint still works, so keep going.
      }
    }

    const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes.map((b) => b & 0xff));
    for (let i = 0; i < data.length; i += CHUNK) {
      const res = await device.transferOut(target.endpoint, data.subarray(i, i + CHUNK));
      if (res.status !== "ok") throw new Error(`Pengiriman ke printer gagal (${res.status}).`);
    }

    try {
      await device.releaseInterface(target.iface);
    } catch {
      /* the print already went out; a failed release is not worth surfacing */
    }
  } finally {
    // Leave the device closed so the OS driver (or the next print) can claim it
    // cleanly. Reopening costs milliseconds.
    try {
      await device.close();
    } catch {
      /* ignore */
    }
  }
}
