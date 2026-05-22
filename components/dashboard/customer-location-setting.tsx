"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { MapPin, Navigation, Loader2, Plus, Star, Pencil, Trash2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "motion/react";
import {
    addLocationAction,
    updateLocationAction,
    deleteLocationAction,
    setDefaultLocationAction,
    type UserLocation,
    type LocationFormData,
} from "@/app/dashboard/users/locations/setting/actions";

const LocationPicker = dynamic(
    () => import("./location-picker").then((m) => m.LocationPicker),
    { ssr: false, loading: () => <div className="h-64 rounded-2xl bg-muted animate-pulse" /> }
);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-2">
            <p className="text-sm font-bold text-muted-foreground">{label}</p>
            {children}
        </div>
    );
}

const DEFAULT_LAT = -6.2088;
const DEFAULT_LON = 106.8456;

function resetForm() {
    return { label: "Rumah", address: "", lat: DEFAULT_LAT, lon: DEFAULT_LON, note: "" };
}

export function CustomerLocationSetting({ locations }: { locations: UserLocation[] }) {
    const router = useRouter();
    const [showForm, setShowForm] = useState(locations.length === 0);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [label, setLabel] = useState("Rumah");
    const [address, setAddress] = useState("");
    const [lat, setLat] = useState(DEFAULT_LAT);
    const [lon, setLon] = useState(DEFAULT_LON);
    const [note, setNote] = useState("");
    const [locating, setLocating] = useState(false);
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
    const [isPending, startTransition] = useTransition();

    function openAddForm() {
        const f = resetForm();
        setEditingId(null);
        setLabel(f.label);
        setAddress(f.address);
        setLat(f.lat);
        setLon(f.lon);
        setNote(f.note);
        setMessage(null);
        setShowForm(true);
    }

    function openEditForm(loc: UserLocation) {
        setEditingId(loc.id);
        setLabel(loc.label);
        setAddress(loc.address);
        setLat(parseFloat(loc.lat));
        setLon(parseFloat(loc.lon));
        setNote(loc.note ?? "");
        setMessage(null);
        setShowForm(true);
    }

    function closeForm() {
        setShowForm(false);
        setEditingId(null);
        setMessage(null);
    }

    async function handleGetLocation() {
        if (!navigator.geolocation) {
            alert("Browser kamu tidak mendukung geolokasi.");
            return;
        }

        if (navigator.permissions) {
            const status = await navigator.permissions.query({ name: "geolocation" });
            if (status.state === "denied") {
                alert("Izin lokasi diblokir. Klik ikon kunci di address bar lalu ubah izin Lokasi ke 'Izinkan', kemudian refresh halaman.");
                return;
            }
        }

        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setLat(pos.coords.latitude);
                setLon(pos.coords.longitude);
                setLocating(false);
                setMessage(null);
            },
            (err) => {
                const msg =
                    err.code === err.PERMISSION_DENIED
                        ? "Izin lokasi ditolak. Klik ikon kunci di address bar untuk mengizinkan."
                        : err.code === err.POSITION_UNAVAILABLE
                            ? "Lokasi tidak tersedia. Pastikan GPS aktif."
                            : "Permintaan lokasi timeout. Coba lagi.";
                alert(msg);
                setLocating(false);
            }
        );
    }

    function handleSave() {
        if (!label.trim() || !address.trim()) {
            setMessage({ ok: false, text: "Label dan alamat wajib diisi." });
            return;
        }
        const data: LocationFormData = {
            label: label.trim(),
            address: address.trim(),
            lat: String(lat),
            lon: String(lon),
            note: note.trim(),
        };
        startTransition(async () => {
            const res =
                editingId !== null
                    ? await updateLocationAction(editingId, data)
                    : await addLocationAction(data);
            setMessage({ ok: res.success, text: res.message });
            if (res.success) {
                setShowForm(false);
                setEditingId(null);
                router.refresh();
            }
        });
    }

    function handleDelete(id: number) {
        startTransition(async () => {
            const res = await deleteLocationAction(id);
            setMessage({ ok: res.success, text: res.message });
            if (res.success) router.refresh();
        });
    }

    function handleSetDefault(id: number) {
        startTransition(async () => {
            const res = await setDefaultLocationAction(id);
            setMessage({ ok: res.success, text: res.message });
            if (res.success) router.refresh();
        });
    }

    return (
        <div className="px-4 md:px-6 py-8 max-w-2xl space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-black">Alamat Pengiriman</h1>
                    <p className="text-muted-foreground mt-1 text-sm">Kelola alamat pengiriman kamu.</p>
                </div>
                {!showForm && (
                    <Button
                        onClick={openAddForm}
                        className="rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold"
                    >
                        <Plus className="h-4 w-4 mr-1" /> Tambah Alamat
                    </Button>
                )}
            </div>

            <AnimatePresence mode="wait">
                {message && (
                    <motion.div
                        key={message.text}
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className={`rounded-xl px-4 py-3 text-sm font-semibold flex items-center gap-2 ${message.ok
                            ? "bg-green-50 border border-green-200 text-green-700"
                            : "bg-rose-50 border border-rose-200 text-rose-700"
                            }`}
                    >
                        {message.ok ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                        {message.text}
                    </motion.div>
                )}
            </AnimatePresence>

            {locations.length === 0 && !showForm && (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                    <MapPin className="h-12 w-12 opacity-20" />
                    <p className="font-bold">Belum ada alamat tersimpan</p>
                    <p className="text-sm text-center">Tambahkan alamat pengiriman kamu terlebih dahulu.</p>
                </div>
            )}

            <div className="space-y-3">
                <AnimatePresence>
                    {locations.map((loc) => (
                        <motion.div
                            key={loc.id}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, x: -16 }}
                            className="rounded-2xl border border-border/60 bg-card p-4 space-y-2"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <p className="font-black text-base">{loc.label}</p>
                                    {loc.is_default && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-black">
                                            <Star className="h-2.5 w-2.5 fill-rose-500" /> Utama
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                    {!loc.is_default && (
                                        <button
                                            onClick={() => handleSetDefault(loc.id)}
                                            disabled={isPending}
                                            className="text-[11px] font-bold text-muted-foreground hover:text-rose-600 px-2 py-1 rounded-lg hover:bg-rose-50 transition-colors disabled:opacity-50"
                                        >
                                            Jadikan Utama
                                        </button>
                                    )}
                                    <button
                                        onClick={() => openEditForm(loc)}
                                        disabled={isPending}
                                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                                    >
                                        <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(loc.id)}
                                        disabled={isPending}
                                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-rose-50 transition-colors disabled:opacity-50"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                            <p className="text-sm text-muted-foreground">{loc.address}</p>
                            {loc.note && <p className="text-xs text-muted-foreground italic">{loc.note}</p>}
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>

            <AnimatePresence>
                {showForm && (
                    <motion.div
                        key="location-form"
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        className="rounded-2xl border border-border/60 bg-card p-5 space-y-5"
                    >
                        <div className="flex items-center justify-between">
                            <p className="font-black text-base">
                                {editingId !== null ? "Edit Alamat" : "Tambah Alamat Baru"}
                            </p>
                            <button
                                onClick={closeForm}
                                className="text-muted-foreground hover:text-foreground"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <Field label="Label">
                            <Input
                                value={label}
                                onChange={(e) => setLabel(e.target.value)}
                                placeholder="cth: Rumah, Kantor"
                                className="rounded-xl"
                            />
                        </Field>

                        <Field label="Alamat Lengkap">
                            <Input
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                placeholder="Jl. Contoh No. 1, Kota"
                                className="rounded-xl"
                            />
                        </Field>

                        <Field label="Catatan (opsional)">
                            <Input
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder="cth: Depan pagar hijau"
                                className="rounded-xl"
                            />
                        </Field>

                        <Field label="Titik Lokasi">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs text-muted-foreground">Klik peta atau seret marker untuk memilih.</p>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={handleGetLocation}
                                    disabled={locating}
                                    className="rounded-xl flex-shrink-0"
                                >
                                    {locating
                                        ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                        : <Navigation className="h-3.5 w-3.5 mr-1.5" />
                                    }
                                    {locating ? "Mendeteksi..." : "Lokasi Saya"}
                                </Button>
                            </div>
                            <LocationPicker
                                lat={lat}
                                lon={lon}
                                onChange={(la, lo) => { setLat(la); setLon(lo); }}
                            />
                            <div className="flex gap-3 text-xs text-muted-foreground bg-muted/40 rounded-xl px-4 py-2.5 mt-2">
                                <span>Lat: <span className="font-black text-foreground">{lat.toFixed(6)}</span></span>
                                <span>·</span>
                                <span>Lon: <span className="font-black text-foreground">{lon.toFixed(6)}</span></span>
                            </div>
                        </Field>

                        <div className="flex gap-2 pt-1">
                            <Button
                                type="button"
                                onClick={handleSave}
                                disabled={isPending}
                                className="flex-1 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold"
                            >
                                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan"}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={closeForm}
                                className="rounded-xl"
                            >
                                Batal
                            </Button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
