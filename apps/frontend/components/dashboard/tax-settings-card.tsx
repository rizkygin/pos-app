'use client';

import { useEffect, useState } from 'react';
import { Loader2, Lock, Percent, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { API_URL } from '@/lib/api-url';

/**
 * Counter tax (PB1 / PPN) settings.
 *
 * Self-contained rather than folded into the outlet form: it loads and saves
 * through its own endpoint (/api/outlet/tax), it is plan-gated where the rest
 * of the form isn't, and changing a tax rate is a decision an owner should be
 * able to make without re-submitting their address and map pin.
 */

type TaxState = {
  enabled: boolean;
  rate: number;
  inclusive: boolean;
  label: string;
};

const fmtExample = (n: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(Math.round(n));

export function TaxSettingsCard() {
  const [state, setState] = useState<TaxState | null>(null);
  const [canUseTax, setCanUseTax] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/outlet/tax`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.success) return;
        setCanUseTax(!!j.canUseTax);
        setState({
          enabled: !!j.tax.enabled,
          rate: Number(j.tax.rate ?? 0),
          inclusive: !!j.tax.inclusive,
          label: j.tax.label ?? 'Pajak',
        });
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    if (!state) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/api/outlet/tax`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(state),
      });
      const body = await res.json().catch(() => ({}));
      setMessage({
        ok: res.ok,
        text: res.ok
          ? (body.message ?? 'Pengaturan pajak disimpan.')
          : (body.error ?? 'Gagal menyimpan pengaturan pajak.'),
      });
    } catch {
      setMessage({ ok: false, text: 'Tidak bisa menghubungi server.' });
    } finally {
      setSaving(false);
    }
  };

  if (!state) return null;

  if (!canUseTax) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">Pajak Kasir (PB1 / PPN)</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Tambahkan pajak otomatis di kasir, tercetak di struk dan terpisah
              dari pendapatan di laporan. Tersedia mulai paket Max Lite.
            </p>
          </div>
          <Link
            href="/dashboard/subscription"
            className="flex shrink-0 items-center gap-1 rounded-lg bg-foreground px-3 py-1.5 text-xs font-bold text-background transition-opacity hover:opacity-90"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Upgrade
          </Link>
        </div>
      </div>
    );
  }

  // A worked example on a round number, because "inclusive vs exclusive" is the
  // setting merchants get wrong, and the difference is only obvious in rupiah.
  const base = 100000;
  const example = state.inclusive
    ? {
        pays: base,
        tax: (base * state.rate) / (100 + state.rate),
        revenue: base - (base * state.rate) / (100 + state.rate),
      }
    : {
        pays: base + (base * state.rate) / 100,
        tax: (base * state.rate) / 100,
        revenue: base,
      };

  return (
    <div className="space-y-4 rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold">
            <Percent className="h-4 w-4 text-muted-foreground" />
            Pajak Kasir
          </p>
          <p className="text-xs text-muted-foreground">
            Dihitung dari total setelah diskon.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={state.enabled}
          aria-label="Aktifkan pajak"
          onClick={() => setState({ ...state, enabled: !state.enabled })}
          className={`relative inline-flex h-7 w-13 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
            state.enabled ? 'bg-emerald-500' : 'bg-muted'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-200 ${
              state.enabled ? 'translate-x-6' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {state.enabled && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold">
                Nama pajak
              </label>
              <Input
                value={state.label}
                onChange={(e) =>
                  setState({ ...state, label: e.target.value.slice(0, 20) })
                }
                placeholder="PB1"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Tercetak di struk, misal &quot;PB1&quot; atau &quot;PPN&quot;.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Tarif (%)</label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                max={99.99}
                step="0.01"
                value={state.rate}
                onChange={(e) =>
                  setState({ ...state, rate: Number(e.target.value) })
                }
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Tarif PB1 berbeda tiap kabupaten/kota.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold">Cara hitung</p>
            {[
              {
                value: false,
                title: 'Harga belum termasuk pajak',
                desc: 'Pajak ditambahkan di kasir. Total yang dibayar pelanggan naik.',
              },
              {
                value: true,
                title: 'Harga sudah termasuk pajak',
                desc: 'Total tetap. Pajak dipisahkan dari pendapatan untuk laporan.',
              },
            ].map((opt) => (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => setState({ ...state, inclusive: opt.value })}
                className={`flex w-full items-start gap-3 rounded-xl border-2 p-3 text-left transition-colors ${
                  state.inclusive === opt.value
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <span
                  className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${
                    state.inclusive === opt.value
                      ? 'border-blue-600 bg-blue-600'
                      : 'border-muted-foreground/40'
                  }`}
                />
                <span className="min-w-0">
                  <span className="block text-xs font-bold">{opt.title}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {opt.desc}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {state.rate > 0 && (
            <div className="rounded-xl bg-muted/50 p-3 text-[11px]">
              <p className="mb-1 font-bold">
                Contoh untuk barang seharga {fmtExample(base)}
              </p>
              <p className="text-muted-foreground">
                Pelanggan bayar{' '}
                <span className="font-bold text-foreground">
                  {fmtExample(example.pays)}
                </span>{' '}
                &middot; pajak {fmtExample(example.tax)} &middot; pendapatan{' '}
                {fmtExample(example.revenue)}
              </p>
            </div>
          )}
        </>
      )}

      {message && (
        <p
          className={`text-xs font-semibold ${
            message.ok ? 'text-emerald-600' : 'text-rose-600'
          }`}
        >
          {message.text}
        </p>
      )}

      {/* Only affects orders taken from here on — every past sale keeps the
          rate it was rung up at. */}
      <p className="text-[11px] text-muted-foreground">
        Perubahan berlaku untuk transaksi berikutnya. Order yang sudah tercatat
        tetap memakai tarif saat transaksi.
      </p>

      <Button onClick={save} disabled={saving} className="w-full font-bold">
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Simpan Pengaturan Pajak
      </Button>
    </div>
  );
}
