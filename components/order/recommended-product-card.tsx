"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "motion/react";
import { Sparkles } from "lucide-react";
import { StarRating } from "@/components/star-rating";
import { fmtIDR } from "@/lib/utils/format";
import { type Product } from "@/lib/types";

export function RecommendedProductCard({ product, feature }: { product: Product; feature: string }) {
    const finalPrice = product.discount_percent
        ? product.price - Math.floor(product.price * (product.discount_percent / 100))
        : product.price;

    return (
        <Link href={`/dashboard/order/${feature}/${product.outletId}`}>
            <motion.div
                whileHover={{ y: -4, scale: 1.02 }}
                className="group flex-shrink-0 w-44 bg-card border border-border/60 rounded-[1.5rem] overflow-hidden shadow-sm hover:shadow-lg transition-all cursor-pointer"
            >
                <div className="relative h-28 overflow-hidden">
                    <Image src={product.image} alt={product.product_name} fill className="object-cover group-hover:scale-110 transition-transform duration-500" />
                    {product.discount_percent && (
                        <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-rose-500/90 backdrop-blur-sm text-[9px] font-black text-white">
                            -{product.discount_percent}%
                        </span>
                    )}
                    <span className="absolute top-2 right-2 flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-amber-400/90 backdrop-blur-sm text-[9px] font-black text-amber-900">
                        <Sparkles className="h-2.5 w-2.5" /> Top
                    </span>
                </div>
                <div className="p-3 space-y-1">
                    <p className="font-black text-xs leading-tight line-clamp-2 group-hover:text-rose-600 transition-colors">{product.product_name}</p>
                    <p className="text-[10px] text-muted-foreground line-clamp-1">{product.outlet}</p>
                    <div className="flex items-center gap-1">
                        <StarRating rating={product.ratings} size="sm" />
                        <span className="text-[10px] font-bold text-amber-600">{product.ratings}</span>
                        <span className="text-[10px] text-muted-foreground">({product.review_count})</span>
                    </div>
                    <div>
                        {product.discount_percent && (
                            <p className="text-[10px] line-through text-muted-foreground">{fmtIDR(product.price)}</p>
                        )}
                        <p className="text-xs font-black text-rose-600">{fmtIDR(finalPrice)}</p>
                    </div>
                </div>
            </motion.div>
        </Link>
    );
}
