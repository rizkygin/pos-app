'use client';

import { useEffect, useState } from 'react';
import {
  Armchair,
  Barcode,
  ChefHat,
  CircleHelp,
  Eye,
  Printer,
  ReceiptText,
  Smartphone,
  Split,
  StickyNote,
  Trash2,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';

// Per device, like Lazy Mode. Bump the suffix when the cashier's icons change
// again and every till sees the guide once more.
const SEEN_KEY = 'pos_cashier_icon_guide_v1';

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* ignore */
  }
}

type Entry = {
  icon: LucideIcon;
  name: string;
  text: string;
  // Moved or newly icon-only in this update: what a returning cashier will
  // go looking for and not find where it was.
  isNew?: boolean;
};

/**
 * The legend for the cashier's icon-only buttons, plus the "?" that reopens it.
 *
 * Opens by itself once per device, then only from the "?". A `title` tooltip
 * alone isn't enough: most tills are tablets, and a finger never hovers.
 * Only the buttons this outlet's plan actually shows are listed — explaining
 * a Meja button the cashier will never see is how a guide stops being read.
 */
export function CashierIconGuide({
  canUseMembership,
  canUseSelfOrder,
  canUseTables,
  canPrintKitchen,
  allowPreCheckoutReceipt,
}: {
  canUseMembership: boolean;
  canUseSelfOrder: boolean;
  canUseTables: boolean;
  canPrintKitchen: boolean;
  allowPreCheckoutReceipt: boolean;
}) {
  const [open, setOpen] = useState(false);

  // After the first paint rather than during it: the guide is about the
  // screen behind it, so that screen should be there first.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (localStorage.getItem(SEEN_KEY) !== '1') setOpen(true);
      } catch {
        /* storage blocked: no auto-open, the "?" still works */
      }
    }, 600);
    return () => clearTimeout(t);
  }, []);

  const close = () => {
    setOpen(false);
    markSeen();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        markSeen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const sections: { title: string; entries: Entry[] }[] = [
    {
      title: 'Baris atas',
      entries: [
        canUseMembership && {
          icon: UserRound,
          name: 'Member',
          text: 'Cari atau daftarkan member, pakai poin dan kode promo.',
        },
        {
          icon: Barcode,
          name: 'Scan barcode',
          text: 'Ketuk dulu untuk membuka kolom scan, lalu scan. Kolomnya tertutup sendiri kalau kosong. Untuk mencari produk, pakai kolom Cari produk.',
          isNew: true,
        },
        canUseSelfOrder && {
          icon: Smartphone,
          name: 'Pesan Mandiri',
          text: 'Pesanan dari HP pelanggan. Berdering sampai diambil.',
        },
        canUseTables && {
          icon: Armchair,
          name: 'Bill meja',
          text: 'Bill meja yang masih terbuka, dari perangkat mana pun.',
        },
        {
          icon: ReceiptText,
          name: 'Pesanan tercatat',
          text: 'Pesanan yang sudah checkout di sesi ini. Bisa cetak ulang struk.',
        },
      ].filter(Boolean) as Entry[],
    },
    {
      title: 'Keranjang',
      entries: [
        {
          icon: StickyNote,
          name: 'Catatan',
          text: 'Catatan untuk dapur. Di sebelah nama pelanggan untuk seluruh pesanan, di tiap item untuk item itu saja.',
        },
        {
          icon: Eye,
          name: 'Lihat lebih jelas',
          text: 'Rincian pesanan dengan huruf besar, untuk dibacakan ke pelanggan. Muncul kalau isi keranjang lebih dari satu.',
        },
        {
          icon: Trash2,
          name: 'Hapus',
          text: 'Di sebelah nama pelanggan: kosongkan keranjang. Di tiap item: hapus item itu saja.',
        },
      ],
    },
    {
      title: 'Bawah, di samping Checkout',
      entries: [
        {
          icon: Split,
          name: 'Bayar campuran / bagi bill',
          text: 'Satu bill dibayar dengan beberapa metode, misal tunai + QRIS. Dulu berupa tulisan di bawah pilihan metode bayar.',
          isNew: true,
        },
        allowPreCheckoutReceipt && {
          icon: Printer,
          name: 'Cetak struk',
          text: 'Cetak struk pelanggan sebelum checkout.',
        },
        canPrintKitchen && {
          icon: ChefHat,
          name: 'Dapur',
          text: canUseTables
            ? 'Cetak tiket dapur. Di bill meja: kirim pesanan baru ke dapur.'
            : 'Cetak tiket dapur.',
        },
      ].filter(Boolean) as Entry[],
    },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Panduan ikon"
        title="Panduan ikon"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border bg-background/90 text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
      >
        <CircleHelp className="h-4 w-4" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="icon-guide-title"
            className="flex max-h-[85vh] w-full flex-col rounded-t-3xl border bg-background shadow-2xl sm:max-w-md sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b px-5 py-4">
              <div className="min-w-0">
                <h3 id="icon-guide-title" className="font-bold">
                  Panduan ikon kasir
                </h3>
                <p className="text-xs text-muted-foreground">
                  Beberapa tombol sekarang berupa ikon agar daftar pesanan lebih
                  lega. Ini artinya.
                </p>
              </div>
              <button
                onClick={close}
                aria-label="Tutup"
                className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {sections.map((s) => (
                <div key={s.title}>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    {s.title}
                  </p>
                  <div className="space-y-2.5">
                    {s.entries.map((e) => (
                      <div key={e.name} className="flex items-start gap-3">
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border shadow-sm ${
                            e.isNew
                              ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
                              : 'bg-background text-muted-foreground'
                          }`}
                        >
                          <e.icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-sm font-semibold">
                            {e.name}
                            {e.isNew && (
                              <span className="rounded-full bg-blue-600 px-1.5 py-px text-[10px] font-bold text-white">
                                Baru
                              </span>
                            )}
                          </p>
                          <p className="text-xs leading-snug text-muted-foreground">
                            {e.text}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="shrink-0 border-t px-5 py-3">
              <p className="mb-2 text-[11px] text-muted-foreground">
                Di komputer, arahkan kursor ke ikon untuk melihat namanya.
                Panduan ini bisa dibuka lagi lewat tombol{' '}
                <CircleHelp className="inline h-3 w-3 align-[-2px]" /> di baris
                atas.
              </p>
              <button
                onClick={close}
                className="h-10 w-full rounded-xl bg-blue-600 text-sm font-bold text-white transition-colors hover:bg-blue-700"
              >
                Mengerti
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
