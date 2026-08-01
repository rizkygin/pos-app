'use client';

import { useMemo, useState, useTransition } from 'react';
import { MapPin, Loader2, Save, CheckCircle2, AlertTriangle, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DashboardHeader } from '@/components/dashboard-header';
import { ServiceAreaMapClient, } from '@/components/dashboard/service-area-map-client';
import type { PlottedOutlet } from '@/components/dashboard/service-area-map';
import { haversineKm } from '@/lib/haversine';
import { API_URL } from '@/lib/api-url';

type Area = { centerLat: number; centerLon: number; radiusKm: number };

// Where the map opens when nothing has ever been configured. The outlets' own
// area rather than Jakarta — an admin setting this up is almost certainly
// sitting in the place they intend to serve.
const FALLBACK_CENTER = { lat: -2.7057, lon: 111.6422 };

export function ServiceAreaSetting({
    initialArea,
    outlets,
}: {
    initialArea: Area | null;
    outlets: PlottedOutlet[];
}) {
    const [center, setCenter] = useState({
        lat: initialArea?.centerLat ?? FALLBACK_CENTER.lat,
        lon: initialArea?.centerLon ?? FALLBACK_CENTER.lon,
    });
    const [radiusKm, setRadiusKm] = useState(initialArea?.radiusKm ?? 50);
    const [saved, setSaved] = useState(initialArea !== null);
    const [alert, setAlert] = useState<{ ok: boolean; text: string } | null>(null);
    const [pending, startTransition] = useTransition();
    // Local overrides layered over the server values, so a toggle reflects
    // immediately instead of waiting for a page refresh.
    const [overrides, setOverrides] = useState<Record<number, boolean>>({});
    const [togglingId, setTogglingId] = useState<number | null>(null);

    const toggleOutlet = async (outletId: number, reachable: boolean) => {
        setTogglingId(outletId);
        try {
            const res = await fetch(`${API_URL}/api/admin/outlet/${outletId}/reachable`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reachable }),
            });
            const json = await res.json().catch(() => null);
            if (res.ok && json?.success) {
                setOverrides((prev) => ({ ...prev, [outletId]: reachable }));
            } else {
                setAlert({ ok: false, text: json?.error ?? 'Gagal mengubah jangkauan outlet.' });
            }
        } catch {
            setAlert({ ok: false, text: 'Gagal terhubung ke server.' });
        } finally {
            setTogglingId(null);
        }
    };

    // Recomputed live as the admin clicks around, so the cost of moving the
    // centre is visible before saving rather than discovered afterwards.
    const impact = useMemo(() => {
        const covered = outlets.filter(
            (o) => haversineKm(o.lat, o.lon, center.lat, center.lon) <= radiusKm,
        );
        return {
            covered: covered.length,
            stranded: outlets.length - covered.length,
            strandedOpen: outlets.filter(
                (o) =>
                    o.isOpen && haversineKm(o.lat, o.lon, center.lat, center.lon) > radiusKm,
            ).length,
        };
    }, [outlets, center.lat, center.lon, radiusKm]);

    const save = () => {
        setAlert(null);
        startTransition(async () => {
            try {
                const res = await fetch(`${API_URL}/api/admin/service-area`, {
                    method: 'PUT',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lat: center.lat, lon: center.lon, radiusKm }),
                });
                const json = await res.json().catch(() => null);
                if (!res.ok || !json?.success) {
                    setAlert({ ok: false, text: json?.error ?? 'Gagal menyimpan area layanan.' });
                    return;
                }
                setSaved(true);
                // Saving recomputes every outlet from the circle, so any manual
                // overrides are now stale — drop them rather than showing values
                // the server no longer holds.
                setOverrides({});
                setAlert({
                    ok: true,
                    text:
                        typeof json.changed === 'number' && json.changed > 0
                            ? `Area layanan tersimpan. ${json.changed} outlet berubah jangkauannya.`
                            : 'Area layanan tersimpan.',
                });
            } catch {
                setAlert({ ok: false, text: 'Gagal terhubung ke server.' });
            }
        });
    };

    return (
        <div className="px-4 md:px-6 pb-16 pt-2 space-y-6 max-w-4xl">
            <DashboardHeader
                title="Area Layanan Kurir"
                description="Tentukan pusat & radius wilayah yang bisa dijangkau kurir Ulun Pesan."
            />

            {/* Stated up front: an unset area is permissive, not restrictive. An
                admin needs to know the feature is inactive rather than assume
                a blank map means "nothing is covered". */}
            {!saved && (
                <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/40">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <p className="text-sm text-amber-800 dark:text-amber-300">
                        Belum ada area layanan. Selama belum diatur, <strong>semua lokasi
                            dianggap tercakup</strong> dan pendaftaran outlet tidak dibatasi.
                    </p>
                </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-border/60 bg-card p-4">
                    <p className="text-2xl font-black tabular-nums">{radiusKm} km</p>
                    <p className="text-xs text-muted-foreground mt-0.5">radius (garis lurus)</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-card p-4">
                    <p className="text-2xl font-black tabular-nums text-emerald-600">{impact.covered}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">outlet tercakup</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-card p-4">
                    <p
                        className={`text-2xl font-black tabular-nums ${impact.stranded > 0 ? 'text-rose-600' : ''}`}
                    >
                        {impact.stranded}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        di luar area{impact.strandedOpen > 0 ? ` (${impact.strandedOpen} buka)` : ''}
                    </p>
                </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-4">
                <p className="text-sm font-bold flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-blue-600" />
                    Klik peta untuk memindahkan pusat area
                </p>

                <ServiceAreaMapClient
                    center={center}
                    radiusKm={radiusKm}
                    outlets={outlets}
                    onPick={(lat, lon) => setCenter({ lat, lon })}
                    className="h-96 w-full"
                />

                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-blue-600" /> pusat area
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" /> outlet tercakup
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-rose-600" /> outlet di luar area
                    </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                            Latitude
                        </label>
                        <Input
                            value={center.lat.toFixed(6)}
                            readOnly
                            className="rounded-xl bg-muted/40 font-mono text-xs"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                            Longitude
                        </label>
                        <Input
                            value={center.lon.toFixed(6)}
                            readOnly
                            className="rounded-xl bg-muted/40 font-mono text-xs"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label
                            htmlFor="radius"
                            className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
                        >
                            Radius (km)
                        </label>
                        <Input
                            id="radius"
                            type="number"
                            min={1}
                            max={500}
                            value={radiusKm}
                            onChange={(e) => setRadiusKm(Number(e.target.value) || 0)}
                            className="rounded-xl"
                        />
                    </div>
                </div>

                {impact.strandedOpen > 0 && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 dark:border-rose-900 dark:bg-rose-950/40">
                        <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                        <p className="text-xs text-rose-700 dark:text-rose-300">
                            {impact.strandedOpen} outlet yang sedang <strong>buka</strong> berada di
                            luar area ini. Tidak ada yang diblokir — batas ini hanya menampilkan
                            peringatan saat pemilik baru mendaftar di luar jangkauan.
                        </p>
                    </div>
                )}

                {alert && (
                    <p
                        className={`flex items-center gap-2 text-sm font-medium ${alert.ok ? 'text-emerald-600' : 'text-rose-600'}`}
                    >
                        {alert.ok ? (
                            <CheckCircle2 className="h-4 w-4" />
                        ) : (
                            <AlertTriangle className="h-4 w-4" />
                        )}
                        {alert.text}
                    </p>
                )}

                <Button onClick={save} disabled={pending} className="rounded-xl">
                    {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    {pending ? 'Menyimpan...' : 'Simpan Area Layanan'}
                </Button>
            </div>

            {/* Per-outlet override. The circle approximates where couriers go; it
                isn't the territory. A shop just past the line that a courier
                passes anyway should be markable without distorting the geometry
                for everyone else. */}
            <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
                <div>
                    <p className="text-sm font-bold">Jangkauan per Outlet</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Nilai ini dihitung ulang setiap area layanan disimpan. Ubah manual
                        kalau kenyataannya berbeda dari lingkaran di atas.
                    </p>
                </div>

                <div className="divide-y divide-border/50 rounded-xl border border-border/50">
                    {outlets.map((o) => {
                        const reachable = overrides[o.id] ?? o.reachable;
                        return (
                            <div key={o.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold">{o.name}</p>
                                    <p className="text-[11px] text-muted-foreground tabular-nums">
                                        {haversineKm(o.lat, o.lon, center.lat, center.lon).toFixed(1)} km
                                        dari pusat
                                        {!o.isOpen && ' · tutup'}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => toggleOutlet(o.id, !reachable)}
                                    disabled={togglingId === o.id}
                                    className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-50 ${
                                        reachable
                                            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-950 dark:text-emerald-400'
                                            : 'bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-950 dark:text-rose-400'
                                    }`}
                                >
                                    {togglingId === o.id
                                        ? '...'
                                        : reachable
                                            ? 'Terjangkau'
                                            : 'Tidak terjangkau'}
                                </button>
                            </div>
                        );
                    })}
                    {outlets.length === 0 && (
                        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                            Belum ada outlet dengan koordinat yang bisa dipetakan.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
