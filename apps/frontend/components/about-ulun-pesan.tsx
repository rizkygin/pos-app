"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Info, X, Store, HeartHandshake, Workflow, ShieldAlert, BubblesIcon } from "lucide-react";

// Informational "Tentang Ulun Pesan" overlay shown on the login page. Mirrors the
// stacked-section layout of kalkulatormbg.com (Apa itu / cara kerja / disclaimer)
// but in the app's Banjar-flavoured Indonesian voice. The trigger is fixed to the
// viewport so it never disturbs the centred login card.
const sections = [
  {
    icon: Store,
    title: "Apa itu Ulun Pesan?",
    body: (
      <>
        Ulun Pesan adalah aplikasi <strong>kasir &amp; pemesanan online (POS)</strong>{" "}
        untuk warung, resto, dan UMKM kuliner. Lewat satu aplikasi, penjual bisa
        mengatur produk, menerima pesanan, mengatur pengiriman oleh kurir, dan
        melihat laporan penjualan — tanpa ribet.
        <span className="mt-2 block text-zinc-400">
          Dalam bahasa Banjar, <em>“Ulun Pesan”</em> berarti “ulun handak pesan”
          (aku mau pesan) — semangat melayani pian, pembeli maupun penjual.
        </span>
      </>
    ),
  },
  
  {
    icon: Workflow,
    title: "Cara Kerja",
    body: (
      <>
        <ol className="ml-4 list-decimal space-y-1">
          <li>Ulun Pesan punya 3 Peran, Kurir, Outlet dan Customer</li>
          <li>Customer order, outlet menyiapkan dan kurir akan mengantarkan</li>
          <li>Dari outlet, lewat Ulun Pesan dan kurir</li>
          <li>Setelah selesai pengantaran, customer berhak memberikan rating pada kurir dan pesanannya</li>
        </ol>
        <span className="mt-3 block text-zinc-400">
          Fitur: manajemen produk &amp; outlet, pesanan real-time, kurir &amp;
          ongkir, promo &amp; iklan, laporan keuangan, serta peran terpisah untuk
          pemilik, kurir, pelanggan, dan admin.
        </span>
      </>
    ),
  },
  {
    icon: ShieldAlert,
    title: "Disclaimer",
    body: (
      <>
        Ulun Pesan masih terus dikembangkan, sehingga tampilan dan fitur dapat
        berubah sewaktu-waktu. Isi pesanan, harga, ketersediaan, dan penyelesaian
        pembayaran sepenuhnya menjadi tanggung jawab masing-masing outlet penjual.
      </>
    ),
  },
  {
    //VERSION::
    icon: BubblesIcon,
    title: "V.1.6.9 Updated at 3 July ",
    body: (
      <>
        Ulun percaya Pangkalan bun bisa berkembang, sama seperti kota besar.
        sampaikan kendala, kritik dan saran lebih lanjut biar Ulun Pesan bisa berkembang jua
        di WA: 0857 5436 3911
      </>
    ),
  },
];

export function AboutUlunPesan() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Trigger — fixed so it stays clear of the centred login card */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-30 flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-zinc-900/80 px-4 py-2 text-xs font-medium text-zinc-100 shadow-lg backdrop-blur-md transition-colors hover:bg-zinc-800"
      >
        <Info className="h-3.5 w-3.5" />
        Apa itu Ulun Pesan?
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="about-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
            onClick={() => setOpen(false)}
          >
            <motion.div
              key="about-panel"
              initial={{ opacity: 0, y: 40, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 40, scale: 0.98 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              onClick={(e) => e.stopPropagation()}
              className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-white/10 bg-zinc-900/90 p-6 shadow-2xl backdrop-blur-xl sm:rounded-3xl sm:p-8"
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Tutup"
                className="absolute right-4 top-4 rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>

              <h2 className="mb-1 text-2xl font-semibold tracking-tight text-white">
                Tentang Ulun Pesan
              </h2>
              <p className="mb-6 text-sm text-zinc-400">
                Kenali Ulun Pesan sebelum mulai.
              </p>

              <div className="space-y-6">
                {sections.map(({ icon: Icon, title, body }) => (
                  <section key={title}>
                    <h3 className="mb-1.5 flex items-center gap-2 text-base font-semibold text-white">
                      <Icon className="h-4 w-4 text-indigo-400" />
                      {title}
                    </h3>
                    <div className="text-sm leading-relaxed text-zinc-300">
                      {body}
                    </div>
                  </section>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
