"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { Heart, Plus, Minus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StarRating } from "@/components/star-rating";
import { fmtIDR, discountedPrice } from "@/lib/utils/format";

import type { Product } from "@/lib/types";

export type OrderProduct = Product;

function getProductImageSrc(image: string): string {
    if (!image || image === "avatar.png") return "/avatar.png";
    if (image.startsWith("http") || image.startsWith("/")) return image;
    return `/products/${image}`;
}

export function ProductCard({
    product,
    onAddToCart,
    onToggleWishlist,
    isWishlisted,
    cartQuantity,
    onIncrement,
    onDecrement,
}: {
    product: OrderProduct;
    onAddToCart: (product: OrderProduct) => void;
    onToggleWishlist: (productId: string) => void;
    isWishlisted: boolean;
    cartQuantity: number;
    onIncrement: (productId: string) => void;
    onDecrement: (productId: string) => void;
}) {
    const finalPrice = discountedPrice(product.price, product.discountPercent);

    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            whileHover={{ y: -4 }}
            className={`group relative bg-card rounded-[1.5rem] border border-border/60 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden ${!product.isAvailable ? "opacity-60" : ""}`}
        >
            <div className="relative aspect-square overflow-hidden">
                <Image
                    src={getProductImageSrc(product.image)}
                    alt={product.product_name}
                    fill
                    className="object-cover group-hover:scale-110 transition-transform duration-500"
                />
                <div className="absolute top-2.5 left-2.5 flex flex-col gap-1.5">
                    {product.isRecommended && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/90 backdrop-blur-sm text-[10px] font-black text-amber-900 shadow-sm">
                            <Sparkles className="h-2.5 w-2.5" /> Rekomendasi
                        </span>
                    )}
                    {product.discountPercent && (
                        <span className="px-2 py-0.5 rounded-full bg-rose-500/90 backdrop-blur-sm text-[10px] font-black text-white shadow-sm">
                            -{product.discountPercent}%
                        </span>
                    )}
                </div>
                <button
                    onClick={() => onToggleWishlist(product.id)}
                    className="absolute top-2.5 right-2.5 h-8 w-8 rounded-full bg-white/90 backdrop-blur-sm shadow-sm flex items-center justify-center transition-all hover:scale-110 active:scale-95"
                >
                    <Heart className={`h-4 w-4 transition-colors ${isWishlisted ? "fill-rose-500 text-rose-500" : "text-muted-foreground"}`} />
                </button>
                {!product.isAvailable && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <span className="px-3 py-1 rounded-full bg-black/60 text-white text-xs font-bold">Habis</span>
                    </div>
                )}
            </div>

            <div className="p-3 space-y-1.5">
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">{product.category}</p>
                <h4 className="font-black text-sm leading-tight line-clamp-2">{product.product_name}</h4>
                <div className="flex items-center gap-1.5">
                    <StarRating rating={product.ratings} size="sm" />
                    <span className="text-xs font-bold text-amber-600">{product.ratings.toFixed(1)}</span>
                </div>
                <div className="space-y-0.5">
                    {product.discountPercent ? (
                        <>
                            <p className="text-xs line-through text-muted-foreground font-medium">{fmtIDR(product.price)}</p>
                            <p className="text-sm font-black text-rose-600">{fmtIDR(finalPrice)}</p>
                        </>
                    ) : (
                        <p className="text-sm font-black">{fmtIDR(product.price)}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground">/ {product.unit}</p>
                </div>
                {product.isAvailable && (
                    <div className="pt-1">
                        {cartQuantity === 0 ? (
                            <Button
                                size="sm"
                                onClick={() => onAddToCart(product)}
                                className="w-full rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs h-8 shadow-sm shadow-rose-200"
                            >
                                <Plus className="h-3.5 w-3.5 mr-1" /> Tambah
                            </Button>
                        ) : (
                            <div className="flex items-center justify-between bg-rose-50 border border-rose-200 rounded-xl px-1 h-8">
                                <button
                                    onClick={() => onDecrement(product.id)}
                                    className="h-6 w-6 rounded-lg bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600 transition-colors"
                                >
                                    <Minus className="h-3 w-3" />
                                </button>
                                <span className="font-black text-sm text-rose-700">{cartQuantity}</span>
                                <button
                                    onClick={() => onIncrement(product.id)}
                                    className="h-6 w-6 rounded-lg bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600 transition-colors"
                                >
                                    <Plus className="h-3 w-3" />
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </motion.div>
    );
}
