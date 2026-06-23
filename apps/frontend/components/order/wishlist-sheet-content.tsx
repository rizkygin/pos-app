"use client";

import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import { Heart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StarRating } from "@/components/star-rating";
import { fmtIDR, discountedPrice } from "@/lib/utils/format";
import type { OrderProduct } from "@/components/order/product-card";
import type { CartItem } from "@/components/order/basket-sheet-content";

type Product = OrderProduct;

export function WishlistSheetContent({
    wishlistedProducts,
    onRemove,
    onAddToCart,
    cart,
}: {
    wishlistedProducts: Product[];
    onRemove: (id: string) => void;
    onAddToCart: (product: Product) => void;
    cart: CartItem[];
}) {
    if (wishlistedProducts.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
                <Heart className="h-16 w-16 opacity-20" />
                <p className="font-bold text-lg">Wishlist kosong</p>
                <p className="text-sm text-center">Tekan ikon hati pada produk untuk menyimpannya</p>
            </div>
        );
    }

    return (
        <div className="space-y-3 overflow-y-auto">
            <AnimatePresence>
                {wishlistedProducts.map((product) => {
                    const finalPrice = discountedPrice(product.price, product.price_mark_down);
                    const inCart = cart.some((c) => c.product.id === product.id);
                    return (
                        <motion.div
                            key={product.id}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className="flex gap-3 p-3 rounded-2xl bg-muted/40 border border-border/50"
                        >
                            <div className="relative h-16 w-16 rounded-xl overflow-hidden flex-shrink-0">
                                <Image src={product.image} alt={product.product_name} fill className="object-cover" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-bold text-sm leading-tight line-clamp-1">{product.product_name}</p>
                                <div className="flex items-center gap-1 mt-0.5">
                                    <StarRating rating={product.ratings} size="sm" />
                                    <span className="text-xs text-amber-600 font-bold">{product.ratings.toFixed(1)}</span>
                                </div>
                                <p className="text-xs font-black text-rose-600 mt-0.5">{fmtIDR(finalPrice)}</p>
                                <div className="flex items-center gap-2 mt-2">
                                    <Button
                                        size="sm"
                                        onClick={() => onAddToCart(product)}
                                        disabled={!product.isAvailable || inCart}
                                        className="h-7 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs px-3"
                                    >
                                        {inCart ? "Di Keranjang" : "Tambah"}
                                    </Button>
                                    <button
                                        onClick={() => onRemove(product.id)}
                                        className="text-muted-foreground hover:text-destructive transition-colors"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    );
                })}
            </AnimatePresence>
        </div>
    );
}
