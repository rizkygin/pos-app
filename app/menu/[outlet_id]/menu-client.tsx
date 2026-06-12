"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import Image from "next/image";
import QRCode from "react-qr-code";
import { MapPin, Phone, Star, Share2, X, Copy, Check, MessageCircle, Navigation } from "lucide-react";
import { fmtIDR } from "@/lib/utils/format";

type Outlet = {
    id: number;
    name: string;
    address: string;
    phone: string;
    lat: string;
    lon: string;
    avatar: string;
    tags: string[];
    is_open: boolean;
    ratings: string;
    review_count: number;
};

type Product = {
    id: string;
    product_name: string;
    price: string;
    price_mark_down: string;
    category: string;
    image: string;
    description: string | null;
    unit: string;
    ratings: string;
    review_count: number;
    is_recommended: boolean;
    isAvailable: boolean;
    discount_percent: number | null;
};

type Props = {
    outlet: Outlet;
    products: Product[];
};

function getImageSrc(image: string): string {
    if (!image || image === "avatar.png") return "/avatar.png";
    if (image.startsWith("http") || image.startsWith("/")) return image;
    return `/products/${image}`;
}

function StarRating({ value, count, size = "sm" }: { value: number; count?: number; size?: "xs" | "sm" }) {
    const s = size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5";
    return (
        <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
                <Star key={n} className={`${s} ${n <= Math.round(value) ? "fill-amber-400 text-amber-400" : "fill-white/20 text-white/20"}`} />
            ))}
            <span className={`font-bold text-white/80 ${size === "xs" ? "text-[10px]" : "text-xs"}`}>
                {value.toFixed(1)}
            </span>
            {count !== undefined && count > 0 && (
                <span className={`flex items-center gap-0.5 text-white/40 ${size === "xs" ? "text-[10px]" : "text-xs"}`}>
                    <MessageCircle className={size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3"} />
                    {count}
                </span>
            )}
        </div>
    );
}

function TiltCard({ children, className }: { children: React.ReactNode; className?: string }) {
    const ref = useRef<HTMLDivElement>(null);

    const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        el.style.transition = "transform 0.08s ease";
        el.style.transform = `perspective(700px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg) translateZ(4px)`;
    }, []);

    const onLeave = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        el.style.transition = "transform 0.45s ease";
        el.style.transform = "perspective(700px) rotateY(0deg) rotateX(0deg) translateZ(0px)";
    }, []);

    return (
        <div ref={ref} onMouseMove={onMove} onMouseLeave={onLeave}
            className={className} style={{ transformStyle: "preserve-3d", willChange: "transform" }}>
            {children}
        </div>
    );
}

function ProductCard({ product, index }: { product: Product; index: number }) {
    const [imgError, setImgError] = useState(false);

    const isDiscounted =
        product.price_mark_down &&
        product.price_mark_down !== "0" &&
        parseFloat(product.price_mark_down) > 0;

    const displayPrice = isDiscounted
        ? parseFloat(product.price_mark_down)
        : parseFloat(product.price);

    const rating = parseFloat(product.ratings);

    return (
        <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4, delay: (index % 8) * 0.055, ease: [0.22, 1, 0.36, 1] }}
        >
            <TiltCard className="h-full">
                <div className="relative h-full flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md hover:border-white/20 hover:bg-white/8 transition-colors">
                    {/* Image */}
                    <div className="relative aspect-[4/3] w-full overflow-hidden">
                        <Image
                            src={imgError ? "/avatar.png" : getImageSrc(product.image)}
                            alt={product.product_name}
                            fill
                            className="object-cover transition-transform duration-500"
                            onError={() => setImgError(true)}
                            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

                        {/* Top badges */}
                        <div className="absolute top-2 left-2 flex flex-col gap-1">
                            {product.is_recommended && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/90 px-2 py-0.5 text-[10px] font-black text-black backdrop-blur-sm">
                                    ✦ Rekomendasi
                                </span>
                            )}
                            {isDiscounted && product.discount_percent && (
                                <span className="rounded-full bg-rose-500/90 px-2 py-0.5 text-[10px] font-black text-white backdrop-blur-sm">
                                    -{product.discount_percent}%
                                </span>
                            )}
                        </div>

                        {/* Sold out */}
                        {!product.isAvailable && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                                <span className="rounded-xl border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-white">
                                    Habis
                                </span>
                            </div>
                        )}

                        {/* Rating pinned to bottom of image */}
                        <div className="absolute bottom-2 left-2">
                            <StarRating value={rating} count={product.review_count} size="xs" />
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex flex-1 flex-col gap-1 p-3 md:p-4">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">
                            {product.category}
                        </span>
                        <p className="line-clamp-2 text-sm font-bold leading-snug text-white md:text-[15px]">
                            {product.product_name}
                        </p>
                        {product.description && (
                            <p className="line-clamp-2 text-[11px] leading-relaxed text-white/45">
                                {product.description}
                            </p>
                        )}

                        {/* Price */}
                        <div className="flex items-baseline gap-2 mt-auto pt-2">
                            <span className="text-sm font-black text-white md:text-base">
                                {fmtIDR(displayPrice)}
                            </span>
                            {isDiscounted && (
                                <span className="text-xs text-white/35 line-through">
                                    {fmtIDR(parseFloat(product.price))}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </TiltCard>
        </motion.div>
    );
}

export function MenuClient({ outlet, products }: Props) {
    const [activeCategory, setActiveCategory] = useState("All");
    const [shareOpen, setShareOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [menuUrl, setMenuUrl] = useState("");

    useEffect(() => {
        setMenuUrl(window.location.href);
    }, []);

    const categories = ["All", ...Array.from(new Set(products.map((p) => p.category))).sort()];
    const filtered = activeCategory === "All" ? products : products.filter((p) => p.category === activeCategory);
    const rating = parseFloat(outlet.ratings);
    const avatarSrc = getImageSrc(outlet.avatar);
    const mapsUrl =
        outlet.lat && outlet.lon && outlet.lat !== "0" && outlet.lon !== "0"
            ? `https://www.google.com/maps?q=${outlet.lat},${outlet.lon}`
            : `https://www.google.com/maps/search/${encodeURIComponent(outlet.address)}`;

    const handleCopy = async () => {
        await navigator.clipboard.writeText(menuUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="min-h-screen bg-[#111114] text-white overflow-x-hidden">

            {/* ── Hero with blurred outlet photo backdrop ── */}
            <div className="relative overflow-hidden">
                {/* Blurred background — outlet's own image */}
                <div
                    className="absolute inset-0 scale-110"
                    style={{
                        backgroundImage: `url(${avatarSrc})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        filter: "blur(48px) brightness(0.55) saturate(1.6)",
                    }}
                />
                {/* Fresh warm-to-dark gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-b from-orange-900/30 via-black/30 to-[#111114]" />
                {/* Top edge tint — fresh amber/teal touch */}
                <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-amber-500/15 to-transparent" />

                {/* Hero content */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                    className="relative z-10 mx-auto max-w-4xl px-5 pb-12 pt-14 md:px-8 md:pt-20"
                >
                    <div className="flex flex-col items-center gap-5 text-center md:flex-row md:items-end md:gap-8 md:text-left">

                        {/* Avatar — crisp on top of blur */}
                        <motion.div
                            initial={{ scale: 0.85, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ duration: 0.55, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
                            className="relative flex-shrink-0"
                        >
                            <div className="h-28 w-28 md:h-36 md:w-36 rounded-2xl overflow-hidden shadow-2xl ring-2 ring-white/25 ring-offset-2 ring-offset-transparent">
                                <Image
                                    src={avatarSrc}
                                    alt={outlet.name}
                                    width={144}
                                    height={144}
                                    className="h-full w-full object-cover"
                                />
                            </div>
                            {/* Open/closed indicator */}
                            <span className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#111114] ${outlet.is_open ? "bg-emerald-400" : "bg-white/30"}`}>
                                {outlet.is_open && <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />}
                            </span>
                        </motion.div>

                        {/* Info */}
                        <div className="flex flex-col gap-2.5">
                            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}>
                                <span className={`mb-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${outlet.is_open ? "bg-emerald-400/20 text-emerald-300 border border-emerald-400/30" : "bg-white/10 text-white/40 border border-white/10"}`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${outlet.is_open ? "bg-emerald-400" : "bg-white/30"}`} />
                                    {outlet.is_open ? "Buka Sekarang" : "Tutup"}
                                </span>
                                <h1 className="text-3xl font-black tracking-tight text-white drop-shadow-lg md:text-5xl">
                                    {outlet.name}
                                </h1>
                            </motion.div>

                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26 }} className="space-y-2">
                                {/* Outlet rating + review count */}
                                <div className="flex items-center justify-center gap-3 md:justify-start">
                                    <StarRating value={rating} count={outlet.review_count} size="sm" />
                                </div>

                                {/* Tags */}
                                {outlet.tags.length > 0 && (
                                    <div className="flex flex-wrap justify-center gap-1.5 md:justify-start">
                                        {outlet.tags.map((tag) => (
                                            <span key={tag} className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-0.5 text-xs font-semibold text-amber-300/80 backdrop-blur-sm">
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {/* Phone */}
                                {outlet.phone && (
                                    <span className="flex items-center justify-center gap-1.5 text-xs text-white/50 md:justify-start">
                                        <Phone className="h-3.5 w-3.5 text-amber-400/70" />
                                        {outlet.phone}
                                    </span>
                                )}
                            </motion.div>

                            {/* Share button */}
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.38 }}
                                className="flex justify-center md:justify-start">
                                <button onClick={() => setShareOpen(true)}
                                    className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-xs font-bold text-white/80 backdrop-blur-sm transition-all hover:bg-white/20 hover:text-white">
                                    <Share2 className="h-3.5 w-3.5" />
                                    Bagikan Menu
                                </button>
                            </motion.div>
                        </div>
                    </div>
                </motion.div>
            </div>

            {/* Subtle warm ambient glow below hero */}
            <div className="pointer-events-none relative h-0">
                <div className="absolute -top-20 left-1/2 -translate-x-1/2 h-40 w-full max-w-150 rounded-full bg-amber-500/8 blur-[80px]" />
            </div>

            {/* ── Category tabs ── */}
            <div className="sticky top-0 z-20 border-b border-white/8 bg-[#111114]/85 backdrop-blur-xl">
                <div className="mx-auto max-w-4xl px-4 md:px-8">
                    <div className="flex gap-1 overflow-x-auto py-3" style={{ scrollbarWidth: "none" }}>
                        {categories.map((cat) => (
                            <button key={cat} onClick={() => setActiveCategory(cat)}
                                className={`relative flex-shrink-0 rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${activeCategory === cat ? "text-white" : "text-white/40 hover:text-white/70"}`}>
                                {activeCategory === cat && (
                                    <motion.span layoutId="cat-pill"
                                        className="absolute inset-0 rounded-full bg-amber-500/90"
                                        transition={{ type: "spring", stiffness: 400, damping: 32 }} />
                                )}
                                <span className="relative z-10">{cat}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Product grid ── */}
            <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={activeCategory}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-5 lg:grid-cols-4"
                    >
                        {filtered.length === 0 ? (
                            <div className="col-span-full py-16 text-center text-white/30">
                                <p className="text-lg font-bold">Tidak ada menu di kategori ini</p>
                            </div>
                        ) : (
                            filtered.map((product, i) => (
                                <ProductCard key={product.id} product={product} index={i} />
                            ))
                        )}
                    </motion.div>
                </AnimatePresence>
            </div>

            {/* ── QR Share Section ── */}
            {menuUrl && (
                <div className="mx-auto max-w-4xl px-4 pb-10 md:px-8">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.45 }}
                        className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/5 p-8 text-center backdrop-blur-md"
                    >
                        <h2 className="text-base font-black text-white">Bagikan Menu Ini</h2>
                        <p className="text-sm text-white/45">Scan dengan kamera untuk share via WhatsApp, LINE, atau chat lainnya</p>
                        <div className="rounded-2xl bg-white p-4 shadow-2xl shadow-black/50">
                            <QRCode value={menuUrl} size={180} />
                        </div>
                        <p className="max-w-xs break-all text-[11px] text-white/25">{menuUrl}</p>
                    </motion.div>
                </div>
            )}

            {/* ── Footer ── */}
            <footer className="border-t border-white/8 px-4 py-8 text-center text-xs text-white/20">
                <p className="font-bold text-white/35">{outlet.name}</p>
                {outlet.address && <p className="mt-1">{outlet.address}</p>}
                {outlet.phone && <p>{outlet.phone}</p>}
                <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-400/10 px-5 py-2 text-xs font-bold text-blue-300 backdrop-blur-sm transition-colors hover:bg-blue-400/20 hover:text-blue-200"
                >
                    <Navigation className="h-3.5 w-3.5" />
                    Lihat Lokasi di Google Maps
                </a>
            </footer>

            {/* ── Share modal ── */}
            <AnimatePresence>
                {shareOpen && (
                    <>
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
                            onClick={() => setShareOpen(false)} />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.92, y: 16 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.92, y: 16 }}
                            transition={{ type: "spring", stiffness: 420, damping: 32 }}
                            className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-sm -translate-y-1/2 rounded-2xl border border-white/15 bg-[#1a1a1e] p-6 shadow-2xl"
                        >
                            <div className="flex items-center justify-between mb-5">
                                <h3 className="text-base font-black text-white">Bagikan Menu</h3>
                                <button onClick={() => setShareOpen(false)}
                                    className="rounded-full p-1.5 text-white/40 hover:bg-white/10 hover:text-white transition-colors">
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            <div className="flex justify-center mb-5">
                                <div className="rounded-xl bg-white p-3 shadow-xl">
                                    <QRCode value={menuUrl} size={160} />
                                </div>
                            </div>
                            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                                <p className="flex-1 truncate text-xs text-white/45">{menuUrl}</p>
                                <button onClick={handleCopy}
                                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-black transition-colors hover:bg-amber-400">
                                    {copied
                                        ? <><Check className="h-3.5 w-3.5" /> Tersalin!</>
                                        : <><Copy className="h-3.5 w-3.5" /> Salin</>}
                                </button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
