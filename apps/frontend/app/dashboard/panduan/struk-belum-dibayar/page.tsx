import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CircleCheck, TriangleAlert } from "lucide-react";
import { getOutlet } from "@/lib/utils/get-role";
import { cn } from "@/lib/utils";
import { PRINT_LOG_REPORT, PRINT_PENDING_MINUTES, SLIP_STATUS, type SlipStatus } from "@/lib/print-log";
import { ArticleSection, ArticleShell } from "../article-shell";

export const metadata: Metadata = {
  title: "Cara cek struk yang belum dibayar · Panduan",
};

/*
 * A guide to /dashboard/reports/struk. The rules quoted here are the backend's,
 * so change this page when they change (lib/print-log.ts, routes/print-logs.ts):
 *
 *   logged: each press of Cetak on the cashier's pre-checkout struk (counter or
 *   table tab) and on Manajemen Meja's Cetak Bill; opening the preview is not;
 *   paid = checkout claims the slip BY CART LINE (counter: same tab + a printed
 *   line in the sale; table: a printed line the sale settled), never by tab;
 *   PRINT_PENDING_MINUTES = 60, range cap 93 days, 2000 prints per report,
 *   reprints of the same cart fold into one slip, "short" compares units per
 *   menu item (add-ons ride with their item) — a table slip against everything
 *   its seating paid, so a bill printed whole and paid split is not short; a
 *   cancelled table bill that goes back on the table makes its slips unpaid
 *   again until re-paid; report is owner only.
 *
 * The status words and colours come from SLIP_STATUS, the same map the report
 * uses, so a badge read here is the one seen there.
 */

export default async function StrukBelumDibayarGuide() {
  const outlet = (await getOutlet()).result[0] as { id: number; name: string } | undefined;

  return (
    <ArticleShell
      category="Kasir"
      title="Cara cek struk yang belum dibayar"
      lede={
        <p>
          Tombol printer di samping Checkout mencetak struk pelanggan <em>sebelum</em> penjualan
          tercatat. Kalau struk sudah diberikan dan uang sudah diterima, tetapi Checkout tidak pernah
          ditekan, penjualan itu tidak ada di laporan — dan uangnya tidak ada di laci. Laporan{" "}
          <strong className="font-semibold text-foreground">Struk Belum Dibayar</strong> menunjukkan
          setiap struk seperti itu, lengkap dengan jam dan nama kasir yang mencetaknya.
        </p>
      }
    >
      <OpenReport outlet={outlet} />

      <ArticleSection
        id="dicatat"
        title="Yang dicatat"
        intro={<p>Setiap kali tombol Cetak ditekan pada struk yang meminta pembayaran:</p>}
      >
        <ul className="grid gap-3 md:grid-cols-3">
          <Rule title="Struk kasir sebelum Checkout">
            Tombol printer di samping Checkout di halaman Kasir — di tab biasa maupun tab meja.
          </Rule>
          <Rule title="Cetak Bill di Manajemen Meja">
            Bill seluruh meja atau bill terpisah (A, B, …) yang diberikan ke tamu.
          </Rule>
          <Rule title="Setiap cetakan">
            Cetak ulang ikut tercatat. Membuka pratinjau struk tanpa menekan Cetak tidak dihitung.
          </Rule>
        </ul>
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          Yang disimpan: isi struk, totalnya, jam cetak, dan akun yang mencetak. Struk yang tercetak
          setelah Checkout dan Tiket Dapur tidak masuk laporan ini — penjualannya sudah tercatat, atau
          tidak ada uang yang diminta. Struk yang dicetak sebelum fitur ini aktif tidak tercatat.
        </p>
      </ArticleSection>

      <ArticleSection id="lunas" title="Kapan struk dianggap lunas">
        <ol className="flex max-w-[72ch] flex-col">
          <Step n={1} title="Kasir mencetak struk">
            Struk tersimpan dengan status belum dibayar.
          </Step>
          <Step n={2} title="Pesanan yang sama di-Checkout">
            Struk mendapat nomor pesanannya dan dianggap lunas.
          </Step>
          <Step n={3} title="Dicocokkan per item, bukan per tab" last>
            Struk hanya lunas oleh Checkout yang berisi item dari keranjang yang dicetak itu. Kalau
            keranjang dikosongkan lalu tab yang sama dipakai untuk pelanggan lain, struk lama tetap
            belum dibayar. Bill meja lunas saat itemnya dibayar di kasir — juga setelah meja digabung
            atau itemnya dipindah.
          </Step>
        </ol>
        <div className="flex items-start gap-3 rounded-xl bg-emerald-50 px-4.5 py-4 dark:bg-emerald-950/30">
          <CircleCheck className="mt-0.5 size-4.5 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />
          <div className="text-sm">
            <p className="mb-0.5 font-semibold text-emerald-800 dark:text-emerald-300">Cetak ulang dihitung satu</p>
            <p>
              Struk yang sama dicetak dua kali muncul sebagai satu baris dengan keterangan
              “dicetak 2×”, dan nilainya dihitung sekali.
            </p>
          </div>
        </div>
      </ArticleSection>

      <ArticleSection id="status" title="Arti setiap status">
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-muted/50 px-4 py-2.5 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            <span>Keadaan struk</span>
            <span>Status</span>
          </div>
          <ul className="divide-y">
            <Verdict
              status="unpaid"
              condition={`Tidak pernah di-Checkout, dicetak lebih dari ${PRINT_PENDING_MINUTES} menit lalu`}
              detail="Pelanggan memegang struk, tetapi penjualannya tidak ada. Tanyakan ke kasir: pesanannya batal, atau uangnya ke mana?"
            />
            <Verdict
              status="short"
              condition="Di-Checkout, tetapi dengan item lebih sedikit dari yang tercetak"
              detail="Laporan menulis item yang tidak ditagih dan nilainya. Bisa karena pelanggan membatalkan satu item — atau struk lengkap ditagih, Checkout hanya sebagian. Bill meja dihitung dari semua pembayaran meja itu, jadi bill yang dibayar terpisah tidak dianggap kurang."
            />
            <Verdict
              status="cancelled"
              condition="Sudah di-Checkout, lalu pesanannya dibatalkan"
              detail="Pastikan uangnya memang dikembalikan ke pelanggan."
            />
            <Verdict
              status="pending"
              condition={`Belum di-Checkout, dicetak kurang dari ${PRINT_PENDING_MINUTES} menit lalu`}
              detail="Wajar untuk pola bayar dulu: uang diterima, makanan diantar, baru Checkout. Cek lagi nanti."
            />
            <Verdict status="paid" condition="Semua item di struk tertagih" detail="Tidak perlu tindakan." />
          </ul>
        </div>
      </ArticleSection>

      <ArticleSection id="membaca" title="Membaca laporan">
        <ol className="flex max-w-[72ch] flex-col">
          <Step n={1} title="Pilih rentang tanggal">
            Bawaannya 7 hari terakhir. Satu kali cek paling panjang 3 bulan.
          </Step>
          <Step n={2} title="Baca ringkasan">
            Nilai struk Belum Dibayar, nilai item yang Kurang Ditagih, struk yang Dibatalkan setelah
            dibayar, dan jumlah seluruh struk yang dicetak.
          </Step>
          <Step n={3} title="Saring daftarnya">
            Bawaannya <Badge status="unpaid" />, <Badge status="short" />, dan{" "}
            <Badge status="cancelled" /> saja. Pilih Menunggu, Lunas, atau Semua untuk melihat
            sisanya.
          </Step>
          <Step n={4} title="Periksa tiap baris" last>
            Jam cetak, kasir yang mencetak, nama pelanggan dan nomor meja atau pager, isi struk,
            totalnya, dan nomor pesanan bila sudah di-Checkout.
          </Step>
        </ol>
      </ArticleSection>

      <ArticleSection
        id="menutup"
        title="Menutup celahnya"
        intro={
          <p>
            Kalau struk sebelum Checkout tidak dibutuhkan di outlet Anda, sembunyikan tombolnya di{" "}
            <Link
              href="/dashboard/setting#struk-awal"
              className="font-medium text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground"
            >
              Pengaturan Outlet → Struk Sebelum Checkout
            </Link>
            .
          </p>
        }
      >
        <ul className="grid gap-3 md:grid-cols-3">
          <Rule title="Struk hanya setelah Checkout">
            Pelanggan baru memegang struk setelah penjualannya tercatat.
          </Rule>
          <Rule title="Bayar dulu tetap bisa">
            Untuk pola pager, kasir menekan Checkout saat menerima uang, bukan saat makanan diantar.
          </Rule>
          <Rule title="Yang tidak berubah">
            Tiket Dapur tetap bisa dicetak. Cetak Bill di Manajemen Meja tetap ada, dan tetap
            tercatat.
          </Rule>
        </ul>

        <div role="note" className="flex items-start gap-3 rounded-xl bg-amber-50 px-4.5 py-4 dark:bg-amber-950/30">
          <TriangleAlert className="mt-0.5 size-4.5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
          <div className="text-sm">
            <p className="mb-0.5 font-semibold text-amber-800 dark:text-amber-300">
              Yang tidak terlihat di laporan ini
            </p>
            <p>
              Penjualan yang sama sekali tidak dicetak — tanpa struk, tanpa Tiket Dapur — tidak
              meninggalkan jejak apa pun. Laporan ini menutup celah struk, bukan semua celah.
              Menghitung laci di setiap tutup shift (Laporan Shift) tetap cara utama memastikan uang
              yang diterima sama dengan yang tercatat.
            </p>
          </div>
        </div>
      </ArticleSection>

      <p className="border-t pt-4.5 text-[13px] text-muted-foreground">
        Laporan ini hanya bisa dibuka pemilik outlet — karyawan tidak, termasuk kasir yang namanya
        tercantum di dalamnya.
      </p>
    </ArticleShell>
  );
}

function OpenReport({ outlet }: { outlet?: { id: number; name: string } }) {
  if (!outlet) {
    return (
      <p className="rounded-xl border bg-card px-5 py-4 text-sm text-muted-foreground">
        Laporan dibuka per outlet. Buat outlet dulu di{" "}
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
        <p className="font-semibold">Struk Belum Dibayar · {outlet.name}</p>
        <p className="max-w-[56ch] text-sm text-muted-foreground">
          Ada di Laporan. Mengikuti outlet aktif Anda — untuk outlet lain, pindah dulu lewat pemilih
          outlet di menu samping.
        </p>
      </div>
      <Link
        href={PRINT_LOG_REPORT}
        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Buka laporan
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </div>
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

function Badge({ status }: { status: SlipStatus }) {
  const s = SLIP_STATUS[status];
  return (
    <span className={cn("inline-block rounded-sm px-1.5 py-0.5 text-[0.72rem] font-semibold whitespace-nowrap", s.className)}>
      {s.label}
    </span>
  );
}

function Verdict({ status, condition, detail }: { status: SlipStatus; condition: string; detail: string }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 px-4 py-3">
      <span className="font-medium">{condition}</span>
      <span className="pt-0.5">
        <Badge status={status} />
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
      {!last && <span aria-hidden className="absolute top-7.5 bottom-0 left-3.5 w-0.5 bg-foreground/15" />}
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
