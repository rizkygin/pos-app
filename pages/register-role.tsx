'use client'
import { useState } from "react";
import { MapPin, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import { ORDER_FEATURES } from "@/lib/order-features";

/* ─── Syariah-friendly SVG illustrations ────────────────────────────────────
   Each character has glasses frames but NO eyes drawn inside them.
   Face skin colour (#FCD5AE) fills the lens area, so eyes are absent.
   ─────────────────────────────────────────────────────────────────────────── */

function CustomerIllustration() {
    return (
        <svg viewBox="0 0 320 360" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
            <defs>
                <linearGradient id="custBg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFF0F5" />
                    <stop offset="100%" stopColor="#FFD6E7" />
                </linearGradient>
            </defs>

            {/* Background */}
            <rect width="320" height="360" fill="url(#custBg)" rx="24" />

            {/* Body / abaya */}
            <path d="M75 220 Q60 295 65 360 L255 360 Q260 295 245 220 Q210 204 160 204 Q110 204 75 220Z" fill="#C026D3" />

            {/* Hijab outer mass */}
            <ellipse cx="160" cy="148" rx="90" ry="84" fill="#A855F7" />
            {/* Hijab side drapes */}
            <path d="M75 220 Q68 175 102 150 Q100 172 104 198 Q92 205 75 220Z" fill="#A855F7" />
            <path d="M245 220 Q252 175 218 150 Q220 172 216 198 Q228 205 245 220Z" fill="#A855F7" />

            {/* Face */}
            <ellipse cx="160" cy="150" rx="63" ry="61" fill="#FCD5AE" />

            {/* Glasses — skin-coloured fill = no visible eyes */}
            <rect x="103" y="134" width="47" height="30" rx="10" fill="#FCD5AE" stroke="#1C1C1C" strokeWidth="3.5" />
            <rect x="170" y="134" width="47" height="30" rx="10" fill="#FCD5AE" stroke="#1C1C1C" strokeWidth="3.5" />
            {/* Bridge */}
            <line x1="150" y1="149" x2="170" y2="149" stroke="#1C1C1C" strokeWidth="3.5" />
            {/* Temples */}
            <line x1="103" y1="149" x2="89"  y2="146" stroke="#1C1C1C" strokeWidth="3.5" strokeLinecap="round" />
            <line x1="217" y1="149" x2="231" y2="146" stroke="#1C1C1C" strokeWidth="3.5" strokeLinecap="round" />

            {/* Nose dots */}
            <circle cx="152" cy="173" r="3" fill="#C28040" />
            <circle cx="168" cy="173" r="3" fill="#C28040" />

            {/* Smile */}
            <path d="M143 187 Q160 200 177 187" fill="none" stroke="#9B5B2E" strokeWidth="3" strokeLinecap="round" />

            {/* Arms */}
            <path d="M78 240 Q56 280 64 316 Q70 330 85 323 Q80 296 86 265" fill="#C026D3" />
            <path d="M242 240 Q264 280 256 316 Q250 330 235 323 Q240 296 234 265" fill="#C026D3" />

            {/* Hands */}
            <ellipse cx="68"  cy="319" rx="14" ry="11" fill="#FCD5AE" />
            <ellipse cx="252" cy="319" rx="14" ry="11" fill="#FCD5AE" />

            {/* Shopping bag */}
            <rect x="230" y="285" width="54" height="53" rx="10" fill="#F472B6" stroke="#DB2777" strokeWidth="2" />
            <path d="M240 285 Q240 268 257 268 Q274 268 274 285" fill="none" stroke="#DB2777" strokeWidth="5" strokeLinecap="round" />
            <line x1="230" y1="305" x2="284" y2="305" stroke="#DB2777" strokeWidth="1.5" />
            {/* Bag tag */}
            <rect x="246" y="313" width="18" height="14" rx="4" fill="#DB2777" />
            <line x1="255" y1="313" x2="255" y2="310" stroke="#DB2777" strokeWidth="2" />
        </svg>
    );
}

function OwnerIllustration() {
    return (
        <svg viewBox="0 0 320 360" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
            <defs>
                <linearGradient id="ownBg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFFBEB" />
                    <stop offset="100%" stopColor="#FDE68A" />
                </linearGradient>
            </defs>

            {/* Background */}
            <rect width="320" height="360" fill="url(#ownBg)" rx="24" />

            {/* Body / dark shirt */}
            <path d="M80 225 Q65 300 70 360 L250 360 Q255 300 240 225 Q210 208 160 208 Q110 208 80 225Z" fill="#1E3A5F" />

            {/* Apron */}
            <path d="M118 225 Q110 300 115 360 L205 360 Q210 300 202 225 Q185 215 160 215 Q135 215 118 225Z" fill="#F8FAFC" />
            {/* Apron top bib */}
            <rect x="130" y="210" width="60" height="55" rx="8" fill="#F8FAFC" />
            {/* Apron pocket */}
            <rect x="142" y="310" width="36" height="26" rx="6" fill="#E2E8F0" />
            {/* Apron tie strings */}
            <line x1="130" y1="220" x2="100" y2="212" stroke="#E2E8F0" strokeWidth="4" strokeLinecap="round" />
            <line x1="190" y1="220" x2="220" y2="212" stroke="#E2E8F0" strokeWidth="4" strokeLinecap="round" />

            {/* Neck */}
            <rect x="148" y="200" width="24" height="28" rx="8" fill="#FCD5AE" />

            {/* Head */}
            <ellipse cx="160" cy="148" rx="63" ry="61" fill="#FCD5AE" />

            {/* Kopiah / peci (small flat-top Muslim cap) */}
            <ellipse cx="160" cy="99" rx="62" ry="18" fill="#1C3050" />
            <rect x="100" y="82" width="120" height="30" rx="6" fill="#1C3050" />
            {/* Kopiah rim highlight */}
            <ellipse cx="160" cy="112" rx="62" ry="8" fill="none" stroke="#2D4A70" strokeWidth="2" />

            {/* Face */}
            <ellipse cx="160" cy="152" rx="63" ry="61" fill="#FCD5AE" />

            {/* Glasses — skin fill = no eyes */}
            <rect x="103" y="136" width="47" height="30" rx="10" fill="#FCD5AE" stroke="#1C1C1C" strokeWidth="3.5" />
            <rect x="170" y="136" width="47" height="30" rx="10" fill="#FCD5AE" stroke="#1C1C1C" strokeWidth="3.5" />
            <line x1="150" y1="151" x2="170" y2="151" stroke="#1C1C1C" strokeWidth="3.5" />
            <line x1="103" y1="151" x2="89"  y2="148" stroke="#1C1C1C" strokeWidth="3.5" strokeLinecap="round" />
            <line x1="217" y1="151" x2="231" y2="148" stroke="#1C1C1C" strokeWidth="3.5" strokeLinecap="round" />

            {/* Nose dots */}
            <circle cx="152" cy="175" r="3" fill="#C28040" />
            <circle cx="168" cy="175" r="3" fill="#C28040" />

            {/* Beard — modest lower-face stubble/beard shape */}
            <path d="M108 185 Q108 215 160 218 Q212 215 212 185 Q195 198 160 200 Q125 198 108 185Z" fill="#8B5E3C" />

            {/* Smile (visible between nose and beard) */}
            <path d="M142 185 Q160 194 178 185" fill="none" stroke="#7A4A25" strokeWidth="2.5" strokeLinecap="round" />

            {/* Arms */}
            <path d="M80 244 Q58 284 66 318 Q72 332 87 326 Q82 300 88 268" fill="#1E3A5F" />
            <path d="M240 244 Q262 284 254 318 Q248 332 233 326 Q238 300 232 268" fill="#1E3A5F" />

            {/* Hands */}
            <ellipse cx="70"  cy="322" rx="14" ry="11" fill="#FCD5AE" />
            <ellipse cx="250" cy="322" rx="14" ry="11" fill="#FCD5AE" />

            {/* Spatula / ladle in right hand */}
            <line x1="250" y1="322" x2="278" y2="270" stroke="#CBD5E1" strokeWidth="7" strokeLinecap="round" />
            {/* Spatula head */}
            <ellipse cx="282" cy="263" rx="14" ry="10" fill="#94A3B8" />
        </svg>
    );
}

function CourierIllustration() {
    return (
        <svg viewBox="0 0 320 360" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
            <defs>
                <linearGradient id="kurBg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#EFF6FF" />
                    <stop offset="100%" stopColor="#DBEAFE" />
                </linearGradient>
            </defs>

            {/* Background */}
            <rect width="320" height="360" fill="url(#kurBg)" rx="24" />

            {/* Body / jacket */}
            <path d="M76 228 Q60 302 66 360 L254 360 Q260 302 244 228 Q212 210 160 210 Q108 210 76 228Z" fill="#F97316" />
            {/* Jacket zipper line */}
            <line x1="160" y1="220" x2="160" y2="360" stroke="#EA580C" strokeWidth="3" />
            {/* Jacket pocket left */}
            <rect x="90"  y="275" width="38" height="28" rx="6" fill="#EA580C" />
            {/* Jacket pocket right */}
            <rect x="192" y="275" width="38" height="28" rx="6" fill="#EA580C" />

            {/* Backpack straps (visible on chest/shoulders) */}
            <path d="M104 228 Q95 255 100 290" fill="none" stroke="#431407" strokeWidth="7" strokeLinecap="round" />
            <path d="M216 228 Q225 255 220 290" fill="none" stroke="#431407" strokeWidth="7" strokeLinecap="round" />
            {/* Strap connector */}
            <rect x="138" y="258" width="44" height="14" rx="7" fill="#431407" />

            {/* Neck */}
            <rect x="148" y="198" width="24" height="28" rx="8" fill="#FCD5AE" />

            {/* Helmet outer shell (covers top 60% of head) */}
            <ellipse cx="160" cy="130" rx="78" ry="72" fill="#1E293B" />
            {/* Helmet visor area opening */}
            <path d="M96 148 Q96 192 160 196 Q224 192 224 148 Q224 132 160 130 Q96 132 96 148Z" fill="#FCD5AE" />
            {/* Helmet visor tinted strip */}
            <path d="M100 148 Q100 136 160 134 Q220 136 220 148" fill="none" stroke="#475569" strokeWidth="8" strokeLinecap="round" />
            {/* Helmet rim edge */}
            <path d="M94 152 Q94 195 160 200 Q226 195 226 152" fill="none" stroke="#334155" strokeWidth="4" />
            {/* Helmet vents */}
            <rect x="145" y="92"  width="30" height="8"  rx="4" fill="#334155" />
            <rect x="140" y="104" width="40" height="7"  rx="3" fill="#334155" />

            {/* Face inside visor */}
            <ellipse cx="160" cy="166" rx="58" ry="34" fill="#FCD5AE" />

            {/* Glasses — skin fill = no eyes */}
            <rect x="106" y="153" width="43" height="26" rx="9" fill="#FCD5AE" stroke="#1C1C1C" strokeWidth="3.5" />
            <rect x="171" y="153" width="43" height="26" rx="9" fill="#FCD5AE" stroke="#1C1C1C" strokeWidth="3.5" />
            <line x1="149" y1="166" x2="171" y2="166" stroke="#1C1C1C" strokeWidth="3.5" />
            <line x1="106" y1="166" x2="95"  y2="163" stroke="#1C1C1C" strokeWidth="3.5" strokeLinecap="round" />
            <line x1="214" y1="166" x2="225" y2="163" stroke="#1C1C1C" strokeWidth="3.5" strokeLinecap="round" />

            {/* Nose dots */}
            <circle cx="153" cy="182" r="2.8" fill="#C28040" />
            <circle cx="167" cy="182" r="2.8" fill="#C28040" />

            {/* Smile */}
            <path d="M145 191 Q160 201 175 191" fill="none" stroke="#9B5B2E" strokeWidth="3" strokeLinecap="round" />

            {/* Arms */}
            <path d="M78 248 Q56 288 64 322 Q70 336 85 330 Q80 304 86 272" fill="#F97316" />
            <path d="M242 248 Q264 288 256 322 Q250 336 235 330 Q240 304 234 272" fill="#F97316" />

            {/* Hands */}
            <ellipse cx="68"  cy="326" rx="14" ry="11" fill="#FCD5AE" />
            <ellipse cx="252" cy="326" rx="14" ry="11" fill="#FCD5AE" />

            {/* Delivery box */}
            <rect x="56" y="298" width="56" height="46" rx="8" fill="#FEF9C3" stroke="#EAB308" strokeWidth="2.5" />
            {/* Box tape */}
            <line x1="84"  y1="298" x2="84"  y2="344" stroke="#EAB308" strokeWidth="3" />
            <line x1="56"  y1="321" x2="112" y2="321" stroke="#EAB308" strokeWidth="3" />
        </svg>
    );
}

/* ─── Role definitions ────────────────────────────────────────────────────── */

type Role = {
    id: string;
    title: string;
    description: string;
    illustration: React.ReactNode;
};

const roles: Role[] = [
    {
        id: "customer",
        title: "Customer",
        description: "Belanja barang barang favorite di area sekitar mu.",
        illustration: <CustomerIllustration />,
    },
    {
        id: "owner",
        title: "Pemilik Resto",
        description: "Mengatur Bisnis, Pantau Penjualan, dan Kembangkan Restoran Anda dengan Mudah.",
        illustration: <OwnerIllustration />,
    },
    {
        id: "courier",
        title: "Kurir",
        description: "Mengantar pesanan barang.",
        illustration: <CourierIllustration />,
    },
];

/* ─── Registration form ──────────────────────────────────────────────────── */

const RegistrationForm = ({ role, onCancel }: { role: string; onCancel: () => void }) => {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [locating, setLocating] = useState(false);
    const [formData, setFormData] = useState<Record<string, string>>(
        role === 'courier' ? { vehicle_type: 'motorcycle' } : {}
    );
    const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
    const [featureError, setFeatureError] = useState(false);

    const toggleFeature = (slug: string) =>
        setSelectedFeatures((prev) => {
            setFeatureError(false);
            return prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug];
        });

    const currentRole = roles.find((r) => r.id === role);

    const handleGetLocation = () => {
        if (!navigator.geolocation) return alert("Geolocation tidak didukung browser ini");
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setFormData((prev) => ({
                    ...prev,
                    lat: String(pos.coords.latitude),
                    lon: String(pos.coords.longitude),
                }));
                setLocating(false);
            },
            () => {
                alert("Gagal mendapatkan lokasi. Pastikan izin lokasi diaktifkan.");
                setLocating(false);
            }
        );
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (role === 'owner' && selectedFeatures.length === 0) {
            setFeatureError(true);
            return;
        }
        setLoading(true);
        try {
            
            const res = await fetch("/api/register-role", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role, data: { ...formData, features: selectedFeatures } }),
            });
            if (res.ok) {
                router.push("/dashboard");
            } else {
                const data = await res.json();
                alert(data.error || "Something went wrong");
            }
        } catch {
            alert("Failed to register");
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    return (
        <motion.div
            layoutId={role}
            className="w-full max-w-lg bg-card border border-border/50 shadow-2xl rounded-[2.5rem] p-8 md:p-12 space-y-8 relative overflow-hidden"
        >
            <div className="absolute inset-0 bg-linear-to-b from-primary/5 to-transparent pointer-events-none" />

            <div className="flex items-center justify-between relative z-10">
                <div className="flex items-center gap-4">
                    <div className="relative w-16 h-16 rounded-2xl overflow-hidden bg-muted">
                        {currentRole?.illustration}
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold">Register as {currentRole?.title}</h2>
                        <p className="text-sm text-muted-foreground">Please fill in your details</p>
                    </div>
                </div>
                <Button variant="ghost" size="icon" onClick={onCancel} className="rounded-full">
                    ✕
                </Button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
                {role === "owner" && (
                    <>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Outlet Name</label>
                            <Input name="name" onChange={handleChange} required placeholder="My Awesome Store" className="rounded-xl" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Address</label>
                            <Input name="address" onChange={handleChange} required placeholder="123 Street Name" className="rounded-xl" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Phone</label>
                                <Input name="phone" onChange={handleChange} required placeholder="08..." className="rounded-xl" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Email</label>
                                <Input name="email" type="email" onChange={handleChange} required placeholder="store@example.com" className="rounded-xl" />
                            </div>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleGetLocation}
                            disabled={locating}
                            className="w-full rounded-xl flex items-center gap-2"
                        >
                            {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                            {locating
                                ? "Mendapatkan lokasi..."
                                : formData.lat
                                    ? `Lokasi: ${Number(formData.lat).toFixed(5)}, ${Number(formData.lon).toFixed(5)}`
                                    : "Gunakan Lokasi Saya"}
                        </Button>

                        <div className="space-y-2 bg-amber-950 rounded-2xl p-1.5">
                            <label className="text-sm font-medium text-white flex items-center justify-between">
                                <span>Kategori Layanan <span className="text-red-400">*</span></span>
                                {selectedFeatures.length > 0 && (
                                    <span className="text-xs text-white/60 font-normal">{selectedFeatures.length} dipilih</span>
                                )}
                            </label>
                            <div className="grid grid-cols-2 gap-2.5 ">
                                {ORDER_FEATURES.filter((f) => f.isAvailable).map((f) => {
                                    const Icon = f.icon;
                                    const active = selectedFeatures.includes(f.slug);
                                    return (
                                        <button
                                            key={f.slug}
                                            type="button"
                                            onClick={() => toggleFeature(f.slug)}
                                            className={`flex items-center gap-3 px-3.5 py-3 rounded-xl border-2 text-left transition-all duration-150 ${
                                                active
                                                    ? "border-indigo-400 bg-indigo-500/30 shadow-lg shadow-indigo-500/20"
                                                    : "border-white/30 bg-white/10 hover:border-white/50 hover:bg-white/20"
                                            }`}
                                        >
                                            <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${active ? f.iconBg : "bg-white/20"}`}>
                                                <Icon className={`h-4 w-4 ${active ? f.iconColor : "text-white"}`} />
                                            </div>
                                            <span className={`text-xs font-bold leading-tight transition-colors ${active ? "text-white" : "text-white/80"}`}>
                                                {f.label}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                            {featureError && (
                                <p className="text-red-400 text-xs font-medium mt-1">Pilih minimal satu kategori layanan.</p>
                            )}
                        </div>
                    </>
                )}

                {role === "courier" && (
                    <>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Nomor Plat Kendaraan</label>
                            <Input name="vehicle_plate" onChange={handleChange} required placeholder="B 1234 ABC" className="rounded-xl" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Jenis Kendaraan</label>
                            <select
                                name="vehicle_type"
                                onChange={handleChange}
                                required
                                className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <option value="motorcycle">Motoran</option>
                                <option value="car">Bemobil</option>
                            </select>
                        </div>
                    </>
                )}

                {role === "customer" && (
                    <div className="py-8 text-center space-y-4">
                        <p className="text-muted-foreground">Tidak ada informasi tambahan yang diperlukan. Siap untuk mulai berbelanja?</p>
                    </div>
                )}

                <div className="flex gap-4 pt-4">
                    <Button type="button" variant="outline" onClick={onCancel} className="flex-1 rounded-2xl py-6 transition-all hover:bg-muted">
                        Batal
                    </Button>
                    <Button type="submit" disabled={loading} className="flex-1 rounded-2xl py-6 font-bold shadow-lg shadow-primary/20 transition-all hover:scale-[1.02]">
                        {loading ? "Mendaftar..." : "Selesai Daftar"}
                    </Button>
                </div>
            </form>
        </motion.div>
    );
};

/* ─── Role card ──────────────────────────────────────────────────────────── */

const RoleCard = ({ role, index, onSelect }: { role: Role; index: number; onSelect: () => void }) => {
    return (
        <motion.div
            layoutId={role.id}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: index * 0.15 }}
            whileHover={{ y: -10, transition: { duration: 0.2 } }}
            className="group relative flex flex-col items-center p-8 rounded-[2.5rem] bg-card border border-border/50 shadow-xl hover:shadow-2xl transition-all duration-300 w-full max-w-90 overflow-hidden cursor-default"
        >
            <div className="absolute inset-0 bg-linear-to-b from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

            <div className="relative z-10 w-full aspect-square mb-8 overflow-hidden rounded-2xl bg-muted/30 pointer-events-none">
                {role.illustration}
            </div>

            <div className="relative z-10 text-center space-y-4 grow pointer-events-none">
                <h3 className="text-2xl font-bold tracking-tight">{role.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{role.description}</p>
            </div>

            <div className="relative z-20 w-full mt-8">
                <Button
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onSelect();
                    }}
                    className="w-full rounded-2xl py-6 text-base font-semibold group-hover:scale-[1.02] transition-transform relative z-30"
                >
                    Register as {role.title.split(" ").pop()}
                </Button>
            </div>
        </motion.div>
    );
};

/* ─── Page ───────────────────────────────────────────────────────────────── */

export const RegisterRolePage = () => {
    const [selectedRole, setSelectedRole] = useState<string | null>(null);

    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6 md:p-12 overflow-x-hidden">
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 blur-[120px] rounded-full" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/5 blur-[120px] rounded-full" />
            </div>

            <div className="relative z-10 w-full max-w-7xl flex flex-col items-center gap-12">
                <AnimatePresence>
                    {!selectedRole ? (
                        <motion.div
                            key="selection"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                            className="flex flex-col items-center gap-12"
                        >
                            <div className="text-center space-y-4">
                                <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight bg-clip-text text-transparent bg-linear-to-r from-foreground to-foreground/70 pb-2">
                                    Pilih Peranmu
                                </h1>
                                <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                                    Pilih peran yang sesuai dengan kebutuhanmu dan mulai berbisnis dengan Ulun Pesan.
                                </p>
                            </div>

                            <div className="flex flex-col lg:flex-row items-stretch justify-center gap-8 w-full max-w-7xl">
                                {roles.map((role, index) => (
                                    <RoleCard key={role.id} role={role} index={index} onSelect={() => setSelectedRole(role.id)} />
                                ))}
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="form"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="w-full flex justify-center"
                        >
                            <RegistrationForm role={selectedRole} onCancel={() => setSelectedRole(null)} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default RegisterRolePage;
