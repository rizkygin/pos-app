"use client";

import { useState, useMemo, useEffect } from "react";
import { useWishlist, type WishlistItem } from "@/hooks/use-wishlist";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import {
    Search,
    Heart,
    ShoppingBasket,
    MapPin,
    Phone,
    Clock,
    Tag,
    ChevronRight,
    ChevronLeft,
    X,
    Store,
    BadgePercent,
    SlidersHorizontal,
} from "lucide-react";
import { StarRating } from "@/components/star-rating";
import { fmtIDR, discountedPrice } from "@/lib/utils/format";
import { ProductCard } from "@/components/order/product-card";
import { OutletPromoCard, type OutletPromo } from "@/components/order/outlet-promo-card";
import { BasketSheetContent, type CartItem } from "@/components/order/basket-sheet-content";
import { WishlistSheetContent } from "@/components/order/wishlist-sheet-content";
import type { Outlet } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet";
import { useQuery } from "@tanstack/react-query";
import { OutletSchema, ProductSchema, type Product } from "@/lib/types";

// ─── Types ─────────────────────────────────────────────────────────────────

type Promo = OutletPromo;


const MOCK_PROMOS: Promo[] = [
    {
        id: "p1",
        title: "Promo Makan Siang",
        description: "Diskon untuk semua menu makan siang",
        code: "SIANG20",
        discountPercent: 20,
        minOrder: 50000,
        expiresAt: "2026-05-31",
        color: "text-white",
        bgGradient: "from-rose-500 to-pink-600",
    },
    {
        id: "p2",
        title: "Pelanggan Baru",
        description: "Khusus untuk pelanggan pertama kali",
        code: "NEWBIE30",
        discountPercent: 30,
        minOrder: 30000,
        expiresAt: "2026-06-15",
        color: "text-white",
        bgGradient: "from-violet-500 to-purple-600",
    },
    {
        id: "p3",
        title: "Weekend Special",
        description: "Setiap Sabtu & Minggu",
        code: "WEEKEND15",
        discountPercent: 15,
        minOrder: 40000,
        expiresAt: "2026-05-18",
        color: "text-white",
        bgGradient: "from-amber-500 to-orange-600",
    },
];



// ─── Main Component ─────────────────────────────────────────────────────────

export function OrderClient({ feature, outletId: _outletId }: { feature?: string; outletId?: string }) {
    const backHref = feature ? `/dashboard/order/${feature}` : "/dashboard/order";
    const [selectedCategory, setSelectedCategory] = useState("Semua");
    const [searchQuery, setSearchQuery] = useState("");
    const [cart, setCart] = useState<CartItem[]>([]);
    const wishlistStore = useWishlist();
    const [appliedPromo, setAppliedPromo] = useState<Promo | null>(null);
    const [basketOpen, setBasketOpen] = useState(false);
    const [wishlistOpen, setWishlistOpen] = useState(false);
    const [showAllPromos, setShowAllPromos] = useState(false);

    const { data: categoriesData } = useQuery<string[]>({
        queryKey: ['categories', _outletId],
        queryFn: async () => {
            const rest = await fetch(`/api/get-categories?outletId=${_outletId}`);
            if (!rest.ok) throw new Error("Failed to fetch categories");
            const json = await rest.json();
            console.log(json.data)

            return json.data;

        },
        enabled: !!_outletId,
    })

    const { data: outlet, error: errorFetchOutlet } = useQuery<Outlet>({
        queryKey: ['outlets', _outletId],

        queryFn: async () => {
            const res = await fetch('/api/get-outlet-id?outletId=' + _outletId);
            if (!res.ok) {
                throw new Error("Failed to fetch outlet")
            }
            const { data } = await res.json()
            return OutletSchema.parse(data);

        },

        enabled: !!_outletId
    })

    if (errorFetchOutlet) {
        console.error("[OrderClient] Failed to fetch outlet:", errorFetchOutlet.message)
    }


    const categories = useMemo(() => {
        const initialCategories = ["Semua"]
        categoriesData?.map((cat: any) => initialCategories.push(cat.category))
        return initialCategories

    }, [categoriesData, _outletId])

    const { data: products } = useQuery<Product[]>({
        queryKey: ['products', _outletId],
        queryFn: async () => {
            const rest = await fetch(`/api/get-all-product?id=${_outletId}`);
            if (!rest.ok) throw new Error("Failed to fetch products");
            const json = await rest.json();
            return ProductSchema.array().parse(json.data);
        },
        enabled: !!_outletId,
    })

    const filteredProducts = useMemo(() => {
        if (!products) return [];

        const matchSearch: Product[] = products.filter((p: Product) =>
            p.isAvailable &&
            (p.product_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (p.description ?? "").toLowerCase().includes(searchQuery.toLowerCase()))
        );

        if (selectedCategory === "Semua") {
            return matchSearch;
        }

        return matchSearch.filter((p: Product) => p.category === selectedCategory);
    }, [products, searchQuery, selectedCategory]);


    // ── Recommended per category ──
    const recommendedByCategory = useMemo(() => {
        const map: Record<string, Product[]> = {};
        products?.forEach((p) => {
            if (p.isRecommended) {
                if (!map[p.category]) map[p.category] = [];
                map[p.category].push(p);
            }
        });
        return map;
    }, []);

    // ── Cart actions ──
    const cartTotal = cart.reduce((acc, item) => acc + item.quantity, 0);

    function addToCart(product: Product) {
        setCart((prev) => {
            const existing = prev.find((c) => c.product.id === product.id);
            if (existing) return prev.map((c) => c.product.id === product.id ? { ...c, quantity: c.quantity + 1 } : c);
            return [...prev, { product, quantity: 1, note: "" }];
        });
    }

    function incrementCart(productId: string) {
        setCart((prev) => prev.map((c) => c.product.id === productId ? { ...c, quantity: c.quantity + 1 } : c));
    }

    function decrementCart(productId: string) {
        setCart((prev) => {
            const item = prev.find((c) => c.product.id === productId);
            if (!item) return prev;
            if (item.quantity <= 1) return prev.filter((c) => c.product.id !== productId);
            return prev.map((c) => c.product.id === productId ? { ...c, quantity: c.quantity - 1 } : c);
        });
    }

    function removeFromCart(productId: string) {
        setCart((prev) => prev.filter((c) => c.product.id !== productId));
    }

    // ── Wishlist actions ──
    function toggleWishlist(productId: string) {
        const product = products?.find((p) => p.id === productId);
        if (!product) return;
        const item: WishlistItem = {
            productId: product.id,
            productName: product.product_name,
            productImage: product.image,
            price: product.price,
            discountPercent: product.discountPercent,
            rating: product.ratings,
            outletName: outlet?.name,
            outletId: String(outlet?.id),
            feature: feature ?? "food",
            unit: product.unit,
        };
        wishlistStore.toggle(item);
    }

    const wishlistedProducts = products?.filter((p) => wishlistStore.has(p.id));

    return (
        <div className="min-h-screen bg-background pb-32">

            {/* ── Back link ────────────────────────────────────────────── */}
            <div className="px-5 pt-4">
                <Link
                    href={backHref}
                    className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ChevronLeft className="h-4 w-4" /> Kembali
                </Link>
            </div>

            {/* ── Outlet Hero ─────────────────────────────────────────── */}
            {outlet && <div className="relative h-56 md:h-72 overflow-hidden mt-3">
                <Image
                    src={outlet?.coverImage}
                    alt={outlet?.name}
                    fill
                    className="object-cover"
                    priority
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

                <div className="absolute bottom-0 left-0 right-0 p-5 md:p-8">
                    <div className="flex items-end gap-4">
                        <div className="relative h-16 w-16 md:h-20 md:w-20 rounded-2xl overflow-hidden ring-4 ring-white/30 flex-shrink-0">
                            <Image src={outlet?.image} alt={outlet?.name} fill className="object-cover" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black ${outlet?.isOpen ? "bg-green-400/90 text-green-900" : "bg-red-400/90 text-red-900"}`}>
                                    {outlet?.isOpen ? "Buka" : "Tutup"}
                                </span>
                                {outlet?.tags.map((tag) => (
                                    <span key={tag} className="px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-sm text-[10px] font-bold text-white">
                                        {tag}
                                    </span>
                                ))}
                            </div>
                            <h1 className="text-xl md:text-3xl font-black text-white leading-tight truncate">{outlet?.name}</h1>
                            <div className="flex items-center gap-4 mt-1 text-white/80 text-xs">
                                <div className="flex items-center gap-1">
                                    <StarRating rating={outlet?.ratings} size="sm" />
                                    <span className="font-black text-amber-300">{outlet?.ratings.toFixed(1)}</span>
                                    <span className="text-white/60">(2.4k ulasan)</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    <span>{outlet?.estimatedTime}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>}


            {/* ── Outlet Info Bar ──────────────────────────────────────── */}
            <div className="bg-card border-b border-border/60 px-5 md:px-8 py-3 flex items-center gap-6 text-xs text-muted-foreground overflow-x-auto">
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    <MapPin className="h-3.5 w-3.5 text-rose-500" />
                    <span className="font-medium">{outlet?.address}</span>
                </div>
                <div className="h-4 w-px bg-border flex-shrink-0" />
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Phone className="h-3.5 w-3.5 text-rose-500" />
                    <span className="font-medium">{outlet?.phone}</span>
                </div>
                <div className="h-4 w-px bg-border flex-shrink-0" />
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Store className="h-3.5 w-3.5 text-rose-500" />
                    <span className="font-medium">
                        {products?.filter((p) => p.isAvailable).length} menu tersedia
                    </span>
                </div>
            </div>

            <div className="px-4 md:px-8 space-y-8 pt-6">

                {/* ── Promo Section ──────────────────────────────────────── */}
                <section className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <BadgePercent className="h-5 w-5 text-rose-500" />
                            <h2 className="font-black text-lg">Promo Outlet</h2>
                        </div>
                        <button
                            onClick={() => setShowAllPromos((v) => !v)}
                            className="flex items-center gap-1 text-rose-600 text-sm font-bold hover:text-rose-700"
                        >
                            {showAllPromos ? "Sembunyikan" : "Lihat Semua"}
                            <ChevronRight className={`h-4 w-4 transition-transform ${showAllPromos ? "rotate-90" : ""}`} />
                        </button>
                    </div>

                    <div className={`flex gap-4 ${showAllPromos ? "flex-wrap" : "overflow-x-auto pb-2"}`}>
                        {MOCK_PROMOS.map((promo) => (
                            <OutletPromoCard
                                key={promo.id}
                                promo={promo}
                                onApply={(p: Promo) => setAppliedPromo((prev) => prev?.id === p.id ? null : p)}
                                isApplied={appliedPromo?.id === promo.id}
                            />
                        ))}
                    </div>

                    {appliedPromo && (
                        <motion.div
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-green-50 border border-green-200 text-green-700 text-sm font-bold"
                        >
                            <Tag className="h-4 w-4" />
                            Promo <span className="font-black">{appliedPromo.code}</span> diterapkan — hemat {appliedPromo.discountPercent}%!
                            <button onClick={() => setAppliedPromo(null)} className="ml-auto text-green-600 hover:text-green-800">
                                <X className="h-4 w-4" />
                            </button>
                        </motion.div>
                    )}
                </section>

                {/* ── Search ────────────────────────────────────────────── */}
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <Input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Cari menu..."
                        className="pl-12 pr-4 py-6 rounded-2xl text-base shadow-sm border-border/60 bg-card"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery("")}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>

                {/* ── Category Tabs ─────────────────────────────────────── */}
                <div className="flex gap-2.5 overflow-x-auto pb-1 no-scrollbar">
                    {categories.map((cat) => (
                        <button
                            key={cat}
                            onClick={() => setSelectedCategory(cat)}
                            className={`flex-shrink-0 px-5 py-2.5 rounded-full text-sm font-black transition-all duration-200 ${selectedCategory === cat
                                ? "bg-rose-500 text-white shadow-md shadow-rose-200"
                                : "bg-card border border-border/60 text-muted-foreground hover:border-rose-300 hover:text-rose-600"
                                }`}
                        >
                            {cat}
                            {cat !== "Semua" && recommendedByCategory[cat]?.length > 0 && (
                                <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] font-black text-amber-900">
                                    {recommendedByCategory[cat].length}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* ── Products Grid ─────────────────────────────────────── */}
                <section className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="font-black text-lg">
                            {selectedCategory === "Semua" ? "Semua Menu" : selectedCategory}
                            <span className="ml-2 text-sm font-semibold text-muted-foreground">({filteredProducts.length})</span>
                        </h2>
                        <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground font-bold">
                            <SlidersHorizontal className="h-4 w-4" /> Filter
                        </button>
                    </div>

                    {filteredProducts.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
                            <Search className="h-12 w-12 opacity-20" />
                            <p className="font-bold">Menu tidak ditemukan</p>
                            <p className="text-sm">Coba kata kunci lain</p>
                        </div>
                    ) : (
                        <motion.div layout className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            <AnimatePresence>
                                {filteredProducts?.map((product: Product) => (
                                    <ProductCard
                                        key={product.id}
                                        product={product}
                                        onAddToCart={addToCart}
                                        onToggleWishlist={toggleWishlist}
                                        isWishlisted={wishlistStore.has(product.id)}
                                        cartQuantity={cart.find((c) => c.product.id === product.id)?.quantity ?? 0}
                                        onIncrement={incrementCart}
                                        onDecrement={decrementCart}
                                    />
                                ))}
                            </AnimatePresence>
                        </motion.div>
                    )}
                </section>
            </div>

            {/* ── Floating Action Bar ───────────────────────────────────── */}
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3">
                {/* Wishlist button */}
                <Sheet open={wishlistOpen} onOpenChange={setWishlistOpen}>
                    <SheetTrigger asChild>
                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className="relative flex items-center gap-2 px-5 py-3.5 rounded-full bg-white border border-border shadow-xl shadow-black/10 font-bold text-sm hover:bg-rose-50 transition-colors"
                        >
                            <Heart className="h-5 w-5 text-rose-500" />
                            <span>Wishlist</span>
                            {wishlistStore.items.length > 0 && (
                                <span className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center">
                                    {wishlistStore.items.length}
                                </span>
                            )}
                        </motion.button>
                    </SheetTrigger>
                    <SheetContent side="right" className="w-full max-w-sm flex flex-col gap-4">
                        <SheetHeader>
                            <SheetTitle className="font-black text-xl flex items-center gap-2">
                                <Heart className="h-5 w-5 text-rose-500 fill-rose-500" /> Wishlist
                                <Badge variant="secondary" className="ml-auto">{wishlistStore.items.length} item</Badge>
                            </SheetTitle>
                        </SheetHeader>
                        <WishlistSheetContent
                            wishlistedProducts={wishlistedProducts ?? []}
                            onRemove={toggleWishlist}
                            onAddToCart={addToCart}
                            cart={cart}
                        />
                    </SheetContent>
                </Sheet>

                {/* Basket button */}
                <Sheet open={basketOpen} onOpenChange={setBasketOpen}>
                    <SheetTrigger asChild>
                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className="relative flex items-center gap-2 px-6 py-3.5 rounded-full bg-rose-500 hover:bg-rose-600 text-white shadow-xl shadow-rose-300 font-bold text-sm transition-colors"
                        >
                            <ShoppingBasket className="h-5 w-5" />
                            <span>Keranjang</span>
                            {cartTotal > 0 && (
                                <span className="absolute -top-1.5 -right-1.5 h-5 min-w-5 px-1 rounded-full bg-amber-400 text-amber-900 text-[10px] font-black flex items-center justify-center">
                                    {cartTotal}
                                </span>
                            )}
                            {cart.length > 0 && (
                                <span className="ml-1 text-rose-100 font-semibold text-xs">
                                    {fmtIDR(cart.reduce((acc, item) => acc + discountedPrice(item.product.price, item.product.discountPercent) * item.quantity, 0))}
                                </span>
                            )}
                        </motion.button>
                    </SheetTrigger>
                    <SheetContent side="right" className="w-full max-w-sm flex flex-col gap-4">
                        <SheetHeader>
                            <SheetTitle className="font-black text-xl flex items-center gap-2">
                                <ShoppingBasket className="h-5 w-5 text-rose-500" /> Keranjang
                                <Badge variant="secondary" className="ml-auto ml-5">{cartTotal} item</Badge>
                            </SheetTitle>
                        </SheetHeader>
                        <BasketSheetContent
                            cart={cart}
                            onIncrement={incrementCart}
                            onDecrement={decrementCart}
                            onRemove={removeFromCart}
                            appliedPromo={appliedPromo}
                            onRemovePromo={() => setAppliedPromo(null)}
                            outlet_id={Number(_outletId)}
                        />
                    </SheetContent>
                </Sheet>
            </div>
        </div>
    );
}
