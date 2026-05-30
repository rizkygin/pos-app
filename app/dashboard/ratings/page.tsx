'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Package,
  Star,
  Store,
} from 'lucide-react';
import { DashboardHeader } from '@/components/dashboard-header';

type ReviewType = 'outlet' | 'product';

type Review = {
  id: string;
  reviewer_name: string;
  rating: number;
  comment: string;
  created_at: string;
  type: ReviewType;
  product_name: string | null;
};

type DistItem = { star: number; count: number };

type SummarySection = {
  avg: number;
  count: number;
  dist: DistItem[];
};

type ApiResponse = {
  data: Review[];
  total: number;
  page: number;
  totalPages: number;
  summary: {
    outlet: SummarySection;
    product: SummarySection;
  };
};

type Tab = 'all' | 'outlet' | 'product';

function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

const AVATAR_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-purple-100 text-purple-700',
  'bg-emerald-100 text-emerald-700',
  'bg-rose-100 text-rose-700',
  'bg-amber-100 text-amber-700',
];

function StarDisplay({
  value,
  size = 'sm',
}: {
  value: number;
  size?: 'sm' | 'lg';
}) {
  const cls = size === 'lg' ? 'h-5 w-5' : 'h-3.5 w-3.5';
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`${cls} ${
            i <= Math.round(value)
              ? 'fill-amber-400 text-amber-400'
              : 'text-muted-foreground/25'
          }`}
        />
      ))}
    </div>
  );
}

function RatingBar({
  label,
  count,
  total,
}: {
  label: string;
  count: number;
  total: number;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-bold text-muted-foreground w-3 shrink-0">
        {label}
      </span>
      <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" />
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-amber-400 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground w-4 shrink-0 text-right">
        {count}
      </span>
    </div>
  );
}

function SummaryCard({
  title,
  icon: Icon,
  accentClass,
  summary,
  loading,
}: {
  title: string;
  icon: typeof Store;
  accentClass: string;
  summary: SummarySection | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div
        className={`rounded-2xl border p-5 flex-1 animate-pulse ${accentClass}`}
      >
        <div className="h-4 w-24 bg-muted rounded mb-4" />
        <div className="flex gap-4">
          <div className="h-14 w-16 bg-muted rounded shrink-0" />
          <div className="flex-1 space-y-2 pt-1">
            {[5, 4, 3, 2, 1].map((s) => (
              <div key={s} className="h-1.5 bg-muted rounded-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border p-5 flex-1 ${accentClass}`}>
      <div className="flex items-center gap-1.5 mb-3">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-bold">{title}</span>
        {summary && summary.count > 0 && (
          <span className="text-[10px] text-muted-foreground ml-1">
            ({summary.count} ulasan)
          </span>
        )}
      </div>
      {!summary || summary.count === 0 ? (
        <p className="text-xs text-muted-foreground py-3">Belum ada ulasan</p>
      ) : (
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-1 shrink-0">
            <span className="text-4xl font-extrabold tracking-tight text-amber-500">
              {summary.avg.toFixed(1)}
            </span>
            <StarDisplay value={summary.avg} />
          </div>
          <div className="flex-1 space-y-1.5">
            {summary.dist.map(({ star, count }) => (
              <RatingBar
                key={star}
                label={String(star)}
                count={count}
                total={summary.count}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewCard({ review }: { review: Review }) {
  const colorIdx = review.reviewer_name.charCodeAt(0) % AVATAR_COLORS.length;
  const formatted = new Date(review.created_at).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="flex gap-4 p-4 rounded-xl border bg-background hover:shadow-sm transition-shadow">
      <div
        className={`shrink-0 h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold ${AVATAR_COLORS[colorIdx]}`}
      >
        {initials(review.reviewer_name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <p className="text-sm font-bold leading-none">
              {review.reviewer_name}
            </p>
            <div className="mt-1">
              <StarDisplay value={review.rating} />
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {review.type === 'product' && review.product_name ? (
              <span className="flex items-center gap-1 text-[10px] font-bold bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                <Package className="h-3 w-3" />
                {review.product_name}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] font-bold bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">
                <Store className="h-3 w-3" />
                Outlet
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">
              {formatted}
            </span>
          </div>
        </div>
        {review.comment ? (
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            {review.comment}
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground/50 italic">
            Tidak ada komentar.
          </p>
        )}
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="flex gap-4 p-4 rounded-xl border bg-background animate-pulse">
      <div className="shrink-0 h-10 w-10 rounded-full bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-32 bg-muted rounded" />
        <div className="h-3 w-24 bg-muted rounded" />
        <div className="h-3 w-full bg-muted rounded" />
        <div className="h-3 w-2/3 bg-muted rounded" />
      </div>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  const windowPages: number[] = [];
  for (
    let i = Math.max(1, page - 2);
    i <= Math.min(totalPages, page + 2);
    i++
  ) {
    windowPages.push(i);
  }

  return (
    <div className="flex items-center justify-center gap-1 mt-6">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page === 1}
        className="p-1.5 rounded-lg border hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {windowPages[0] > 1 && (
        <>
          <button
            onClick={() => onChange(1)}
            className="h-8 w-8 text-xs rounded-lg border hover:bg-muted"
          >
            1
          </button>
          {windowPages[0] > 2 && (
            <span className="text-muted-foreground text-xs px-1">…</span>
          )}
        </>
      )}

      {windowPages.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`h-8 w-8 text-xs rounded-lg border font-semibold transition-colors ${
            p === page
              ? 'bg-amber-500 text-white border-amber-500'
              : 'hover:bg-muted'
          }`}
        >
          {p}
        </button>
      ))}

      {windowPages[windowPages.length - 1] < totalPages && (
        <>
          {windowPages[windowPages.length - 1] < totalPages - 1 && (
            <span className="text-muted-foreground text-xs px-1">…</span>
          )}
          <button
            onClick={() => onChange(totalPages)}
            className="h-8 w-8 text-xs rounded-lg border hover:bg-muted"
          >
            {totalPages}
          </button>
        </>
      )}

      <button
        onClick={() => onChange(page + 1)}
        disabled={page === totalPages}
        className="p-1.5 rounded-lg border hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function RatingsPage() {
  const [tab, setTab] = useState<Tab>('all');
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(true);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [summary, setSummary] = useState<ApiResponse['summary'] | null>(null);
  const summaryLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setListLoading(true);

    fetch(`/api/get-owner-ratings?type=${tab}&page=${page}`)
      .then((r) => r.json())
      .then((json: ApiResponse) => {
        if (cancelled) return;
        setReviews(json.data ?? []);
        setTotalPages(json.totalPages ?? 0);
        if (!summaryLoadedRef.current) {
          setSummary(json.summary);
          summaryLoadedRef.current = true;
        }
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tab, page]);

  const handleTabChange = (newTab: Tab) => {
    setTab(newTab);
    setPage(1);
  };

  const summaryLoading = !summaryLoadedRef.current && listLoading;
  const outletCount = summary?.outlet.count ?? 0;
  const productCount = summary?.product.count ?? 0;
  const allCount = outletCount + productCount;

  const tabs: { key: Tab; label: string; icon: typeof Store; count: number }[] =
    [
      { key: 'all', label: 'Semua', icon: MessageSquare, count: allCount },
      { key: 'outlet', label: 'Outlet', icon: Store, count: outletCount },
      { key: 'product', label: 'Produk', icon: Package, count: productCount },
    ];

  return (
    <div className="px-4 mx-2 md:mx-6 pb-12">
      <DashboardHeader
        title="Ulasan"
        description="Semua ulasan pelanggan untuk outlet dan produk kamu."
      />

      {/* Dual summary cards */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <SummaryCard
          title="Rating Outlet"
          icon={Store}
          accentClass="bg-gradient-to-br from-amber-500/10 to-transparent"
          summary={summary?.outlet ?? null}
          loading={summaryLoading}
        />
        <SummaryCard
          title="Rating Produk"
          icon={Package}
          accentClass="bg-gradient-to-br from-blue-500/10 to-transparent"
          summary={summary?.product ?? null}
          loading={summaryLoading}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {tabs.map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            onClick={() => handleTabChange(key)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold border transition-all ${
              tab === key
                ? 'bg-amber-500 text-white border-amber-500 shadow'
                : 'bg-background text-muted-foreground border-muted hover:border-amber-300'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {!summaryLoading && (
              <span
                className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  tab === key ? 'bg-white/20' : 'bg-muted'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Review list */}
      <div className="space-y-3">
        {listLoading ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
        ) : reviews.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <MessageSquare className="h-10 w-10 opacity-20" />
            <p className="text-sm font-semibold">Belum ada ulasan</p>
          </div>
        ) : (
          reviews.map((r) => <ReviewCard key={r.id} review={r} />)
        )}
      </div>

      {/* Pagination */}
      {!listLoading && (
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      )}
    </div>
  );
}
