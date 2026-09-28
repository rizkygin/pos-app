"use client";

import { useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import QRCode from "react-qr-code";
import { AlertTriangle, Armchair, ExternalLink, Printer, Store } from "lucide-react";

const noSubscribe = () => () => {};

export type SelfOrderSettingsValue = {
    enabled: boolean;
    radiusM: number;
};

export type SelfOrderSettingsMeta = {
    outletId: number;
    radiusMin: number;
    radiusMax: number;
    hasLocation: boolean;
    planAllowed: boolean;
    canUseTables: boolean;
    tables: { id: number; label: string; zone: string }[];
};

/**
 * Pesan Mandiri, the owner's side: how far from the outlet's pin a phone may
 * order from, and the QR codes to stick up — one for the counter, one per
 * table when the outlet runs Manajemen Meja. A table's code carries its id
 * (?meja=), so what is ordered from it lands on that table's bill.
 *
 * The on/off switch lives in the section header and saves with the page's
 * Simpan button, like every other section.
 */
export function SelfOrderSettings({
    value,
    onChange,
    meta,
    outletName,
}: {
    value: SelfOrderSettingsValue;
    onChange: (v: SelfOrderSettingsValue) => void;
    meta: SelfOrderSettingsMeta;
    outletName: string;
}) {
    // Empty on the server render; the codes wait for the browser's own origin.
    const origin = useSyncExternalStore(
        noSubscribe,
        () => window.location.origin,
        () => "",
    );
    const sheetRef = useRef<HTMLDivElement>(null);

    const counterUrl = `${origin}/menu/${meta.outletId}`;
    const tableUrl = (id: number) => `${counterUrl}?meja=${id}`;
    const tables = meta.canUseTables ? meta.tables : [];

    /**
     * A printable sheet of every code, in a window of its own: the dashboard
     * around this section would otherwise print too. The codes are the SVGs
     * already on screen, so what prints is exactly what was checked here.
     */
    const print = () => {
        const cards = sheetRef.current?.querySelectorAll<HTMLElement>("[data-qr-card]");
        if (!cards?.length) return;
        const w = window.open("", "_blank", "width=820,height=1000");
        if (!w) return;
        const esc = (s: string) =>
            s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
        const body = [...cards]
            .map((c) => {
                const svg = c.querySelector("svg")?.outerHTML ?? "";
                return `<div class="card"><div class="qr">${svg}</div><div class="title">${esc(
                    c.dataset.title ?? "",
                )}</div><div class="sub">Scan untuk pesan dari HP · bayar di kasir</div><div class="brand">${esc(
                    outletName,
                )}</div></div>`;
            })
            .join("");
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR Pesan Mandiri — ${esc(
            outletName,
        )}</title><style>
            *{box-sizing:border-box} body{margin:0;padding:12mm;font-family:system-ui,sans-serif;color:#111}
            .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8mm}
            .card{border:1.5px dashed #999;border-radius:6mm;padding:7mm;text-align:center;break-inside:avoid}
            .qr svg{width:52mm;height:52mm}
            .title{margin-top:4mm;font-size:22pt;font-weight:900}
            .sub{margin-top:1.5mm;font-size:10pt;color:#555}
            .brand{margin-top:2mm;font-size:9pt;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#888}
        </style></head><body><div class="grid">${body}</div><script>window.onload=()=>{window.print()}</script></body></html>`);
        w.document.close();
    };

    return (
        <div className="flex flex-col gap-4">
            {!meta.planAllowed && (
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-300/60 bg-amber-50 px-3.5 py-3 text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                        Pesan Mandiri tersedia mulai paket <b>Max Lite</b>.{" "}
                        <Link href="/dashboard/subscription" className="font-bold underline">
                            Lihat paket
                        </Link>
                    </p>
                </div>
            )}
            {meta.planAllowed && !meta.hasLocation && (
                <div className="flex items-start gap-2.5 rounded-xl border border-rose-300/60 bg-rose-50 px-3.5 py-3 text-[13px] text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                        Simpan titik <b>Lokasi</b> outlet dulu. Pesan Mandiri memeriksa jarak HP pelanggan ke titik
                        itu, jadi tanpa lokasi fitur ini tidak bisa dinyalakan.
                    </p>
                </div>
            )}

            <div className="rounded-xl border border-border/60 bg-muted/40 px-4 py-3.5">
                <div className="mb-2 flex items-baseline justify-between">
                    <p className="text-[11.5px] font-bold tracking-wide text-muted-foreground">JARAK MAKSIMAL PELANGGAN</p>
                    <span className="text-lg font-black tabular-nums">{value.radiusM} m</span>
                </div>
                <input
                    type="range"
                    min={meta.radiusMin}
                    max={meta.radiusMax}
                    step={10}
                    value={value.radiusM}
                    onChange={(e) => onChange({ ...value, radiusM: Number(e.target.value) })}
                    className="w-full accent-rose-600"
                    aria-label="Jarak maksimal pelanggan dari titik outlet"
                />
                <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                    <span>{meta.radiusMin} m</span>
                    <span>{meta.radiusMax} m</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    HP pelanggan harus berada dalam jarak ini dari titik outlet saat memesan, ditambah toleransi GPS
                    hingga 100 m. Warung kecil cukup 50–100 m; food court atau gedung besar butuh lebih.
                </p>
            </div>

            <div ref={sheetRef} className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                    <p className="text-[11.5px] font-bold tracking-wide text-muted-foreground">KODE QR</p>
                    <button
                        type="button"
                        onClick={print}
                        disabled={!origin}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-bold transition hover:bg-muted disabled:opacity-50"
                    >
                        <Printer className="h-3.5 w-3.5" /> Cetak semua
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <QrCard
                        url={counterUrl}
                        title="Kasir / Umum"
                        sub="Tanpa meja · ambil di kasir"
                        icon={<Store className="h-3.5 w-3.5" />}
                        ready={!!origin}
                    />
                    {tables.map((t) => (
                        <QrCard
                            key={t.id}
                            url={tableUrl(t.id)}
                            title={`Meja ${t.label}`}
                            sub={t.zone}
                            icon={<Armchair className="h-3.5 w-3.5" />}
                            ready={!!origin}
                        />
                    ))}
                </div>
                {meta.canUseTables ? (
                    tables.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                            Belum ada meja. Buat denah di{" "}
                            <Link href="/dashboard/tables" className="font-bold text-rose-600 hover:underline dark:text-rose-400">
                                Manajemen Meja
                            </Link>{" "}
                            untuk mendapat QR per meja — pesanannya langsung masuk ke bill meja itu.
                        </p>
                    )
                ) : (
                    <p className="text-xs text-muted-foreground">
                        Satu QR untuk semua: tempel di kasir atau di tiap meja. Pesanan masuk ke kasir dengan nomor
                        antrean, pelanggan membayar saat dipanggil.
                    </p>
                )}
            </div>

            <ul className="flex list-disc flex-col gap-1 pl-4 text-xs leading-relaxed text-muted-foreground">
                <li>Pesanan dari HP berbunyi di kasir sampai diterima. Setelah diterima, pesanan jadi tab biasa.</li>
                <li>Pelanggan tidak perlu daftar akun. Harga selalu diambil dari menu terbaru, bukan dari HP.</li>
                <li>Halaman menu tetap bisa dilihat siapa saja; hanya memesan yang butuh lokasi.</li>
            </ul>
        </div>
    );
}

function QrCard({
    url,
    title,
    sub,
    icon,
    ready,
}: {
    url: string;
    title: string;
    sub: string;
    icon: React.ReactNode;
    ready: boolean;
}) {
    return (
        <div
            data-qr-card
            data-title={title}
            className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-3 text-center"
        >
            {/* White on purpose, in dark mode too: a QR code needs its quiet zone. */}
            <div className="rounded-lg bg-white p-2">
                {ready ? <QRCode value={url} size={112} /> : <div className="h-28 w-28" />}
            </div>
            <div className="min-w-0">
                <p className="flex items-center justify-center gap-1 text-sm font-black">
                    {icon}
                    {title}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
            </div>
            <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 hover:underline dark:text-rose-400"
            >
                Buka <ExternalLink className="h-3 w-3" />
            </a>
        </div>
    );
}
