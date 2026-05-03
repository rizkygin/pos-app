"use client";

import { useState, useMemo, useEffect } from "react";
import Image from "next/image";
import {
    Search,
    ShoppingCart,
    Plus,
    Minus,
    Trash2,
    CreditCard,
    Coffee,
    Pizza,
    Cookie,
    Package,
    LayoutGrid
} from "lucide-react";
import { Button } from "@/components/ui/button";

type Product = {
    id: string;
    product_name: string;
    price: string;
    price_mark_down: string;
    category: string;
    image: string;
    isAvailable: boolean;
    description: string | null;
    unit: string;
};

type CartItem = {
    product: Product;
    quantity: number;
};

type CashierClientProps = {
    outletId: number;
    initialProducts: Product[];
};

let CATEGORIES = [
    { id: "All", label: "All Items", icon: LayoutGrid, color: "text-blue-500", bg: "bg-blue-50", border: "border-blue-200" },
];

export const CashierClient = ({ outletId, initialProducts }: CashierClientProps) => {
    const [selectedCategory, setSelectedCategory] = useState<string>("All");
    const [searchQuery, setSearchQuery] = useState("");
    const [cart, setCart] = useState<CartItem[]>([]);

    // Fetch categories
    useEffect(() => {
        const fetchCategories = async () => {
            try {
                // GET requests cannot have a body, so we pass outletId as a query parameter
                const res = await fetch(`/api/get-categories?outletId=${outletId}`);
                if (!res.ok) {
                    throw new Error("Failed to fetch categories");
                }
                const { data } = await res.json();

                console.log(data, "data");
                data?.map((category: any) => {
                    CATEGORIES.push({
                        id: category.category,
                        label: category.category,
                        icon: LayoutGrid,
                        color: "text-red-500",
                        bg: "bg-red-50",
                        border: "border-red-200",
                    });
                })
            } catch (err) {
                console.error(err);
            }
        };
        fetchCategories()



    }, [outletId, CATEGORIES]);

    const filteredProducts = useMemo(() => {
        return initialProducts.filter(product => {
            const matchesCategory = selectedCategory === "All" || product.category === selectedCategory;
            const matchesSearch = product.product_name.toLowerCase().includes(searchQuery.toLowerCase());
            return matchesCategory && matchesSearch;
        });
    }, [initialProducts, selectedCategory, searchQuery]);

    // Cart operations
    const addToCart = (product: Product) => {
        if (!product.isAvailable) return;

        setCart(prev => {
            const existing = prev.find(item => item.product.id === product.id);
            if (existing) {
                return prev.map(item =>
                    item.product.id === product.id
                        ? { ...item, quantity: item.quantity + 1 }
                        : item
                );
            }
            return [...prev, { product, quantity: 1 }];
        });
    };

    const updateQuantity = (productId: string, delta: number) => {
        setCart(prev => prev.map(item => {
            if (item.product.id === productId) {
                const newQuantity = item.quantity + delta;
                return newQuantity > 0 ? { ...item, quantity: newQuantity } : item;
            }
            return item;
        }));
    };

    const removeFromCart = (productId: string) => {
        setCart(prev => prev.filter(item => item.product.id !== productId));
    };

    const clearCart = () => setCart([]);

    // Calculations
    const cartTotal = cart.reduce((total, item) => {
        const price = item.product.price_mark_down && item.product.price_mark_down !== "0"
            ? parseFloat(item.product.price_mark_down)
            : parseFloat(item.product.price);
        return total + (price * item.quantity);
    }, 0);

    const handleCheckout = async () => {
        if (cart.length === 0) return;
        try {
            const response = await fetch('/api/add-order-detail', {
                method: 'POST',
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    outletId,
                    cart,
                    total: cartTotal,
                }),
            });
            let errorMsg = "Failed to add order detail";
            if (!response.ok) {
                try {
                    const data = await response.json();
                    errorMsg = data?.error?.message || data?.error || errorMsg;
                } catch {
                    errorMsg = `Server error: ${response.status} ${response.statusText}`;
                }
                throw new Error(errorMsg);
            }
            clearCart();
            alert("Order detail added successfully");
        } catch (error: any) {
            alert(error.message);
        }
    };

    return (
        <div className="flex h-full max-h-[calc(100vh-4rem)] overflow-hidden">
            {/* Main Content: Products Grid */}
            <div className="flex-1 flex flex-col min-w-0 bg-background/50 backdrop-blur-sm border-r">

                {/* Header & Search */}
                <div className="p-4 md:p-6 pb-0">
                    <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between mb-6">
                        <div>
                            <h1 className="text-3xl font-extrabold tracking-tight">Point of Sale</h1>
                            <p className="text-muted-foreground text-sm mt-1">Select items to add to cart</p>
                        </div>
                        <div className="relative w-full md:w-72">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <input
                                type="text"
                                placeholder="Search products..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full h-11 pl-10 pr-4 rounded-xl border bg-background/80 shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none"
                            />
                        </div>
                    </div>

                    {/* Categories */}
                    <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide">
                        {CATEGORIES.map(cat => (
                            <button
                                key={cat.id}
                                onClick={() => setSelectedCategory(cat.id)}
                                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 whitespace-nowrap transition-all duration-300 font-semibold ${selectedCategory === cat.id
                                    ? `${cat.border} ${cat.bg} ${cat.color} shadow-sm ring-1 ring-current`
                                    : 'border-transparent bg-background/60 hover:bg-muted text-muted-foreground hover:text-foreground hover:border-border'
                                    }`}
                            >
                                <cat.icon className="h-4 w-4" />
                                {cat.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Products Grid */}
                <div className="flex-1 overflow-y-auto p-4 md:p-6 pt-2">
                    {filteredProducts.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
                            <Package className="h-16 w-16 mb-4" />
                            <h3 className="text-xl font-bold mb-2">No products found</h3>
                            <p className="max-w-[250px]">Try adjusting your search or category filter.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6 pb-20">
                            {filteredProducts.map(product => {
                                const isDiscounted = product.price_mark_down && product.price_mark_down !== "0";
                                const displayPrice = isDiscounted ? product.price_mark_down : product.price;
                                const inCart = cart.find(item => item.product.id === product.id)?.quantity || 0;

                                return (
                                    <button
                                        key={product.id}
                                        onClick={() => addToCart(product)}
                                        disabled={!product.isAvailable}
                                        className={`group relative flex flex-col text-left bg-background rounded-2xl overflow-hidden border-2 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 ${!product.isAvailable ? 'opacity-60 cursor-not-allowed border-muted grayscale-[0.5]' :
                                            inCart > 0 ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-transparent hover:border-blue-200'
                                            }`}
                                    >
                                        {/* Image Container */}
                                        <div className="relative aspect-square w-full bg-muted/20 overflow-hidden">
                                            {product.image && product.image !== "avatar.png" ? (
                                                <Image
                                                    src={product.image}
                                                    fill
                                                    className="object-cover transition-transform duration-700 group-hover:scale-110"
                                                    alt={product.product_name}
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center bg-muted/30">
                                                    <Package className="h-12 w-12 text-muted-foreground/40" />
                                                </div>
                                            )}

                                            {/* Stock Badge */}
                                            <div className="absolute top-3 left-3 flex flex-col gap-2">
                                                {!product.isAvailable && (
                                                    <span className="bg-rose-500/90 backdrop-blur text-white text-[10px] font-black uppercase px-2.5 py-1 rounded-full shadow-sm">
                                                        Out of Stock
                                                    </span>
                                                )}
                                                {isDiscounted && product.isAvailable && (
                                                    <span className="bg-emerald-500/90 backdrop-blur text-white text-[10px] font-black uppercase px-2.5 py-1 rounded-full shadow-sm">
                                                        Promo
                                                    </span>
                                                )}
                                            </div>

                                            {/* In Cart Indicator */}
                                            {inCart > 0 && (
                                                <div className="absolute top-3 right-3 bg-blue-600 text-white font-bold h-7 w-7 rounded-full flex items-center justify-center shadow-lg border-2 border-background animate-in zoom-in">
                                                    {inCart}
                                                </div>
                                            )}
                                        </div>

                                        {/* Content */}
                                        <div className="p-4 flex flex-col flex-1">
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                                                {product.category}
                                            </span>
                                            <h3 className="font-bold text-sm md:text-base leading-tight line-clamp-2 mb-2 group-hover:text-blue-600 transition-colors">
                                                {product.product_name}
                                            </h3>

                                            <div className="mt-auto flex items-end justify-between">
                                                <div className="flex flex-col">
                                                    {isDiscounted && (
                                                        <span className="text-xs text-muted-foreground line-through decoration-rose-500/50">
                                                            Rp {product.price}
                                                        </span>
                                                    )}
                                                    <span className="font-extrabold text-blue-600 text-lg">
                                                        Rp {displayPrice}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Sidebar: Shopping Cart */}
            <div className="w-[350px] lg:w-[400px] flex-shrink-0 bg-background flex flex-col shadow-2xl relative z-10 border-l">
                {/* Cart Header */}
                <div className="p-6 border-b bg-background/80 backdrop-blur-md sticky top-0 z-20">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                                <ShoppingCart className="h-6 w-6" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold">Current Order</h2>
                                <p className="text-sm text-muted-foreground">
                                    {cart.reduce((acc, item) => acc + item.quantity, 0)} Items
                                </p>
                            </div>
                        </div>
                        {cart.length > 0 && (
                            <button
                                onClick={clearCart}
                                className="text-xs font-bold text-rose-500 hover:text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-lg transition-colors"
                            >
                                Clear
                            </button>
                        )}
                    </div>
                </div>

                {/* Cart Items */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {cart.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center opacity-50 px-6">
                            <ShoppingCart className="h-16 w-16 mb-4 text-muted-foreground" />
                            <h3 className="font-bold text-lg mb-1">Cart is empty</h3>
                            <p className="text-sm text-muted-foreground">Select products from the left to add them to your cart.</p>
                        </div>
                    ) : (
                        cart.map(item => {
                            const isDiscounted = item.product.price_mark_down && item.product.price_mark_down !== "0";
                            const displayPrice = isDiscounted ? item.product.price_mark_down : item.product.price;

                            return (
                                <div key={item.product.id} className="flex gap-3 bg-muted/30 p-3 rounded-2xl border animate-in slide-in-from-right-4">
                                    {/* Item Image */}
                                    <div className="relative h-16 w-16 rounded-xl overflow-hidden bg-background border shrink-0">
                                        {item.product.image && item.product.image !== "avatar.png" ? (
                                            <Image src={item.product.image} fill className="object-cover" alt={item.product.product_name} />
                                        ) : (
                                            <Package className="h-8 w-8 m-auto mt-4 text-muted-foreground/30" />
                                        )}
                                    </div>

                                    {/* Item Details */}
                                    <div className="flex-1 flex flex-col justify-between min-w-0">
                                        <div className="flex justify-between items-start gap-2">
                                            <h4 className="font-bold text-sm line-clamp-2 leading-tight">{item.product.product_name}</h4>
                                            <button
                                                onClick={() => removeFromCart(item.product.id)}
                                                className="text-muted-foreground hover:text-rose-500 transition-colors p-1"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>

                                        <div className="flex items-center justify-between mt-2">
                                            <span className="font-bold text-blue-600 text-sm">
                                                Rp {displayPrice}
                                            </span>

                                            {/* Quantity Controls */}
                                            <div className="flex items-center gap-3 bg-background border rounded-lg p-1 shadow-sm">
                                                <button
                                                    onClick={() => updateQuantity(item.product.id, -1)}
                                                    className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground transition-colors"
                                                >
                                                    <Minus className="h-3 w-3" />
                                                </button>
                                                <span className="text-sm font-bold w-4 text-center">{item.quantity}</span>
                                                <button
                                                    onClick={() => updateQuantity(item.product.id, 1)}
                                                    className="w-6 h-6 flex items-center justify-center rounded-md bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors"
                                                >
                                                    <Plus className="h-3 w-3" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Checkout Section */}
                <div className="p-6 bg-background border-t shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.1)]">
                    <div className="space-y-3 mb-6">
                        <div className="flex justify-between text-muted-foreground text-sm font-medium">
                            <span>Subtotal</span>
                            <span>Rp {cartTotal}</span>
                        </div>
                        <div className="flex justify-between text-muted-foreground text-sm font-medium">
                            <span>Tax (0%)</span>
                            <span>Rp 0</span>
                        </div>
                        <div className="h-px w-full bg-border my-2" />
                        <div className="flex justify-between items-end">
                            <span className="text-base font-bold">Total</span>
                            <span className="text-3xl font-black text-blue-600 tracking-tight">Rp {cartTotal}</span>
                        </div>
                    </div>

                    <Button
                        onClick={handleCheckout}
                        disabled={cart.length === 0}
                        className="w-full h-14 rounded-2xl text-lg font-bold shadow-xl shadow-blue-600/20 bg-blue-600 hover:bg-blue-700 transition-all hover:-translate-y-1"
                    >
                        <CreditCard className="mr-2 h-5 w-5" />
                        Checkout Now
                    </Button>
                </div>
            </div>
        </div>
    );
};
