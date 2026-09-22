import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Banknote, Clock, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { ArticleSection, ArticleShell } from "../article-shell";

export const metadata: Metadata = {
  title: "Cara mengelola stok & opname · Panduan",
};

/*
 * The Stok page end to end: what moves stock, the opname session, and when an
 * HPP has to be typed. Mirrors the backend, so change this page when these do:
 *
 *   - lib/cost.ts        postMovement — the single writer; every number here
 *                        comes from a stock_movements row
 *   - lib/opname.ts      TOLERANCE_RP / TOLERANCE_PCT (the "Perlu alasan"
 *                        threshold), REASON_CODES, MAX_BACKDATE_DAYS
 *   - routes/stock-opname.ts  the finish gates: every product answered
 *                        (`incomplete`), every big variance explained
 *                        (`needs_reason`)
 *   - lib/stock.ts       applyProduction — a batch is priced from what it ate
 *   - lib/cogs.ts        COGS sums reason in ('sales','void'), so an opname
 *                        adjustment never lands in laba kotor
 *
 * Screenshots in public/panduan/stok are captured from this outlet's own
 * screens; retake them (light + dark) when the layout changes.
 */

const SHOT_W = 1184;
const SHOT_H = 806;

export default function StokGuide() {
  return (
    <ArticleShell
      category="Stok & Barang"
      title="Mengelola stok: apa yang menggerakkannya, dan cara opname"
      lede={
        <div className="flex flex-col gap-4">
          <p>
            Stok hanya dihitung untuk produk yang Anda tandai{" "}
            <b className="font-semibold text-foreground">dikelola stoknya</b>. Angkanya tidak pernah
            berubah sendiri: setiap pergerakan berasal dari satu kejadian yang tercatat, dan bisa
            ditelusuri satu per satu lewat <b className="font-semibold text-foreground">Alur Stok</b> di
            tiap produk.
          </p>
          <p className="flex items-start gap-2.5 rounded-xl bg-muted px-3.5 py-3 text-sm text-foreground">
            <Banknote className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Opname tidak menyentuh kas. Uangnya sudah keluar waktu barang dibeli; barang yang hilang
              atau busuk mengurangi <b className="font-semibold">nilai stok</b>, bukan kas, dan tidak
              masuk ke laba kotor.
            </span>
          </p>
        </div>
      }
    >
      <ArticleSection
        id="penggerak"
        title="Apa yang menggerakkan stok"
        intro={
          <p>
            Hanya enam kejadian di bawah ini. Kalau stok berubah tanpa Anda mengerti kenapa, buka{" "}
            <GuideLink href="/dashboard/invoice/stock">Stok</GuideLink> → pilih produknya →{" "}
            <b className="font-semibold text-foreground">Alur Stok</b>: semua barisnya ada di sana,
            lengkap dengan sisa stok setelah tiap kejadian.
          </p>
        }
      >
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          <Event
            name={<GuideLink href="/dashboard/invoice/purchase">Faktur Pembelian</GuideLink>}
            effect="Stok masuk sebanyak yang dibeli, dan harga belinya ikut membentuk HPP rata-rata."
            chip="Masuk"
            tone="in"
          />
          <Event
            name="Penjualan di kasir"
            effect="Stok keluar — produknya sendiri kalau punya stok, atau bahan-bahannya kalau punya resep."
            chip="Keluar"
            tone="out"
          />
          <Event
            name={<GuideLink href="/dashboard/invoice/production">Produksi</GuideLink>}
            effect="Bahan keluar, hasilnya masuk. Di sinilah HPP barang buatan sendiri terbentuk."
            chip="Masuk & keluar"
            tone="in"
          />
          <Event
            name="Stok Opname"
            effect="Selisih antara hitungan fisik dan catatan sistem, setelah Anda setujui."
            chip="Penyesuaian"
            tone="adjust"
          />
          <Event
            name="Pembatalan nota"
            effect="Stok kembali dengan biaya aslinya, jadi nota yang dibatalkan tidak meninggalkan jejak biaya."
            chip="Kembali"
            tone="in"
          />
          <Event
            name="Pesanan dari aplikasi pelanggan"
            effect="Tidak memotong stok sama sekali. Yang memotong stok hanya penjualan lewat kasir dan faktur penjualan."
            chip="Tidak bergerak"
          />
        </ul>

        <Shot
          name="stok"
          alt="Halaman Stok: kartu Nilai Stok, Produk Dikelola dan Stok Habis di atas, lalu daftar produk dengan tombol Alur Stok di tiap baris."
          caption="Halaman Stok. Nilai stok di kartu paling kiri dihitung dari HPP tiap barang, bukan dari harga jualnya."
        />
      </ArticleSection>

      <ArticleSection
        id="opname"
        title="Menghitung fisik lewat sesi opname"
        intro={
          <p>
            Opname adalah menghitung barang yang benar-benar ada di rak, lalu membandingkannya dengan
            catatan sistem. Tekan <b className="font-semibold text-foreground">Stok Opname</b> untuk
            memulai satu sesi. <b className="font-semibold text-foreground">Jual beli tetap jalan</b>{" "}
            selama sesi berlangsung.
          </p>
        }
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Card
            title="Boleh berhari-hari"
            body="Tiap barang dibandingkan dengan stok sistem pada saat barang itu dihitung — bukan saat sesi dibuka. Jadi penjualan yang terjadi di tengah-tengah opname tidak ikut terhitung sebagai barang hilang."
          />
          <Card
            title="Boleh dari beberapa HP"
            body="Hitungan disimpan di server, bukan di HP. Siapa pun yang punya akses Stok bisa ikut mengisi, dan tombol Muat ulang menarik hitungan terbaru dari perangkat lain."
          />
          <Card
            title="Stok belum berubah"
            body="Selama sesi masih berjalan, tidak ada satu pun angka stok yang bergeser. Semua baru diterapkan saat Anda menyetujui di layar tinjauan."
          />
        </div>

        <Shot
          name="opname"
          alt="Lembar hitung opname: tiap baris punya status berwarna, tombol Pas, kolom hitung fisik, selisih dalam kata, dan dampak rupiah."
          caption="Lembar hitung. Tombol Pas mengisi angka sesuai catatan sistem sekali klik — untuk barang yang jumlahnya memang sudah cocok."
        />

        <div>
          <h3 className="mb-3.5 font-semibold">Arti warna di tiap baris</h3>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            <Status
              dot="bg-muted-foreground/40"
              name="Belum dihitung"
              body="Belum ada jawaban. Opname tidak bisa diselesaikan selama masih ada baris seperti ini."
            />
            <Status
              dot="bg-green-600"
              name="Pas"
              body="Hitungan sama dengan catatan sistem. Tidak ada yang berubah untuk barang ini."
            />
            <Status
              dot="bg-amber-500"
              name="Selisih kecil"
              body="Beda, tapi masih di bawah batas. Alasan boleh diisi, boleh tidak."
            />
            <Status
              dot="bg-red-600"
              name="Perlu alasan"
              body="Selisihnya di atas Rp 100.000 atau lebih dari 5% stok. Wajib diberi alasan sebelum bisa disetujui."
            />
            <Status
              dot="bg-muted-foreground/60"
              name="Dilewati"
              body="Ditandai tidak bisa dihitung, misalnya barang di gudang yang terkunci. Stoknya dibiarkan apa adanya — ini tetap dihitung sebagai jawaban."
            />
          </ul>
        </div>

        <div
          role="note"
          className="flex items-start gap-3 rounded-xl bg-muted px-4.5 py-4"
        >
          <Clock className="mt-0.5 size-4.5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="text-sm">
            <p className="mb-0.5 font-semibold">Lupa input hitungan kemarin?</p>
            <p>
              Buka <b className="font-semibold">Catatan sesi</b> → <b className="font-semibold">Waktu hitung</b>{" "}
              → <b className="font-semibold">Waktu lain</b>, lalu isi kapan barang itu dihitung (paling jauh 7
              hari ke belakang). Hitungan dari kertas kemarin akan dibandingkan dengan stok sistem pada jam
              itu, bukan stok hari ini. Satu barang tidak boleh diberi waktu lebih awal daripada opname
              terakhirnya, supaya selisih yang sama tidak terhitung dua kali.
            </p>
          </div>
        </div>
      </ArticleSection>

      <ArticleSection
        id="tinjau"
        title="Tinjau, beri alasan, lalu setujui"
        intro={
          <p>
            Kalau semua barang sudah dijawab, tombol{" "}
            <b className="font-semibold text-foreground">Tinjau selisih</b> terbuka. Layar ini
            mengelompokkan hasilnya: yang cocok lewat tanpa perlu dilihat, yang beda dikumpulkan dengan
            dampak rupiahnya.
          </p>
        }
      >
        <Shot
          name="tinjau"
          alt="Layar tinjauan: empat kotak ringkasan di atas, lalu kelompok Perlu alasan, Selisih kecil, Cocok dengan sistem dan Dilewati."
          caption="Layar tinjauan. Tombol Setujui baru aktif setelah semua selisih besar punya alasan."
        />

        <div className="grid items-start gap-7 lg:grid-cols-2">
          <div>
            <h3 className="mb-3.5 font-semibold">Alasan yang bisa dipilih</h3>
            <ul className="flex list-disc flex-col gap-1.5 pl-4.5 marker:text-muted-foreground">
              <li>Barang busuk / rusak</li>
              <li>Terpakai tanpa dicatat</li>
              <li>Salah satuan saat input</li>
              <li>Tercatat ganda di faktur</li>
              <li>Hilang / belum diketahui</li>
            </ul>
            <p className="mt-3 text-sm text-muted-foreground">
              Alasan ikut tertulis di catatan penyesuaian, jadi enam bulan lagi Alur Stok masih bisa
              menjelaskan kenapa stoknya berubah.
            </p>
          </div>

          <div>
            <h3 className="mb-3.5 font-semibold">Yang terjadi setelah disetujui</h3>
            <ol className="flex flex-col gap-2.5">
              <Numbered n={1}>
                Stok sistem ditulis ulang sesuai hasil hitung, dicatat pada{" "}
                <b className="font-semibold">waktu masing-masing barang dihitung</b>.
              </Numbered>
              <Numbered n={2}>
                Penyesuaiannya muncul di Alur Stok dan Riwayat Opname — bisa ditelusuri, tidak bisa
                dihapus.
              </Numbered>
              <Numbered n={3}>
                Barang yang dilewati tidak berubah sama sekali, dan sesi ini ditutup.
              </Numbered>
            </ol>
          </div>
        </div>
      </ArticleSection>

      <ArticleSection
        id="hpp"
        title="Kolom Dampak nilai: kapan HPP perlu diisi"
        intro={
          <p>
            Dampak nilai adalah selisih dikali HPP barang. Kalau sistem belum pernah tahu harga beli
            suatu barang, angka itu belum bisa dihitung — dan di situlah kolomnya menawarkan{" "}
            <b className="font-semibold text-foreground">Isi HPP</b>.{" "}
            <b className="font-semibold text-foreground">Ini tidak wajib.</b> Dikosongkan pun opname
            tetap bisa diselesaikan.
          </p>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Card
            tone="ok"
            title="Barang yang dibeli — boleh diisi"
            body="Bahan dan barang dagangan yang Anda beli dari pemasok: bawang, gula, gelas plastik. Cara terbaik tetap lewat Faktur Pembelian, karena harganya ikut terhitung otomatis. Isi HPP di sini hanya kalau stoknya sudah terlanjur ada tanpa pernah dicatat pembeliannya."
          />
          <Card
            tone="warn"
            title="Barang yang dibuat sendiri — jangan diisi"
            body="Sambal, sirup, adonan, kopi hasil racikan: barang yang punya resep. HPP-nya dihitung dari bahan yang terpakai waktu Anda mencatat Produksi, dan akan lebih tepat daripada angka yang diketik. Baris seperti ini memang tidak menawarkan Isi HPP."
          />
        </div>

        <Shot
          name="hpp"
          alt="Kotak dialog Isi HPP: kolom harga beli per satu unit, perhitungan nilai stok, dan peringatan bahwa angkanya mengunci setelah opname disetujui."
          caption="Dialog Isi HPP. Perkalian di bawah kolom isian memperlihatkan nilai stok yang terbentuk — cara cepat memergoki harga per karung yang keliru diisi sebagai harga per kg."
        />

        <div
          role="note"
          className="flex items-start gap-3 rounded-xl bg-amber-50 px-4.5 py-4 dark:bg-amber-950/30"
        >
          <TriangleAlert
            className="mt-0.5 size-4.5 shrink-0 text-amber-700 dark:text-amber-300"
            aria-hidden
          />
          <div className="text-sm">
            <p className="mb-0.5 font-semibold text-amber-800 dark:text-amber-300">
              Sekali disetujui, HPP ini mengunci
            </p>
            <p>
              Selama opname belum disetujui, angkanya masih bisa diubah atau dikosongkan. Sesudah
              disetujui, angka itu menjadi HPP resmi barang tersebut dan dipakai menghitung{" "}
              <b className="font-semibold">laba kotor setiap penjualan berikutnya</b> — opname tidak bisa
              mengubahnya lagi, hanya Faktur Pembelian berikutnya yang akan mencampur harga baru.
              Penjualan yang sudah lewat tidak ikut berubah. Kalau ragu, kosongkan saja.{" "}
              <GuideLink href="/dashboard/panduan/laba-kotor">
                Selengkapnya di panduan laba kotor
              </GuideLink>
              .
            </p>
          </div>
        </div>
      </ArticleSection>

      <ArticleSection
        id="urutan"
        title="Urutan yang disarankan"
        intro={<p>Supaya angka HPP dan nilai stok benar sejak awal, kerjakan dari bawah ke atas.</p>}
      >
        <ol className="flex flex-col gap-2.5">
          <Numbered n={1}>
            <b className="font-semibold">Catat pembelian lewat Faktur Pembelian.</b> Ini yang mengisi
            stok sekaligus HPP bahan-bahan yang Anda beli.
          </Numbered>
          <Numbered n={2}>
            <b className="font-semibold">Catat Produksi</b> untuk barang buatan sendiri, setelah
            bahannya punya harga. Kalau bahannya masih Rp 0, hasil produksinya juga akan Rp 0.
          </Numbered>
          <Numbered n={3}>
            <b className="font-semibold">Opname rutin</b> — akhir bulan, atau kapan pun Anda merasa
            catatan sudah tidak cocok dengan rak.
          </Numbered>
          <Numbered n={4}>
            <b className="font-semibold">Baca selisihnya, bukan cuma menyetujuinya.</b> Selisih yang
            berulang di barang yang sama biasanya bukan barang hilang, melainkan resep atau satuan yang
            perlu dibetulkan.
          </Numbered>
        </ol>
      </ArticleSection>

      <p className="border-t pt-4.5 text-[13px] text-muted-foreground">
        Halaman Stok tersedia di paket Max Lite, Max, dan Ultimax.
      </p>
    </ArticleShell>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

/**
 * A screenshot of the real screen, in both themes: a light shot on a dark page
 * (or the reverse) reads as a foreign object rather than as this app.
 */
function Shot({ name, alt, caption }: { name: string; alt: string; caption: string }) {
  return (
    <figure className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-xl border bg-card">
        <Image
          src={`/panduan/stok/${name}.png`}
          alt={alt}
          width={SHOT_W}
          height={SHOT_H}
          className="block h-auto w-full dark:hidden"
        />
        <Image
          src={`/panduan/stok/${name}-dark.png`}
          alt={alt}
          width={SHOT_W}
          height={SHOT_H}
          className="hidden h-auto w-full dark:block"
        />
      </div>
      <figcaption className="max-w-[68ch] text-[13px] text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

function Event({
  name,
  effect,
  chip,
  tone,
}: {
  name: React.ReactNode;
  effect: string;
  chip: string;
  tone?: "in" | "out" | "adjust";
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-[3px] px-4 py-3">
      <span className="font-semibold">{name}</span>
      <span
        className={cn(
          "justify-self-end rounded-full border px-2.5 py-[3px] text-xs font-semibold tracking-[0.04em] whitespace-nowrap uppercase",
          tone === "in"
            ? "border-transparent bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
            : tone === "out"
              ? "border-transparent bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
              : tone === "adjust"
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

function Status({ dot, name, body }: { dot: string; name: string; body: string }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", dot)} aria-hidden />
      <div className="flex flex-col gap-0.5">
        <span className="font-semibold">{name}</span>
        <span className="text-sm text-muted-foreground">{body}</span>
      </div>
    </li>
  );
}

function Card({ title, body, tone }: { title: string; body: string; tone?: "ok" | "warn" }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border p-4.5",
        tone === "ok"
          ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/20"
          : tone === "warn"
            ? "border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20"
            : "bg-card",
      )}
    >
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function Numbered({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[30px_minmax(0,1fr)] items-start gap-3.5">
      <span className="grid size-7.5 place-items-center rounded-full border-[1.5px] border-foreground/20 bg-card font-mono text-[13px] font-semibold">
        {n}
      </span>
      <span className="pt-1">{children}</span>
    </li>
  );
}

function GuideLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground"
    >
      {children}
    </Link>
  );
}
