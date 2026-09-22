import type { Metadata } from "next";
import Link from "next/link";
import { Lock, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { ArticleSection, ArticleShell } from "../article-shell";

export const metadata: Metadata = {
  title: "Cara laba kotor dihitung · Panduan",
};

/*
 * How HPP (and so laba kotor) is costed, per sold line. Mirrors the backend, so
 * change this page when these change:
 *
 *   - lib/cogs.ts            orderCogsSql / lineCogsSql — the three kinds of line,
 *                            the frozen orderDetails.unit_cost fallback, jasa = 0
 *   - lib/outlet-access.ts   usesCostLedger — only a PAID plan with `stock`
 *                            (Max Lite / Max / Ultimax) reads the ledger; trials don't
 *   - lib/cost.ts            postMovement — the weighted average, IN blends, OUT consumes
 *   - routes/invoices.ts     purchase landed cost, opname "HPP awal" only at avg 0
 *
 * App orders never call applySaleStockOut, so they always fall back to the
 * frozen buying price, whatever the plan.
 */

type PathKey = "a" | "b" | "c";

const PATH: Record<PathKey, { letter: string; solid: string; soft: string; ink: string; marker: string }> = {
  a: {
    letter: "A",
    solid: "bg-blue-600",
    soft: "bg-blue-50 dark:bg-blue-950/40",
    ink: "text-blue-700 dark:text-blue-300",
    marker: "marker:text-blue-600 dark:marker:text-blue-400",
  },
  b: {
    letter: "B",
    solid: "bg-emerald-700",
    soft: "bg-emerald-50 dark:bg-emerald-950/40",
    ink: "text-emerald-700 dark:text-emerald-300",
    marker: "marker:text-emerald-600 dark:marker:text-emerald-400",
  },
  c: {
    letter: "C",
    solid: "bg-slate-600",
    soft: "bg-slate-100 dark:bg-slate-800/60",
    ink: "text-slate-600 dark:text-slate-300",
    marker: "marker:text-slate-500",
  },
};

export default function LabaKotorGuide() {
  return (
    <ArticleShell
      category="Laporan & Keuangan"
      title="Dari mana angka HPP di laporan Anda berasal"
      lede={
        <div className="flex flex-col gap-4">
          <p>
            Laba kotor adalah omzet dikurangi HPP. Setiap item yang terjual dihitung HPP-nya dengan
            salah satu dari tiga cara, ditentukan oleh kategori produk, paket langganan, dari mana
            pesanan masuk, dan cara stok produk diatur. Ikuti alurnya dari atas.
          </p>
          <p className="flex items-start gap-2.5 rounded-xl bg-muted px-3.5 py-3 text-sm text-foreground">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Begitu item terjual, HPP-nya dikunci. Mengubah Harga Beli atau harga bahan setelahnya
              tidak mengubah laporan yang sudah lewat — kecuali Harga Beli-nya kosong waktu itu
              (lihat Cara A).
            </span>
          </p>
        </div>
      }
    >
      <ArticleSection
        id="alur"
        title="Alur penentuan HPP"
        intro={
          <p>
            Setiap pertanyaan: jawaban <b className="font-semibold text-foreground">Ya</b> keluar ke
            kanan, jawaban <b className="font-semibold text-foreground">Tidak</b> lanjut ke bawah.
          </p>
        }
      >
        <div className="flex flex-col">
          <div className="inline-flex w-fit flex-wrap items-baseline gap-x-2.5 rounded-full bg-foreground px-4.5 py-2.5 font-semibold text-background">
            Satu item terjual
            <small className="text-[13px] font-normal opacity-75">dihitung per baris pesanan</small>
          </div>
          <Down />

          <Step
            question="Kategorinya Jasa?"
            help="Layanan tidak memakai barang."
            to="c"
            label="Rp 0"
          />
          <Down label="Tidak" />

          <Step
            question="Paket Anda Basic, Pro, atau masih trial?"
            help="Hanya paket berbayar Max Lite, Max, dan Ultimax yang menghitung dari stok."
            to="a"
            label="Harga Beli"
            note="Semua produk, termasuk menu yang punya resep."
          />
          <Down label="Tidak" />

          <Step
            question="Pesanan masuk dari aplikasi pelanggan?"
            help="Pesanan online tidak memotong stok, jadi tidak ada biaya stok yang tercatat."
            to="a"
            label="Harga Beli"
          />
          <Down label="Tidak" />

          <div>
            <div className="flex flex-col items-center gap-0.5 rounded-[10px] border-[1.5px] border-zinc-300 bg-card px-4 py-3.5 text-center dark:border-zinc-700">
              <p className="flex gap-[11px] text-base font-semibold leading-snug">
                <Diamond />
                Bagaimana stok produk ini diatur?
              </p>
              <p className="text-sm text-muted-foreground">
                Pilihan “Apakah Produk ini dapat dikelola stoknya?” di form produk.
              </p>
            </div>
            <div className="relative ml-7 grid gap-3 border-l-2 border-zinc-400 pt-4 pl-5 md:ml-0 md:grid-cols-3 md:gap-4 md:border-l-0 md:pt-[42px] md:pl-0 dark:border-zinc-600">
              {/* md+: stem down from the question, then a bar across the three branches */}
              <span
                aria-hidden
                className="absolute top-0 left-[calc(50%-1px)] hidden h-[21px] w-0.5 bg-zinc-400 md:block dark:bg-zinc-600"
              />
              <span
                aria-hidden
                className="absolute top-5 right-[calc((100%-32px)/6)] left-[calc((100%-32px)/6)] hidden h-0.5 bg-zinc-400 md:block dark:bg-zinc-600"
              />
              <Branch
                title="Punya stok sendiri"
                help="Barang jadi, bahan baku, hasil produksi"
                to="b"
                label="HPP rata-rata produk"
              />
              <Branch
                title="Ambil dari stok produk lain, ada resep"
                help="Menu olahan, paket, eceran"
                to="b"
                label="HPP rata-rata bahan"
              />
              <Branch
                title="Tidak dihitung stoknya, tanpa resep"
                help="Biaya tambahan, item yang tidak dihitung"
                to="a"
                label="Harga Beli"
              />
            </div>
          </div>
        </div>
      </ArticleSection>

      <ArticleSection id="cara" title="Tiga cara menghitung">
        <div className="flex flex-col gap-4.5">
          <ResultCard
            to="a"
            title="Harga Beli"
            formula="Harga Beli × jumlah terjual"
            when="paket Basic & Pro dan masa trial, pesanan dari aplikasi pelanggan, serta produk tanpa stok dan tanpa resep."
            points={[
              "Harga Beli di form produk disalin ke transaksi saat item terjual, lalu dikunci. Mengubahnya nanti hanya berlaku untuk penjualan berikutnya.",
              "Harga Beli kosong waktu terjual? Laporan memakai Harga Beli yang berlaku sekarang, jadi mengisinya belakangan tetap memperbaiki laporan lama.",
              "Masih kosong juga? HPP tercatat Rp 0 dan item terlihat untung 100%.",
            ]}
            example={
              <Example
                title="Es Teh · Harga Beli Rp 2.000"
                rows={[["Terjual 5 gelas", "5 × Rp 2.000"]]}
                total={["HPP", "Rp 10.000"]}
                to="a"
                note="Bulan depan Harga Beli naik jadi Rp 2.500: penjualan ini tetap Rp 10.000."
              />
            }
          />
          <ResultCard
            to="b"
            title="HPP rata-rata dari stok"
            formula="HPP rata-rata saat terjual × jumlah terpakai"
            when="paket Max Lite, Max & Ultimax — penjualan di kasir atas produk yang punya stok sendiri atau punya resep."
            points={[
              "Produk dengan stok sendiri memakai HPP rata-ratanya sendiri.",
              "Menu dengan resep dihitung per bahan: jumlah pemakaian tiap bahan × HPP rata-ratanya, lalu dijumlahkan.",
              "Bahan setengah jadi yang punya stok sendiri (hasil Produksi) dihitung dari HPP batch-nya, tidak dipecah lagi ke bahan mentah.",
              "Biaya ditulis di catatan stok saat transaksi, jadi tidak berubah walau harga bahan naik kemudian. Harga Beli di form produk tidak dipakai di sini.",
            ]}
            example={
              <Example
                title="Nasi Goreng · resep per porsi"
                rows={[
                  ["0,2 kg beras × Rp 12.900/kg", "Rp 2.580"],
                  ["1 butir telur × Rp 2.000", "Rp 2.000"],
                ]}
                total={["HPP 1 porsi", "Rp 4.580"]}
                to="b"
                note="Rp 12.900/kg adalah HPP rata-rata beras — lihat contoh perhitungannya di bawah."
              />
            }
          />
          <article
            id="cara-c"
            className="scroll-mt-20 overflow-hidden rounded-2xl border bg-card"
          >
            <ResultHead to="c" title="Rp 0" formula="Kategori Jasa" />
            <p className="max-w-[68ch] px-5 pt-4 pb-5">
              Jasa tidak memakai barang, jadi tidak punya HPP. Pendapatannya tetap masuk omzet dan
              terlihat sebagai untung 100%. Harga Beli di produk jasa — misalnya harga alat yang
              disewakan — sengaja tidak dipakai, supaya satu kali sewa tidak tercatat rugi jutaan
              rupiah.
            </p>
          </article>
        </div>
      </ArticleSection>

      <ArticleSection
        id="rata-rata"
        title="Dari mana HPP rata-rata berasal"
        intro={
          <p>
            Khusus Cara B. HPP rata-rata adalah rata-rata tertimbang dari semua stok yang masuk,
            dan hanya bergerak saat stok masuk dengan harga yang diketahui.
          </p>
        }
      >
        <div
          role="math"
          aria-label="HPP rata-rata baru sama dengan stok ada kali rata-rata lama ditambah jumlah masuk kali harga masuk, dibagi stok ada ditambah jumlah masuk"
          className="overflow-x-auto rounded-xl bg-muted px-4.5 py-4 font-mono text-sm leading-7 tabular-nums"
        >
          <span className="font-semibold whitespace-nowrap text-emerald-700 dark:text-emerald-300">
            HPP rata-rata baru
          </span>{" "}
          ={" "}
          <span className="inline-grid text-center align-middle">
            <span className="border-b-[1.5px] border-current pb-0.5 whitespace-nowrap">
              (stok ada × rata-rata lama) + (jumlah masuk × harga masuk)
            </span>
            <span className="pt-0.5 whitespace-nowrap">stok ada + jumlah masuk</span>
          </span>
        </div>

        <div className="grid items-start gap-7 lg:grid-cols-2">
          <div>
            <h3 className="mb-3.5 font-semibold">Yang menggerakkan angkanya</h3>
            <ul className="divide-y overflow-hidden rounded-xl border bg-card">
              <Event
                name={
                  <>
                    <GuideLink href="/dashboard/invoice/purchase">Faktur Pembelian</GuideLink> di-Posting
                  </>
                }
                effect="Harga per unit setelah diskon dicampur ke rata-rata."
                chip="Mengubah"
                tone="moves"
              />
              <Event
                name={<GuideLink href="/dashboard/invoice/production">Produksi</GuideLink>}
                effect="Biaya bahan yang terpakai ÷ jumlah hasil, dicampur ke rata-rata hasil produksi."
                chip="Mengubah"
                tone="moves"
              />
              <Event
                name={
                  <>
                    Opname di halaman <GuideLink href="/dashboard/invoice/stock">Stok</GuideLink>
                  </>
                }
                effect="Hanya bila HPP rata-rata masih Rp 0: Anda bisa mengisi HPP awal."
                chip="Sekali"
                tone="once"
              />
              <Event
                name="Penjualan & selisih opname"
                effect="Memakai rata-rata yang ada, tidak mengubahnya."
                chip="Tetap"
              />
              <Event name="Pembatalan" effect="Stok kembali dengan biaya aslinya." chip="Dikembalikan" />
            </ul>
          </div>

          <div>
            <h3 className="mb-3.5 font-semibold">Contoh: beras</h3>
            <ol className="flex flex-col">
              <TimelineStep n={1} what="Faktur Pembelian 10 kg @ Rp 12.000">
                rata-rata <Em>Rp 12.000/kg</Em> · stok 10 kg
              </TimelineStep>
              <TimelineStep n={2} what="Terjual 10 porsi Nasi Goreng, memakai 2 kg">
                HPP beras 2 × 12.000 = <Em>Rp 24.000</Em> · rata-rata tetap · stok 8 kg
              </TimelineStep>
              <TimelineStep n={3} what="Faktur Pembelian 12 kg @ Rp 13.500">
                (8 × 12.000 + 12 × 13.500) ÷ 20 = <Em>Rp 12.900/kg</Em> · stok 20 kg
              </TimelineStep>
              <TimelineStep n={4} what="Penjualan berikutnya memakai Rp 12.900/kg" last>
                Penjualan di langkah 2 tetap <Em>Rp 24.000</Em>
              </TimelineStep>
            </ol>
          </div>
        </div>

        <div
          role="note"
          className="flex items-start gap-3 rounded-xl bg-amber-50 px-4.5 py-4 dark:bg-amber-950/30"
        >
          <TriangleAlert className="mt-0.5 size-4.5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
          <div className="text-sm">
            <p className="mb-0.5 font-semibold text-amber-800 dark:text-amber-300">
              Produk baru mulai dari Rp 0
            </p>
            <p>
              Di paket Max Lite, Max &amp; Ultimax, produk yang belum pernah masuk lewat Faktur
              Pembelian, Produksi, atau Opname punya HPP rata-rata Rp 0 — dan penjualannya tercatat
              HPP Rp 0. Harga Beli tidak dipakai sebagai cadangan. Catat pembelian lewat{" "}
              <GuideLink href="/dashboard/invoice/purchase">Faktur Pembelian</GuideLink>, atau isi
              HPP awal saat Opname di halaman{" "}
              <GuideLink href="/dashboard/invoice/stock">Stok</GuideLink>.
            </p>
          </div>
        </div>
      </ArticleSection>

      <p className="border-t pt-4.5 text-[13px] text-muted-foreground">
        Berlaku untuk HPP dan laba kotor di halaman Laporan dan Dashboard.
      </p>
    </ArticleShell>
  );
}

/* ── Flowchart pieces ─────────────────────────────────────────────────────── */

function Diamond() {
  return (
    <span
      aria-hidden
      className="mt-[0.42em] size-[9px] shrink-0 rotate-45 border-2 border-current"
    />
  );
}

/** The "Tidak" arrow down the spine. */
function Down({ label }: { label?: string }) {
  return (
    <div className="relative ml-7 h-11.5 border-l-2 border-zinc-400 dark:border-zinc-600">
      <span
        aria-hidden
        className="absolute bottom-0 -left-[7px] border-x-[6px] border-t-8 border-x-transparent border-t-zinc-400 dark:border-t-zinc-600"
      />
      {label && (
        <span className="absolute top-1/2 left-2.5 -translate-y-[58%] text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {label}
        </span>
      )}
    </div>
  );
}

function Pill({ to, label }: { to: PathKey; label: string }) {
  const p = PATH[to];
  return (
    <a
      href={`#cara-${to}`}
      className={cn(
        "inline-flex items-center gap-2 rounded-full py-1.5 pr-3 pl-1.5 text-sm leading-tight font-semibold text-white transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring",
        p.solid,
      )}
    >
      <b className="grid size-5.5 shrink-0 place-items-center rounded-full bg-white/20 font-mono text-xs">
        {p.letter}
      </b>
      {label}
    </a>
  );
}

/**
 * One yes/no question. From md up the "Ya" exit runs to the right of the
 * question; below md the question and its exit share one card, so the spine
 * that carries on below it can only mean "Tidak".
 */
function Step({
  question,
  help,
  to,
  label,
  note,
}: {
  question: string;
  help: string;
  to: PathKey;
  label: string;
  note?: string;
}) {
  return (
    <div className="grid rounded-[10px] border-[1.5px] border-zinc-300 bg-card md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] md:items-center md:rounded-none md:border-0 md:bg-transparent dark:border-zinc-700">
      <div className="flex flex-col gap-0.5 px-4 pt-3.5 pb-2.5 md:rounded-[10px] md:border-[1.5px] md:border-zinc-300 md:bg-card md:pb-3.5 md:dark:border-zinc-700">
        <p className="flex gap-[11px] text-base leading-snug font-semibold">
          <Diamond />
          {question}
        </p>
        <p className="pl-5.5 text-sm text-muted-foreground">{help}</p>
      </div>
      <div className="grid grid-cols-[52px_minmax(0,1fr)] items-start pt-1 pr-4 pb-3.5 pl-5.5 md:grid-cols-[96px_minmax(0,1fr)] md:items-center md:p-0">
        <span aria-hidden className="relative mt-4 mr-3 h-0.5 bg-zinc-400 md:mt-0 dark:bg-zinc-600">
          <span className="absolute -top-[5px] -right-0.5 border-y-[6px] border-l-8 border-y-transparent border-l-zinc-400 dark:border-l-zinc-600" />
          <span className="absolute bottom-[7px] left-1/2 -translate-x-1/2 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            Ya
          </span>
        </span>
        <div className="flex flex-col items-start gap-1.5 pt-0.5 md:pt-0">
          <span className="sr-only">Ya:</span>
          <Pill to={to} label={label} />
          {note && <p className="text-[13px] leading-snug text-muted-foreground">{note}</p>}
        </div>
      </div>
    </div>
  );
}

function Branch({
  title,
  help,
  to,
  label,
}: {
  title: string;
  help: string;
  to: PathKey;
  label: string;
}) {
  return (
    <div className="relative flex flex-col gap-1 rounded-[10px] border-[1.5px] border-zinc-300 bg-card px-4 pt-3.5 pb-4 dark:border-zinc-700">
      {/* md+: drop from the bar above */}
      <span
        aria-hidden
        className="absolute -top-5.5 left-[calc(50%-1px)] hidden h-3 w-0.5 bg-zinc-400 md:block dark:bg-zinc-600"
      />
      <span
        aria-hidden
        className="absolute -top-2.5 left-[calc(50%-6px)] hidden border-x-[6px] border-t-8 border-x-transparent border-t-zinc-400 md:block dark:border-t-zinc-600"
      />
      {/* below md: tick off the spine on the left */}
      <span
        aria-hidden
        className="absolute top-[calc(50%-1px)] -left-[21px] h-0.5 w-3 bg-zinc-400 md:hidden dark:bg-zinc-600"
      />
      <span
        aria-hidden
        className="absolute top-[calc(50%-6px)] -left-[9px] border-y-[6px] border-l-8 border-y-transparent border-l-zinc-400 md:hidden dark:border-l-zinc-600"
      />
      <p className="leading-snug font-semibold">{title}</p>
      <p className="mb-3 text-[13px] leading-snug text-muted-foreground">{help}</p>
      <div className="mt-auto">
        <Pill to={to} label={label} />
      </div>
    </div>
  );
}

/* ── Result cards ─────────────────────────────────────────────────────────── */

function ResultHead({ to, title, formula }: { to: PathKey; title: string; formula: string }) {
  const p = PATH[to];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3.5 gap-y-2 px-5 py-4", p.soft)}>
      <span
        className={cn(
          "grid size-7.5 shrink-0 place-items-center rounded-lg font-mono font-semibold text-white",
          p.solid,
        )}
      >
        {p.letter}
      </span>
      <h3 className="text-lg leading-snug font-semibold">{title}</h3>
      <span className={cn("basis-full font-mono text-[13px] font-medium sm:ml-auto sm:basis-auto", p.ink)}>
        {formula}
      </span>
    </div>
  );
}

function ResultCard({
  to,
  title,
  formula,
  when,
  points,
  example,
}: {
  to: PathKey;
  title: string;
  formula: string;
  when: string;
  points: string[];
  example: React.ReactNode;
}) {
  return (
    <article id={`cara-${to}`} className="scroll-mt-20 overflow-hidden rounded-2xl border bg-card">
      <ResultHead to={to} title={title} formula={formula} />
      <p className="px-5 pt-4 text-sm">
        <strong className="font-semibold">Dipakai untuk:</strong> {when}
      </p>
      <div className="grid gap-5 px-5 pt-3.5 pb-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <ul className={cn("flex list-disc flex-col gap-2 pl-4.5", PATH[to].marker)}>
          {points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        {example}
      </div>
    </article>
  );
}

function Example({
  title,
  rows,
  total,
  to,
  note,
}: {
  title: string;
  rows: [string, string][];
  total: [string, string];
  to: PathKey;
  note: string;
}) {
  return (
    <div className="flex flex-col gap-2 self-start rounded-xl bg-muted px-4 py-3.5 text-sm">
      <p className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">Contoh</p>
      <p className="font-semibold">{title}</p>
      <table className="w-full border-collapse tabular-nums">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td className="py-[3px] align-top">{label}</td>
              <td className="py-[3px] pl-3 text-right font-mono text-[13px] whitespace-nowrap">{value}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="border-t border-foreground/20 pt-[7px]">{total[0]}</td>
            <td
              className={cn(
                "border-t border-foreground/20 pt-[7px] pl-3 text-right font-mono text-[13px] whitespace-nowrap",
                PATH[to].ink,
              )}
            >
              {total[1]}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="text-[13px] leading-snug text-muted-foreground">{note}</p>
    </div>
  );
}

/* ── Average-cost section ─────────────────────────────────────────────────── */

function Event({
  name,
  effect,
  chip,
  tone,
}: {
  name: React.ReactNode;
  effect: string;
  chip: string;
  tone?: "moves" | "once";
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-[3px] px-4 py-3">
      <span className="font-semibold">{name}</span>
      <span
        className={cn(
          "justify-self-end rounded-full border px-2.5 py-[3px] text-xs font-semibold tracking-[0.04em] whitespace-nowrap uppercase",
          tone === "moves"
            ? "border-transparent bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
            : tone === "once"
              ? "border-transparent bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
              : "border-foreground/20 text-muted-foreground",
        )}
      >
        {chip}
      </span>
      <span className="col-span-2 row-start-2 text-sm text-muted-foreground">{effect}</span>
    </li>
  );
}

function TimelineStep({
  n,
  what,
  last,
  children,
}: {
  n: number;
  what: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className={cn("relative grid grid-cols-[30px_minmax(0,1fr)] gap-3.5", !last && "pb-4.5")}>
      {!last && (
        <span aria-hidden className="absolute top-7.5 bottom-0 left-3.5 w-0.5 bg-foreground/15" />
      )}
      <span className="grid size-7.5 place-items-center rounded-full border-[1.5px] border-foreground/20 bg-card font-mono text-[13px] font-semibold">
        {n}
      </span>
      <div className="flex flex-col gap-0.5 pt-1">
        <p className="font-semibold">{what}</p>
        <p className="font-mono text-[13px] text-muted-foreground tabular-nums">{children}</p>
      </div>
    </li>
  );
}

function Em({ children }: { children: React.ReactNode }) {
  return <em className="font-semibold text-emerald-700 not-italic dark:text-emerald-300">{children}</em>;
}

function GuideLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground">
      {children}
    </Link>
  );
}
