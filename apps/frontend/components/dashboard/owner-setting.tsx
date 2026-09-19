"use client";

import { useState, useRef, useEffect, useMemo, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, Camera, Loader2, Navigation, Send, Sparkles, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ORDER_FEATURES } from "@/lib/order-features";
import { API_URL } from "@/lib/api-url";
import { resolveOutletImage, isBackendImage } from "@/lib/image-src";
import { parseCoord, isValidCoord } from "@/lib/coords";
import { haversineKm } from "@/lib/haversine";
import { getCurrentPosition, geolocationMessage, GEOLOCATION_OPTIONS } from "@/lib/geolocation";
import { usePushSubscription } from "@/lib/use-push-subscription";
import { DEFAULT_SERVICE_TYPE, SERVICE_TYPES, SERVICE_TYPE_LABEL } from "@/lib/service-type";
import { cn } from "@/lib/utils";

const FEATURE_META = ORDER_FEATURES.filter((f) => f.isAvailable);

// Map centre before the outlet's own coordinates load.
const DEFAULT_LAT = -6.2088;
const DEFAULT_LON = 106.8456;

// What a new outlet is created with — the "no photo" photo.
const DEFAULT_AVATAR = "avatar.png";

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

// Everything PATCH /api/outlet/me writes, kept as one object so "unsaved
// changes" is a comparison against what was last loaded or saved, not a flag
// that stays up after the owner types a name and then deletes it again.
type OutletForm = {
    isOpen: boolean;
    name: string;
    phone: string;
    address: string;
    lat: number;
    lon: number;
    avatar: string;
    tags: string[];
};

type TaxState = {
    enabled: boolean;
    rate: number;
    inclusive: boolean;
    label: string;
};

type SectionId = "profil" | "tag" | "lokasi" | "notifikasi" | "pajak" | "layanan";

const EMPTY_FORM: OutletForm = {
    isOpen: true,
    name: "",
    phone: "",
    address: "",
    lat: DEFAULT_LAT,
    lon: DEFAULT_LON,
    avatar: DEFAULT_AVATAR,
    tags: [],
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const rp = (n: number) =>
    new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(Math.round(n));

const INPUT = "h-[42px] rounded-[11px] px-3.5 text-sm focus-visible:border-rose-500 focus-visible:ring-rose-500/15";

async function patchJson(path: string, body: unknown): Promise<{ ok: boolean; text?: string }> {
    try {
        const res = await fetch(`${API_URL}${path}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({}));
        return { ok: res.ok && json.success !== false, text: json.error ?? json.message };
    } catch {
        return { ok: false, text: "Tidak bisa menghubungi server." };
    }
}

// Push is per device, not per outlet, so the section says which device it is
// talking about. Coarse on purpose — it only has to be recognisable.
function deviceLabel(ua: string) {
    const browser = /Edg\//.test(ua) ? "Edge"
        : /OPR\//.test(ua) ? "Opera"
        : /SamsungBrowser/.test(ua) ? "Samsung Internet"
        : /Firefox\/|FxiOS/.test(ua) ? "Firefox"
        : /Chrome\/|CriOS/.test(ua) ? "Chrome"
        : /Safari\//.test(ua) ? "Safari"
        : "Browser";
    const os = /Android/.test(ua) ? "Android"
        : /iPhone|iPad|iPod/.test(ua) ? "iOS"
        : /Windows/.test(ua) ? "Windows"
        : /Mac OS X/.test(ua) ? "macOS"
        : /Linux/.test(ua) ? "Linux"
        : "";
    return os ? `${browser} · ${os}` : browser;
}

// The user agent never changes under a running page.
const noSubscribe = () => () => {};

// The dashboard scrolls inside AppContent, not the window, so the scroll-spy
// has to find whichever ancestor actually scrolls.
function scrollParent(el: HTMLElement): HTMLElement | null {
    for (let node = el.parentElement; node; node = node.parentElement) {
        const { overflowY } = getComputedStyle(node);
        if (overflowY === "auto" || overflowY === "scroll") return node;
    }
    return null;
}

function Switch({ checked, onChange, label, disabled }: {
    checked: boolean;
    onChange: () => void;
    label: string;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={onChange}
            className={cn(
                "relative h-6.25 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-rose-500/30 disabled:opacity-60",
                checked ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600",
            )}
        >
            <span
                className={cn(
                    "pointer-events-none absolute left-0.75 top-[2.5px] h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.3)] transition-transform duration-200",
                    checked && "translate-x-4.75",
                )}
            />
        </button>
    );
}

// The section nav finds these by id, which also makes each one linkable.
function Section({ id, title, desc, action, children }: {
    id: SectionId;
    title: string;
    desc: React.ReactNode;
    action?: React.ReactNode;
    children?: React.ReactNode;
}) {
    return (
        <section id={id} className="overflow-hidden rounded-[18px] border border-border bg-card">
            <div className={cn("flex items-center justify-between gap-3 px-5 py-4 md:px-5.5", children && "border-b border-border/60")}>
                <div className="min-w-0 flex-1">
                    <h2 className="text-[14.5px] font-extrabold">{title}</h2>
                    <p className="mt-0.5 text-[12.5px] text-muted-foreground">{desc}</p>
                </div>
                {action}
            </div>
            {children && <div className="flex flex-col gap-5 p-5 md:p-5.5">{children}</div>}
        </section>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold text-muted-foreground">{label}</span>
            {children}
        </label>
    );
}

export function OwnerSetting() {
    const [loading, setLoading] = useState(true);
    const [form, setForm] = useState<OutletForm>(EMPTY_FORM);
    const [savedForm, setSavedForm] = useState<OutletForm>(EMPTY_FORM);
    // Read-only: written by the backend from the outlet's products.
    const [features, setFeatures] = useState<string[]>([]);
    const [tagInput, setTagInput] = useState("");
    const [locating, setLocating] = useState(false);
    const [locError, setLocError] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    // Counter tax and Dine In / Take Away live on their own endpoints (both
    // owner-only to change, tax also plan-gated) but save with the same button:
    // one page, one "Simpan". null = not loaded, and the section stays hidden.
    const [tax, setTax] = useState<TaxState | null>(null);
    const [savedTax, setSavedTax] = useState<TaxState | null>(null);
    const [canUseTax, setCanUseTax] = useState(false);
    const [serviceType, setServiceType] = useState<boolean | null>(null);
    const [savedServiceType, setSavedServiceType] = useState<boolean | null>(null);

    const push = usePushSubscription();
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
    // Empty on the server render; the browser's own answer after hydration.
    const device = useSyncExternalStore(
        noSubscribe,
        () => deviceLabel(navigator.userAgent),
        () => "",
    );

    const patch = (p: Partial<OutletForm>) => setForm((f) => ({ ...f, ...p }));

    useEffect(() => {
        fetch(`${API_URL}/api/outlet/me`, { credentials: "include" })
            .then((res) => res.json())
            .then((data: { success: boolean; outlet: Outlet | null }) => {
                const outlet = data.outlet;
                if (!outlet) return;
                const loaded: OutletForm = {
                    isOpen: outlet.is_open,
                    name: outlet.name,
                    phone: outlet.phone,
                    address: outlet.address,
                    // Keep the Jakarta default when the stored value isn't a real
                    // coordinate — parseFloat('') is NaN, which crashed the picker.
                    lat: parseCoord(outlet.lat) ?? DEFAULT_LAT,
                    lon: parseCoord(outlet.lon) ?? DEFAULT_LON,
                    avatar: outlet.avatar,
                    tags: outlet.tags,
                };
                setForm(loaded);
                setSavedForm(loaded);
                setFeatures(outlet.features);
            })
            .finally(() => setLoading(false));

        fetch(`${API_URL}/api/outlet/tax`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => {
                if (!j?.success) return;
                const loaded: TaxState = {
                    enabled: !!j.tax.enabled,
                    rate: Number(j.tax.rate ?? 0),
                    inclusive: !!j.tax.inclusive,
                    label: j.tax.label ?? "Pajak",
                };
                setCanUseTax(!!j.canUseTax);
                setTax(loaded);
                setSavedTax(loaded);
            })
            .catch(() => {});

        fetch(`${API_URL}/api/outlet/service-type`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => {
                if (!j?.success) return;
                setServiceType(!!j.enabled);
                setSavedServiceType(!!j.enabled);
            })
            .catch(() => {});
    }, []);

    // Courier coverage circle. Fetched as a shape, not a verdict, so the warning
    // re-evaluates while the owner drags the pin instead of trailing a
    // round-trip behind the map.
    const [serviceArea, setServiceArea] = useState<{
        centerLat: number;
        centerLon: number;
        radiusKm: number;
    } | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch(`${API_URL}/api/service-area`)
            .then((r) => r.json())
            .then((json) => {
                if (!cancelled && json?.success) setServiceArea(json.area ?? null);
            })
            .catch(() => {
                // No area, no warning. A failed fetch must never imply "outside".
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const coverage = useMemo(() => {
        if (!serviceArea || !isValidCoord(form.lat, form.lon)) return null;
        const distanceKm = haversineKm(form.lat, form.lon, serviceArea.centerLat, serviceArea.centerLon);
        return { outside: distanceKm > serviceArea.radiusKm, distanceKm, area: serviceArea };
    }, [serviceArea, form.lat, form.lon]);

    const outletDirty = !same(form, savedForm);
    // A locked plan can't save tax, so its (untouchable) fields never count.
    const taxDirty = canUseTax && !same(tax, savedTax);
    const serviceTypeDirty = serviceType !== savedServiceType;
    const dirty = outletDirty || taxDirty || serviceTypeDirty;

    // Flipping Dine In / Take Away used to save on the spot; now it waits for
    // Simpan like everything else, so leaving with it unsaved has to be loud.
    useEffect(() => {
        if (!dirty) return;
        const warn = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);

    // ── Section nav + scroll-spy ─────────────────────────────────────────
    const nav = useMemo(() => {
        const items: { id: SectionId; label: string; tag: string; warn?: boolean }[] = [
            { id: "profil", label: "Profil Outlet", tag: "" },
            { id: "tag", label: "Tag & Kategori", tag: `${form.tags.length}/3` },
            { id: "lokasi", label: "Lokasi", tag: coverage?.outside ? "cek" : "", warn: coverage?.outside },
            {
                id: "notifikasi",
                label: "Notifikasi",
                tag: push.state === "unsupported" ? "" : push.state === "subscribed" ? "aktif" : "mati",
            },
        ];
        if (tax) {
            items.push({
                id: "pajak",
                label: "Pajak Kasir",
                tag: !canUseTax ? "Max Lite" : tax.enabled ? `${tax.rate}%` : "mati",
            });
        }
        if (serviceType !== null) {
            items.push({ id: "layanan", label: "Dine In / Take Away", tag: serviceType ? "aktif" : "mati" });
        }
        return items;
    }, [form.tags.length, coverage?.outside, push.state, tax, canUseTax, serviceType]);

    const [active, setActive] = useState<SectionId>("profil");
    const headerRef = useRef<HTMLDivElement>(null);
    const chipRowRef = useRef<HTMLDivElement>(null);
    const navKey = nav.map((n) => n.id).join();

    // Where the sticky header's bottom edge sits once it is stuck — the line a
    // section has to cross to count as the one being read. Measured from its
    // sticky offset rather than its current position, because before it sticks
    // (a subscription banner above it) it sits lower than it will.
    const readingLine = () => {
        const header = headerRef.current;
        if (!header) return 0;
        return (parseFloat(getComputedStyle(header).top) || 0) + header.offsetHeight;
    };

    useEffect(() => {
        if (loading || !headerRef.current) return;
        const ids = navKey.split(",") as SectionId[];
        const scroller = scrollParent(headerRef.current);
        const target: HTMLElement | Window = scroller ?? window;
        let frame = 0;
        const compute = () => {
            frame = 0;
            const top = scroller ? scroller.scrollTop : window.scrollY;
            const view = scroller ? scroller.clientHeight : window.innerHeight;
            const height = scroller ? scroller.scrollHeight : document.documentElement.scrollHeight;
            // The last sections are too short to ever reach the line, so the
            // bottom of the page is theirs.
            if (top > 0 && top + view >= height - 4) {
                setActive(ids[ids.length - 1]);
                return;
            }
            const line = readingLine() + 32;
            let next = ids[0];
            for (const id of ids) {
                const el = document.getElementById(id);
                if (el && el.getBoundingClientRect().top <= line) next = id;
            }
            setActive(next);
        };
        const onScroll = () => {
            if (!frame) frame = requestAnimationFrame(compute);
        };
        target.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);
        compute();
        return () => {
            target.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onScroll);
            cancelAnimationFrame(frame);
        };
    }, [loading, navKey]);

    // Keep the active chip in view on the phone-width nav. scrollTo on the chip
    // row, not scrollIntoView — that would also scroll the page and cancel the
    // smooth scroll goTo just started.
    useEffect(() => {
        const row = chipRowRef.current;
        const chip = row?.querySelector<HTMLElement>(`[data-section="${active}"]`);
        if (row && chip) row.scrollTo({ left: chip.offsetLeft - 16, behavior: "smooth" });
    }, [active]);

    function goTo(id: SectionId) {
        const el = document.getElementById(id);
        const header = headerRef.current;
        if (!el || !header) return;
        setActive(id);
        const delta = el.getBoundingClientRect().top - readingLine() - 16;
        const scroller = scrollParent(header);
        (scroller ?? window).scrollBy({ top: delta, behavior: "smooth" });
    }

    // ── Actions ──────────────────────────────────────────────────────────
    function handleGetLocation() {
        setLocating(true);
        setLocError(null);
        getCurrentPosition(
            (pos) => {
                patch({ lat: pos.coords.latitude, lon: pos.coords.longitude });
                setLocating(false);
            },
            (err) => {
                setLocError(geolocationMessage(err));
                setLocating(false);
            },
            GEOLOCATION_OPTIONS,
        );
    }

    // Uploading only stores the file; the outlet points at it once Simpan runs.
    async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        setUploading(true);
        const fd = new FormData();
        fd.append("image", file);
        try {
            const res = await fetch(`${API_URL}/api/outlet/me/avatar`, {
                method: "POST",
                credentials: "include",
                body: fd,
            }).then((r) => r.json());
            if (res.success && res.imageUrl) patch({ avatar: res.imageUrl });
            else setMessage({ ok: false, text: res.message ?? "Gagal mengunggah foto." });
        } catch {
            setMessage({ ok: false, text: "Gagal mengunggah foto." });
        } finally {
            setUploading(false);
        }
    }

    function addTag() {
        const trimmed = tagInput.trim();
        if (!trimmed || form.tags.includes(trimmed) || form.tags.length >= 3) return;
        patch({ tags: [...form.tags, trimmed] });
        setTagInput("");
    }

    async function handleTest() {
        setTesting(true);
        setTestResult(null);
        const ok = await push.sendTest();
        setTestResult(
            ok
                ? { ok: true, text: "Notifikasi tes dikirim — cek layar perangkatmu." }
                : { ok: false, text: "Gagal mengirim notifikasi tes." },
        );
        setTesting(false);
    }

    async function handleSave() {
        if (saving || !dirty) return;
        setMessage(null);
        // Refuse to write a coordinate the map can't read back. String(NaN) is
        // the text "NaN", which persists and breaks the picker on every reopen.
        if (outletDirty && !isValidCoord(form.lat, form.lon)) {
            setMessage({
                ok: false,
                text: "Titik lokasi outlet belum valid. Pakai 'Lokasi Saya' atau geser pin di peta.",
            });
            goTo("lokasi");
            return;
        }
        setSaving(true);
        // Snapshot what is being sent: an edit made while the request is in
        // flight must still read as unsaved afterwards.
        const sentForm = form;
        const sentTax = tax;
        const sentServiceType = serviceType;
        const results = await Promise.all([
            outletDirty
                ? patchJson("/api/outlet/me", {
                    name: sentForm.name,
                    phone: sentForm.phone,
                    address: sentForm.address,
                    lat: String(sentForm.lat),
                    lon: String(sentForm.lon),
                    is_open: sentForm.isOpen,
                    // features is derived server-side from products — see the
                    // Kategori Layanan block; the API ignores it now.
                    tags: sentForm.tags,
                    avatar: sentForm.avatar,
                }).then((r) => {
                    if (r.ok) setSavedForm(sentForm);
                    return r;
                })
                : null,
            taxDirty && sentTax
                ? patchJson("/api/outlet/tax", sentTax).then((r) => {
                    if (r.ok) setSavedTax(sentTax);
                    return r;
                })
                : null,
            serviceTypeDirty && sentServiceType !== null
                ? patchJson("/api/outlet/service-type", { enabled: sentServiceType }).then((r) => {
                    if (r.ok) setSavedServiceType(sentServiceType);
                    return r;
                })
                : null,
        ]);
        setSaving(false);
        const failed = results.find((r) => r && !r.ok);
        setMessage(
            failed
                ? { ok: false, text: failed.text ?? "Gagal menyimpan pengaturan." }
                : { ok: true, text: "Tersimpan" },
        );
    }

    // ── Render ───────────────────────────────────────────────────────────
    const status = saving
        ? null
        : message && !message.ok
            ? { text: "Gagal menyimpan", cls: "text-rose-600 dark:text-rose-400" }
            : dirty
                ? { text: "Ada perubahan belum disimpan", cls: "text-amber-700 dark:text-amber-400" }
                : message?.ok
                    ? { text: message.text, cls: "text-emerald-600 dark:text-emerald-400" }
                    : null;

    const avatarSrc = resolveOutletImage(form.avatar);

    // A worked example on a round number, because "inclusive vs exclusive" is the
    // setting merchants get wrong, and the difference is only obvious in rupiah.
    const base = 100000;
    const example = tax?.inclusive
        ? { pays: base, tax: (base * tax.rate) / (100 + tax.rate), revenue: base - (base * tax.rate) / (100 + tax.rate) }
        : { pays: base + (base * (tax?.rate ?? 0)) / 100, tax: (base * (tax?.rate ?? 0)) / 100, revenue: base };

    if (loading) {
        return (
            <div className="mx-auto max-w-280 space-y-5 px-4 py-6 md:px-6">
                <div className="h-8 w-56 animate-pulse rounded-lg bg-muted" />
                <div className="flex gap-8">
                    <div className="hidden h-64 w-59 shrink-0 animate-pulse rounded-2xl bg-muted lg:block" />
                    <div className="flex-1 space-y-5">
                        <div className="h-72 animate-pulse rounded-[18px] bg-muted" />
                        <div className="h-48 animate-pulse rounded-[18px] bg-muted" />
                    </div>
                </div>
            </div>
        );
    }

    return (
        // shrink-0: this is a flex child of the scrolling <main>, and a sticky
        // header only sticks within its parent — let the parent shrink to the
        // viewport and the header scrolls away after one screen.
        <div className="shrink-0 pb-24">
            {/* ── Sticky header: title + the one save button ─────────────── */}
            <div
                ref={headerRef}
                className="sticky top-12 z-20 border-b border-border bg-background/85 backdrop-blur-md md:top-10"
            >
                <div className="mx-auto flex max-w-280 items-center gap-4 px-4 py-3 md:px-6 md:py-4">
                    <div className="min-w-0 flex-1">
                        <h1 className="text-[19px] font-extrabold tracking-tight">Pengaturan Outlet</h1>
                        <p className="mt-0.5 truncate text-[13px] text-muted-foreground max-sm:hidden">
                            Kelola profil, lokasi, dan aturan penjualan outlet pian.
                        </p>
                        {status && (
                            <p className={cn("mt-0.5 truncate text-xs font-semibold sm:hidden", status.cls)}>{status.text}</p>
                        )}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                        {status && (
                            <span className={cn("text-[12.5px] font-semibold max-sm:hidden", status.cls)}>{status.text}</span>
                        )}
                        <button
                            type="button"
                            onClick={() => void handleSave()}
                            disabled={saving || !dirty}
                            className="flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white shadow-[0_6px_16px_-6px_rgba(225,29,72,.6)] transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none sm:px-5"
                        >
                            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                            {saving ? "Menyimpan…" : (
                                <>
                                    <span className="sm:hidden">Simpan</span>
                                    <span className="max-sm:hidden">Simpan Perubahan</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Phone/tablet section nav — the sidebar one needs lg width. */}
                <div
                    ref={chipRowRef}
                    className="flex gap-1.5 overflow-x-auto px-4 pb-3 scrollbar-none md:px-6 lg:hidden"
                >
                    {nav.map((n) => (
                        <button
                            key={n.id}
                            type="button"
                            data-section={n.id}
                            onClick={() => goTo(n.id)}
                            className={cn(
                                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors",
                                active === n.id
                                    ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                                    : "border-border bg-card text-muted-foreground",
                            )}
                        >
                            {n.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="mx-auto flex max-w-280 flex-col gap-5 px-4 py-5 md:px-6 lg:flex-row lg:items-start lg:gap-8 lg:py-7">
                {/* ── Aside: outlet card, open switch, section nav ──────── */}
                <aside className="flex flex-col gap-5 lg:sticky lg:top-36 lg:w-59 lg:shrink-0">
                    <div className="rounded-2xl border border-border bg-card p-4">
                        <div className="flex items-center gap-3">
                            <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-muted">
                                <Image
                                    src={avatarSrc}
                                    alt=""
                                    fill
                                    className="object-cover"
                                    unoptimized={isBackendImage(form.avatar)}
                                />
                            </div>
                            <div className="min-w-0">
                                <p className="truncate text-[13.5px] font-bold">{form.name || "Outlet pian"}</p>
                                <p className="mt-px truncate text-[11.5px] text-muted-foreground">{form.address || "Alamat belum diisi"}</p>
                            </div>
                        </div>
                        <div className="mt-3.5 flex items-center justify-between gap-2.5 rounded-xl bg-muted/50 px-3 py-2.5">
                            <span className="flex items-center gap-2 text-[12.5px] font-bold">
                                <span className={cn("h-2 w-2 rounded-full", form.isOpen ? "bg-emerald-500" : "bg-rose-500")} />
                                {form.isOpen ? "Outlet buka" : "Outlet tutup"}
                            </span>
                            <Switch
                                checked={form.isOpen}
                                onChange={() => patch({ isOpen: !form.isOpen })}
                                label="Outlet buka"
                            />
                        </div>
                        <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
                            Pelanggan hanya bisa memesan saat outlet buka.
                        </p>
                    </div>

                    <nav className="hidden flex-col gap-0.5 lg:flex">
                        {nav.map((n) => (
                            <button
                                key={n.id}
                                type="button"
                                onClick={() => goTo(n.id)}
                                className={cn(
                                    "flex w-full items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-left text-[13.5px] font-semibold transition-colors",
                                    active === n.id
                                        ? "bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300"
                                        : "text-muted-foreground hover:bg-muted",
                                )}
                            >
                                <span>{n.label}</span>
                                <span
                                    className={cn(
                                        "text-[11px] font-bold",
                                        n.warn
                                            ? "text-amber-600 dark:text-amber-400"
                                            : active === n.id
                                                ? "text-rose-700 dark:text-rose-400"
                                                : "text-muted-foreground/70",
                                    )}
                                >
                                    {n.tag}
                                </span>
                            </button>
                        ))}
                    </nav>

                    {/* Only affects orders taken from here on — every past sale
                        keeps the tax rate and service type it was rung up with. */}
                    <p className="hidden px-3 text-[11.5px] leading-relaxed text-muted-foreground lg:block">
                        Perubahan berlaku untuk transaksi berikutnya. Order yang sudah tercatat tidak berubah.
                    </p>
                </aside>

                <div className="flex min-w-0 flex-1 flex-col gap-5">
                    {message && !message.ok && (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                            {message.text}
                        </div>
                    )}

                    {/* ── Profil ──────────────────────────────────────────── */}
                    <Section
                        id="profil"
                        title="Profil Outlet"
                        desc="Tampil di halaman pelanggan dan struk."
                    >
                        <div className="flex flex-wrap items-center gap-4">
                            <div className="relative h-21 w-21 shrink-0 overflow-hidden rounded-2xl border border-border bg-muted">
                                <Image
                                    src={avatarSrc}
                                    alt="Foto outlet"
                                    fill
                                    className="object-cover"
                                    unoptimized={isBackendImage(form.avatar)}
                                />
                                {uploading && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                        <Loader2 className="h-5 w-5 animate-spin text-white" />
                                    </div>
                                )}
                            </div>
                            <div className="min-w-50 flex-1">
                                <p className="text-[13px] font-bold">Foto Outlet</p>
                                <p className="mb-2.5 mt-0.5 text-xs text-muted-foreground">
                                    JPG, PNG, atau WebP — maksimal 5MB. Dipotong persegi, jadi rasio 1:1 paling rapi.
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => fileRef.current?.click()}
                                        disabled={uploading}
                                        className="flex items-center gap-1.5 rounded-[10px] border border-border bg-card px-3.5 py-2 text-[12.5px] font-bold transition-colors hover:bg-muted disabled:opacity-60"
                                    >
                                        <Camera className="h-3.5 w-3.5" />
                                        {uploading ? "Mengunggah..." : "Ganti Foto"}
                                    </button>
                                    {form.avatar !== DEFAULT_AVATAR && (
                                        <button
                                            type="button"
                                            onClick={() => patch({ avatar: DEFAULT_AVATAR })}
                                            disabled={uploading}
                                            className="rounded-[10px] px-3.5 py-2 text-[12.5px] font-bold text-muted-foreground transition-colors hover:text-foreground"
                                        >
                                            Hapus
                                        </button>
                                    )}
                                </div>
                                <input
                                    ref={fileRef}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={handleAvatarChange}
                                />
                            </div>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field label="Nama Outlet">
                                <Input
                                    value={form.name}
                                    onChange={(e) => patch({ name: e.target.value })}
                                    placeholder="Nama outlet..."
                                    className={INPUT}
                                />
                            </Field>
                            <Field label="Nomor WhatsApp">
                                <Input
                                    type="tel"
                                    value={form.phone}
                                    onChange={(e) => patch({ phone: e.target.value })}
                                    placeholder="08..."
                                    className={INPUT}
                                />
                            </Field>
                        </div>

                        <Field label="Alamat">
                            <Input
                                value={form.address}
                                onChange={(e) => patch({ address: e.target.value })}
                                placeholder="Jl. Contoh No. 1..."
                                className={INPUT}
                            />
                        </Field>
                    </Section>

                    {/* ── Tag & Kategori ─────────────────────────────────── */}
                    <Section
                        id="tag"
                        title="Tag & Kategori"
                        desc="Tag pian tulis sendiri. Kategori ikut produk yang dijual."
                    >
                        <div className="flex flex-col gap-2.5">
                            <div className="flex items-baseline justify-between gap-2.5">
                                <p className="text-[12.5px] font-bold text-muted-foreground">Tag Outlet</p>
                                <span className="text-[11.5px] font-bold text-muted-foreground/80">{form.tags.length} / 3</span>
                            </div>
                            {form.tags.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {form.tags.map((tag) => (
                                        <span
                                            key={tag}
                                            className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 py-1.5 pl-3 pr-2 text-[12.5px] font-bold text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                                        >
                                            {tag}
                                            <button
                                                type="button"
                                                aria-label={`Hapus tag ${tag}`}
                                                onClick={() => patch({ tags: form.tags.filter((t) => t !== tag) })}
                                                className="flex h-4.25 w-4.25 items-center justify-center rounded-full bg-rose-800/10 dark:bg-rose-300/15"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}
                            {form.tags.length < 3 ? (
                                <div className="flex flex-wrap gap-2">
                                    <Input
                                        value={tagInput}
                                        onChange={(e) => setTagInput(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                                        placeholder="Ketik tag lalu tekan Enter — misal Halal, 24 Jam"
                                        className={cn(INPUT, "h-10 min-w-50 flex-1")}
                                    />
                                    <button
                                        type="button"
                                        onClick={addTag}
                                        className="h-10 rounded-[11px] border border-border bg-card px-4.5 text-[13px] font-bold transition-colors hover:bg-muted"
                                    >
                                        Tambah
                                    </button>
                                </div>
                            ) : (
                                <p className="text-xs text-muted-foreground">Maksimal 3 tag sudah dipilih.</p>
                            )}
                        </div>

                        {/* Derived from the outlet's products by the backend, not
                            chosen here. The old checklist drifted from reality in
                            both directions: an outlet kept advertising a category
                            after it stopped selling it (customers tapped in to an
                            empty outlet), or sold products in a category it had
                            never ticked (those products never showed in browse at
                            all). Shown for transparency so the owner understands
                            where they appear. */}
                        <div className="flex flex-col gap-2.5 border-t border-border/60 pt-4.5">
                            <p className="text-[12.5px] font-bold text-muted-foreground">
                                Kategori Layanan <span className="font-semibold text-muted-foreground/70">· otomatis</span>
                            </p>
                            {features.length === 0 ? (
                                <p className="rounded-xl bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
                                    Belum ada kategori. Outlet pian belum muncul di pencarian pelanggan —
                                    tambahkan produk dulu di menu Produk.
                                </p>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    {features.map((slug) => (
                                        <span
                                            key={slug}
                                            className="rounded-[11px] border border-border bg-muted/50 px-3 py-2 text-[12.5px] font-bold"
                                        >
                                            {FEATURE_META.find((f) => f.slug === slug)?.label ?? slug}
                                        </span>
                                    ))}
                                </div>
                            )}
                            <p className="text-xs leading-relaxed text-muted-foreground">
                                Kategori mengikuti produk yang pian jual — tambah produk di kategori tertentu,
                                outlet langsung muncul di kategori itu.
                            </p>
                        </div>
                    </Section>

                    {/* ── Lokasi ─────────────────────────────────────────── */}
                    <Section
                        id="lokasi"
                        title="Lokasi Outlet"
                        desc="Dipakai kurir untuk menjemput pesanan. Klik peta atau seret penanda."
                        action={
                            <button
                                type="button"
                                onClick={handleGetLocation}
                                disabled={locating}
                                className="flex shrink-0 items-center gap-1.5 rounded-[10px] border border-border bg-card px-3.5 py-2 text-[12.5px] font-bold transition-colors hover:bg-muted disabled:opacity-60"
                            >
                                {locating
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : <Navigation className="h-3.5 w-3.5" />}
                                {locating ? "Mencari..." : "Pakai Lokasi Saya"}
                            </button>
                        }
                    >
                        {locError && (
                            <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{locError}</p>
                        )}

                        <div className="overflow-hidden rounded-[14px] border border-border">
                            <LocationPicker lat={form.lat} lon={form.lon} onChange={(la, lo) => patch({ lat: la, lon: lo })} />
                        </div>

                        <div className="flex flex-wrap gap-2.5">
                            {[
                                { label: "LATITUDE", value: form.lat },
                                { label: "LONGITUDE", value: form.lon },
                            ].map((c) => (
                                <div key={c.label} className="min-w-37.5 flex-1 rounded-[11px] border border-border/60 bg-muted/40 px-3.5 py-2.5">
                                    <p className="text-[11px] font-bold tracking-wide text-muted-foreground">{c.label}</p>
                                    <p className="mt-0.5 text-sm font-bold tabular-nums">{c.value.toFixed(6)}</p>
                                </div>
                            ))}
                        </div>

                        {/* Same advisory as registration. An owner can move their pin
                            long after signing up — or the admin can move the coverage
                            centre underneath them — so the warning has to live here
                            too, not only on the form they filled in once. Never
                            blocks saving. */}
                        {coverage?.outside && (
                            <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/40">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                                <div>
                                    <p className="text-[13px] font-bold text-amber-800 dark:text-amber-300">
                                        Di luar area penjemputan kurir
                                    </p>
                                    <p className="mt-0.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400/90">
                                        Lokasi outlet pian {Math.round(coverage.distanceKm)} km dari pusat area layanan
                                        (radius {coverage.area.radiusKm} km). Outlet tetap aktif dan bisa berjualan di
                                        tempat — hanya pengantaran kurir yang belum tersedia.
                                    </p>
                                </div>
                            </div>
                        )}
                    </Section>

                    {/* ── Notifikasi ─────────────────────────────────────────
                        Acts on the spot rather than on Simpan: it's this
                        device's browser subscription, not an outlet setting. */}
                    <Section
                        id="notifikasi"
                        title="Notifikasi Pesanan Baru"
                        desc="Bunyi peringatan di perangkat ini setiap ada pesanan masuk, walau aplikasi ditutup."
                    >
                        {push.state === "unsupported" ? (
                            <p className="text-[13px] text-muted-foreground">
                                Browser ini tidak mendukung notifikasi latar belakang. Coba Chrome, Edge, atau Safari versi terbaru.
                            </p>
                        ) : (
                            <div className="flex flex-col gap-3">
                                <div
                                    className={cn(
                                        "flex flex-wrap items-center justify-between gap-3.5 rounded-xl border px-4 py-3.5",
                                        push.state === "subscribed"
                                            ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
                                            : "border-border/60 bg-muted/40",
                                    )}
                                >
                                    <div className="min-w-45 flex-1">
                                        <p
                                            className={cn(
                                                "text-[13.5px] font-bold",
                                                push.state === "subscribed" && "text-emerald-800 dark:text-emerald-300",
                                            )}
                                        >
                                            {push.state === "subscribed" && "Notifikasi aktif di perangkat ini"}
                                            {push.state === "unsubscribed" && "Notifikasi belum diaktifkan"}
                                            {push.state === "default" && "Belum diminta izin"}
                                            {push.state === "denied" && "Izin notifikasi ditolak"}
                                            {push.state === "unconfigured" && "Notifikasi belum dikonfigurasi server"}
                                        </p>
                                        <p className="mt-0.5 text-xs text-muted-foreground">
                                            {push.state === "denied"
                                                ? "Izinkan notifikasi untuk situs ini lewat pengaturan browser, lalu muat ulang halaman."
                                                : device && `Perangkat: ${device}`}
                                        </p>
                                    </div>
                                    {(push.state === "default" || push.state === "unsubscribed") && (
                                        <button
                                            type="button"
                                            onClick={push.subscribe}
                                            disabled={push.busy}
                                            className="flex shrink-0 items-center gap-1.5 rounded-[10px] bg-rose-600 px-4 py-2 text-[12.5px] font-bold text-white transition-colors hover:bg-rose-700 disabled:opacity-60"
                                        >
                                            {push.busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                            Aktifkan
                                        </button>
                                    )}
                                    {push.state === "subscribed" && (
                                        <button
                                            type="button"
                                            onClick={push.unsubscribe}
                                            disabled={push.busy}
                                            className="shrink-0 rounded-[10px] border border-border bg-card px-4 py-2 text-[12.5px] font-bold transition-colors hover:bg-muted disabled:opacity-60"
                                        >
                                            Matikan
                                        </button>
                                    )}
                                </div>
                                {push.state === "subscribed" && (
                                    <div className="flex flex-col gap-1.5">
                                        <button
                                            type="button"
                                            onClick={() => void handleTest()}
                                            disabled={testing}
                                            className="flex items-center gap-1.5 self-start text-[12.5px] font-bold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
                                        >
                                            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                            Kirim notifikasi tes
                                        </button>
                                        {testResult && (
                                            <p className={cn("text-xs font-medium", testResult.ok ? "text-emerald-600" : "text-rose-500")}>
                                                {testResult.text}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </Section>

                    {/* ── Pajak Kasir ────────────────────────────────────────
                        Changing the rate does NOT touch orders already taken:
                        ordersTable freezes rate/amount/inclusive at sale time. */}
                    {tax && !canUseTax && (
                        <Section
                            id="pajak"
                            title="Pajak Kasir (PB1 / PPN)"
                            desc="Pajak otomatis di kasir, tercetak di struk dan terpisah dari pendapatan di laporan. Tersedia mulai paket Max Lite."
                            action={
                                <Link
                                    href="/dashboard/subscription"
                                    className="flex shrink-0 items-center gap-1.5 rounded-[10px] bg-foreground px-3 py-2 text-xs font-bold text-background transition-opacity hover:opacity-90"
                                >
                                    <Sparkles className="h-3.5 w-3.5" />
                                    Upgrade
                                </Link>
                            }
                        />
                    )}
                    {tax && canUseTax && (
                        <Section
                            id="pajak"
                            title="Pajak Kasir (PB1 / PPN)"
                            desc="Dihitung dari total setelah diskon."
                            action={
                                <Switch
                                    checked={tax.enabled}
                                    onChange={() => setTax({ ...tax, enabled: !tax.enabled })}
                                    label="Aktifkan pajak"
                                />
                            }
                        >
                            {tax.enabled && (
                                <>
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <Field label="Nama pajak di struk">
                                            <Input
                                                value={tax.label}
                                                onChange={(e) => setTax({ ...tax, label: e.target.value.slice(0, 20) })}
                                                placeholder="PB1"
                                                className={INPUT}
                                            />
                                        </Field>
                                        <Field label="Tarif (%)">
                                            <Input
                                                type="number"
                                                inputMode="decimal"
                                                min={0}
                                                max={99.99}
                                                step="0.01"
                                                value={tax.rate}
                                                onChange={(e) => setTax({ ...tax, rate: Number(e.target.value) })}
                                                className={INPUT}
                                            />
                                        </Field>
                                    </div>

                                    <div className="flex flex-col gap-2">
                                        <p className="text-xs font-bold text-muted-foreground">Cara hitung</p>
                                        {[
                                            {
                                                value: false,
                                                title: "Harga belum termasuk pajak",
                                                desc: "Pajak ditambahkan di kasir. Total yang dibayar pelanggan naik.",
                                            },
                                            {
                                                value: true,
                                                title: "Harga sudah termasuk pajak",
                                                desc: "Total tetap. Pajak dipisahkan dari pendapatan untuk laporan.",
                                            },
                                        ].map((opt) => {
                                            const selected = tax.inclusive === opt.value;
                                            return (
                                                <button
                                                    key={String(opt.value)}
                                                    type="button"
                                                    role="radio"
                                                    aria-checked={selected}
                                                    onClick={() => setTax({ ...tax, inclusive: opt.value })}
                                                    className={cn(
                                                        "flex w-full items-start gap-3 rounded-xl border-[1.5px] px-4 py-3 text-left transition-colors",
                                                        selected
                                                            ? "border-rose-600 bg-rose-50/60 dark:bg-rose-500/10"
                                                            : "border-border hover:border-muted-foreground/40",
                                                    )}
                                                >
                                                    <span
                                                        className={cn(
                                                            "mt-0.5 h-3.75 w-3.75 shrink-0 rounded-full bg-card",
                                                            selected ? "border-[4.5px] border-rose-600" : "border-2 border-muted-foreground/40",
                                                        )}
                                                    />
                                                    <span className="min-w-0">
                                                        <span className="block text-[13px] font-bold">{opt.title}</span>
                                                        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{opt.desc}</span>
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {tax.rate > 0 && (
                                        <div className="rounded-xl border border-border/60 bg-muted/40 px-4 py-3.5">
                                            <p className="mb-2 text-[11.5px] font-bold tracking-wide text-muted-foreground">
                                                CONTOH BARANG {rp(base)}
                                            </p>
                                            <div className="flex flex-wrap gap-3.5">
                                                {[
                                                    { label: "Pelanggan bayar", value: example.pays, cls: "" },
                                                    { label: "Pajak", value: example.tax, cls: "text-muted-foreground" },
                                                    { label: "Pendapatan pian", value: example.revenue, cls: "text-emerald-700 dark:text-emerald-400" },
                                                ].map((x) => (
                                                    <div key={x.label} className="min-w-27.5 flex-1">
                                                        <p className="text-xs text-muted-foreground">{x.label}</p>
                                                        <p className={cn("mt-0.5 text-base font-extrabold tabular-nums", x.cls)}>{rp(x.value)}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </Section>
                    )}

                    {/* ── Dine In / Take Away ────────────────────────────────
                        Whether the cashier asks at all. Off hides the switch at
                        the counter and a sale records NULL ("tidak dicatat");
                        a table's bill is still dine in, whatever this says. */}
                    {serviceType !== null && (
                        <Section
                            id="layanan"
                            title="Dine In / Take Away"
                            desc={
                                serviceType
                                    ? "Kasir memilih Dine In atau Take Away di setiap pesanan."
                                    : "Tidak ditanyakan di kasir. Pesanan kasir tidak mencatat Dine In / Take Away."
                            }
                            action={
                                <Switch
                                    checked={serviceType}
                                    onChange={() => setServiceType(!serviceType)}
                                    label="Tanyakan Dine In / Take Away di kasir"
                                />
                            }
                        >
                            <div className="rounded-xl border border-border/60 bg-muted/40 px-4 py-3.5">
                                <p className="mb-2.5 text-[11.5px] font-bold tracking-wide text-muted-foreground">DI KASIR</p>
                                {serviceType ? (
                                    <div className="flex flex-wrap items-center gap-3">
                                        {/* A picture of the cashier's switch, not a control. */}
                                        <div aria-hidden className="flex rounded-full bg-muted p-0.5 text-[11px] font-bold">
                                            {SERVICE_TYPES.map((s) => (
                                                <span
                                                    key={s}
                                                    className={cn(
                                                        "rounded-full px-2.5 py-0.5",
                                                        s === DEFAULT_SERVICE_TYPE
                                                            ? s === "take_away" ? "bg-amber-500 text-white" : "bg-indigo-600 text-white"
                                                            : "text-muted-foreground",
                                                    )}
                                                >
                                                    {SERVICE_TYPE_LABEL[s]}
                                                </span>
                                            ))}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Pesanan baru mulai sebagai {SERVICE_TYPE_LABEL[DEFAULT_SERVICE_TYPE]}.
                                        </p>
                                    </div>
                                ) : (
                                    <p className="text-[13px] font-semibold text-muted-foreground">
                                        Tombol Dine In / Take Away tidak muncul di kasir.
                                    </p>
                                )}
                            </div>
                            <ul className="flex list-disc flex-col gap-1 pl-4 text-xs leading-relaxed text-muted-foreground">
                                <li>Bill dari Manajemen Meja selalu tercatat Dine In.</li>
                                <li>
                                    Pesanan yang sudah tercatat tidak berubah.{" "}
                                    <Link
                                        href="/dashboard/reports/service-type"
                                        className="font-bold text-rose-600 hover:text-rose-700 dark:text-rose-400"
                                    >
                                        Lihat laporan Dine In / Take Away →
                                    </Link>
                                </li>
                            </ul>
                        </Section>
                    )}

                    <p className="px-1 text-[11.5px] leading-relaxed text-muted-foreground lg:hidden">
                        Perubahan berlaku untuk transaksi berikutnya. Order yang sudah tercatat tidak berubah.
                    </p>
                </div>
            </div>
        </div>
    );
}
