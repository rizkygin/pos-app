import Link from "next/link";
import {
  Store,
  Smartphone,
  Receipt,
  Boxes,
  BarChart3,
  Monitor,
  Wallet,
  Check,
  X,
  ArrowRight,
  Sparkles,
  Clock,
  ShieldCheck,
  Bike,
  FileBarChart,
} from "lucide-react";

// ============================================================================
// Public marketing landing page — static RSC (no client JS): everything here
// is indexable and instant. Pricing below is intentionally STATIC copy; the
// source of truth is apps/backend/src/db/seed-plans.ts — update both together.
// ============================================================================

const TIERS = [
  {
    name: "Basic",
    tagline: "Untuk usaha yang baru mulai",
    monthly: 30000,
    yearly: 324000,
    highlight: false,
    features: [
      { label: "1 outlet", ok: true },
      { label: "Kasir online & pesanan pelanggan", ok: true },
      { label: "Buku kas & laporan penjualan", ok: true },
      { label: "Faktur penjualan & pembelian", ok: false },
      { label: "Manajemen stok", ok: false },
      { label: "Aplikasi kasir desktop", ok: false },
    ],
  },
  {
    name: "Pro",
    tagline: "Paling pas untuk usaha berkembang",
    monthly: 80000,
    yearly: 756000,
    highlight: true,
    features: [
      { label: "1 outlet", ok: true },
      { label: "Kasir online & pesanan pelanggan", ok: true },
      { label: "Buku kas & laporan penjualan", ok: true },
      { label: "Faktur penjualan & pembelian", ok: true },
      { label: "Manajemen stok", ok: false },
      { label: "Aplikasi kasir desktop", ok: false },
    ],
  },
  {
    name: "Max Lite",
    tagline: "Multi-outlet + kasir desktop",
    monthly: 110000,
    yearly: 1080000,
    highlight: false,
    features: [
      { label: "2 outlet", ok: true },
      { label: "Kasir online & pesanan pelanggan", ok: true },
      { label: "Buku kas & semua laporan", ok: true },
      { label: "Faktur penjualan & pembelian", ok: true },
      { label: "Manajemen stok", ok: true },
      { label: "Aplikasi kasir desktop", ok: true },
    ],
  },
  {
    name: "Max",
    tagline: "Paket terlengkap",
    monthly: 200000,
    yearly: 1944000,
    highlight: false,
    features: [
      { label: "3 outlet", ok: true },
      { label: "Kasir online & pesanan pelanggan", ok: true },
      { label: "Buku kas & semua laporan", ok: true },
      { label: "Faktur penjualan & pembelian", ok: true },
      { label: "Manajemen stok", ok: true },
      { label: "Aplikasi kasir desktop", ok: true },
    ],
  },
];

const FEATURES = [
  {
    icon: Store,
    title: "Kasir Cepat (POS)",
    body: "Ring up penjualan dalam hitungan detik — multi-tab pesanan, diskon, struk thermal, dan mode uang pas.",
  },
  {
    icon: Smartphone,
    title: "Pesanan Online",
    body: "Pelanggan pesan langsung dari HP lewat halaman menu outlet Pian — tanpa install aplikasi.",
  },
  {
    icon: Bike,
    title: "Pengantaran Kurir",
    body: "Pesanan delivery tersambung ke kurir, lengkap dengan pelacakan status sampai diterima.",
  },
  {
    icon: Receipt,
    title: "Faktur Jual & Beli",
    body: "Faktur penjualan dan pembelian dengan DP, cicilan, jatuh tempo, dan cetak PDF profesional.",
  },
  {
    icon: Boxes,
    title: "Manajemen Stok",
    body: "Stok otomatis berkurang saat terjual — termasuk resep/bahan baku, opname, dan riwayat pergerakan.",
  },
  {
    icon: Wallet,
    title: "Buku Kas",
    body: "Semua uang masuk dan keluar tercatat rapi, tersambung otomatis dari kasir dan faktur.",
  },
  {
    icon: BarChart3,
    title: "Laporan Lengkap",
    body: "Laporan penjualan harian/bulanan dan laporan faktur — tahu untung Pian tanpa hitung manual.",
  },
  {
    icon: Monitor,
    title: "Aplikasi Kasir Desktop",
    body: "Kasir native untuk komputer toko: lebih cepat, tetap jalan, dan printer thermal langsung tersambung.",
  },
];

const FAQS = [
  {
    q: "Bagaimana cara pembayarannya?",
    a: "Transfer bank manual dengan nominal unik — konfirmasi biasanya kurang dari 24 jam setelah bukti transfer diunggah. Tanpa kartu kredit.",
  },
  {
    q: "Apakah ada masa percobaan?",
    a: "Ada — gratis 14 hari dengan semua fitur, tanpa perlu membayar dulu. Masa percobaan tidak hangus jika Pian membayar lebih awal.",
  },
  {
    q: "Bisa ganti paket di tengah jalan?",
    a: "Bisa kapan saja. Upgrade berlaku langsung dan sisa masa aktif dikonversi jadi hari bonus; downgrade mulai setelah paket berjalan selesai — tidak ada yang hangus.",
  },
  {
    q: "Perlu install aplikasi?",
    a: "Tidak — semuanya jalan di browser HP atau komputer. Aplikasi kasir desktop tersedia sebagai tambahan di paket Max Lite dan Max.",
  },
];

const rupiah = (v: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(v);

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* SoftwareApplication JSON-LD: price-range rich result eligibility. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "Ulun Pesan",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web",
            description:
              "Aplikasi kasir (POS) dan pemesanan online untuk usaha lokal.",
            offers: {
              "@type": "AggregateOffer",
              priceCurrency: "IDR",
              lowPrice: 30000,
              highPrice: 200000,
            },
          }),
        }}
      />

      {/* ================= navbar ================= */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="text-lg font-black tracking-tight">
            Ulun<span className="text-rose-600">Pesan</span>
          </Link>
          <div className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
            <a href="#fitur" className="transition-colors hover:text-foreground">Fitur</a>
            <a href="#cara-kerja" className="transition-colors hover:text-foreground">Cara Kerja</a>
            <a href="#harga" className="transition-colors hover:text-foreground">Harga</a>
            <a href="#faq" className="transition-colors hover:text-foreground">FAQ</a>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-xl px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              Masuk
            </Link>
            <Link
              href="/login"
              className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-rose-700"
            >
              Coba Gratis
            </Link>
          </div>
        </nav>
      </header>

      {/* ================= hero ================= */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 left-1/2 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-gradient-to-br from-rose-500/15 to-pink-500/10 blur-[100px]" />
        <div className="mx-auto max-w-4xl px-4 pb-16 pt-20 text-center md:pb-24 md:pt-28">
          <p className="mx-auto mb-4 inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
            <Sparkles className="size-3.5" /> Gratis 14 hari — tanpa kartu kredit
          </p>
          <h1 className="text-4xl font-black leading-tight tracking-tight md:text-6xl">
            Kasir, pesanan online, dan pembukuan —{" "}
            <span className="bg-gradient-to-r from-rose-600 to-pink-600 bg-clip-text text-transparent">
              satu aplikasi
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground md:text-lg">
            Ulun Pesan membantu usaha lokal melayani pelanggan lebih cepat:
            kasir POS, menu online untuk pelanggan, pengantaran kurir, faktur,
            stok, dan laporan — mulai dari {rupiah(30000)}/bulan.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-rose-600 to-pink-600 px-7 py-3.5 text-base font-bold text-white shadow-lg shadow-rose-600/25 transition-transform hover:-translate-y-0.5"
            >
              Mulai Gratis Sekarang <ArrowRight className="size-4" />
            </Link>
            <a
              href="#harga"
              className="inline-flex items-center gap-2 rounded-2xl border-2 px-7 py-3.5 text-base font-bold transition-colors hover:bg-muted"
            >
              Lihat Harga
            </a>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium text-muted-foreground">
            <span className="flex items-center gap-1.5"><Clock className="size-3.5 text-rose-500" /> Siap pakai dalam 5 menit</span>
            <span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-rose-500" /> Data usaha Pian aman</span>
            <span className="flex items-center gap-1.5"><Smartphone className="size-3.5 text-rose-500" /> Jalan di HP & komputer</span>
          </div>
        </div>
      </section>

      {/* ================= features ================= */}
      <section id="fitur" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 md:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-black tracking-tight md:text-4xl">
            Semua yang usaha Pian butuhkan
          </h2>
          <p className="mt-3 text-muted-foreground">
            Dari melayani pembeli di depan toko sampai pembukuan di belakang —
            tidak perlu banyak aplikasi lagi.
          </p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border p-5 transition-shadow hover:shadow-md">
              <div className="mb-3 inline-flex rounded-xl bg-rose-100 p-2.5 dark:bg-rose-950">
                <f.icon className="size-5 text-rose-600 dark:text-rose-400" />
              </div>
              <h3 className="font-bold">{f.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ================= how it works ================= */}
      <section id="cara-kerja" className="scroll-mt-20 border-y bg-muted/30 py-16 md:py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-black tracking-tight md:text-4xl">Mulai dalam 3 langkah</h2>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              {
                n: "1",
                t: "Daftar & buat outlet",
                b: "Daftar gratis, isi nama usaha dan lokasi — langsung dapat halaman menu online sendiri.",
              },
              {
                n: "2",
                t: "Tambahkan produk",
                b: "Masukkan produk, harga, dan stok. Foto produk bikin menu online Pian makin menarik.",
              },
              {
                n: "3",
                t: "Terima pesanan & jualan",
                b: "Layani pembeli lewat kasir, terima pesanan online, dan pantau untung dari laporan.",
              },
            ].map((s) => (
              <div key={s.n} className="relative rounded-2xl border bg-background p-6">
                <span className="absolute -top-4 left-6 flex size-8 items-center justify-center rounded-full bg-gradient-to-r from-rose-600 to-pink-600 text-sm font-black text-white shadow">
                  {s.n}
                </span>
                <h3 className="mt-2 font-bold">{s.t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ================= pricing ================= */}
      <section id="harga" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 md:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-black tracking-tight md:text-4xl">Harga jujur, tanpa biaya tersembunyi</h2>
          <p className="mt-3 text-muted-foreground">
            Semua paket termasuk masa percobaan gratis 14 hari. Bayar tahunan
            hemat sampai 21%.
          </p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`relative flex flex-col rounded-3xl border-2 p-5 ${
                t.highlight
                  ? "border-rose-500 bg-gradient-to-b from-rose-50/80 to-transparent dark:from-rose-950/30"
                  : "border-border"
              }`}
            >
              {t.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-rose-500 to-pink-600 px-3 py-0.5 text-[10px] font-black uppercase tracking-wider text-white shadow">
                  Terpopuler
                </span>
              )}
              <p className="text-sm font-black uppercase tracking-wide">{t.name}</p>
              <p className="mt-0.5 min-h-8 text-[11px] leading-snug text-muted-foreground">{t.tagline}</p>
              <p className="mt-3">
                <span className="text-2xl font-black tabular-nums tracking-tight">{rupiah(t.monthly)}</span>
                <span className="text-xs text-muted-foreground">/bln</span>
              </p>
              <p className="text-[11px] text-muted-foreground">
                atau {rupiah(t.yearly)}/tahun
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-xs">
                {t.features.map((f) => (
                  <li key={f.label} className="flex items-center gap-2">
                    {f.ok ? (
                      <Check className="size-3.5 shrink-0 text-rose-500" />
                    ) : (
                      <X className="size-3.5 shrink-0 text-muted-foreground/50" />
                    )}
                    <span className={f.ok ? "" : "text-muted-foreground/60 line-through"}>{f.label}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/login"
                className={`mt-4 rounded-xl py-2.5 text-center text-sm font-bold transition-colors ${
                  t.highlight
                    ? "bg-gradient-to-r from-rose-600 to-pink-600 text-white hover:from-rose-700 hover:to-pink-700"
                    : "border-2 border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                }`}
              >
                Coba Gratis 14 Hari
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* ================= FAQ ================= */}
      <section id="faq" className="border-t bg-muted/30 py-16 md:py-20">
        <div className="mx-auto max-w-3xl scroll-mt-20 px-4">
          <h2 className="text-center text-2xl font-black tracking-tight md:text-4xl">
            Pertanyaan yang sering ditanya
          </h2>
          <div className="mt-8 space-y-3">
            {FAQS.map((f) => (
              <details key={f.q} className="group rounded-2xl border bg-background p-5">
                <summary className="cursor-pointer list-none font-bold marker:hidden">
                  {f.q}
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ================= final CTA ================= */}
      <section className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-rose-500 via-rose-600 to-pink-600 p-8 text-center text-white md:p-14">
          <Sparkles className="pointer-events-none absolute -right-8 -top-8 size-44 opacity-10" />
          <h2 className="text-2xl font-black tracking-tight md:text-4xl">
            Usaha Pian siap naik kelas?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-white/85 md:text-base">
            Coba semua fitur gratis 14 hari. Tanpa kartu kredit, tanpa ribet —
            batal kapan saja.
          </p>
          <Link
            href="/login"
            className="mt-7 inline-flex items-center gap-2 rounded-2xl bg-white px-7 py-3.5 text-base font-bold text-rose-600 shadow-lg transition-transform hover:-translate-y-0.5"
          >
            Daftar Sekarang <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      {/* ================= footer ================= */}
      <footer className="border-t py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground md:flex-row">
          <p>
            <span className="font-black text-foreground">Ulun<span className="text-rose-600">Pesan</span></span>{" "}
            — kasir & pemesanan online untuk usaha lokal.
          </p>
          <div className="flex items-center gap-5">
            <a href="#fitur" className="transition-colors hover:text-foreground">Fitur</a>
            <a href="#harga" className="transition-colors hover:text-foreground">Harga</a>
            <Link href="/login" className="transition-colors hover:text-foreground">Masuk</Link>
          </div>
          <p className="text-xs">© {new Date().getFullYear()} Ulun Pesan</p>
        </div>
      </footer>
    </main>
  );
}
