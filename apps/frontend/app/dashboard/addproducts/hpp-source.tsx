'use client';

import Link from 'next/link';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/*
 * Which figure a SALE of a product books as HPP — said on the etalase row and
 * under the form's "Harga modal", because owners kept asking instead of opening
 * the Panduan. On a stock plan most products never read the Harga modal they
 * typed, and nothing on the form said so.
 *
 * Mirrors the backend, so change this with it (and with the Panduan page
 * app/dashboard/panduan/laba-kotor):
 *
 *   - lib/outlet-access.ts  usesCostLedger — arrives here as `ledger`
 *                           (cost_ledger on /api/products/mine). Not re-derived
 *                           from plan features: a trial grants `stock` and
 *                           still costs from the buying price.
 *   - lib/cogs.ts           category 'jasa' is left out of every COGS sum
 *   - lib/force-hpp.ts      rootTarget: tracked → avg_cost; untracked with a
 *                           recipe that moves stock → its tracked leaves
 *                           (recipe_hpp, computed there); else → buying_price
 *
 * Counter sales only: an app order never moves stock, so it always books the
 * buying price. The popovers say so once rather than on every row.
 */
export type HppSource = 'buying' | 'avg' | 'recipe' | 'service';

export type Hpp = { source: HppSource; cost: number };

const num = (v: unknown) => Number(v) || 0;

export function hppOf(p: {
  ledger: boolean;
  category: string;
  trackStock: boolean;
  buyingPrice: string | number | null | undefined;
  avgCost?: string | number | null;
  recipeHpp?: number | null;
}): Hpp {
  // Exact match, like the SQL (`category <> 'jasa'`).
  if (p.category === 'jasa') return { source: 'service', cost: 0 };
  if (!p.ledger) return { source: 'buying', cost: num(p.buyingPrice) };
  if (p.trackStock) return { source: 'avg', cost: num(p.avgCost) };
  if (p.recipeHpp != null) return { source: 'recipe', cost: p.recipeHpp };
  return { source: 'buying', cost: num(p.buyingPrice) };
}

/** A real cost of zero: the sale books Rp 0 and reads as a 100% margin. */
export const hppMissing = (h: Hpp) => h.source !== 'service' && h.cost <= 0;

// The guide's colours: A blue (Harga Beli), B emerald (stok), C slate (Jasa).
const SOURCE: Record<HppSource, { label: string; chip: string }> = {
  buying: {
    label: 'Harga modal',
    chip: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  },
  avg: {
    label: 'Rata-rata stok',
    chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  recipe: {
    label: 'Dari resep',
    chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  service: {
    label: 'Jasa',
    chip: 'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300',
  },
};

export const hppSourceLabel = (s: HppSource) => SOURCE[s].label;

const rupiah = (v: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(v);

export function HppChip({ source, className = '' }: { source: HppSource; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${SOURCE[source].chip} ${className}`}
    >
      {SOURCE[source].label}
    </span>
  );
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="font-medium underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground"
    >
      {children}
    </Link>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

const GUIDE_HREF = '/dashboard/panduan/laba-kotor';

/** The etalase's HPP cell: what one sale books, and a tap away, why. */
export function HppCell({
  hpp,
  name,
  unit,
  buyingPrice,
  ledger,
  hasRecipe,
  explorerHref,
  isOwner,
}: {
  hpp: Hpp;
  name: string;
  unit: string;
  buyingPrice: number;
  ledger: boolean;
  hasRecipe: boolean;
  /** Jelajah Resep for this product, when the plan has it. */
  explorerHref: string | null;
  isOwner: boolean;
}) {
  const missing = hppMissing(hpp);
  const per = unit.trim() || 'item';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Asal HPP ${name}: ${SOURCE[hpp.source].label}, ${rupiah(hpp.cost)}`}
          className="inline-flex flex-col items-end gap-1 rounded-lg px-1.5 py-1 -mx-1.5 -my-1 text-right hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span
            className={`inline-flex items-center gap-1 font-semibold tabular-nums ${
              missing
                ? 'text-amber-600 dark:text-amber-500'
                : hpp.source === 'service'
                  ? 'text-muted-foreground'
                  : ''
            }`}
          >
            {missing && <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
            {rupiah(hpp.cost)}
          </span>
          <HppChip source={hpp.source} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3 p-4">
        <div>
          <p className="truncate text-xs text-muted-foreground">HPP {name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold tabular-nums">{rupiah(hpp.cost)}</span>
            <span className="text-xs text-muted-foreground">per {per} terjual</span>
            <HppChip source={hpp.source} className="ml-auto" />
          </p>
        </div>

        {hpp.source === 'buying' && (
          <>
            <p className="text-xs leading-relaxed">
              Diambil dari <b>Harga modal</b> yang Anda isi di form produk.{' '}
              {!ledger
                ? 'Paket Anda menghitung HPP semua produk dari Harga modal.'
                : hasRecipe
                  ? 'Resepnya tidak memotong stok bahan mana pun, jadi Harga modal yang dipakai.'
                  : 'Produk ini tidak punya stok sendiri dan tidak punya resep.'}
            </p>
            {missing && (
              <Warn>
                Harga modal masih kosong, jadi penjualannya tercatat HPP Rp 0 (terlihat untung
                100%). Isi lewat tombol Edit.
              </Warn>
            )}
          </>
        )}

        {hpp.source === 'avg' && (
          <>
            <p className="text-xs leading-relaxed">
              Produk ini punya stok sendiri, jadi HPP-nya diambil dari <b>rata-rata harga stok</b>{' '}
              yang masuk lewat Faktur Pembelian, Produksi, atau Opname.{' '}
              <b>Harga modal{buyingPrice > 0 ? ` (${rupiah(buyingPrice)})` : ''} tidak dipakai.</b>
            </p>
            {missing && (
              <Warn>
                Belum ada stok masuk dengan harga, jadi penjualannya tercatat HPP Rp 0. Catat lewat{' '}
                <A href="/dashboard/invoice/purchase">Faktur Pembelian</A>, atau isi HPP awal saat
                Opname di halaman <A href="/dashboard/invoice/stock">Stok</A>.
              </Warn>
            )}
          </>
        )}

        {hpp.source === 'recipe' && (
          <>
            <p className="text-xs leading-relaxed">
              Dihitung dari <b>bahan resepnya</b>: jumlah pemakaian × rata-rata harga stok tiap
              bahan. Bahan yang tidak punya stok sendiri tidak ikut dihitung.{' '}
              <b>Harga modal{buyingPrice > 0 ? ` (${rupiah(buyingPrice)})` : ''} tidak dipakai.</b>
            </p>
            {missing ? (
              <Warn>
                Bahan resepnya belum punya HPP rata-rata, jadi penjualannya tercatat HPP Rp 0.
                {explorerHref && (
                  <>
                    {' '}
                    Lihat bahan mana di <A href={explorerHref}>Jelajah Resep</A>.
                  </>
                )}
              </Warn>
            ) : (
              explorerHref && (
                <p className="text-xs">
                  Rincian per bahan: <A href={explorerHref}>Jelajah Resep</A>
                </p>
              )
            )}
          </>
        )}

        {hpp.source === 'service' && (
          <p className="text-xs leading-relaxed">
            Jasa tidak memakai barang, jadi HPP-nya selalu Rp 0 dan pendapatannya terlihat untung
            100%. Harga modal tidak dipakai di laporan.
          </p>
        )}

        {(ledger && hpp.source !== 'service') || isOwner ? (
          <div className="flex flex-col gap-1 border-t pt-2.5 text-[11px] text-muted-foreground">
            {ledger && hpp.source !== 'service' && (
              <p>Berlaku untuk penjualan di kasir. Pesanan dari aplikasi pelanggan selalu memakai Harga modal.</p>
            )}
            {isOwner && (
              <p>
                <A href={GUIDE_HREF}>Cara HPP dihitung</A>
              </p>
            )}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** The (?) on the HPP column header: the four chips, once. */
export function HppLegend({ ledger, isOwner }: { ledger: boolean; isOwner: boolean }) {
  const rows: [HppSource, string][] = ledger
    ? [
        ['avg', 'Produk dengan stok sendiri. Dari Faktur Pembelian, Produksi & Opname — Harga modal tidak dipakai.'],
        ['recipe', 'Produk tanpa stok sendiri yang punya resep. Jumlah HPP bahan resepnya.'],
        ['buying', 'Produk tanpa stok dan tanpa resep. Angka yang Anda isi di form produk.'],
        ['service', 'Selalu Rp 0.'],
      ]
    : [
        ['buying', 'Semua produk di paket Anda. Angka yang Anda isi di form produk.'],
        ['service', 'Selalu Rp 0.'],
      ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Apa arti kolom HPP?"
          className="rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3 p-4 normal-case tracking-normal">
        <div>
          <p className="text-sm font-semibold text-foreground">Kolom HPP</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Biaya yang dicatat setiap kali 1 item terjual di kasir — dasar laba kotor di Laporan.
            Ketuk angkanya untuk penjelasan per produk.
          </p>
        </div>
        <ul className="flex flex-col gap-2.5">
          {rows.map(([source, text]) => (
            <li key={source} className="flex flex-col items-start gap-1">
              <HppChip source={source} />
              <span className="text-xs text-foreground">{text}</span>
            </li>
          ))}
          <li className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Rp 0 berwarna kuning: belum ada HPP, penjualannya terlihat untung 100%.</span>
          </li>
        </ul>
        {(ledger || isOwner) && (
          <div className="flex flex-col gap-1 border-t pt-2.5 text-[11px] text-muted-foreground">
            {ledger && <p>Pesanan dari aplikasi pelanggan selalu memakai Harga modal.</p>}
            {isOwner && (
              <p>
                <A href={GUIDE_HREF}>Cara HPP dihitung</A>
              </p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The line under the form's Harga modal / Harga beli field: is the number being
 * typed the one a sale will book? Live — it follows the stock toggle and the
 * category as the owner changes them, before anything is saved.
 */
export function HppFieldHint({
  hpp,
  ledger,
  isIngredient,
  unit,
}: {
  hpp: Hpp;
  ledger: boolean;
  isIngredient: boolean;
  unit: string;
}) {
  const missing = hppMissing(hpp);
  const per = ` per ${unit}`;

  // A bahan is never sold: what matters is what a recipe books for it.
  if (isIngredient) {
    if (!ledger) return <Muted>Harga beli{per}.</Muted>;
    if (hpp.source === 'avg') {
      return (
        <Line source="avg">
          {missing ? (
            <Warn>
              Bahan ini punya stok sendiri, jadi resep memakai rata-rata harga stoknya — masih Rp 0
              sampai stok masuk lewat Faktur Pembelian atau Opname. Harga beli di sini hanya isian
              awal di sana.
            </Warn>
          ) : (
            <Muted>
              Resep memakai rata-rata harga stok bahan ini: <b>{rupiah(hpp.cost)}</b>
              {per}. Harga beli di sini hanya isian awal di Faktur Pembelian dan Opname.
            </Muted>
          )}
        </Line>
      );
    }
    if (hpp.source === 'recipe') {
      return (
        <Line source="recipe">
          <Muted>
            Tidak dipakai — bahan ini dihitung dari resepnya sendiri: <b>{rupiah(hpp.cost)}</b>
            {per}.
          </Muted>
        </Line>
      );
    }
    return (
      <Warn>
        Bahan tanpa stok sendiri tidak ikut dihitung di HPP menu. Nyalakan “Punya stok sendiri” di
        bawah supaya ikut terhitung.
      </Warn>
    );
  }

  if (hpp.source === 'service') {
    return (
      <Line source="service">
        <Muted>Jasa tidak punya HPP — angka ini tidak dipakai di laporan.</Muted>
      </Line>
    );
  }

  if (hpp.source === 'buying') {
    return (
      <Line source="buying">
        <Muted>
          Dicatat sebagai HPP setiap kali terjual{missing ? ' — kosong berarti Rp 0, terlihat untung 100%' : ''}.
          Tidak dilihat pelanggan.
        </Muted>
      </Line>
    );
  }

  if (hpp.source === 'avg') {
    return (
      <Line source="avg">
        {missing ? (
          <Warn>
            Tidak dipakai sebagai HPP: produk dengan stok sendiri memakai rata-rata harga stok, yang
            masih Rp 0 sampai stok masuk lewat Faktur Pembelian atau Opname. Angka di sini hanya
            isian awal di sana.
          </Warn>
        ) : (
          <Muted>
            Tidak dipakai sebagai HPP: produk dengan stok sendiri memakai rata-rata harga stok,{' '}
            <b>{rupiah(hpp.cost)}</b>
            {per}. Angka di sini hanya isian awal di Faktur Pembelian dan Opname.
          </Muted>
        )}
      </Line>
    );
  }

  return (
    <Line source="recipe">
      {missing ? (
        <Warn>
          Tidak dipakai sebagai HPP: dihitung dari bahan resep, yang belum punya HPP rata-rata —
          tercatat Rp 0.
        </Warn>
      ) : (
        <Muted>
          Tidak dipakai sebagai HPP: dihitung dari bahan resep, <b>{rupiah(hpp.cost)}</b>
          {per}.
        </Muted>
      )}
    </Line>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

function Line({ source, children }: { source: HppSource; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        HPP: <HppChip source={source} />
      </span>
      {children}
    </div>
  );
}
