"use client";

import { useState, useRef, useTransition } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { motion } from "motion/react";
import { MapPin, Loader2, Camera, Store, Phone, Navigation, Utensils, Coffee, Wrench, ShoppingBag, PackageOpen, Scissors, Bike, Sparkles, Popcorn, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateOutletAction, uploadOutletAvatar } from "@/app/dashboard/setting/actions";
import { FEATURES } from "@/lib/feature-categories";
import { ORDER_FEATURES } from "@/lib/order-features";

const FEATURE_META = ORDER_FEATURES;

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

export function OwnerSetting({ outlet }: { outlet: Outlet | null }) {
    const [bgImage] = useState(() => BG_IMAGES[Math.floor(Math.random() * BG_IMAGES.length)]);
    const [isOpen, setIsOpen] = useState(outlet?.is_open ?? true);
    const [name, setName] = useState(outlet?.name ?? "");
    const [phone, setPhone] = useState(outlet?.phone ?? "");
    const [address, setAddress] = useState(outlet?.address ?? "");
    const [lat, setLat] = useState(parseFloat(outlet?.lat ?? "-6.2088"));
    const [lon, setLon] = useState(parseFloat(outlet?.lon ?? "106.8456"));
    const [avatar, setAvatar] = useState(outlet?.avatar ?? "avatar.png");
    const [features, setFeatures] = useState<string[]>(outlet?.features ?? []);
    const [tags, setTags] = useState<string[]>(outlet?.tags ?? []);
    const [tagInput, setTagInput] = useState("");
    const [locating, setLocating] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
    const [isPending, startTransition] = useTransition();
    const fileRef = useRef<HTMLInputElement>(null);

    const avatarSrc = avatar.startsWith("/") ? avatar : `/${avatar}`;

    function handleGetLocation() {
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setLat(pos.coords.latitude);
                setLon(pos.coords.longitude);
                setLocating(false);
            },
            () => {
                alert("Gagal mendapatkan lokasi. Pastikan izin lokasi diaktifkan.");
                setLocating(false);
            }
        );
    }

    async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        const fd = new FormData();
        fd.append("image", file);
        const res = await uploadOutletAvatar(fd);
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
        startTransition(async () => {
            const res = await updateOutletAction({
                name,
                phone,
                address,
                lat: String(lat),
                lon: String(lon),
                is_open: isOpen,
                features,
                tags,
                avatar,
            });
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

                {/* ── Avatar ────────────────────────────────────────────── */}
                <div className="flex items-center gap-5 p-5 rounded-2xl border border-border/60 bg-card shadow-sm">
                    <div className="relative h-20 w-20 rounded-2xl overflow-hidden flex-shrink-0 ring-2 ring-border">
                        <Image src={avatarSrc} alt="Avatar outlet" fill className="object-cover" />
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

                {/* ── Features ─────────────────────────────────────────── */}
                <div className="p-5 rounded-2xl border border-border/60 bg-card shadow-sm space-y-4">
                    <div>
                        <p className="font-black flex items-center gap-2">
                            <Store className="h-4 w-4 text-rose-500" /> Kategori Layanan
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">Pilih layanan yang outlet kamu tawarkan.</p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {FEATURE_META.map((f) => {
                            const meta = f;
                            const Icon = f.icon ?? Store;
                            const active = features.includes(f.slug);
                            return (
                                <button
                                    key={f.slug}
                                    type="button"
                                    onClick={() => setFeatures((prev) =>
                                        prev.includes(f.slug)
                                            ? prev.filter((s) => s !== f.slug)
                                            : [...prev, f.slug]
                                    )}
                                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-2xl border-2 text-left transition-all duration-150 ${active
                                        ? "border-rose-400 bg-rose-50 shadow-sm"
                                        : "border-border/60 bg-background hover:border-rose-200 hover:bg-rose-50/40"
                                        }`}
                                >
                                    <div className={`h-8 w-8 rounded-xl flex items-center justify-center flex-shrink-0 ${active ? meta?.gradient ?? "bg-rose-100" : "bg-muted"}`}>
                                        <Icon className={`h-4 w-4 ${active ? meta?.color ?? "text-rose-600" : "text-muted-foreground"}`} />
                                    </div>
                                    <span className={`text-xs font-bold leading-tight ${active ? "text-rose-700" : "text-muted-foreground"}`}>
                                        {meta?.label ?? f}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    {features.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                            {features.length} kategori dipilih
                        </p>
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
