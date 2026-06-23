"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { StarRating } from "@/components/star-rating";
import { fmtIDR } from "@/lib/utils/format";
import { type Product } from "@/lib/types";

export function ProductSearchCard({ product, feature }: { product: Product; feature: string }) {
    const finalPrice = product.discountPercent
        ? product.price - Math.floor(product.price * (product.discountPercent / 100))
        : product.price;

    return (
        <Link href={`/dashboard/order/${feature}/${product.outleid}`}>
            <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                whileHover={{ y: -3 }}
                className="group flex gap-3 p-3 bg-card border border-border/60 rounded-2xl shadow-sm hover:shadow-md transition-all cursor-pointer"
            >
                <div className="relative h-20 w-20 rounded-xl overflow-hidden flex-shrink-0">
                    <Image src={product.image.startsWith('http') || product.image.startsWith('/') ? product.image : `/${product.image}`} alt={product.product_name} fill className="object-cover group-hover:scale-110 transition-transform duration-300" />
                    {product.discountPercent && (
                        <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded-full bg-rose-500/90 text-[8px] font-black text-white">
                            -{product.discountPercent}%
                        </span>
                    )}
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                    <p className="font-black text-sm leading-tight line-clamp-2 group-hover:text-rose-600 transition-colors">{product.product_name}</p>
                    <p className="text-[11px] text-muted-foreground">{product.outlet}</p>
                    <div className="flex items-center gap-1.5">
                        <StarRating rating={product.ratings} />
                        <span className="text-[11px] font-bold text-amber-600">{product.ratings.toFixed(1)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <div>
                            {product.discountPercent && (
                                <p className="text-[10px] line-through text-muted-foreground">{fmtIDR(product.price)}</p>
                            )}
                            <p className="text-sm font-black text-rose-600">{fmtIDR(finalPrice)}</p>
                        </div>
                        <span className="text-[10px] font-bold text-rose-500 flex items-center gap-0.5">
                            Lihat Menu <ArrowRight className="h-3 w-3" />
                        </span>
                    </div>
                </div>
            </motion.div>
        </Link>
    );
}
