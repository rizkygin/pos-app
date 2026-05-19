"use client";

import { useState, useRef, useTransition } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { motion } from "motion/react";
import { MapPin, Loader2, Camera, Store, Phone, Navigation, Utensils, Coffee, Wrench, ShoppingBag, PackageOpen, Scissors, Bike, Sparkles, Popcorn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateOutletAction, uploadOutletAvatar } from "@/app/dashboard/setting/actions";
import { FEATURES } from "@/lib/feature-categories";

const FEATURE_META: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
    makan: { label: "Pesan Makanan", icon: Utensils, color: "text-rose-600", bg: "bg-rose-100" },
    minum: { label: "Pesan Minuman", icon: Coffee, color: "text-amber-700", bg: "bg-amber-100" },
    cemil: { label: "Cemilan", icon: Popcorn, color: "text-orange-600", bg: "bg-orange-100" },
    jasa: { label: "Layanan Jasa", icon: Wrench, color: "text-blue-600", bg: "bg-blue-100" },
    "kirim paket": { label: "Kirim Paket", icon: PackageOpen, color: "text-violet-600", bg: "bg-violet-100" },
    "kecantikan dan spa": { label: "Kecantikan & Spa", icon: Scissors, color: "text-pink-600", bg: "bg-pink-100" },
    "sewa kendaraan": { label: "Sewa Kendaraan", icon: Bike, color: "text-cyan-600", bg: "bg-cyan-100" },
    "hiburan dan aktivitas": { label: "Hiburan & Aktivitas", icon: Sparkles, color: "text-indigo-600", bg: "bg-indigo-100" },
    "belanja mart": { label: "Belanja Mart", icon: ShoppingBag, color: "text-emerald-600", bg: "bg-emerald-100" },
};

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
    const [isOpen, setIsOpen] = useState(outlet?.is_open ?? true);
    const [name, setName] = useState(outlet?.name ?? "");
    const [phone, setPhone] = useState(outlet?.phone ?? "");
    const [address, setAddress] = useState(outlet?.address ?? "");
    const [lat, setLat] = useState(parseFloat(outlet?.lat ?? "-6.2088"));
    const [lon, setLon] = useState(parseFloat(outlet?.lon ?? "106.8456"));
    const [avatar, setAvatar] = useState(outlet?.avatar ?? "avatar.png");
    const [features, setFeatures] = useState<string[]>(outlet?.features ?? []);
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
                avatar,
            });
            setMessage({ ok: res.success, text: res.message });
        });
    }

    return (
        <div className="px-4 md:px-6 pb-16 space-y-8 max-w-2xl">

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

            {/* ── Features ─────────────────────────────────────────── */}
            <div className="p-5 rounded-2xl border border-border/60 bg-card shadow-sm space-y-4">
                <div>
                    <p className="font-black flex items-center gap-2">
                        <Store className="h-4 w-4 text-rose-500" /> Kategori Layanan
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">Pilih layanan yang outlet kamu tawarkan.</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {FEATURES.map((f) => {
                        const meta = FEATURE_META[f];
                        const Icon = meta?.icon ?? Store;
                        const active = features.includes(f);
                        return (
                            <button
                                key={f}
                                type="button"
                                onClick={() => setFeatures((prev) =>
                                    prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]
                                )}
                                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-2xl border-2 text-left transition-all duration-150 ${active
                                        ? "border-rose-400 bg-rose-50 shadow-sm"
                                        : "border-border/60 bg-background hover:border-rose-200 hover:bg-rose-50/40"
                                    }`}
                            >
                                <div className={`h-8 w-8 rounded-xl flex items-center justify-center flex-shrink-0 ${active ? meta?.bg ?? "bg-rose-100" : "bg-muted"}`}>
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
    );
}
