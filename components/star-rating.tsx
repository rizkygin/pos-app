import { Star } from "lucide-react";

export function StarRating({ rating, size = "sm" }: { rating: number; size?: "sm" | "md" | "lg" }) {
    const sz = size === "sm" ? "h-3 w-3" : size === "md" ? "h-4 w-4" : "h-5 w-5";
    return (
        <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((s) => (
                <Star
                    key={s}
                    className={`${sz} ${s <= Math.round(rating) ? "fill-amber-400 text-amber-400" : "fill-muted text-muted"}`}
                />
            ))}
        </div>
    );
}
