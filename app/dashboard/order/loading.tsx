import { Skeleton } from "@/components/ui/skeleton";

export default function OrderLoading() {
    return (
        <main className="pb-24">
            {/* Outlet hero skeleton */}
            <div className="relative h-64 bg-muted animate-pulse" />

            <div className="px-4 md:px-6 mt-6 space-y-8">
                {/* Promo banners skeleton */}
                <div className="flex gap-4 overflow-hidden">
                    {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-32 w-72 rounded-3xl flex-shrink-0" />
                    ))}
                </div>

                {/* Category tabs skeleton */}
                <div className="flex gap-3">
                    {[1, 2, 3, 4, 5].map((i) => (
                        <Skeleton key={i} className="h-10 w-24 rounded-full" />
                    ))}
                </div>

                {/* Product grid skeleton */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="space-y-3">
                            <Skeleton className="aspect-square rounded-3xl" />
                            <Skeleton className="h-4 w-3/4 rounded-full" />
                            <Skeleton className="h-3 w-1/2 rounded-full" />
                            <Skeleton className="h-8 w-full rounded-xl" />
                        </div>
                    ))}
                </div>
            </div>
        </main>
    );
}
