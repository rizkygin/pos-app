'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, MapPin, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

export type ActiveLocation = { id: number; label: string; address: string } | null;

// Rotating hints, not a feature list — they exist to show the box takes anything,
// so they deliberately span food, drink, mart and jasa.
const HINTS = [
  'Bebek Goreng',
  'Kebab',
  'Burger',
  'Smoothies',
  'Es Teh Manis',
  'Nasi Kuning',
  'Ayam Geprek',
  'Tukang Servis AC',
  'Semen & Cat',
  'Sembako',
];

const ROTATE_MS = 3000;

/**
 * The customer dashboard's opening block: where the order goes, what they're
 * hunting for, and the greeting — one gradient panel with the search box
 * floating off its bottom edge.
 */
export function CustomerHero({ location }: { location: ActiveLocation }) {
  const [hint, setHint] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setHint((i) => (i + 1) % HINTS.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="pt-4">
      <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-blue-700 via-blue-600 to-sky-500 px-5 pb-14 pt-5 text-white shadow-xl shadow-blue-600/25">
        <div className="absolute -right-10 -top-14 size-44 rounded-full bg-white/15 blur-2xl" />
        <div className="absolute -bottom-20 -left-10 size-48 rounded-full bg-white/10 blur-2xl" />

        <div className="relative">
          {/* Where it gets delivered. Tapping goes to the address list, which is
              the only place the answer can actually be changed. */}
          <Link
            href="/dashboard/users/locations/setting"
            className="group inline-flex max-w-full items-center gap-2 rounded-full bg-white/15 py-1.5 pl-2 pr-3 backdrop-blur-sm transition-colors hover:bg-white/25"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/25">
              <MapPin className="size-3.5" />
            </span>
            <span className="min-w-0 truncate text-xs font-semibold">
              <span className="text-white/70">Dikirim ke · </span>
              {location ? (
                <>
                  {location.label}
                  <span className="font-normal text-white/80"> · {location.address}</span>
                </>
              ) : (
                'Atur alamat pengiriman'
              )}
            </span>
            <ChevronRight className="size-3.5 shrink-0 text-white/70 transition-transform group-hover:translate-x-0.5" />
          </Link>

          <h1 className="mt-4 text-[26px] font-black leading-tight tracking-tight md:text-4xl">
            Handak pesan apa?
          </h1>
          <p className="mt-1.5 max-w-sm text-sm text-white/80">
            Cari langsung, atau pilih kategori di bawah buat mulai pesan.
          </p>
        </div>
      </section>

      {/* Looks like an input, is a link: the real field lives on the search page,
          so there is no half-typed state to hand over and no keyboard opening
          here only to be thrown away by the navigation. */}
      <div className="relative z-10 -mt-8 px-3">
        <Link
          href="/dashboard/search-order"
          role="search"
          aria-label="Cari makanan, minuman, belanja, atau jasa"
          className="flex h-14 w-full items-center gap-3 rounded-2xl border border-blue-100 bg-white px-4 shadow-lg shadow-blue-900/10 transition-colors hover:border-blue-300 dark:border-blue-950/70 dark:bg-zinc-900"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/60">
            <Search className="size-4.5 text-blue-600 dark:text-blue-400" />
          </span>
          <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-sm text-muted-foreground">
            <span className="mr-1">Cari</span>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={HINTS[hint]}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="inline-block font-semibold text-foreground/70"
              >
                &ldquo;{HINTS[hint]}&rdquo;
              </motion.span>
            </AnimatePresence>
          </span>
        </Link>
      </div>
    </div>
  );
}
