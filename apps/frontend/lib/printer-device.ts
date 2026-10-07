/**
 * Where this device sends a thermal print.
 *
 * Picked once in Pengaturan → Printer and kept in this browser's localStorage —
 * it describes the hardware next to this screen, so it is per device, never per
 * outlet, and never touches the server. Every slip (customer receipt, kitchen
 * ticket, shift report, thermal invoice) asks resolvePrintRoute() at click time
 * instead of sniffing the platform itself.
 *
 * "Otomatis" is what every device did before this setting existed and stays
 * the default: Android hands the bytes to ThermalBridge/RawBT, anything else
 * opens the browser print dialog. The direct modes are what a Windows or Mac
 * counter picks to behave like a desktop cashier app — the slip goes straight
 * to the printer, no dialog, no popup.
 */

import { useSyncExternalStore } from "react";
import { isAndroid } from "./escpos";
import { forgetUsbPrinter, getPairedPrinter, isWebUsbSupported, printBytesOverUsb } from "./webusb-printer";
import { getSerialPrinter, isWebSerialSupported, printBytesOverSerial, warmSerialPrinter } from "./webserial-printer";

/** What the owner picked. */
export type PrinterMode = "auto" | "bluetooth" | "usb" | "dialog";

/** What a print actually does right now, after the browser has had its say. */
export type PrintRoute = "android" | "bluetooth" | "usb" | "dialog";

const MODE_KEY = "pos_printer_mode";
const MODES: PrinterMode[] = ["auto", "bluetooth", "usb", "dialog"];
// Same-tab listeners; the storage event only reaches OTHER tabs.
const CHANGE_EVENT = "pos-printer-change";

export function readPrinterMode(): PrinterMode {
  if (typeof window === "undefined") return "auto";
  try {
    const v = window.localStorage.getItem(MODE_KEY) as PrinterMode | null;
    return v && MODES.includes(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

export function writePrinterMode(mode: PrinterMode) {
  try {
    if (mode === "auto") window.localStorage.removeItem(MODE_KEY);
    else window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Private browsing / storage disabled: the pick just doesn't persist.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * The route for the next print. A direct mode the browser can't do (the
 * setting survives a switch to a browser without Web Serial) falls back to
 * Otomatis rather than to nothing.
 */
export function resolvePrintRoute(): PrintRoute {
  const mode = readPrinterMode();
  if (mode === "bluetooth" && isWebSerialSupported()) return "bluetooth";
  if (mode === "usb" && isWebUsbSupported()) return "usb";
  if (mode === "dialog") return "dialog";
  return isAndroid() ? "android" : "dialog";
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The mode, live — for the settings screen. "auto" on the server render. */
export function usePrinterMode(): PrinterMode {
  return useSyncExternalStore(subscribe, readPrinterMode, () => "auto");
}

/** The route, live — for a print menu that labels its buttons by it. */
export function usePrintRoute(): PrintRoute {
  return useSyncExternalStore(subscribe, resolvePrintRoute, () => "dialog");
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Send raw ESC/POS to the printer paired in Pengaturan → Printer.
 *
 * Throws an Indonesian, operator-actionable message — callers show it as-is.
 * Not paired is an error, not a picker: a print never opens a device chooser,
 * that only happens in Pengaturan.
 */
export async function printDirect(route: "bluetooth" | "usb", bytes: number[] | Uint8Array): Promise<void> {
  if (route === "bluetooth") {
    const port = await getSerialPrinter().catch(() => null);
    if (!port) throw new Error("Printer Bluetooth belum dipilih di perangkat ini. Buka Pengaturan → Printer → Pilih printer.");
    await printBytesOverSerial(port, bytes);
    return;
  }
  const device = await getPairedPrinter().catch(() => null);
  if (!device) throw new Error("Printer USB belum dipilih di perangkat ini. Buka Pengaturan → Printer → Pilih printer.");
  try {
    await printBytesOverUsb(device, bytes);
  } catch (e) {
    // Only a dead handle drops the pairing — see printBytesOverUsb.
    if ((e as { deviceGone?: boolean })?.deviceGone) await forgetUsbPrinter();
    throw e;
  }
}

/**
 * Start connecting before the click — a no-op unless this device prints over
 * Bluetooth, where the connect is the slow part of a print. Safe to call every
 * time a slip appears; a link already up is left as it is.
 */
export function warmDirectPrinter() {
  if (resolvePrintRoute() !== "bluetooth") return;
  getSerialPrinter()
    .then((port) => port && warmSerialPrinter(port))
    .catch(() => {});
}

/** The message to show for a failed direct print. */
export const printErrorMessage = (e: unknown) =>
  e instanceof Error && e.message ? e.message : "Gagal mencetak ke printer.";
