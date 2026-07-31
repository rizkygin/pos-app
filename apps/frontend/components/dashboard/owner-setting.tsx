"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { motion } from "motion/react";
import { MapPin, Loader2, Camera, Store, Phone, Navigation, Utensils, Coffee, Wrench, ShoppingBag, PackageOpen, Scissors, Bike, Sparkles, Popcorn, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FEATURES } from "@/lib/feature-categories";
import { ORDER_FEATURES } from "@/lib/order-features";
import { API_URL } from "@/lib/api-url";
import { resolveOutletImage, isBackendImage } from "@/lib/image-src";
import { parseCoord, isValidCoord } from "@/lib/coords";
import { getCurrentPosition, geolocationMessage, GEOLOCATION_OPTIONS } from "@/lib/geolocation";
import { PushNotificationCard } from "@/components/dashboard/push-notification-card";

const FEATURE_META = ORDER_FEATURES.filter((f) => f.isAvailable);

// Map centre before the outlet's own coordinates load.
const DEFAULT_LAT = -6.2088;
const DEFAULT_LON = 106.8456;

const BG_IMAGES = [
    "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1920&q=80&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=1920&q=80&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=1920&q=80&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1920&q=80&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1920&q=80&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1526367790999-0150786686a2?w=1920&q=80&auto=format&fit=crop",
];

const LocationPicker = dynamic(
    () => import("./location-picker").then((m) => m.LocationPicker),
    { ssr: false, loading: () => <div className="h-80 rounded-2xl bg-muted animate-pulse" /> }
);

type Outlet = {
    id: number;
    name: string;
    phone: string;
    address: string;
    lat: string;
    lon: string;
    avatar: string;
    is_open: boolean;
    features: string[];
    tags: string[];
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-2">
            <p className="text-sm font-bold text-muted-foreground">{label}</p>
            {children}
        </div>
    );
}

export function OwnerSetting() {
    const [bgImage] = useState(() => BG_IMAGES[Math.floor(Math.random() * BG_IMAGES.length)]);
    const [loading, setLoading] = useState(true);
    const [isOpen, setIsOpen] = useState(true);
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [address, setAddress] = useState("");
    const [lat, setLat] = useState(DEFAULT_LAT);
    const [lon, setLon] = useState(DEFAULT_LON);
    const [avatar, setAvatar] = useState("avatar.png");
    // Read-only: written by the backend from the outlet's products.
    const [features, setFeatures] = useState<string[]>([]);
    const [tags, setTags] = useState<string[]>([]);
    const [tagInput, setTagInput] = useState("");
    const [locating, setLocating] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
    const [isPending, startTransition] = useTransition();
    const fileRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        fetch(`${API_URL}/api/outlet/me`, { credentials: "include" })
            .then((res) => res.json())
            .then((data: { success: boolean; outlet: Outlet | null }) => {
                const outlet = data.outlet;
                if (!outlet) return;
                setIsOpen(outlet.is_open);
                setName(outlet.name);
                setPhone(outlet.phone);
                setAddress(outlet.address);
                // Keep the Jakarta default when the stored value isn't a real
                // coordinate — parseFloat('') is NaN, which crashed the picker.
                setLat(parseCoord(outlet.lat) ?? DEFAULT_LAT);
                setLon(parseCoord(outlet.lon) ?? DEFAULT_LON);
                setAvatar(outlet.avatar);
                setFeatures(outlet.features);
                setTags(outlet.tags);
            })
            .finally(() => setLoading(false));
    }, []);

    const avatarSrc = resolveOutletImage(avatar);

    function handleGetLocation() {
        setLocating(true);
        getCurrentPosition(
            (pos) => {
                setLat(pos.coords.latitude);
                setLon(pos.coords.longitude);
                setLocating(false);
            },
            (err) => {
                setMessage({ ok: false, text: geolocationMessage(err) });
                setLocating(false);
            },
            GEOLOCATION_OPTIONS,
        );
    }

    async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        const fd = new FormData();
        fd.append("image", file);
        const res = await fetch(`${API_URL}/api/outlet/me/avatar`, {
            method: "POST",
            credentials: "include",
            body: fd,
        }).then((r) => r.json());
        if (res.success && res.imageUrl) setAvatar(res.imageUrl);
        setUploading(false);
    }

    function addTag() {
        const trimmed = tagInput.trim();
        if (!trimmed || tags.includes(trimmed) || tags.length >= 3) return;
        setTags((prev) => [...prev, trimmed]);
        setTagInput("");
    }

    function handleSave() {
        setMessage(null);
        // Refuse to write a coordinate the map can't read back. String(NaN) is
        // the text "NaN", which persists and breaks the picker on every reopen.
        if (!isValidCoord(lat, lon)) {
            setMessage({
                ok: false,
                text: "Titik lokasi outlet belum valid. Pakai 'Lokasi Saya' atau geser pin di peta.",
            });
            return;
        }
        startTransition(async () => {
            const res = await fetch(`${API_URL}/api/outlet/me`, {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name,
                    phone,
                    address,
                    lat: String(lat),
                    lon: String(lon),
                    is_open: isOpen,
                    // features is derived server-side from products — see the
                    // Kategori Layanan card below; the API ignores it now.
                    tags,
                    avatar,
                }),
            }).then((r) => r.json());
            setMessage({ ok: res.success, text: res.message });
        });
    }

    return (
        <div className="relative min-h-screen">
            <div className="absolute inset-0 z-0 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <div className="absolute inset-0 bg-background/50" />
            </div>
            <div className="relative z-10 px-4 md:px-6 pb-16 space-y-8 max-w-2xl">

                {/* Header */}
                <div>
                    <h1 className="text-2xl font-black">Pengaturan Outlet</h1>
                    <p className="text-muted-foreground mt-1 text-sm">Kelola profil dan informasi outlet kamu.</p>
                </div>

                {/* ── Status Outlet ─────────────────────────────────────── */}
                <div className="flex items-center justify-between p-5 rounded-2xl border border-border/60 bg-card shadow-sm">
                    <div className="space-y-0.5">
                        <p className="font-black text-base flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${isOpen ? "bg-emerald-500" : "bg-rose-500"}`} />
                            {isOpen ? "Outlet Sedang Buka" : "Outlet Sedang Tutup"}
                        </p>
                        <p className="text-xs text-muted-foreground">Pelanggan bisa memesan jika outlet buka.</p>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={isOpen}
                        onClick={() => setIsOpen((v) => !v)}
                        className={`relative inline-flex h-7 w-13 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${isOpen ? "bg-emerald-500" : "bg-muted"}`}
                    >
                        <span
                            className={`pointer-events-none inline-block h-6 w-6 rounded-full bg-white shadow-md ring-0 transition-transform duration-200 ${isOpen ? "translate-x-6" : "translate-x-0"}`}
                        />
                    </button>
                </div>

                {/* ── Push Notifications ───────────────────────────────── */}
                <PushNotificationCard />

                {/* ── Avatar ────────────────────────────────────────────── */}
                <div className="flex items-center gap-5 p-5 rounded-2xl border border-border/60 bg-card shadow-sm">
                    <div className="relative h-20 w-20 rounded-2xl overflow-hidden flex-shrink-0 ring-2 ring-border">
                        <Image
                            src={avatarSrc}
                            alt="Avatar outlet"
                            fill
                            className="object-cover"
                            unoptimized={isBackendImage(avatar)}
                        />
                        {uploading && (
                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                <Loader2 className="h-5 w-5 text-white animate-spin" />
                            </div>
                        )}
                    </div>
                    <div className="space-y-1">
                        <p className="font-bold text-sm">Foto Outlet</p>
                        <p className="text-xs text-muted-foreground">Format JPG/PNG/WebP, maks. 5MB</p>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-xl mt-1"
                            onClick={() => fileRef.current?.click()}
                            disabled={uploading}
                        >
                            <Camera className="h-3.5 w-3.5 mr-1.5" />
                            {uploading ? "Mengunggah..." : "Ganti Foto"}
                        </Button>
                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleAvatarChange}
                        />
                    </div>
                </div>

                {/* ── Info Fields ───────────────────────────────────────── */}
                <div className="p-5 rounded-2xl border border-border/60 bg-card shadow-sm space-y-5">
                    <p className="font-black flex items-center gap-2"><Store className="h-4 w-4 text-rose-500" /> Informasi Outlet</p>

                    <Field label="Nama Outlet">
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Nama outlet..."
                            className="rounded-xl"
                        />
                    </Field>

                    <Field label="Nomor Telepon">
                        <div className="relative">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                type="tel"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder="+62..."
                                className="rounded-xl pl-10"
                            />
                        </div>
                    </Field>

                    <Field label="Alamat">
                        <Input
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            placeholder="Jl. Contoh No. 1..."
                            className="rounded-xl"
                        />
                    </Field>
                </div>

                {/* ── Tags ─────────────────────────────────────────────── */}
                <div className="p-5 rounded-2xl border border-border/60 bg-card shadow-sm space-y-4">
                    <div>
                        <p className="font-black flex items-center gap-2">
                            <Tag className="h-4 w-4 text-rose-500" /> Tag Outlet
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">Tambahkan hingga 3 tag untuk outlet kamu.</p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            <span className="text-xs text-muted-foreground mt-1">Contoh:</span>
                            {["Halal", "24 Jam", "Free Ongkir", "Buka Hari Ini"].map((ex) => (
                                <span key={ex} className="px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium border border-border/40">{ex}</span>
                            ))}
                        </div>
                    </div>
                    {tags.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {tags.map((tag) => (
                                <span key={tag} className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold">
                                    {tag}
                                    <button type="button" onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}>
                                        <X className="h-3 w-3" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                    {tags.length < 3 ? (
                        <div className="flex gap-2">
                            <Input
                                value={tagInput}
                                onChange={(e) => setTagInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                                placeholder="Ketik tag lalu tekan Enter..."
                                className="rounded-xl"
                            />
                            <button
                                type="button"
                                onClick={addTag}
                                className="px-4 py-2 rounded-xl border border-border/60 bg-background text-sm font-bold hover:border-rose-200 hover:bg-rose-50/40 transition-all"
                            >
                                Tambah
                            </button>
                        </div>
                    ) : (
                        <p className="text-xs text-muted-foreground">Maksimal 3 tag sudah dipilih.</p>
                    )}
                </div>

                {/* ── Features (read-only) ─────────────────────────────────
                    Derived from the outlet's products by the backend, not
                    chosen here. The old checklist drifted from reality in both
                    directions: an outlet kept advertising a category after it
                    stopped selling it (customers tapped in to an empty outlet),
                    or sold products in a category it had never ticked (those
                    products never showed in browse at all). Shown for
                    transparency so the owner understands where they appear. */}
                <div className="p-5 rounded-2xl border border-border/60 bg-card shadow-sm space-y-4">
                    <div>
                        <p className="font-black flex items-center gap-2">
                            <Store className="h-4 w-4 text-rose-500" /> Kategori Layanan
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                            Otomatis mengikuti produk yang pian jual. Tambah produk di kategori
                            tertentu, outlet langsung muncul di kategori itu.
                        </p>
                    </div>
                    {features.length === 0 ? (
                        <p className="text-xs text-muted-foreground rounded-xl bg-muted/40 px-4 py-3">
                            Belum ada kategori. Outlet pian belum muncul di pencarian pelanggan —
                            tambahkan produk dulu di menu Produk.
                        </p>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {features.map((slug) => {
                                const meta = FEATURE_META.find((f) => f.slug === slug);
                                const Icon = meta?.icon ?? Store;
                                return (
                                    <span
                                        key={slug}
                                        className="flex items-center gap-2 px-3 py-2 rounded-2xl border-2 border-rose-400 bg-rose-50"
                                    >
                                        <Icon className="h-4 w-4 text-rose-600" />
                                        <span className="text-xs font-bold text-rose-700">
                                            {meta?.label ?? slug}
                                        </span>
                                    </span>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* ── Location ─────────────────────────────────────────── */}
                <div className="p-5 rounded-2xl border border-border/60 bg-card shadow-sm space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="font-black flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-rose-500" /> Lokasi Outlet
                        </p>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-xl"
                            onClick={handleGetLocation}
                            disabled={locating}
                        >
                            {locating
                                ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                : <Navigation className="h-3.5 w-3.5 mr-1.5" />
                            }
                            {locating ? "Mendapatkan lokasi..." : "Lokasi Saya"}
                        </Button>
                    </div>

                    <p className="text-xs text-muted-foreground">Klik peta atau seret penanda untuk mengubah lokasi.</p>

                    <LocationPicker lat={lat} lon={lon} onChange={(la, lo) => { setLat(la); setLon(lo); }} />

                    <div className="flex gap-3 text-xs text-muted-foreground bg-muted/40 rounded-xl px-4 py-2.5">
                        <span>Lat: <span className="font-black text-foreground">{lat.toFixed(6)}</span></span>
                        <span>·</span>
                        <span>Lon: <span className="font-black text-foreground">{lon.toFixed(6)}</span></span>
                    </div>
                </div>

                {/* ── Save ─────────────────────────────────────────────── */}
                {message && (
                    <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`px-4 py-3 rounded-2xl text-sm font-bold ${message.ok ? "bg-emerald-50 border border-emerald-200 text-emerald-700" : "bg-rose-50 border border-rose-200 text-rose-700"}`}
                    >
                        {message.text}
                    </motion.div>
                )}

                <Button
                    onClick={handleSave}
                    disabled={isPending}
                    className="w-full rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-black py-6 shadow-lg shadow-rose-200"
                >
                    {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    {isPending ? "Menyimpan..." : "Simpan Perubahan"}
                </Button>
            </div>
        </div>
    );
}
