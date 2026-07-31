'use client';

import { useCallback, useEffect, useState } from 'react';
import { Store, Plus, Loader2, MapPin, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { API_URL } from '@/lib/api-url';
import { ORDER_FEATURES } from '@/lib/order-features';
import { parseCoordPair } from '@/lib/coords';
import { getCurrentPosition, geolocationMessage } from '@/lib/geolocation';

type OutletRow = {
  id: number;
  name: string;
  address: string;
  avatar: string;
  is_open: boolean;
};

export function OutletsClient() {
  const [outlets, setOutlets] = useState<OutletRow[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [maxOutlets, setMaxOutlets] = useState(1);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<number | null>(null);

  // create form
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [locating, setLocating] = useState(false);
  const [features, setFeatures] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchAll = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/my-outlets`, { credentials: 'include' });
    const json = await res.json();
    if (json.success) {
      setOutlets(json.data);
      setActiveId(json.active_id);
      setMaxOutlets(json.max_outlets ?? 1);
    }
  }, []);

  useEffect(() => {
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

  const switchTo = async (id: number) => {
    setSwitching(id);
    try {
      const res = await fetch(`${API_URL}/api/outlets/active`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outlet_id: id }),
      });
      if (res.ok) window.location.reload();
    } finally {
      setSwitching(null);
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setError('Browser ini tidak mendukung geolokasi.');
      return;
    }
    setLocating(true);
    setError('');
    getCurrentPosition(
      (pos) => {
        setLat(String(pos.coords.latitude));
        setLon(String(pos.coords.longitude));
        setLocating(false);
      },
      // Previously swallowed entirely, so a failed fix looked like nothing had
      // happened and the outlet got created with empty coordinates.
      (err) => {
        setError(geolocationMessage(err));
        setLocating(false);
      },
    );
  };

  const create = async () => {
    setSaving(true);
    setError('');
    try {
      // Setting a location is optional here. Omit the pair entirely when it
      // isn't a real coordinate so the backend's default applies — posting the
      // empty strings this form starts with used to store '' in a notNull
      // varchar, which came back as NaN and crashed the outlet map picker.
      const coords = parseCoordPair(lat, lon);
      const res = await fetch(`${API_URL}/api/outlets`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, address, phone, email, features, ...coords }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Gagal membuat outlet');
        return;
      }
      // Backend already switched the active-outlet cookie to the new outlet.
      window.location.reload();
    } catch {
      setError('Gagal terhubung ke server');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  const capReached = outlets.length >= maxOutlets;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          <span className="font-bold text-foreground">{outlets.length}</span> dari{' '}
          <span className="font-bold text-foreground">{maxOutlets}</span> outlet
          {capReached && (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              batas paket tercapai — upgrade untuk menambah
            </span>
          )}
        </p>
        <Button
          onClick={() => setShowAdd((v) => !v)}
          disabled={capReached && !showAdd}
          className="bg-foreground text-background hover:opacity-85"
        >
          <Plus className="size-4" /> Tambah Outlet
        </Button>
      </div>

      {showAdd && (
        <div className="rounded-2xl border p-4">
          <p className="text-sm font-bold">Outlet Baru</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Input placeholder="Nama outlet" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Email outlet (unik)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input placeholder="Alamat" value={address} onChange={(e) => setAddress(e.target.value)} />
            <Input placeholder="WhatsApp" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <Button type="button" variant="outline" onClick={useMyLocation} disabled={locating} className="mt-2 w-full">
            {locating ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
            {lat ? `Lokasi: ${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}` : 'Gunakan Lokasi Saya'}
          </Button>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {ORDER_FEATURES.filter((f) => f.isAvailable).map((f) => (
              <button
                key={f.slug}
                type="button"
                onClick={() =>
                  setFeatures((prev) =>
                    prev.includes(f.slug) ? prev.filter((s) => s !== f.slug) : [...prev, f.slug],
                  )
                }
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  features.includes(f.slug)
                    ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>
              Batal
            </Button>
            <Button
              size="sm"
              onClick={create}
              disabled={saving || !name.trim() || !email.trim() || !address.trim() || !phone.trim()}
              className="bg-foreground text-background hover:opacity-85"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : 'Buat Outlet'}
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {outlets.map((o) => (
          <div
            key={o.id}
            className={`rounded-2xl border p-4 ${o.id === activeId ? 'border-sky-500 ring-1 ring-sky-500/30' : ''}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-bold">
                  <Store className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />
                  <span className="truncate">{o.name}</span>
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{o.address}</p>
              </div>
              {o.id === activeId ? (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                  <CheckCircle2 className="size-3" /> Aktif
                </span>
              ) : (
                <Button size="sm" variant="outline" onClick={() => switchTo(o.id)} disabled={switching !== null}>
                  {switching === o.id ? <Loader2 className="size-3.5 animate-spin" /> : 'Jadikan Aktif'}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Outlet aktif menentukan data yang tampil di seluruh dashboard — kasir, produk, faktur,
        stok, dan laporan semuanya per-outlet. Karyawan terikat ke outlet tempat mereka dibuat.
      </p>
    </div>
  );
}
