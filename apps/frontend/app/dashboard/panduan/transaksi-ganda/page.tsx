import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, ExternalLink, TriangleAlert } from "lucide-react";
import { getOutlet } from "@/lib/utils/get-role";
import { cn } from "@/lib/utils";
import { ArticleSection, ArticleShell } from "../article-shell";

export const metadata: Metadata = {
  title: "Cara cek transaksi ganda · Panduan",
};

/*
 * A guide to /auditowners/[outlet_id]. The rules quoted here are the backend's,
 * so change this page when they change (routes/audit.ts):
 *
 *   WINDOW_SECONDS = 90, REVIEW_GAP_SECONDS = 30, MAX_RANGE_DAYS = 93,
 *   default range = the last 30 days, list capped at 500 pairs,
 *   counter sales only (source = 'pos'), cancelled / deleted notes excluded,
 *   customer name outranks the item/gap/payment heuristic in both directions.
 *
 * The audit is deliberately not in the sidebar (it names a cashier's mistakes);
 * this guide links to it for the owner's ACTIVE outlet, which is also the outlet
 * the audit's own note links resolve against, so the two cannot disagree.
 */

export default async function TransaksiGandaGuide() {
  const outlet = (await getOutlet()).result[0] as { id: number; name: string } | undefined;

  return (
    <ArticleShell
      category="Kasir"
      title="Cara cek transaksi ganda di kasir"
      lede={
        <p>
          Kalau koneksi tersendat saat Checkout, satu penjualan bisa tercatat dua kali. Pelanggan
          membayar sekali, tetapi laporan mencatat dua penjualan — dan kalau nota keduanya tunai,
          laci kas terlihat kurang saat tutup shift. Halaman{" "}
          <strong className="font-semibold text-foreground">Audit Transaksi Ganda</strong>{" "}
          menemukan pasangan nota seperti ini untuk Anda.
        </p>
      }
    >
      <OpenAudit outlet={outlet} />

      <ArticleSection id="penyebab" title="Kenapa bisa terjadi">
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Cause n={1} text="Kasir menekan Checkout." />
          <Cause n={2} text="Pesanan tersimpan di server, tetapi balasannya tidak sampai ke kasir." />
          <Cause n={3} text="Layar menampilkan pesan gagal, keranjang masih penuh." />
          <Cause n={4} text="Kasir menekan Checkout lagi — tersimpanlah nota kedua." critical />
        </ol>
        <p className="max-w-[68ch]">
          Menekan Checkout lagi adalah reaksi yang wajar untuk layar yang bilang pesanan gagal. Ini
          bukan kesalahan kasir.
        </p>
        <div className="flex items-start gap-3 rounded-xl bg-emerald-50 px-4.5 py-4 dark:bg-emerald-950/30">
          <CircleCheck
            className="mt-0.5 size-4.5 shrink-0 text-emerald-700 dark:text-emerald-300"
            aria-hidden
          />
          <div className="text-sm">
            <p className="mb-0.5 font-semibold text-emerald-800 dark:text-emerald-300">
              Sudah dicegah sejak 10 September 2026
            </p>
            <p>
              Kasir sekarang memberi kode unik pada setiap Checkout. Kalau kasir mengulang setelah
              pesan gagal, server mengenali pesanan yang sama dan tidak mencatatnya dua kali. Nota
              ganda sebelum tanggal itu masih ada di pembukuan dan perlu dibersihkan — audit ini
              juga cara memastikan masalahnya tidak muncul lagi.
            </p>
          </div>
        </div>
      </ArticleSection>

      <ArticleSection
        id="aturan"
        title="Kapan dua nota dianggap ganda"
        intro={<p>Audit memasangkan dua nota hanya bila ketiga syarat ini terpenuhi:</p>}
      >
        <ul className="grid gap-3 md:grid-cols-3">
          <Rule title="Transaksi kasir">
            Pesanan dari aplikasi pelanggan tidak diperiksa. Nota yang sudah dibatalkan tidak
            dihitung.
          </Rule>
          <Rule title="Isi keranjang identik">
            Produk, jumlah, dan harga sama persis — termasuk tambahan (add-on) — dan totalnya sama.
          </Rule>
          <Rule title="Jaraknya ≤ 90 detik">
            Checkout ulang biasanya terjadi 5–70 detik setelah yang pertama. Pelanggan berikutnya
            jarang memesan hal yang persis sama secepat itu.
          </Rule>
        </ul>

        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-muted/50 px-4 py-2.5 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            <span>Kondisi pasangan</span>
            <span>Tanda</span>
          </div>
          <ul className="divide-y">
            <Verdict
              condition="Nama Pelanggan sama di kedua nota"
              detail="Satu pesanan yang terkirim dua kali, walau hanya satu kopi dengan jeda 40 detik."
              verdict="likely"
            />
            <Verdict
              condition="Nama Pelanggan berbeda"
              detail="Dua pembeli yang masing-masing menyebut namanya. Jangan batalkan nota keduanya."
              verdict="review"
            />
            <Verdict
              condition="Tanpa nama, satu jenis item, jeda lebih dari 30 detik, metode bayar sama"
              detail="Bisa jadi dua pembeli berbeda yang memesan hal yang sama. Pastikan dulu."
              verdict="review"
            />
            <Verdict
              condition="Tanpa nama, lainnya"
              detail="Lebih dari satu jenis item, jeda di bawah 30 detik, atau metode bayar berganti — hanya kasir yang mengulang yang menghasilkan pola ini."
              verdict="likely"
            />
          </ul>
        </div>
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          Nama Pelanggan hanya dipakai bila kasir sempat mengetiknya. Kalau salah satu nota tanpa
          nama, penilaian kembali memakai item, jeda, dan metode bayar.
        </p>
      </ArticleSection>

      <ArticleSection id="membaca" title="Membaca halaman audit">
        <ol className="flex max-w-[72ch] flex-col">
          <Step n={1} title="Pilih rentang tanggal">
            Bawaannya 30 hari terakhir. Satu kali cek paling panjang 3 bulan.
          </Step>
          <Step n={2} title="Baca Ringkasan">
            Jumlah pasangan, nilai nota berlebih (penjualan yang tidak pernah terjadi), dan berapa
            yang tercatat tunai. Bagian tunai inilah yang membuat laci kas terlihat kurang.
          </Step>
          <Step n={3} title="Cek Dampak ke laci kas">
            Untuk setiap shift: saldo sistem saat tutup shift, dikurangi uang tunai dari nota ganda,
            menjadi saldo yang seharusnya. Angka penutupan shift sendiri tidak diubah.
          </Step>
          <Step n={4} title="Periksa Daftar lengkap nota ganda" last>
            Satu baris per pasangan. Jam dan kode <span className="text-destructive">merah</span>{" "}
            adalah nota kedua — yang perlu dibatalkan. Daftar dipotong di 500 pasangan; persempit
            tanggalnya kalau sampai batas itu.
          </Step>
        </ol>
      </ArticleSection>

      <ArticleSection id="membatalkan" title="Membatalkan nota kedua">
        <ol className="flex max-w-[72ch] flex-col">
          <Step n={1} title="Catat kode nota merah">
            Misalnya <Code>#A1B2C3D4</Code>. Klik kodenya untuk membuka rincian pesanan di tab baru
            bila ingin memastikan isinya.
          </Step>
          <Step n={2} title="Cari di Semua Pesanan">
            Buka{" "}
            <Link
              href="/dashboard/order-outlet"
              className="font-medium underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground"
            >
              Semua Pesanan
            </Link>{" "}
            (Dashboard → Pesanan Terbaru → Lihat Semua), lalu ketik kodenya tanpa tanda # di kolom
            cari.
          </Step>
          <Step n={3} title="Tahan tombol Batalkan 5 detik">
            Periksa kode dan nilainya di jendela konfirmasi, lalu setujui.
          </Step>
          <Step n={4} title="Muat ulang audit" last>
            Pasangan yang sudah dibatalkan hilang dari daftar.
          </Step>
        </ol>

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
              Pembatalan tidak bisa diurungkan
            </p>
            <p>
              Stok dikembalikan dan uangnya dicatat sebagai kas keluar “Pembatalan Order Kasir”.
              Pesanan aslinya tetap tersimpan di riwayat. Batalkan hanya nota yang bertanda{" "}
              <VerdictBadge verdict="likely" />, atau yang bertanda <VerdictBadge verdict="review" />{" "}
              setelah Anda yakin itu memang pesanan yang sama.
            </p>
          </div>
        </div>
      </ArticleSection>

      <p className="border-t pt-4.5 text-[13px] text-muted-foreground">
        Audit hanya bisa dibuka pemilik outlet — karyawan tidak, termasuk kasir yang shift-nya
        dibahas. Itu sebabnya halamannya tidak ada di menu samping.
      </p>
    </ArticleShell>
  );
}

function OpenAudit({ outlet }: { outlet?: { id: number; name: string } }) {
  if (!outlet) {
    return (
      <p className="rounded-xl border bg-card px-5 py-4 text-sm text-muted-foreground">
        Audit dibuka per outlet. Buat outlet dulu di{" "}
        <Link href="/dashboard/outlets" className="font-medium text-foreground underline underline-offset-2">
          Outlet Saya
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <p className="font-semibold">Audit Transaksi Ganda · {outlet.name}</p>
        <p className="max-w-[56ch] text-sm text-muted-foreground">
          Mengikuti outlet aktif Anda. Untuk outlet lain, pindah dulu lewat pemilih outlet di menu
          samping.
        </p>
      </div>
      <Link
        href={`/auditowners/${outlet.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Buka audit
        <ExternalLink className="size-4" aria-hidden />
        <span className="sr-only">(tab baru)</span>
      </Link>
    </div>
  );
}

function Cause({ n, text, critical }: { n: number; text: string; critical?: boolean }) {
  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-card p-4",
        critical && "border-destructive/40 bg-destructive/5",
      )}
    >
      <span
        className={cn(
          "font-mono text-xs font-semibold text-muted-foreground",
          critical && "text-destructive",
        )}
      >
        {n}
      </span>
      <p className="text-sm">{text}</p>
    </li>
  );
}

function Rule({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-1 rounded-xl border bg-card p-4">
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground">{children}</p>
    </li>
  );
}

type VerdictKind = "likely" | "review";

// Same colours and words as the audit page's Status column, so a badge read
// here is recognised there.
function VerdictBadge({ verdict }: { verdict: VerdictKind }) {
  return (
    <span
      className={cn(
        "inline-block rounded-sm px-1.5 py-0.5 text-[0.72rem] font-medium whitespace-nowrap",
        verdict === "review"
          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
          : "bg-destructive/10 text-destructive",
      )}
    >
      {verdict === "review" ? "Perlu dicek" : "Hampir pasti"}
    </span>
  );
}

function Verdict({
  condition,
  detail,
  verdict,
}: {
  condition: string;
  detail: string;
  verdict: VerdictKind;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 px-4 py-3">
      <span className="font-medium">{condition}</span>
      <span className="pt-0.5">
        <VerdictBadge verdict={verdict} />
      </span>
      <span className="col-span-2 text-sm text-muted-foreground">{detail}</span>
    </li>
  );
}

function Step({
  n,
  title,
  last,
  children,
}: {
  n: number;
  title: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className={cn("relative grid grid-cols-[30px_minmax(0,1fr)] gap-3.5", !last && "pb-5")}>
      {!last && (
        <span aria-hidden className="absolute top-7.5 bottom-0 left-3.5 w-0.5 bg-foreground/15" />
      )}
      <span className="grid size-7.5 place-items-center rounded-full border-[1.5px] border-foreground/20 bg-card font-mono text-[13px] font-semibold">
        {n}
      </span>
      <div className="flex flex-col gap-0.5 pt-1">
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground">{children}</code>
  );
}
