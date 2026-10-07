"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AlertTriangle, Bluetooth, Loader2, Monitor, Printer, Sparkles, Usb } from "lucide-react";
import {
    AUTO_PRINT_SCRIPT,
    escapeHtml,
    escposBuilder,
    isAndroid,
    openAndroidPrintApp,
    printHtmlWindow,
    readPaperWidth,
    thermalPageCss,
    writePaperWidth,
    type PaperWidth,
} from "@/lib/escpos";
import {
    base64ToBytes,
    printDirect,
    printErrorMessage,
    resolvePrintRoute,
    usePrinterMode,
    writePrinterMode,
    type PrinterMode,
    type PrintRoute,
} from "@/lib/printer-device";
import {
    BAUD_RATES,
    forgetSerialPrinter,
    getSerialPrinter,
    isWebSerialSupported,
    pairSerialPrinter,
    readSerialBaud,
    serialPortLabel,
    writeSerialBaud,
} from "@/lib/webserial-printer";
import { forgetUsbPrinter, getPairedPrinter, isWebUsbSupported, pairUsbPrinter } from "@/lib/webusb-printer";
import { cn } from "@/lib/utils";

/*
 * Pengaturan → Printer. Everything here is THIS device's, kept in this
 * browser's localStorage (see lib/printer-device.ts) — it acts on the spot,
 * like Notifikasi, and the page's Simpan button never sees it.
 */

// Browser capabilities never change under a running page.
const noSubscribe = () => () => {};
const useClientFlag = (read: () => boolean) => useSyncExternalStore(noSubscribe, read, () => false);

const ROUTE_LABEL: Record<PrintRoute, string> = {
    android: "ThermalBridge",
    bluetooth: "Bluetooth",
    usb: "USB",
    dialog: "Dialog cetak",
};

/** Short tag for the section nav. */
export const PRINTER_MODE_TAG: Record<PrinterMode, string> = {
    auto: "otomatis",
    bluetooth: "Bluetooth",
    usb: "USB",
    dialog: "dialog",
};

// A slip that shows what the printer is doing: the paper and route it was
// sent with, and a digit row exactly one line wide — if it wraps or falls
// short, the paper width is wrong.
function testEscposBase64(paper: PaperWidth, route: PrintRoute, outletName: string) {
    const p = escposBuilder(paper);
    p.init();
    p.align(1);
    p.bold(true);
    p.size(0x11);
    p.line("TES PRINTER");
    p.size(0x00);
    p.bold(false);
    if (outletName) p.line(outletName);
    p.line(new Date().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }));
    p.align(0);
    p.divider();
    p.row("Kertas", `${paper}mm`);
    p.row("Cara cetak", ROUTE_LABEL[route]);
    p.divider();
    p.line(Array.from({ length: p.width }, (_, i) => String((i + 1) % 10)).join(""));
    p.line("Angka di atas harus 1 baris.");
    p.divider();
    p.align(1);
    p.line("Printer siap dipakai.");
    p.line("ulunpesan.com");
    p.finish();
    return p.toBase64();
}

function testHtml(paper: PaperWidth, outletName: string) {
    const when = new Date().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Tes Printer</title>
<style>${thermalPageCss(paper)}</style></head><body>
  <div class="c b lg">TES PRINTER</div>
  ${outletName ? `<div class="c">${escapeHtml(outletName)}</div>` : ""}
  <div class="c sm">${escapeHtml(when)}</div>
  <div class="dv"></div>
  <div class="row"><span>Kertas</span><span>${paper}mm</span></div>
  <div class="row"><span>Cara cetak</span><span>Dialog cetak</span></div>
  <div class="dv"></div>
  <div class="c sm">Printer siap dipakai.</div>
  <div class="c sm">ulunpesan.com</div>
  ${AUTO_PRINT_SCRIPT}
</body></html>`;
}

export function PrinterSettings({ outletName }: { outletName: string }) {
    const mode = usePrinterMode();
    const canSerial = useClientFlag(isWebSerialSupported);
    const canUsb = useClientFlag(isWebUsbSupported);
    const onAndroid = useClientFlag(isAndroid);

    const [paper, setPaper] = useState<PaperWidth>(() => readPaperWidth());
    const [baud, setBaud] = useState<number>(() => readSerialBaud());
    // Name of the printer this device is paired with for the current mode;
    // undefined while the browser is still being asked.
    const [paired, setPaired] = useState<string | null | undefined>(undefined);
    const [busy, setBusy] = useState<"pair" | "test" | null>(null);
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
    // After the printer-class USB picker closes empty: offer the wide one,
    // which needs a click of its own (see pairUsbPrinter).
    const [offerAllUsb, setOfferAllUsb] = useState(false);

    useEffect(() => {
        let live = true;
        const lookup: Promise<string | null> =
            mode === "bluetooth" && canSerial
                ? getSerialPrinter().then((p) => (p ? serialPortLabel(p) : null))
                : mode === "usb" && canUsb
                    ? getPairedPrinter().then((d) => (d ? d.productName || "Printer USB" : null))
                    : Promise.resolve(null);
        lookup
            .catch(() => null)
            .then((label) => {
                if (live) setPaired(label);
            });
        return () => {
            live = false;
        };
    }, [mode, canSerial, canUsb]);

    const pickMode = (m: PrinterMode) => {
        if (m === mode) return;
        setMessage(null);
        setOfferAllUsb(false);
        setPaired(undefined);
        writePrinterMode(m);
    };

    const pickPaper = (w: PaperWidth) => {
        setPaper(w);
        writePaperWidth(w);
    };

    // Straight from the click: the picker needs the click's user activation,
    // and nothing awaited before it may spend it.
    async function pair(allUsb = false) {
        setMessage(null);
        setBusy("pair");
        try {
            if (mode === "bluetooth") {
                const port = await pairSerialPrinter();
                if (port) {
                    setPaired(serialPortLabel(port));
                    setMessage({ ok: true, text: "Printer tersimpan di perangkat ini. Coba Cetak tes." });
                }
            } else {
                const device = await pairUsbPrinter(allUsb);
                if (device) {
                    setPaired(device.productName || "Printer USB");
                    setOfferAllUsb(false);
                    setMessage({ ok: true, text: "Printer tersimpan di perangkat ini. Coba Cetak tes." });
                } else {
                    setOfferAllUsb(!allUsb);
                }
            }
        } catch (e) {
            setMessage({ ok: false, text: printErrorMessage(e) });
        } finally {
            setBusy(null);
        }
    }

    async function forget() {
        setMessage(null);
        if (mode === "bluetooth") await forgetSerialPrinter();
        else await forgetUsbPrinter();
        setPaired(null);
    }

    async function testPrint() {
        setMessage(null);
        const route = resolvePrintRoute();
        if (route === "dialog") {
            if (!printHtmlWindow(testHtml(paper, outletName))) {
                setMessage({ ok: false, text: "Popup diblokir. Izinkan popup untuk situs ini agar bisa mencetak." });
            }
            return;
        }
        const b64 = testEscposBase64(paper, route, outletName);
        if (route === "android") {
            openAndroidPrintApp(b64);
            return;
        }
        setBusy("test");
        try {
            await printDirect(route, base64ToBytes(b64));
            setMessage({ ok: true, text: "Terkirim ke printer." });
        } catch (e) {
            setMessage({ ok: false, text: printErrorMessage(e) });
        } finally {
            setBusy(null);
        }
    }

    const options: {
        mode: PrinterMode;
        icon: React.ReactNode;
        title: string;
        desc: string;
        unavailable?: string;
    }[] = [
        {
            mode: "auto",
            icon: <Sparkles className="h-4 w-4" />,
            title: "Otomatis",
            desc: onAndroid
                ? "HP/tablet Android ini mengirim struk ke aplikasi ThermalBridge (atau RawBT)."
                : "Membuka dialog cetak browser. Di HP Android, struk dikirim ke ThermalBridge.",
        },
        {
            mode: "bluetooth",
            icon: <Bluetooth className="h-4 w-4" />,
            title: "Bluetooth langsung",
            desc: "Printer thermal Bluetooth yang sudah di-pair ke Windows atau Mac. Struk langsung keluar tanpa dialog, seperti aplikasi kasir.",
            unavailable: canSerial ? undefined : "Butuh Chrome atau Edge terbaru di komputer, dibuka lewat https.",
        },
        {
            mode: "usb",
            icon: <Usb className="h-4 w-4" />,
            title: "USB langsung",
            desc: "Printer thermal dengan kabel USB. Struk langsung keluar tanpa dialog.",
            unavailable: canUsb ? undefined : "Butuh Chrome atau Edge di komputer, dibuka lewat https.",
        },
        {
            mode: "dialog",
            icon: <Monitor className="h-4 w-4" />,
            title: "Dialog cetak browser",
            desc: "Pakai printer yang terpasang di sistem (dengan driver). Ukuran kertas dipilih di dialog.",
        },
    ];

    const direct = (mode === "bluetooth" && canSerial) || (mode === "usb" && canUsb);

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
                <p className="text-xs font-bold text-muted-foreground">Cara cetak di perangkat ini</p>
                {options.map((opt) => {
                    const selected = mode === opt.mode;
                    const disabled = !!opt.unavailable && !selected;
                    return (
                        <button
                            key={opt.mode}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={disabled}
                            onClick={() => pickMode(opt.mode)}
                            className={cn(
                                "flex w-full items-start gap-3 rounded-xl border-[1.5px] px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55",
                                selected
                                    ? "border-rose-600 bg-rose-50/60 dark:bg-rose-500/10"
                                    : "border-border hover:border-muted-foreground/40",
                            )}
                        >
                            <span
                                className={cn(
                                    "mt-0.5 h-3.75 w-3.75 shrink-0 rounded-full bg-card",
                                    selected ? "border-[4.5px] border-rose-600" : "border-2 border-muted-foreground/40",
                                )}
                            />
                            <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1.5 text-[13px] font-bold">
                                    <span className="text-muted-foreground">{opt.icon}</span>
                                    {opt.title}
                                </span>
                                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{opt.desc}</span>
                                {opt.unavailable && (
                                    <span className="mt-1 block text-[11.5px] font-semibold text-amber-700 dark:text-amber-400">
                                        {opt.unavailable}
                                    </span>
                                )}
                            </span>
                        </button>
                    );
                })}
            </div>

            {direct && (
                <div className="flex flex-col gap-3.5 rounded-xl border border-border/60 bg-muted/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-45 flex-1">
                            <p className={cn("text-[13.5px] font-bold", paired && "text-emerald-700 dark:text-emerald-400")}>
                                {paired === undefined ? "Memeriksa printer…" : paired ?? "Belum ada printer dipilih"}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                {paired
                                    ? "Semua struk dari perangkat ini langsung ke printer ini."
                                    : "Pilih sekali — setelah itu tidak ditanya lagi di setiap struk."}
                            </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            {paired && (
                                <button
                                    type="button"
                                    onClick={() => void forget()}
                                    disabled={busy !== null}
                                    className="rounded-[10px] px-3 py-2 text-[12.5px] font-bold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
                                >
                                    Lupakan
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => void pair()}
                                disabled={busy !== null}
                                className={cn(
                                    "flex items-center gap-1.5 rounded-[10px] px-4 py-2 text-[12.5px] font-bold transition-colors disabled:opacity-60",
                                    paired
                                        ? "border border-border bg-card hover:bg-muted"
                                        : "bg-rose-600 text-white hover:bg-rose-700",
                                )}
                            >
                                {busy === "pair" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                {paired ? "Ganti printer" : "Pilih printer"}
                            </button>
                        </div>
                    </div>

                    {mode === "usb" && offerAllUsb && (
                        <button
                            type="button"
                            onClick={() => void pair(true)}
                            disabled={busy !== null}
                            className="self-start text-[12.5px] font-bold text-rose-600 hover:text-rose-700 dark:text-rose-400"
                        >
                            Printer tidak muncul? Tampilkan semua perangkat USB →
                        </button>
                    )}

                    {mode === "bluetooth" ? (
                        <ol className="flex list-decimal flex-col gap-1 pl-4 text-xs leading-relaxed text-muted-foreground">
                            <li>
                                Nyalakan printer, lalu pair di Bluetooth komputer — Windows: Pengaturan › Bluetooth &amp;
                                perangkat › Tambah perangkat. Mac: Pengaturan Sistem › Bluetooth. PIN biasanya 0000 atau 1234.
                            </li>
                            <li>
                                Klik Pilih printer, lalu pilih printernya. Di Windows bisa tampil sebagai port COM
                                (“Standard Serial over Bluetooth link”). Kalau ada dua, pilih salah satu lalu Cetak tes —
                                kalau tidak keluar, Ganti printer ke yang satunya.
                            </li>
                            <li>Klik Cetak tes di bawah.</li>
                        </ol>
                    ) : (
                        <ul className="flex list-disc flex-col gap-1 pl-4 text-xs leading-relaxed text-muted-foreground">
                            <li>Colokkan printer, lalu klik Pilih printer.</li>
                            <li>
                                Kalau gagal tersambung: Mac — hapus printer ini dari daftar printer sistem. Windows — printer
                                perlu driver WinUSB (pakai Zadig).
                            </li>
                        </ul>
                    )}

                    {mode === "bluetooth" && (
                        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                            Printer Bluetooth hanya bisa tersambung ke satu perangkat. Kalau HP kasir (ThermalBridge) sedang
                            tersambung, printer tidak bisa dipakai dari komputer ini.
                        </p>
                    )}

                    {mode === "bluetooth" && (
                        <label className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
                            <span className="min-w-45 flex-1 text-xs text-muted-foreground">
                                <span className="font-bold">Baud rate</span> — hanya untuk printer kabel serial. Bluetooth
                                tidak terpengaruh.
                            </span>
                            <select
                                value={baud}
                                onChange={(e) => {
                                    const v = Number(e.target.value);
                                    setBaud(v);
                                    writeSerialBaud(v);
                                }}
                                className="h-8 rounded-lg border border-input bg-card px-2 text-xs font-bold"
                            >
                                {BAUD_RATES.map((b) => (
                                    <option key={b} value={b}>
                                        {b}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-45 flex-1">
                    <p className="text-[13px] font-bold">Lebar kertas</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Dipakai struk, tiket dapur, laporan shift, dan faktur thermal.</p>
                </div>
                <div className="flex overflow-hidden rounded-lg border border-border">
                    {(["58", "80"] as const).map((w) => (
                        <button
                            key={w}
                            type="button"
                            onClick={() => pickPaper(w)}
                            className={cn(
                                "px-3 py-1.5 text-xs font-bold transition-colors",
                                paper === w ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
                            )}
                        >
                            {w}mm
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex flex-col gap-1.5">
                <button
                    type="button"
                    onClick={() => void testPrint()}
                    disabled={busy !== null || (direct && !paired)}
                    className="flex items-center gap-1.5 self-start rounded-[10px] border border-border bg-card px-4 py-2 text-[12.5px] font-bold transition-colors hover:bg-muted disabled:opacity-60"
                >
                    {busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
                    Cetak tes
                </button>
                {message && (
                    <p className={cn("text-xs font-medium", message.ok ? "text-emerald-600" : "text-rose-500")}>
                        {message.text}
                    </p>
                )}
            </div>
        </div>
    );
}
