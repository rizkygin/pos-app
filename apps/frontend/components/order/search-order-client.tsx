'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, SearchX, Star, X } from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { formatCurrency } from '@/lib/utils/format';
import { isBackendImage, resolveProductImage } from '@/lib/image-src';
import { cn } from '@/lib/utils';

export type SearchResult = {
  id: string;
  name: string;
  image: string;
  description: string;
  category: string;
  feature: string;
  isService: boolean;
  price: number;
  priceMarkDown: number;
  lowestPrice: number | null;
  highestPrice: number | null;
  discountPercent: number | null;
  unit: string;
  ratings: number;
  reviewCount: number;
  outletId: number;
  outletName: string;
  outletAvatar: string;
  outletRatings: number;
  outletIsOpen: boolean;
  distanceKm: number | null;
};

const PAGE_SIZE = 24;
const DEBOUNCE_MS = 300;

// Same rotation as the dashboard trigger, reused here as example queries so the
// empty page suggests something to press instead of just sitting there.
const SUGGESTIONS = ['Bebek Goreng', 'Kebab', 'Burger', 'Smoothies', 'Nasi Kuning', 'Semen'];

function priceLabel(item: SearchResult) {
  // Jasa is quoted as a negotiable range — printing a single number would be a
  // promise the owner never made.
  if (item.isService && item.lowestPrice != null) {
    return `mulai ${formatCurrency(item.lowestPrice)}`;
  }
  const hasDiscount = item.priceMarkDown > 0 && item.priceMarkDown < item.price;
  return formatCurrency(hasDiscount ? item.priceMarkDown : item.price);
}

function ResultRow({ item }: { item: SearchResult }) {
  const hasDiscount =
    !item.isService && item.priceMarkDown > 0 && item.priceMarkDown < item.price;

  return (
    <li>
      <Link
        href={`/dashboard/order/${item.feature}/${item.outletId}`}
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-blue-50/60 active:bg-blue-100/60 dark:hover:bg-blue-950/30 dark:active:bg-blue-950/50"
      >
        <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-muted">
          <Image
            src={resolveProductImage(item.image)}
            unoptimized={isBackendImage(item.image)}
            alt={item.name}
            fill
            sizes="64px"
            className={cn('object-cover', !item.outletIsOpen && 'grayscale')}
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{item.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {item.outletName}
            {item.distanceKm !== null && <> · {item.distanceKm} km</>}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-amber-600">
              <Star className="size-3 fill-amber-500 text-amber-500" />
              {item.ratings.toFixed(1)}
              {item.reviewCount > 0 && (
                <span className="font-medium text-muted-foreground"> ({item.reviewCount})</span>
              )}
            </span>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {item.category}
            </span>
            {!item.outletIsOpen && (
              <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 dark:bg-rose-950/50">
                Tutup
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-sm font-black tabular-nums text-blue-600 dark:text-blue-400">
            {priceLabel(item)}
          </p>
          {hasDiscount && (
            <p className="text-[11px] text-muted-foreground line-through tabular-nums">
              {formatCurrency(item.price)}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground">/{item.unit}</p>
        </div>
      </Link>
    </li>
  );
}

function RowSkeleton() {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="size-16 shrink-0 animate-pulse rounded-xl bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-2/5 animate-pulse rounded bg-muted" />
        <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
      </div>
    </li>
  );
}

export function SearchOrderClient() {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SearchResult[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [appending, setAppending] = useState(false);
  // Which query the list on screen belongs to. Loading is derived from it rather
  // than held as its own flag: the moment `query` changes, the list is by
  // definition stale, with no state write needed to say so.
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const loading = loadedQuery !== query;

  const appendRef = useRef<AbortController | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(term.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const load = useCallback(async (q: string, offset: number, signal: AbortSignal) => {
    try {
      const res = await fetch(
        `${API_URL}/api/search-products?q=${encodeURIComponent(q)}&limit=${PAGE_SIZE}&offset=${offset}`,
        { cache: 'no-store', credentials: 'include', signal },
      );
      const data = await res.json();
      const rows: SearchResult[] = data?.success ? data.data : [];
      setItems((prev) => (offset === 0 ? rows : [...prev, ...rows]));
      setHasMore(Boolean(data?.hasMore));
      setLoadedQuery(q);
    } catch (err) {
      // An abort is the expected outcome of typing another character, not a
      // failure — leave the list (and loadedQuery) alone so the newer request
      // is the one that paints.
      if ((err as Error)?.name === 'AbortError') return;
      if (offset === 0) setItems([]);
      setHasMore(false);
      setLoadedQuery(q);
    } finally {
      setAppending(false);
    }
  }, []);

  useEffect(() => {
    // Typing is faster than the network: aborting on the way out is what stops a
    // slow early keystroke landing after a fast later one and repainting the
    // list with results for a query that's already been changed.
    const controller = new AbortController();
    void load(query, 0, controller.signal);
    return () => controller.abort();
  }, [query, load]);

  // Recycler-style paging: the list grows when the bottom sentinel scrolls into
  // view, so there is no "load more" button to hunt for on a phone.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loading || appending) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        appendRef.current?.abort();
        const controller = new AbortController();
        appendRef.current = controller;
        setAppending(true);
        void load(query, items.length, controller.signal);
      },
      { rootMargin: '240px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, appending, items.length, query, load]);

  // A page-2 request outliving the query that asked for it would append rows
  // from the old search onto the new list.
  useEffect(() => () => appendRef.current?.abort(), [query]);

  return (
    <div className="w-full">
      {/* Sticky search header. The dashboard's box is only a link — this is the
          field it hands off to, so it takes focus on arrival. Offset by the
          dashboard header's own height (h-12, md:h-10): both are sticky in the
          same scroll container, so at top-0 this one would park underneath it. */}
      <div className="sticky top-12 z-20 border-b border-blue-100 bg-background/95 backdrop-blur-md md:top-10 dark:border-blue-950/70">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-3 py-3">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Kembali"
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
          >
            <ArrowLeft className="size-5" />
          </button>
          <div className="flex h-11 flex-1 items-center gap-2 rounded-2xl border border-blue-100 bg-white px-3 focus-within:border-blue-400 dark:border-blue-950/70 dark:bg-zinc-900">
            <input
              // The page exists to be typed into — arriving without focus would
              // cost a second tap on every search.
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              type="search"
              inputMode="search"
              placeholder="Cari makanan, belanja, atau jasa…"
              aria-label="Kata kunci pencarian"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {term && (
              <button
                type="button"
                onClick={() => setTerm('')}
                aria-label="Hapus pencarian"
                className="flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl pb-16">
        {!query && !loading && (
          <div className="flex flex-wrap gap-2 px-4 pt-4">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setTerm(s)}
                className="rounded-full border border-blue-100 bg-blue-50/60 px-3 py-1.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-950/70 dark:bg-blue-950/40 dark:text-blue-300"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <p className="px-4 pt-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          {query ? `Hasil untuk “${query}”` : 'Paling banyak dicari'}
        </p>

        {loading ? (
          <ul className="mt-1 divide-y divide-border/60">
            {Array.from({ length: 6 }).map((_, i) => (
              <RowSkeleton key={i} />
            ))}
          </ul>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
            <SearchX className="size-10 text-muted-foreground/40" />
            <p className="font-bold">Tidak ketemu</p>
            <p className="text-sm text-muted-foreground">
              Coba kata lain — nama menu, nama toko, atau jenis jasa.
            </p>
          </div>
        ) : (
          <>
            <ul className="mt-1 divide-y divide-border/60">
              {items.map((item) => (
                <ResultRow key={`${item.outletId}-${item.id}`} item={item} />
              ))}
            </ul>
            <div ref={sentinelRef} className="h-10" />
            {appending && (
              <div className="flex justify-center pb-6 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
