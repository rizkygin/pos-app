"use client";

import { useState, useEffect, useCallback } from "react";

export type WishlistItem = {
    productId: string;
    productName: string;
    productImage: string;
    price: number;
    discountPercent?: number;
    rating: number;
    outletName?: string;
    outletId?: string;
    feature: string;
    unit: string;
};

const STORAGE_KEY = "pos-wishlist";

function readStorage(): WishlistItem[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as WishlistItem[]) : [];
    } catch {
        return [];
    }
}

function writeStorage(items: WishlistItem[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
        // ignore quota errors
    }
}

export function useWishlist() {
    const [items, setItems] = useState<WishlistItem[]>([]);

    useEffect(() => {
        setItems(readStorage());
    }, []);

    const add = useCallback((item: WishlistItem) => {
        setItems((prev) => {
            if (prev.some((i) => i.productId === item.productId)) return prev;
            const next = [...prev, item];
            writeStorage(next);
            return next;
        });
    }, []);

    const remove = useCallback((productId: string) => {
        setItems((prev) => {
            const next = prev.filter((i) => i.productId !== productId);
            writeStorage(next);
            return next;
        });
    }, []);

    const toggle = useCallback((item: WishlistItem) => {
        setItems((prev) => {
            const exists = prev.some((i) => i.productId === item.productId);
            const next = exists
                ? prev.filter((i) => i.productId !== item.productId)
                : [...prev, item];
            writeStorage(next);
            return next;
        });
    }, []);

    const has = useCallback(
        (productId: string) => items.some((i) => i.productId === productId),
        [items]
    );

    return { items, add, remove, toggle, has };
}
