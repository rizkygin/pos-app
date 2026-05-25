"use client";

import { useState, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Star, ChevronRight, Check, User, Store, Package, Bike, AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import type { SubmitResult } from "@/app/dashboard/ratings/actions";

export type RatingUserType = "customer" | "courier";

export type ProductItem = {
    id: string;
    orderDetailId: number;
    name: string;
    quantity: number;
};

export type CourierInfo = {
    name: string;
    vehicleType: string;
    vehiclePlate: string;
};

export type CustomerInfo = {
    name: string;
    phone: string | null;
};

export type OutletInfo = {
    name: string;
    address: string;
};

type RatingInput = { rating: number; comment: string };
type ProductRatingInput = RatingInput & { productId: string; orderDetailId: number };

type Props =
    | {
          userType: "customer";
          orderId: string;
          courier: CourierInfo;
          products: ProductItem[];
          onSubmit: (courierRating: RatingInput, productRatings: ProductRatingInput[]) => Promise<SubmitResult>;
      }
    | {
          userType: "courier";
          orderId: string;
          customer: CustomerInfo;
          outlet: OutletInfo;
          onSubmit: (customerRating: RatingInput, outletRating: RatingInput) => Promise<SubmitResult>;
      };

/* ── Star picker ─────────────────────────────────────────────── */

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    const [hovered, setHovered] = useState(0);
    const active = hovered || value;

    const LABELS = ["", "Buruk", "Kurang", "Cukup", "Bagus", "Sangat Bagus"];

    return (
        <div className="flex flex-col items-center gap-2">
            <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((i) => (
                    <motion.button
                        key={i}
                        type="button"
                        whileHover={{ scale: 1.2 }}
                        whileTap={{ scale: 0.9 }}
                        onMouseEnter={() => setHovered(i)}
                        onMouseLeave={() => setHovered(0)}
                        onClick={() => onChange(i)}
                        className="focus:outline-none"
                    >
                        <motion.div
                            animate={{ scale: i <= active ? 1 : 0.9 }}
                            transition={{ type: "spring", stiffness: 400, damping: 20 }}
                        >
                            <Star
                                className={`h-10 w-10 transition-colors duration-150 ${
                                    i <= active
                                        ? "fill-amber-400 text-amber-400"
                                        : "text-muted-foreground/25"
                                }`}
                            />
                        </motion.div>
                    </motion.button>
                ))}
            </div>
            <AnimatePresence mode="wait">
                {active > 0 && (
                    <motion.span
                        key={active}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="text-sm font-bold text-amber-500"
                    >
                        {LABELS[active]}
                    </motion.span>
                )}
            </AnimatePresence>
        </div>
    );
}

/* ── Mini star picker for product rows ──────────────────────── */

function MiniStarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    const [hovered, setHovered] = useState(0);
    const active = hovered || value;

    return (
        <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((i) => (
                <button
                    key={i}
                    type="button"
                    onMouseEnter={() => setHovered(i)}
                    onMouseLeave={() => setHovered(0)}
                    onClick={() => onChange(i)}
                    className="focus:outline-none"
                >
                    <Star
                        className={`h-6 w-6 transition-all duration-100 ${
                            i <= active ? "fill-amber-400 text-amber-400 scale-110" : "text-muted-foreground/25"
                        }`}
                    />
                </button>
            ))}
        </div>
    );
}

/* ── Step indicator ──────────────────────────────────────────── */

function StepIndicator({ current, total, labels }: { current: number; total: number; labels: string[] }) {
    return (
        <div className="flex items-center justify-center gap-0 w-full max-w-xs mx-auto">
            {Array.from({ length: total }).map((_, i) => {
                const done = i < current;
                const active = i === current;
                return (
                    <div key={i} className="flex items-center flex-1 last:flex-none">
                        <div className="flex flex-col items-center gap-1">
                            <motion.div
                                animate={
                                    done
                                        ? { backgroundColor: "#10b981", borderColor: "#10b981" }
                                        : active
                                        ? { borderColor: "#f59e0b", scale: 1.1 }
                                        : { borderColor: "#e5e7eb", scale: 1 }
                                }
                                className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold bg-background"
                                transition={{ duration: 0.3 }}
                            >
                                {done ? (
                                    <Check className="h-4 w-4 text-white" />
                                ) : (
                                    <span className={active ? "text-amber-500" : "text-muted-foreground/40"}>
                                        {i + 1}
                                    </span>
                                )}
                            </motion.div>
                            <span className={`text-[10px] font-semibold whitespace-nowrap ${active ? "text-foreground" : "text-muted-foreground/50"}`}>
                                {labels[i]}
                            </span>
                        </div>
                        {i < total - 1 && (
                            <div className="flex-1 h-0.5 mx-1 mb-4">
                                <motion.div
                                    className="h-full rounded-full bg-emerald-400"
                                    animate={{ width: done ? "100%" : "0%" }}
                                    transition={{ duration: 0.4, ease: "easeOut" }}
                                />
                                <div className="h-full w-full -mt-0.5 rounded-full bg-muted-foreground/15" />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

/* ── Person card (courier / customer) ───────────────────────── */

function PersonCard({ name, sub, icon: Icon, color }: {
    name: string; sub: string; icon: typeof User; color: string
}) {
    const initials = name.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
    return (
        <div className={`flex items-center gap-4 p-4 rounded-2xl ${color}`}>
            <div className="h-14 w-14 rounded-full bg-background/60 flex items-center justify-center shrink-0 shadow-sm">
                <span className="text-lg font-black">{initials}</span>
            </div>
            <div className="min-w-0">
                <p className="font-black text-base leading-snug truncate">{name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                    <Icon className="h-3.5 w-3.5 text-current opacity-60 shrink-0" />
                    <p className="text-sm opacity-70 truncate">{sub}</p>
                </div>
            </div>
        </div>
    );
}

/* ── Outlet card ─────────────────────────────────────────────── */

function OutletCard({ name, address }: { name: string; address: string }) {
    return (
        <div className="flex items-center gap-4 p-4 rounded-2xl bg-orange-50 dark:bg-orange-950/20">
            <div className="h-14 w-14 rounded-2xl bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center shrink-0 shadow-sm">
                <Store className="h-7 w-7 text-orange-500" />
            </div>
            <div className="min-w-0">
                <p className="font-black text-base leading-snug truncate">{name}</p>
                <p className="text-sm text-muted-foreground mt-0.5 truncate">{address}</p>
            </div>
        </div>
    );
}

/* ── Product rating row ──────────────────────────────────────── */

type ProductRating = { rating: number; comment: string };

function ProductRow({ product, value, onChange }: { 
    product: ProductItem; 
    value: ProductRating; 
    onChange: (v: ProductRating) => void; 
}) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="rounded-xl border bg-background overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
                <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
                    <Package className="h-5 w-5 text-muted-foreground/60" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">{product.name}</p>
                    <p className="text-xs text-muted-foreground">{product.quantity}×</p>
                </div>
                <MiniStarPicker
                    value={value.rating}
                    onChange={(r) => {
                        onChange({ ...value, rating: r });
                        if (!expanded) setExpanded(true);
                    }}
                />
            </div>
            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="px-4 pb-3 pt-0">
                            <textarea
                                value={value.comment}
                                onChange={(e) => onChange({ ...value, comment: e.target.value })}
                                placeholder="Komentar produk ini (opsional)…"
                                rows={2}
                                className="w-full px-3 py-2 text-sm rounded-lg border bg-muted/30 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 resize-none transition-all"
                            />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

/* ── Main form ───────────────────────────────────────────────── */

export function RatingSubmitForm(props: Props) {
    const router = useRouter();
    const [step, setStep] = useState(0);
    const [submitted, setSubmitted] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [isSubmitting, startSubmit] = useTransition();

    // Step 0: person rating (courier/customer)
    const [personRating, setPersonRating] = useState(0);
    const [personComment, setPersonComment] = useState("");

    // Step 1 for customer: per-product ratings
    const [productRatings, setProductRatings] = useState<Record<string, ProductRating>>(
        props.userType === "customer"
            ? Object.fromEntries(props.products.map((p) => [p.id, { rating: 0, comment: "" }]))
            : {}
    );

    // Step 1 for courier: outlet rating
    const [outletRating, setOutletRating] = useState(0);
    const [outletComment, setOutletComment] = useState("");

    const stepLabels =
        props.userType === "customer"
            ? ["Kurir", "Produk"]
            : ["Pelanggan", "Outlet"];

    const canNext = step === 0 ? personRating > 0 : true;

    const handleSubmit = () => {
        setSubmitError(null);
        startSubmit(async () => {
            let result: SubmitResult;
            if (props.userType === "customer") {
                const payload: ProductRatingInput[] = props.products.map((p) => ({
                    productId: p.id,
                    orderDetailId: p.orderDetailId,
                    ...(productRatings[p.id] ?? { rating: 0, comment: "" }),
                }));
                result = await props.onSubmit({ rating: personRating, comment: personComment }, payload);
            } else {
                result = await props.onSubmit(
                    { rating: personRating, comment: personComment },
                    { rating: outletRating, comment: outletComment }
                );
            }

            if (result.ok) {
                setSubmitted(true);
                setTimeout(() => router.push("/dashboard/order"), 1800);
            } else if (result.error === "already_rated") {
                setSubmitError("Kamu sudah memberikan ulasan untuk pesanan ini.");
            } else {
                setSubmitError("Terjadi kesalahan. Silakan coba lagi.");
            }
        });
    };

    if (submitted) {
        return (
            <div className="min-h-[70vh] flex flex-col items-center justify-center gap-6 px-4">
                <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 260, damping: 20 }}
                    className="w-24 h-24 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center"
                >
                    <Check className="h-12 w-12 text-emerald-500" />
                </motion.div>
                <div className="text-center space-y-1">
                    <motion.p
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="text-2xl font-black"
                    >
                        Terima Kasih!
                    </motion.p>
                    <motion.p
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.35 }}
                        className="text-sm text-muted-foreground"
                    >
                        Ulasanmu sudah kami catat. Mengarahkan kamu...
                    </motion.p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-[70vh] flex flex-col items-center px-4 py-10 gap-8 max-w-lg mx-auto">
            {/* Header */}
            <div className="w-full text-center space-y-1">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                    Bagaimana pengalamanmu?
                </p>
                <h1 className="text-2xl font-black">Beri Ulasan</h1>
            </div>

            {/* Step indicator */}
            <StepIndicator current={step} total={2} labels={stepLabels} />

            {/* Step panels */}
            <div className="w-full flex-1">
                <AnimatePresence mode="wait">
                    {step === 0 && (
                        <motion.div
                            key="step0"
                            initial={{ opacity: 0, x: 40 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -40 }}
                            transition={{ duration: 0.25, ease: "easeOut" }}
                            className="space-y-6"
                        >
                            {props.userType === "customer" ? (
                                <PersonCard
                                    name={props.courier.name}
                                    sub={`${props.courier.vehicleType} · ${props.courier.vehiclePlate}`}
                                    icon={Bike}
                                    color="bg-cyan-50 dark:bg-cyan-950/20 text-cyan-800 dark:text-cyan-200"
                                />
                            ) : (
                                <PersonCard
                                    name={props.customer.name}
                                    sub={props.customer.phone ?? "Tidak ada nomor"}
                                    icon={User}
                                    color="bg-violet-50 dark:bg-violet-950/20 text-violet-800 dark:text-violet-200"
                                />
                            )}

                            <div className="flex flex-col items-center gap-4 py-4 rounded-2xl bg-muted/30 border">
                                <p className="text-sm font-semibold text-muted-foreground">
                                    {props.userType === "customer" ? "Nilai kurir kamu" : "Nilai pelanggan"}
                                </p>
                                <StarPicker value={personRating} onChange={setPersonRating} />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                    Komentar (opsional)
                                </label>
                                <textarea
                                    value={personComment}
                                    onChange={(e) => setPersonComment(e.target.value)}
                                    placeholder={
                                        props.userType === "customer"
                                            ? "Bagaimana pelayanan kurirmu?"
                                            : "Bagaimana sikap pelanggan?"
                                    }
                                    rows={3}
                                    className="w-full px-4 py-3 text-sm rounded-xl border bg-background focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 resize-none transition-all"
                                />
                            </div>
                        </motion.div>
                    )}

                    {step === 1 && props.userType === "customer" && (
                        <motion.div
                            key="step1-customer"
                            initial={{ opacity: 0, x: 40 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -40 }}
                            transition={{ duration: 0.25, ease: "easeOut" }}
                            className="space-y-3"
                        >
                            <p className="text-sm text-muted-foreground font-medium text-center">
                                Nilai masing-masing produk yang kamu pesan
                            </p>
                            {props.products.map((product) => (
                                <ProductRow
                                    key={product.id}
                                    product={product}
                                    value={productRatings[product.id] ?? { rating: 0, comment: "" }}
                                    onChange={(v) =>
                                        setProductRatings((prev) => ({ ...prev, [product.id]: v }))
                                    }
                                />
                            ))}
                        </motion.div>
                    )}

                    {step === 1 && props.userType === "courier" && (
                        <motion.div
                            key="step1-courier"
                            initial={{ opacity: 0, x: 40 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -40 }}
                            transition={{ duration: 0.25, ease: "easeOut" }}
                            className="space-y-6"
                        >
                            <OutletCard name={props.outlet.name} address={props.outlet.address} />

                            <div className="flex flex-col items-center gap-4 py-4 rounded-2xl bg-muted/30 border">
                                <p className="text-sm font-semibold text-muted-foreground">Nilai outlet ini</p>
                                <StarPicker value={outletRating} onChange={setOutletRating} />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                    Komentar (opsional)
                                </label>
                                <textarea
                                    value={outletComment}
                                    onChange={(e) => setOutletComment(e.target.value)}
                                    placeholder="Bagaimana kondisi outlet, pesanan, dll?"
                                    rows={3}
                                    className="w-full px-4 py-3 text-sm rounded-xl border bg-background focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 resize-none transition-all"
                                />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Error message */}
            {submitError && (
                <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 text-red-600 text-sm font-medium"
                >
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {submitError}
                </motion.div>
            )}

            {/* Navigation */}
            <div className="w-full flex gap-3 pt-2">
                {step > 0 && (
                    <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => setStep(0)}
                        className="flex-1 py-3 rounded-xl border text-sm font-bold text-muted-foreground hover:bg-muted/40 transition-colors disabled:opacity-40"
                    >
                        Kembali
                    </button>
                )}
                <motion.button
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    disabled={!canNext || isSubmitting}
                    onClick={() => {
                        if (step === 0) setStep(1);
                        else handleSubmit();
                    }}
                    className="flex-1 py-3 rounded-xl bg-amber-500 text-white text-sm font-black hover:bg-amber-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm shadow-amber-200"
                >
                    {step === 0 ? (
                        <>
                            Berikutnya
                            <ChevronRight className="h-4 w-4" />
                        </>
                    ) : isSubmitting ? (
                        <>
                            Mengirim...
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                                className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white"
                            />
                        </>
                    ) : (
                        <>
                            Kirim Ulasan
                            <Check className="h-4 w-4" />
                        </>
                    )}
                </motion.button>
            </div>

            <p className="text-xs text-muted-foreground/50 text-center">
                Langkah {step + 1} dari 2 · Order #{props.orderId.slice(-8).toUpperCase()}
            </p>
        </div>
    );
}
