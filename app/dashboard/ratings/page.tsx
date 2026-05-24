"use client";

import { useEffect, useState } from "react";
import { Star, Store, Package, MessageSquare } from "lucide-react";
import { DashboardHeader } from "@/components/dashboard-header";

type ReviewType = "outlet" | "product";

type Review = {
    id: string;
    reviewer_name: string;
    rating: number;
    comment: string;
    created_at: string;
    type: ReviewType;
    product_name: string | null;
};

function initials(name: string) {
    return name
        .split(" ")
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? "")
        .join("");
}

const AVATAR_COLORS = [
    "bg-blue-100 text-blue-700",
    "bg-purple-100 text-purple-700",
    "bg-emerald-100 text-emerald-700",
    "bg-rose-100 text-rose-700",
    "bg-amber-100 text-amber-700",
];

type Tab = "semua" | "outlet" | "produk";

function StarDisplay({ value, size = "sm" }: { value: number; size?: "sm" | "lg" }) {
    const cls = size === "lg" ? "h-6 w-6" : "h-3.5 w-3.5";
    return (
        <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((i) => (
                <Star
                    key={i}
                    className={`${cls} ${i <= Math.round(value) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/25"}`}
                />
            ))}
        </div>
    );
}

function RatingBar({ label, count, total }: { label: string; count: number; total: number }) {
    const pct = total > 0 ? (count / total) * 100 : 0;
    return (
        <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-muted-foreground w-4 shrink-0">{label}</span>
            <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" />
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div
                    className="h-full bg-amber-400 rounded-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                />
            </div>
            <span className="text-xs text-muted-foreground w-4 shrink-0 text-right">{count}</span>
        </div>
    );
}

function ReviewCard({ review }: { review: Review }) {
    const colorIdx = review.reviewer_name.charCodeAt(0) % AVATAR_COLORS.length;
    const formatted = new Date(review.created_at).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
    });

    return (
        <div className="flex gap-4 p-4 rounded-xl border bg-background hover:shadow-sm transition-shadow">
            <div className={`shrink-0 h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold ${AVATAR_COLORS[colorIdx]}`}>
                {initials(review.reviewer_name)}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                        <p className="text-sm font-bold leading-none">{review.reviewer_name}</p>
                        <div className="mt-1">
                            <StarDisplay value={review.rating} />
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        {review.type === "product" && review.product_name ? (
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
                        <span className="text-[10px] text-muted-foreground">{formatted}</span>
                    </div>
                </div>
                {review.comment ? (
                    <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{review.comment}</p>
                ) : (
                    <p className="mt-2 text-sm text-muted-foreground/50 italic">Tidak ada komentar.</p>
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

export default function RatingsPage() {
    const [reviews, setReviews] = useState<Review[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<Tab>("semua");

    useEffect(() => {
        fetch("/api/get-ratings")
            .then((r) => r.json())
            .then((json) => setReviews(json.data ?? []))
            .finally(() => setLoading(false));
    }, []);

    const total = reviews.length;
    const avgRating = total > 0 ? reviews.reduce((a, r) => a + r.rating, 0) / total : 0;

    const dist = [5, 4, 3, 2, 1].map((star) => ({
        star,
        count: reviews.filter((r) => r.rating === star).length,
    }));

    const outletCount = reviews.filter((r) => r.type === "outlet").length;
    const productCount = reviews.filter((r) => r.type === "product").length;

    const filtered =
        tab === "outlet"
            ? reviews.filter((r) => r.type === "outlet")
            : tab === "produk"
            ? reviews.filter((r) => r.type === "product")
            : reviews;

    const tabs: { key: Tab; label: string; count: number; icon: typeof Store }[] = [
        { key: "semua",  label: "Semua",  count: total,        icon: MessageSquare },
        { key: "outlet", label: "Outlet", count: outletCount,  icon: Store },
        { key: "produk", label: "Produk", count: productCount, icon: Package },
    ];

    return (
        <div className="px-4 mx-2 md:mx-6 pb-12">
            <DashboardHeader
                title="Ulasan"
                description="Semua ulasan pelanggan untuk outlet dan produk kamu."
            />

            {/* Summary */}
            <div className="rounded-2xl border bg-gradient-to-br from-amber-600/10 to-transparent p-6 mb-6">
                {loading ? (
                    <div className="flex gap-6 animate-pulse">
                        <div className="flex flex-col items-center gap-2 px-6">
                            <div className="h-16 w-20 bg-muted rounded" />
                            <div className="h-4 w-28 bg-muted rounded" />
                        </div>
                        <div className="flex-1 space-y-3 pt-2">
                            {[5,4,3,2,1].map(s => <div key={s} className="h-2 bg-muted rounded-full" />)}
                        </div>
                    </div>
                ) : total === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
                        <Star className="h-10 w-10 opacity-20" />
                        <p className="text-sm font-semibold">Belum ada ulasan</p>
                    </div>
                ) : (
                    <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center">
                        <div className="flex flex-col items-center gap-1 px-6">
                            <span className="text-6xl font-extrabold tracking-tight text-amber-500">
                                {avgRating.toFixed(1)}
                            </span>
                            <StarDisplay value={avgRating} size="lg" />
                            <span className="text-xs text-muted-foreground mt-1">{total} ulasan</span>
                        </div>
                        <div className="flex-1 w-full space-y-2">
                            {dist.map(({ star, count }) => (
                                <RatingBar key={star} label={String(star)} count={count} total={total} />
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-4">
                {tabs.map(({ key, label, count, icon: Icon }) => (
                    <button
                        key={key}
                        onClick={() => setTab(key)}
                        className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold border transition-all ${
                            tab === key
                                ? "bg-amber-500 text-white border-amber-500 shadow"
                                : "bg-background text-muted-foreground border-muted hover:border-amber-300"
                        }`}
                    >
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                        <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${tab === key ? "bg-white/20" : "bg-muted"}`}>
                            {count}
                        </span>
                    </button>
                ))}
            </div>

            {/* Review list */}
            <div className="space-y-3">
                {loading ? (
                    Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
                        <MessageSquare className="h-10 w-10 opacity-20" />
                        <p className="text-sm font-semibold">Belum ada ulasan</p>
                    </div>
                ) : (
                    filtered.map((r) => <ReviewCard key={r.id} review={r} />)
                )}
            </div>
        </div>
    );
}
