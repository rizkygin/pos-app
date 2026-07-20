import Link from "next/link";
import Image from "next/image";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_API_URL } from "@/lib/api-url";
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
      { label: "1 akun karyawan", ok: true },
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
      { label: "3 akun karyawan", ok: true },
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
      { label: "5 akun karyawan", ok: true },
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
      { label: "5 akun karyawan", ok: true },
      { label: "Kasir online & pesanan pelanggan", ok: true },
      { label: "Buku kas & semua laporan", ok: true },
      { label: "Faktur penjualan & pembelian", ok: true },
      { label: "Manajemen stok", ok: true },
      { label: "Aplikasi kasir desktop", ok: true },
    ],
  },
];

// Accent chips follow the app sidebar's convention: black is the base, and
// rose/emerald/violet/orange do the playful identity work.
const ACCENTS = [
  { bg: "bg-rose-500/15", text: "text-rose-400" },
  { bg: "bg-emerald-500/15", text: "text-emerald-400" },
  { bg: "bg-violet-500/15", text: "text-violet-400" },
  { bg: "bg-orange-500/15", text: "text-orange-400" },
];

const FEATURES = [
  {
    icon: Store,
    title: "Kasir Cepat (POS)",
    body: "Ring up penjualan dalam hitungan detik, multi-tab pesanan, diskon, struk thermal, dan mode uang pas.",
  },
  {
    icon: Smartphone,
    title: "Pesanan Online",
    body: "Pelanggan pesan langsung dari HP lewat halaman menu outlet Pian, tanpa install aplikasi.",
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
    body: "Stok otomatis berkurang saat terjual, termasuk resep/bahan baku, opname, dan riwayat pergerakan.",
  },
  {
    icon: Wallet,
    title: "Buku Kas",
    body: "Semua uang masuk dan keluar tercatat rapi, tersambung otomatis dari kasir dan faktur.",
  },
  {
    icon: BarChart3,
    title: "Laporan Lengkap",
    body: "Laporan penjualan harian/bulanan dan laporan faktur, tahu untung Pian tanpa hitung manual.",
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
    a: "Transfer bank manual dengan nominal unik, konfirmasi biasanya kurang dari 24 jam setelah bukti transfer diunggah. Tanpa kartu kredit.",
  },
  {
    q: "Apakah ada masa percobaan?",
    a: "Ada. Gratis 14 hari dengan semua fitur, tanpa perlu membayar dulu. Masa percobaan tidak hangus jika Pian membayar lebih awal.",
  },
  {
    q: "Bisa ganti paket di tengah jalan?",
    a: "Bisa kapan saja. Upgrade berlaku langsung dan sisa masa aktif dikonversi jadi hari bonus; downgrade mulai setelah paket berjalan selesai, tidak ada yang hangus.",
  },
  {
    q: "Perlu install aplikasi?",
    a: "Tidak, semuanya jalan di browser HP atau komputer. Aplikasi kasir desktop tersedia sebagai tambahan di paket Max Lite dan Max.",
  },
];

const rupiah = (v: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(v);

// GitHub-style framed app window: hairline chrome bar + traffic dots, sitting
// on a soft multi-color glow. Purely presentational.
function WindowFrame({
  src,
  alt,
  width,
  height,
  glow,
  priority = false,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  glow: string;
  priority?: boolean;
}) {
  return (
    <div className="relative">
      <div
        className={`pointer-events-none absolute -inset-6 rounded-[2rem] blur-[60px] ${glow}`}
      />
      <div className="relative overflow-hidden rounded-xl border border-white/15 bg-[#111118] shadow-2xl">
        <div className="flex items-center gap-1.5 border-b border-white/10 bg-white/[0.04] px-3 py-2">
          <span className="size-2.5 rounded-full bg-rose-500/80" />
          <span className="size-2.5 rounded-full bg-amber-500/80" />
          <span className="size-2.5 rounded-full bg-emerald-500/80" />
          <span className="ml-3 hidden rounded-md bg-white/5 px-2 py-0.5 text-[10px] text-zinc-500 sm:block">
            ulunpesan.com/dashboard
          </span>
        </div>
        <Image src={src} alt={alt} width={width} height={height} priority={priority} className="w-full" />
      </div>
    </div>
  );
}

function PhoneFrame({
  src,
  alt,
  width,
  height,
  caption,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption: string;
}) {
  return (
    <figure className="flex flex-col items-center gap-3">
      <div className="overflow-hidden rounded-[1.6rem] border border-white/15 bg-[#111118] p-1.5 shadow-xl">
        <Image src={src} alt={alt} width={width} height={height} className="w-full max-w-60 rounded-[1.1rem]" />
      </div>
      <figcaption className="text-xs text-zinc-400">{caption}</figcaption>
    </figure>
  );
}

// Alternating text + screenshot showcase rows (real product, real data).
const SHOWCASES = [
  {
    title: "Faktur profesional dalam satu menit",
    body: "Susun faktur penjualan atau pembelian langsung dari daftar produk, lengkap dengan DP, diskon per-item, pajak, jatuh tempo, dan cetak PDF.",
    src: "/landing/faktur.webp",
    w: 1600,
    h: 831,
    glow: "bg-emerald-600/15",
  },
  {
    title: "Tahu piutang & hutang tanpa buka buku",
    body: "Laporan Faktur merangkum faktur terbit, yang sudah dibayar, piutang berjalan, sampai siapa yang terlambat, per hari, minggu, atau bulan.",
    src: "/landing/laporan.webp",
    w: 1600,
    h: 831,
    glow: "bg-violet-600/15",
  },
  {
    title: "Semua uang bermuara ke Buku Kas",
    body: "Penjualan kasir dan pembayaran faktur tercatat otomatis, Pian tinggal menambah pengeluaran, dan posisi kas harian/bulanan selalu akurat.",
    src: "/landing/bukukas.webp",
    w: 1600,
    h: 839,
    glow: "bg-rose-600/15",
  },
  {
    title: "Stok terpotong sendiri, bahkan lewat resep",
    body: "Produk olahan bisa punya resep bahan. Jual 1 porsi, stok mie dan telurnya berkurang otomatis. Opname dan riwayat pergerakan tersedia.",
    src: "/landing/stok-resep.webp",
    w: 1000,
    h: 1025,
    glow: "bg-orange-500/15",
  },
];

// Returning users skip the marketing page: a valid session goes straight to
// the dashboard. Sessionless visitors (and crawlers — SEO unaffected) get the
// landing; the cookie sniff avoids a backend round-trip for them.
async function hasSession() {
  const cookie = (await headers()).get("cookie") ?? "";
  if (!cookie.includes("auth_session")) return false;
  const res = await fetch(`${SERVER_API_URL}/api/auth/get-session`, {
    headers: { cookie },
    cache: "no-store",
  }).catch(() => null);
  if (!res?.ok) return false;
  const data = await res.json().catch(() => null);
  return !!data?.user;
}

export default async function LandingPage() {
  if (await hasSession()) redirect("/dashboard");
  return (
    <main className="min-h-screen bg-[#0a0a0f] text-white">
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
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0a0a0f]/80 backdrop-blur">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="text-lg font-black tracking-tight">
            UlunPesan
          </Link>
          <div className="hidden items-center gap-6 text-sm font-medium text-zinc-400 md:flex">
            <a href="#fitur" className="transition-colors hover:text-white">Fitur</a>
            <a href="#cara-kerja" className="transition-colors hover:text-white">Cara Kerja</a>
            <a href="#harga" className="transition-colors hover:text-white">Harga</a>
            <a href="#faq" className="transition-colors hover:text-white">FAQ</a>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-xl px-4 py-2 text-sm font-semibold text-zinc-300 transition-colors hover:text-white"
            >
              Masuk
            </Link>
            <Link
              href="/login"
              className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-zinc-950 shadow-sm transition-opacity hover:opacity-85"
            >
              Coba Gratis
            </Link>
          </div>
        </nav>
      </header>

      {/* ================= hero ================= */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 left-1/4 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-rose-600/20 blur-[120px]" />
        <div className="pointer-events-none absolute -top-10 right-0 h-[380px] w-[380px] rounded-full bg-violet-600/20 blur-[120px]" />
        <div className="pointer-events-none absolute top-64 left-1/2 h-[300px] w-[500px] -translate-x-1/2 rounded-full bg-orange-500/10 blur-[120px]" />
        <div className="mx-auto max-w-4xl px-4 pb-16 pt-20 text-center md:pb-24 md:pt-28">
          <p className="mx-auto mb-4 inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-bold text-rose-300">
            <Sparkles className="size-3.5" /> Gratis 14 hari — tanpa kartu kredit
          </p>
          <h1 className="text-4xl font-black leading-tight tracking-tight md:text-7xl">
            Kasir, pesanan online, dan pembukuan dalam{" "}
            <span className="bg-gradient-to-r from-rose-400 via-violet-400 to-orange-300 bg-clip-text text-transparent">
              satu aplikasi
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-zinc-400 md:text-lg">
            Ulun Pesan membantu usaha lokal melayani pelanggan lebih cepat:
            kasir POS, menu online untuk pelanggan, pengantaran kurir, faktur,
            stok, dan laporan mulai dari {rupiah(30000)}/bulan.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-7 py-3.5 text-base font-bold text-zinc-950 shadow-lg shadow-white/10 transition-transform hover:-translate-y-0.5"
            >
              Mulai Gratis Sekarang <ArrowRight className="size-4" />
            </Link>
            <a
              href="#harga"
              className="inline-flex items-center gap-2 rounded-2xl border-2 border-white/20 px-7 py-3.5 text-base font-bold text-white transition-colors hover:bg-white/10"
            >
              Lihat Harga
            </a>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium text-zinc-400">
            <span className="flex items-center gap-1.5"><Clock className="size-3.5 text-orange-500" /> Siap pakai dalam 5 menit</span>
            <span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-emerald-500" /> Data usaha Pian aman</span>
            <span className="flex items-center gap-1.5"><Smartphone className="size-3.5 text-violet-500" /> Jalan di HP & komputer</span>
          </div>
        </div>

        {/* the product, front and center — real outlet, real data */}
        <div className="mx-auto max-w-5xl px-4 pb-20">
          <WindowFrame
            src="/landing/kasir.webp"
            alt="Kasir (POS) Ulun Pesan dengan produk dan keranjang"
            width={1600}
            height={1012}
            glow="bg-gradient-to-r from-rose-600/20 via-violet-600/15 to-orange-500/15"
            priority
          />
        </div>
      </section>

      {/* ================= features ================= */}
      <section id="fitur" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 md:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-black tracking-tight md:text-4xl">
            Semua yang usaha Pian butuhkan
          </h2>
          <p className="mt-3 text-zinc-400">
            Dari melayani pembeli di depan toko sampai pembukuan di belakang —
            tidak perlu banyak aplikasi lagi.
          </p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <div key={f.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-white/25 hover:bg-white/[0.06]">
              <div className={`mb-3 inline-flex rounded-xl p-2.5 ${ACCENTS[i % ACCENTS.length].bg}`}>
                <f.icon className={`size-5 ${ACCENTS[i % ACCENTS.length].text}`} />
              </div>
              <h3 className="font-bold">{f.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ================= showcases: real screenshots ================= */}
      <section className="mx-auto max-w-6xl space-y-16 px-4 py-16 md:space-y-24 md:py-20">
        {SHOWCASES.map((sc, i) => (
          <div key={sc.title} className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
            <div className={i % 2 === 1 ? "md:order-2" : ""}>
              <h3 className="text-xl font-black tracking-tight md:text-3xl">{sc.title}</h3>
              <p className="mt-3 leading-relaxed text-zinc-400">{sc.body}</p>
            </div>
            <div className={i % 2 === 1 ? "md:order-1" : ""}>
              <WindowFrame src={sc.src} alt={sc.title} width={sc.w} height={sc.h} glow={sc.glow} />
            </div>
          </div>
        ))}
      </section>

      {/* ================= how it works ================= */}
      <section id="cara-kerja" className="scroll-mt-20 border-y border-white/10 bg-white/[0.02] py-16 md:py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-black tracking-tight md:text-4xl">Mulai dalam 3 langkah</h2>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              {
                n: "1",
                t: "Daftar & buat outlet",
                b: "Daftar gratis, isi nama usaha dan lokasi, langsung dapat halaman menu online sendiri.",
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
            ].map((s, i) => (
              <div key={s.n} className="relative rounded-2xl border border-white/10 bg-[#0a0a0f] p-6">
                <span
                  className={`absolute -top-4 left-6 flex size-8 items-center justify-center rounded-full text-sm font-black text-white shadow ${
                    ["bg-emerald-600", "bg-orange-500", "bg-violet-600"][i]
                  }`}
                >
                  {s.n}
                </span>
                <h3 className="mt-2 font-bold">{s.t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{s.b}</p>
              </div>
            ))}
          </div>

          {/* satu ekosistem: pemilik, pelanggan, kurir */}
          <div className="mx-auto mt-16 max-w-2xl text-center">
            <h3 className="text-xl font-black tracking-tight md:text-2xl">
              Bukan cuma untuk pemilik usaha
            </h3>
            <p className="mt-2 text-sm text-zinc-400">
              Ulun Pesan menghubungkan tiga sisi — usaha Pian, pelanggan, dan
              kurir — dalam satu ekosistem.
            </p>
          </div>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-[#0a0a0f] p-6">
              <div className="mb-3 inline-flex rounded-xl bg-violet-500/15 p-2.5">
                <Smartphone className="size-5 text-violet-400" />
              </div>
              <h4 className="font-bold">Untuk Pelanggan</h4>
              <ul className="mt-3 space-y-2 text-sm text-zinc-400">
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-violet-400" />
                  Buka halaman menu outlet dan pesan langsung dari HP — tanpa
                  install aplikasi apa pun.
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-violet-400" />
                  Pantau status pesanan dari dikonfirmasi, disiapkan, sampai
                  diantar ke depan pintu.
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-violet-400" />
                  Beri rating untuk outlet, produk, dan kurir — bantu usaha
                  lokal favorit makin dikenal.
                </li>
              </ul>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#0a0a0f] p-6">
              <div className="mb-3 inline-flex rounded-xl bg-orange-500/15 p-2.5">
                <Bike className="size-5 text-orange-400" />
              </div>
              <h4 className="font-bold">Untuk Kurir</h4>
              <ul className="mt-3 space-y-2 text-sm text-zinc-400">
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-orange-400" />
                  Daftar gratis sebagai mitra kurir — cukup motor atau mobil
                  dan nomor plat kendaraan.
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-orange-400" />
                  Ambil orderan dari ruang tunggu saat Pian online — antar
                  pesanan, dapat penghasilan.
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-orange-400" />
                  Kumpulkan rating dari pelanggan — kurir terbaik makin
                  dipercaya, makin sering dapat orderan.
                </li>
              </ul>
              <Link
                href="/login"
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-orange-400 transition-colors hover:text-orange-300"
              >
                Daftar jadi kurir <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ================= mobile strip ================= */}
      <section className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-black tracking-tight md:text-4xl">Senyaman itu di HP</h2>
          <p className="mt-3 text-zinc-400">
            Kelola bisnis dari genggaman, kasir multi-meja, ringkasan bisnis, sampai
            struk yang langsung tercetak ke printer thermal.
          </p>
        </div>
        <div className="mt-10 grid grid-cols-1 items-start justify-items-center gap-8 sm:grid-cols-3">
          <PhoneFrame
            src="/landing/hp-dashboard.webp"
            alt="Ringkasan bisnis di HP"
            width={800}
            height={709}
            caption="Ringkasan bisnis sekali lirik"
          />
          <PhoneFrame
            src="/landing/hp-kasir.webp"
            alt="Kasir multi-meja di HP"
            width={728}
            height={1406}
            caption="Kasir multi-meja + Lazy Mode"
          />
          <PhoneFrame
            src="/landing/hp-struk.webp"
            alt="Struk digital siap cetak"
            width={800}
            height={1278}
            caption="Struk siap cetak 58/80mm"
          />
        </div>
      </section>

      {/* ================= pricing ================= */}
      <section id="harga" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 md:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-black tracking-tight md:text-4xl">Harga jujur, tanpa biaya tersembunyi</h2>
          <p className="mt-3 text-zinc-400">
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
                  ? "border-white bg-gradient-to-b from-white/[0.08] to-transparent"
                  : "border-white/10 bg-white/[0.02]"
              }`}
            >
              {t.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-rose-500 via-violet-500 to-orange-400 px-3 py-0.5 text-[10px] font-black uppercase tracking-wider text-white shadow">
                  Terpopuler
                </span>
              )}
              <p className="text-sm font-black uppercase tracking-wide">{t.name}</p>
              <p className="mt-0.5 min-h-8 text-[11px] leading-snug text-zinc-400">{t.tagline}</p>
              <p className="mt-3">
                <span className="text-2xl font-black tabular-nums tracking-tight">{rupiah(t.monthly)}</span>
                <span className="text-xs text-zinc-400">/bln</span>
              </p>
              <p className="text-[11px] text-zinc-400">
                atau {rupiah(t.yearly)}/tahun
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-xs">
                {t.features.map((f) => (
                  <li key={f.label} className="flex items-center gap-2">
                    {f.ok ? (
                      <Check className="size-3.5 shrink-0 text-emerald-500" />
                    ) : (
                      <X className="size-3.5 shrink-0 text-zinc-600" />
                    )}
                    <span className={f.ok ? "" : "text-zinc-500 line-through"}>{f.label}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/login"
                className={`mt-4 rounded-xl py-2.5 text-center text-sm font-bold transition-colors ${
                  t.highlight
                    ? "bg-white text-zinc-950 hover:opacity-85"
                    : "border-2 border-white/15 text-white hover:border-white/40 hover:bg-white/5"
                }`}
              >
                Coba Gratis 14 Hari
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* pembayaran → kwitansi resmi via email */}
      <section className="mx-auto max-w-4xl px-4 pb-16 md:pb-20">
        <div className="grid items-center gap-8 md:grid-cols-5">
          <div className="md:col-span-2">
            <h3 className="text-xl font-black tracking-tight md:text-2xl">
              Setiap pembayaran, kwitansi resmi
            </h3>
            <p className="mt-3 leading-relaxed text-zinc-400">
              Bayar via transfer bank dengan kode unik, konfirmasi kurang dari 24 jam,
              dan kwitansi bernomor langsung masuk ke email Pian,bukti pembayaran
              yang sah dan rapi.
            </p>
          </div>
          <div className="md:col-span-3">
            <WindowFrame
              src="/landing/kwitansi-email.webp"
              alt="Kwitansi pembayaran Ulun Pesan di Gmail"
              width={1400}
              height={732}
              glow="bg-rose-600/15"
            />
          </div>
        </div>
      </section>

      {/* ================= FAQ ================= */}
      <section id="faq" className="border-t border-white/10 bg-white/[0.02] py-16 md:py-20">
        <div className="mx-auto max-w-3xl scroll-mt-20 px-4">
          <h2 className="text-center text-2xl font-black tracking-tight md:text-4xl">
            Pertanyaan yang sering ditanya
          </h2>
          <div className="mt-8 space-y-3">
            {FAQS.map((f) => (
              <details key={f.q} className="group rounded-2xl border border-white/10 bg-[#0a0a0f] p-5">
                <summary className="cursor-pointer list-none font-bold marker:hidden">
                  {f.q}
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ================= final CTA ================= */}
      <section className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 p-8 text-center text-white md:p-14">
          <div className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-rose-600/25 blur-[80px]" />
          <div className="pointer-events-none absolute -left-16 -bottom-16 size-64 rounded-full bg-violet-600/25 blur-[80px]" />
          <div className="pointer-events-none absolute left-1/3 -bottom-24 size-56 rounded-full bg-orange-500/20 blur-[80px]" />
          <Sparkles className="pointer-events-none absolute -right-8 -top-8 size-44 opacity-10" />
          <h2 className="text-2xl font-black tracking-tight md:text-4xl">
            Usaha Pian siap naik kelas?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-white/85 md:text-base">
            Coba semua fitur gratis 14 hari. Tanpa kartu kredit, tanpa ribet,
            batal kapan saja.
          </p>
          <Link
            href="/login"
            className="mt-7 inline-flex items-center gap-2 rounded-2xl bg-white px-7 py-3.5 text-base font-bold text-zinc-950 shadow-lg transition-transform hover:-translate-y-0.5"
          >
            Daftar Sekarang <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      {/* ================= footer ================= */}
      <footer className="border-t border-white/10 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-zinc-400 md:flex-row">
          <p>
            <span className="font-black text-white">UlunPesan</span>{" "}
            — kasir & pemesanan online untuk usaha lokal.
          </p>
          <div className="flex items-center gap-5">
            <a href="#fitur" className="transition-colors hover:text-white">Fitur</a>
            <a href="#harga" className="transition-colors hover:text-white">Harga</a>
            <Link href="/login" className="transition-colors hover:text-foreground">Masuk</Link>
          </div>
          <p className="text-xs">© {new Date().getFullYear()} Ulun Pesan</p>
        </div>
      </footer>
    </main>
  );
}
