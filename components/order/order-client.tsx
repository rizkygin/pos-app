"use client";

import { useState, useMemo } from "react";
import { useWishlist, type WishlistItem } from "@/hooks/use-wishlist";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import {
    Search,
    Heart,
    ShoppingBasket,
    Plus,
    Minus,
    Trash2,
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
    ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StarRating } from "@/components/star-rating";
import { fmtIDR, discountedPrice } from "@/lib/utils/format";
import { ProductCard, type OrderProduct } from "@/components/order/product-card";
import { OutletPromoCard, type OutletPromo } from "@/components/order/outlet-promo-card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet";

// ─── Types ─────────────────────────────────────────────────────────────────

type Product = OrderProduct;

type Outlet = {
    id: number;
    name: string;
    address: string;
    phone: string;
    ratings: number;
    avatar: string;
    coverImage: string;
    tags: string[];
    isOpen: boolean;
    estimatedTime: string;
};

type Promo = OutletPromo;

type CartItem = {
    product: Product;
    quantity: number;
    note: string;
};

// ─── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_OUTLET: Outlet = {
    id: 1,
    name: "Warung Makan Bu Tini",
    address: "Jl. Sudirman No. 45, Jakarta Pusat",
    phone: "+62 812-3456-7890",
    ratings: 4.8,
    avatar: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=200&auto=format&fit=crop&q=60",
    coverImage: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1200&auto=format&fit=crop&q=80",
    tags: ["Indonesian", "Homestyle", "Halal"],
    isOpen: true,
    estimatedTime: "20–35 min",
};

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

const MOCK_PRODUCTS: Product[] = [
    // Makanan
    {
        id: "prod1",
        product_name: "Nasi Ayam Bakar",
        price: 35000,
        price_mark_down: 35000,
        category: "Makanan",
        image: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=500&auto=format&fit=crop&q=60",
        ratings: 4.9,
        isAvailable: true,
        description: "Ayam bakar dengan bumbu rempah khas, disajikan dengan nasi putih hangat",
        unit: "porsi",
        isRecommended: true,
        discountPercent: 20,
    },
    {
        id: "prod2",
        product_name: "Soto Ayam Komplit",
        price: 28000,
        price_mark_down: 28000,
        category: "Makanan",
        image: "https://images.unsplash.com/photo-1547592180-85f173990554?w=500&auto=format&fit=crop&q=60",
        ratings: 4.7,
        isAvailable: true,
        description: "Soto ayam kuah bening dengan telur, perkedel, dan kerupuk",
        unit: "porsi",
        isRecommended: true,
    },
    {
        id: "prod3",
        product_name: "Nasi Goreng Spesial",
        price: 30000,
        price_mark_down: 30000,
        category: "Makanan",
        image: "https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=500&auto=format&fit=crop&q=60",
        ratings: 4.5,
        isAvailable: true,
        description: "Nasi goreng dengan telur, ayam, dan sayuran segar",
        unit: "porsi",
    },
    {
        id: "prod4",
        product_name: "Mie Goreng Jawa",
        price: 25000,
        price_mark_down: 25000,
        category: "Makanan",
        image: "https://images.unsplash.com/photo-1569050467447-ce54b3bbc37d?w=500&auto=format&fit=crop&q=60",
        ratings: 4.3,
        isAvailable: true,
        description: "Mie goreng dengan bumbu kecap dan rempah khas Jawa",
        unit: "porsi",
    },
    {
        id: "prod5",
        product_name: "Gado-Gado Jakarta",
        price: 22000,
        price_mark_down: 22000,
        category: "Makanan",
        image: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=500&auto=format&fit=crop&q=60",
        ratings: 4.6,
        isAvailable: false,
        description: "Sayuran segar dengan bumbu kacang yang gurih",
        unit: "porsi",
    },
    // Minuman
    {
        id: "prod6",
        product_name: "Es Teh Manis",
        price: 8000,
        price_mark_down: 8000,
        category: "Minuman",
        image: "https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=500&auto=format&fit=crop&q=60",
        ratings: 4.8,
        isAvailable: true,
        description: "Teh manis dingin menyegarkan",
        unit: "gelas",
        isRecommended: true,
        discountPercent: 15,
    },
    {
        id: "prod7",
        product_name: "Jus Alpukat",
        price: 18000,
        price_mark_down: 18000,
        category: "Minuman",
        image: "https://images.unsplash.com/photo-1623065422902-30a2d299bbe4?w=500&auto=format&fit=crop&q=60",
        ratings: 4.7,
        isAvailable: true,
        description: "Jus alpukat segar dengan susu kental manis",
        unit: "gelas",
    },
    {
        id: "prod8",
        product_name: "Kopi Susu Aren",
        price: 22000,
        price_mark_down: 22000,
        category: "Minuman",
        image: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=500&auto=format&fit=crop&q=60",
        ratings: 4.9,
        isAvailable: true,
        description: "Kopi susu dengan gula aren asli",
        unit: "gelas",
        isRecommended: true,
    },
    // Snack
    {
        id: "prod9",
        product_name: "Pisang Goreng Keju",
        price: 15000,
        price_mark_down: 15000,
        category: "Snack",
        image: "https://images.unsplash.com/photo-1571748982800-fa51082c2224?w=500&auto=format&fit=crop&q=60",
        ratings: 4.6,
        isAvailable: true,
        description: "Pisang goreng crispy dengan topping keju parut",
        unit: "porsi",
        discountPercent: 30,
    },
    {
        id: "prod10",
        product_name: "Martabak Telur Mini",
        price: 20000,
        price_mark_down: 20000,
        category: "Snack",
        image: "https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=60",
        ratings: 4.4,
        isAvailable: true,
        description: "Martabak telur gurih dengan isian daging cincang",
        unit: "porsi",
        isRecommended: true,
    },
    // Dessert
    {
        id: "prod11",
        product_name: "Es Campur",
        price: 17000,
        price_mark_down: 17000,
        category: "Dessert",
        image: "https://images.unsplash.com/photo-1488477181946-6428a0291777?w=500&auto=format&fit=crop&q=60",
        ratings: 4.5,
        isAvailable: true,
        description: "Es campur dengan kelapa muda, cincau, dan sirup segar",
        unit: "porsi",
    },
    {
        id: "prod12",
        product_name: "Klepon Isi Gula Merah",
        price: 12000,
        price_mark_down: 12000,
        category: "Dessert",
        image: "https://images.unsplash.com/photo-1600626334183-35fb5a7e1882?w=500&auto=format&fit=crop&q=60",
        ratings: 4.8,
        isAvailable: true,
        description: "Klepon tradisional isi gula merah dengan taburan kelapa",
        unit: "porsi",
        isRecommended: true,
    },
];

const CATEGORIES = ["Semua", "Makanan", "Minuman", "Snack", "Dessert"];

// ─── Basket Sheet Content ───────────────────────────────────────────────────

function BasketSheetContent({
    cart,
    onIncrement,
    onDecrement,
    onRemove,
    appliedPromo,
    onRemovePromo,
}: {
    cart: CartItem[];
    onIncrement: (id: string) => void;
    onDecrement: (id: string) => void;
    onRemove: (id: string) => void;
    appliedPromo: Promo | null;
    onRemovePromo: () => void;
}) {
    const subtotal = cart.reduce((acc, item) => {
        const price = discountedPrice(item.product.price, item.product.discountPercent);
        return acc + price * item.quantity;
    }, 0);

    const promoDiscount = appliedPromo && subtotal >= appliedPromo.minOrder
        ? Math.floor(subtotal * (appliedPromo.discountPercent / 100))
        : 0;

    const total = subtotal - promoDiscount;

    if (cart.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
                <ShoppingBasket className="h-16 w-16 opacity-20" />
                <p className="font-bold text-lg">Keranjang kosong</p>
                <p className="text-sm text-center">Tambahkan produk dari menu di bawah</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Items */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                <AnimatePresence>
                    {cart.map((item) => {
                        const finalPrice = discountedPrice(item.product.price, item.product.discountPercent);
                        return (
                            <motion.div
                                key={item.product.id}
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="flex gap-3 p-3 rounded-2xl bg-muted/40 border border-border/50"
                            >
                                <div className="relative h-16 w-16 rounded-xl overflow-hidden flex-shrink-0">
                                    <Image src={item.product.image} alt={item.product.product_name} fill className="object-cover" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-bold text-sm leading-tight line-clamp-1">{item.product.product_name}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">{fmtIDR(finalPrice)} / {item.product.unit}</p>
                                    <div className="flex items-center justify-between mt-2">
                                        <div className="flex items-center gap-1.5 bg-background border border-border rounded-xl px-1 h-7">
                                            <button
                                                onClick={() => onDecrement(item.product.id)}
                                                className="h-5 w-5 rounded-lg bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600"
                                            >
                                                <Minus className="h-2.5 w-2.5" />
                                            </button>
                                            <span className="font-black text-xs w-4 text-center">{item.quantity}</span>
                                            <button
                                                onClick={() => onIncrement(item.product.id)}
                                                className="h-5 w-5 rounded-lg bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600"
                                            >
                                                <Plus className="h-2.5 w-2.5" />
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <p className="font-black text-sm text-rose-600">{fmtIDR(finalPrice * item.quantity)}</p>
                                            <button
                                                onClick={() => onRemove(item.product.id)}
                                                className="text-muted-foreground hover:text-destructive transition-colors"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>

            {/* Summary */}
            <div className="border-t border-border/60 pt-4 mt-4 space-y-3">
                {appliedPromo && (
                    <div className="flex items-center justify-between rounded-xl bg-green-50 border border-green-200 px-3 py-2">
                        <div className="flex items-center gap-2">
                            <Tag className="h-3.5 w-3.5 text-green-600" />
                            <span className="text-xs font-bold text-green-700">{appliedPromo.code}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-green-700">
                                {promoDiscount > 0 ? `-${fmtIDR(promoDiscount)}` : "Min. belum terpenuhi"}
                            </span>
                            <button onClick={onRemovePromo} className="text-green-600 hover:text-green-800">
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                )}

                <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between text-muted-foreground">
                        <span>Subtotal</span>
                        <span className="font-semibold">{fmtIDR(subtotal)}</span>
                    </div>
                    {promoDiscount > 0 && (
                        <div className="flex justify-between text-green-600">
                            <span>Diskon promo</span>
                            <span className="font-semibold">-{fmtIDR(promoDiscount)}</span>
                        </div>
                    )}
                    <Separator />
                    <div className="flex justify-between font-black text-base">
                        <span>Total</span>
                        <span className="text-rose-600">{fmtIDR(total)}</span>
                    </div>
                </div>

                <Button className="w-full rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-black py-6 shadow-lg shadow-rose-200">
                    Checkout <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}

// ─── Wishlist Sheet Content ─────────────────────────────────────────────────

function WishlistSheetContent({
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
                    const finalPrice = discountedPrice(product.price, product.discountPercent);
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

    // ── Filtering ──
    const filteredProducts = useMemo(() => {
        return MOCK_PRODUCTS.filter((p) => {
            const matchCategory = selectedCategory === "Semua" || p.category === selectedCategory;
            const matchSearch = p.product_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                p.description.toLowerCase().includes(searchQuery.toLowerCase());
            return matchCategory && matchSearch;
        });
    }, [selectedCategory, searchQuery]);

    // ── Recommended per category ──
    const recommendedByCategory = useMemo(() => {
        const map: Record<string, Product[]> = {};
        MOCK_PRODUCTS.forEach((p) => {
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
        const product = MOCK_PRODUCTS.find((p) => p.id === productId);
        if (!product) return;
        const item: WishlistItem = {
            productId: product.id,
            productName: product.product_name,
            productImage: product.image,
            price: product.price,
            discountPercent: product.discountPercent,
            rating: product.ratings,
            outletName: MOCK_OUTLET.name,
            outletId: String(MOCK_OUTLET.id),
            feature: feature ?? "food",
            unit: product.unit,
        };
        wishlistStore.toggle(item);
    }

    const wishlistedProducts = MOCK_PRODUCTS.filter((p) => wishlistStore.has(p.id));

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
            <div className="relative h-56 md:h-72 overflow-hidden mt-3">
                <Image
                    src={MOCK_OUTLET.coverImage}
                    alt={MOCK_OUTLET.name}
                    fill
                    className="object-cover"
                    priority
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

                <div className="absolute bottom-0 left-0 right-0 p-5 md:p-8">
                    <div className="flex items-end gap-4">
                        <div className="relative h-16 w-16 md:h-20 md:w-20 rounded-2xl overflow-hidden ring-4 ring-white/30 flex-shrink-0">
                            <Image src={MOCK_OUTLET.avatar} alt={MOCK_OUTLET.name} fill className="object-cover" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black ${MOCK_OUTLET.isOpen ? "bg-green-400/90 text-green-900" : "bg-red-400/90 text-red-900"}`}>
                                    {MOCK_OUTLET.isOpen ? "Buka" : "Tutup"}
                                </span>
                                {MOCK_OUTLET.tags.map((tag) => (
                                    <span key={tag} className="px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-sm text-[10px] font-bold text-white">
                                        {tag}
                                    </span>
                                ))}
                            </div>
                            <h1 className="text-xl md:text-3xl font-black text-white leading-tight truncate">{MOCK_OUTLET.name}</h1>
                            <div className="flex items-center gap-4 mt-1 text-white/80 text-xs">
                                <div className="flex items-center gap-1">
                                    <StarRating rating={MOCK_OUTLET.ratings} size="sm" />
                                    <span className="font-black text-amber-300">{MOCK_OUTLET.ratings.toFixed(1)}</span>
                                    <span className="text-white/60">(2.4k ulasan)</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    <span>{MOCK_OUTLET.estimatedTime}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Outlet Info Bar ──────────────────────────────────────── */}
            <div className="bg-card border-b border-border/60 px-5 md:px-8 py-3 flex items-center gap-6 text-xs text-muted-foreground overflow-x-auto">
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    <MapPin className="h-3.5 w-3.5 text-rose-500" />
                    <span className="font-medium">{MOCK_OUTLET.address}</span>
                </div>
                <div className="h-4 w-px bg-border flex-shrink-0" />
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Phone className="h-3.5 w-3.5 text-rose-500" />
                    <span className="font-medium">{MOCK_OUTLET.phone}</span>
                </div>
                <div className="h-4 w-px bg-border flex-shrink-0" />
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Store className="h-3.5 w-3.5 text-rose-500" />
                    <span className="font-medium">
                        {MOCK_PRODUCTS.filter((p) => p.isAvailable).length} menu tersedia
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
                    {CATEGORIES.map((cat) => (
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
                                {filteredProducts.map((product) => (
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
                            wishlistedProducts={wishlistedProducts}
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
                                <Badge variant="secondary" className="ml-auto">{cartTotal} item</Badge>
                            </SheetTitle>
                        </SheetHeader>
                        <BasketSheetContent
                            cart={cart}
                            onIncrement={incrementCart}
                            onDecrement={decrementCart}
                            onRemove={removeFromCart}
                            appliedPromo={appliedPromo}
                            onRemovePromo={() => setAppliedPromo(null)}
                        />
                    </SheetContent>
                </Sheet>
            </div>
        </div>
    );
}
