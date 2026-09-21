'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CreditCard,
  Loader2,
  CheckCircle2,
  XCircle,
  ImageIcon,
  RefreshCw,
  BadgePercent,
  UsersRound,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { API_URL } from '@/lib/api-url';

type PaymentRow = {
  id: number;
  user_name: string;
  user_email: string;
  plan_name: string;
  tier: string;
  interval: 'monthly' | 'yearly';
  amount: string;
  unique_code: number;
  amount_due: string;
  status: 'pending' | 'paid' | 'rejected' | 'expired' | 'failed' | 'refunded';
  proof_image: string | null;
  sender_bank: string | null;
  sender_name: string | null;
  transfer_date: string | null;
  merchant_note: string | null;
  review_note: string | null;
  expires_at: string | null;
  paid_at: string | null;
  period_end: string | null;
  created_at: string;
};

const rupiah = (v: number | string) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(v) || 0);

const tgl = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

const STATUS_STYLE: Record<PaymentRow['status'], string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  paid: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  rejected: 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-300',
  expired: 'bg-zinc-100 text-zinc-500 line-through dark:bg-zinc-800 dark:text-zinc-400',
  failed: 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-300',
  refunded: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
};
const STATUS_LABEL: Record<PaymentRow['status'], string> = {
  pending: 'Menunggu',
  paid: 'Lunas',
  rejected: 'Ditolak',
  expired: 'Kedaluwarsa',
  failed: 'Gagal',
  refunded: 'Refund',
};

const FILTERS = [
  { key: 'pending', label: 'Menunggu' },
  { key: 'paid', label: 'Lunas' },
  { key: 'rejected', label: 'Ditolak' },
  { key: 'all', label: 'Semua' },
] as const;

// One period's takings. plan_total + addon_total === total: the split is of the
// same money, not an extra on top (the 3-digit unique code rides the plan side).
type RevenueBucket = {
  period: string; // 'YYYY-MM' for monthly, 'YYYY' for yearly
  total: number;
  plan_total: number;
  addon_total: number;
  count: number;
};

type RevenueSummary = {
  all_time: number;
  all_time_count: number;
  this_month: number;
  this_month_count: number;
  last_month: number;
  active_subscribers: number;
  trialing: number;
  monthly: RevenueBucket[]; // last 12 months, zero-filled
  yearly: RevenueBucket[]; // every year on record
};

// Compact rupiah for the bar column — twelve full-length figures stacked up
// read as a wall of digits. The exact number stays one hover away.
const rupiahShort = (v: number) => {
  const n = Math.round(v);
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1).replace('.', ',')} M`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1).replace('.', ',')} jt`;
  if (n >= 1_000) return `Rp ${Math.round(n / 1_000)} rb`;
  return rupiah(n);
};

const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// 'YYYY-MM' -> 'Sep 26'; 'YYYY' -> '2026'. Parsed as plain strings, never
// through new Date(), which would drag the viewer's clock into a label that is
// already a settled calendar bucket from the server.
const periodLabel = (period: string) => {
  const [y, m] = period.split('-');
  return m ? `${BULAN_PENDEK[Number(m) - 1]} ${y.slice(2)}` : y;
};

// Revenue accumulation from PAID payments (computed server-side from the
// source of truth — no shadow table). Plain stat tiles: numbers wear text
// ink, labels muted; no chart, so no hover/palette machinery.
function RevenueStats() {
  const [summary, setSummary] = useState<RevenueSummary | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/admin/subscription-revenue`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.success && setSummary(j.data))
      .catch(() => {});
  }, []);

  if (!summary) return null;

  const tiles = [
    {
      label: 'Pendapatan Bulan Ini',
      value: rupiah(summary.this_month),
      sub: `${summary.this_month_count} pembayaran`,
    },
    {
      label: 'Bulan Lalu',
      value: rupiah(summary.last_month),
      sub: ' ',
    },
    {
      label: 'Total Pendapatan',
      value: rupiah(summary.all_time),
      sub: `${summary.all_time_count} pembayaran`,
    },
    {
      label: 'Pelanggan',
      value: String(summary.active_subscribers),
      sub: `aktif · ${summary.trialing} masa percobaan`,
    },
  ];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border bg-muted/20 px-3.5 py-3">
            <p className="text-[11px] font-medium text-muted-foreground">{t.label}</p>
            <p className="mt-0.5 truncate text-lg font-bold tabular-nums">{t.value}</p>
            <p className="text-[11px] text-muted-foreground">{t.sub}</p>
          </div>
        ))}
      </div>
      <RevenueHistory monthly={summary.monthly ?? []} yearly={summary.yearly ?? []} />
    </div>
  );
}

// Earnings per period. One measure (money in), so one hue and no legend — the
// heading says what is plotted. Rows rather than columns: twelve month names
// along an x-axis collide at phone width, and a row list reads as the table it
// effectively is, with every value labelled instead of gated behind the hover.
// The hover adds only the split and the exact figure.
function RevenueHistory({ monthly, yearly }: { monthly: RevenueBucket[]; yearly: RevenueBucket[] }) {
  const [mode, setMode] = useState<'monthly' | 'yearly'>('monthly');
  const rows = mode === 'monthly' ? monthly : yearly;

  // Bars are scaled against the biggest period in view, so switching Bulanan /
  // Tahunan rescales rather than flattening a year against a month.
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0);
  const windowTotal = rows.reduce((s, r) => s + r.total, 0);
  const windowCount = rows.reduce((s, r) => s + r.count, 0);
  const addonTotal = rows.reduce((s, r) => s + r.addon_total, 0);

  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-bold">
            <TrendingUp className="size-4 text-teal-600 dark:text-teal-400" /> Pendapatan Aplikasi
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Seluruh uang masuk dari pembayaran langganan yang sudah dikonfirmasi.
          </p>
        </div>
        <div className="flex gap-1.5">
          {(
            [
              { key: 'monthly', label: '12 Bulan' },
              { key: 'yearly', label: 'Per Tahun' },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setMode(t.key)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                mode === t.key
                  ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300'
                  : 'border-transparent bg-muted/50 text-muted-foreground hover:bg-muted'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          Belum ada pembayaran yang dikonfirmasi.
        </p>
      ) : (
        <>
          {/* Column headers: the trailing payment count is meaningless as a
              bare number floating at the end of a row. */}
          <div className="mt-3 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <span className="w-12 shrink-0">{mode === 'monthly' ? 'Bulan' : 'Tahun'}</span>
            <span className="flex-1" />
            <span className="w-20 shrink-0 text-right">Masuk</span>
            <span className="w-8 shrink-0 text-right">Bayar</span>
          </div>
          {/* gap-y-1.5 keeps >=2px of surface between neighbouring bars. */}
          <div className="mt-1.5 flex flex-col gap-y-1.5">
            {rows.map((r) => (
              <div key={r.period} className="group relative flex items-center gap-2">
                <span className="w-12 shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
                  {periodLabel(r.period)}
                </span>
                {/* Track is one step off the surface; the fill is the only ink
                    that carries data. Square at the baseline, 4px rounded end. */}
                <span className="h-2.5 flex-1 overflow-hidden rounded-r-[4px] bg-muted">
                  <span
                    className="block h-full rounded-r-[4px] bg-teal-600 transition-[width]"
                    style={{ width: max > 0 ? `${Math.max(r.total > 0 ? 2 : 0, (r.total / max) * 100)}%` : '0%' }}
                  />
                </span>
                <span className="w-20 shrink-0 text-right text-[11px] font-semibold tabular-nums">
                  {r.total > 0 ? rupiahShort(r.total) : '—'}
                </span>
                <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {r.count || ''}
                </span>

                {r.total > 0 && (
                  <div className="pointer-events-none absolute right-0 top-full z-10 hidden w-max rounded-lg border bg-background px-2.5 py-1.5 text-[11px] shadow-md group-hover:block">
                    <p className="font-bold tabular-nums">{rupiah(r.total)}</p>
                    <p className="text-muted-foreground">
                      Paket {rupiah(r.plan_total)}
                      {r.addon_total > 0 && ` · Akun tambahan ${rupiah(r.addon_total)}`}
                    </p>
                    <p className="text-muted-foreground">{r.count} pembayaran</p>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t pt-2.5 text-[11px]">
            <span className="text-muted-foreground">
              Total {mode === 'monthly' ? '12 bulan terakhir' : 'sepanjang masa'}
            </span>
            <span className="font-bold tabular-nums">
              {rupiah(windowTotal)}
              <span className="ml-1.5 font-medium text-muted-foreground">
                · {windowCount} pembayaran
                {addonTotal > 0 && ` · termasuk ${rupiah(addonTotal)} akun tambahan`}
              </span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// Set/clear a marketing deal on one merchant: % off, optionally scoped to a
// single tier and/or interval (kosong = berlaku semua). 0% clears the deal.
function DealForm() {
  const [email, setEmail] = useState('');
  const [pct, setPct] = useState('');
  const [tier, setTier] = useState('');
  const [intervalScope, setIntervalScope] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const submit = async () => {
    if (!email.trim()) return;
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/subscription-deals`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          discount_pct: Number(pct || 0),
          tier: tier || null,
          interval: intervalScope || null,
          note,
        }),
      });
      const json = await res.json();
      if (json.success) {
        const scope = [
          tier ? tier : 'semua tier',
          intervalScope ? (intervalScope === 'monthly' ? 'bulanan' : 'tahunan') : 'semua interval',
        ].join(' · ');
        setResult({
          ok: true,
          msg:
            Number(pct || 0) > 0
              ? `Deal ${pct}% (${scope}) tersimpan untuk ${json.merchant?.name ?? email}`
              : `Deal dihapus untuk ${json.merchant?.name ?? email}`,
        });
        setEmail('');
        setPct('');
        setNote('');
      } else {
        setResult({ ok: false, msg: json.error || 'Gagal menyimpan deal' });
      }
    } catch {
      setResult({ ok: false, msg: 'Gagal terhubung ke server' });
    } finally {
      setSaving(false);
    }
  };

  const selectCls =
    'h-9 rounded-lg border bg-background px-2 text-xs font-medium text-foreground';

  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <p className="flex items-center gap-1.5 text-sm font-bold">
        <BadgePercent className="size-4 text-teal-600 dark:text-teal-400" /> Deal Marketing
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Diskon % khusus per merchant — bisa dibatasi ke satu tier/interval. Isi 0% untuk menghapus
        deal. Merchant harus sudah membuka halaman Langganan.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          placeholder="email merchant"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-9 w-56 text-xs"
        />
        <Input
          type="number"
          min={0}
          max={100}
          placeholder="%"
          value={pct}
          onChange={(e) => setPct(e.target.value)}
          className="h-9 w-16 text-xs"
        />
        <select value={tier} onChange={(e) => setTier(e.target.value)} className={selectCls}>
          <option value="">Semua tier</option>
          <option value="basic">Basic</option>
          <option value="pro">Pro</option>
          <option value="max_lite">Max Lite</option>
          <option value="max">Max</option>
          <option value="ultimax">Ultimax</option>
        </select>
        <select
          value={intervalScope}
          onChange={(e) => setIntervalScope(e.target.value)}
          className={selectCls}
        >
          <option value="">Semua interval</option>
          <option value="monthly">Bulanan</option>
          <option value="yearly">Tahunan</option>
        </select>
        <Input
          placeholder="catatan (cth. deal IG Juli)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="h-9 w-44 text-xs"
        />
        <Button size="sm" onClick={submit} disabled={saving || !email.trim()}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : 'Simpan Deal'}
        </Button>
      </div>
      {result && (
        <p
          className={`mt-2 text-xs font-medium ${
            result.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
          }`}
        >
          {result.msg}
        </p>
      )}
    </div>
  );
}

// One merchant's staff quota: the plan's cap, the admin override on top of it,
// and what each of their outlets has filled. The cap is PER OUTLET — an owner
// with two outlets may fill it twice — so outlets are listed one by one.
type CapInfo = {
  merchant: { id: string; name: string; email: string };
  subscription: {
    status: string;
    tier: string | null;
    plan_name: string | null;
    current_period_end: string | null;
  } | null;
  plan_max_employees: number | null;
  override: number | null;
  effective_max: number;
  // Price side: seats billed and the per-seat MONTHLY rate (yearly plans are
  // charged 12x it). 0 either way = granted but not charged.
  addon_seats: number;
  addon_seat_price: number;
  addon_note: string;
  outlets: { id: number; name: string; active_employees: number }[];
};

// Sell/grant extra staff accounts to ONE merchant without touching the plan
// catalog (editing the seed would hand the same seats to every merchant on
// that tier), and set what they pay for them in the same save — a grant and
// its price are one decision. Kosongkan = merchant follows their plan again
// and the charge goes away with it.
function EmployeeCapForm() {
  const [email, setEmail] = useState('');
  const [info, setInfo] = useState<CapInfo | null>(null);
  const [cap, setCap] = useState('');
  const [seats, setSeats] = useState('');
  const [seatPrice, setSeatPrice] = useState('');
  const [addonNote, setAddonNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const lookup = async () => {
    if (!email.trim()) return;
    setLoading(true);
    setResult(null);
    setInfo(null);
    try {
      const res = await fetch(
        `${API_URL}/api/admin/subscription-employee-cap?email=${encodeURIComponent(email.trim())}`,
        { credentials: 'include' },
      );
      const json = await res.json();
      if (json.success) {
        const d = json.data as CapInfo;
        setInfo(d);
        setCap(d.override != null ? String(d.override) : '');
        setSeatPrice(d.addon_seat_price > 0 ? String(d.addon_seat_price) : '');
        setAddonNote(d.addon_note ?? '');
        // Billed seats default to whatever the grant adds ON TOP of the plan's
        // own cap — the usual sale — but stay editable, because "granted, not
        // charged" is a real case and the admin should see the number they are
        // about to bill rather than have it inferred at payment time.
        setSeats(
          d.addon_seats > 0
            ? String(d.addon_seats)
            : d.override != null && d.plan_max_employees != null
              ? String(Math.max(0, d.override - d.plan_max_employees))
              : '',
        );
      } else {
        setResult({ ok: false, msg: json.error || 'Merchant tidak ditemukan' });
      }
    } catch {
      setResult({ ok: false, msg: 'Gagal terhubung ke server' });
    } finally {
      setLoading(false);
    }
  };

  const save = async (clear: boolean) => {
    if (!email.trim()) return;
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/subscription-employee-cap`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          max_employees: clear ? null : cap,
          addon_seats: clear ? 0 : Number(seats || 0),
          addon_seat_price: clear ? 0 : Number(seatPrice || 0),
          addon_note: clear ? '' : addonNote,
        }),
      });
      const json = await res.json();
      if (json.success) {
        const over = (json.data.over_cap_outlets ?? []) as CapInfo['outlets'];
        const stale = json.data.stale_pending as { amount_due: string } | null;
        const billed = Number(json.data.addon_seats) * Number(json.data.addon_seat_price);
        const name = json.merchant?.name ?? email.trim();
        setResult({
          ok: true,
          msg:
            (clear
              ? `Kuota khusus dihapus — ${name} kembali mengikuti paket (${json.data.effective_max} karyawan), tagihan tambahan ikut dihapus`
              : `${name} sekarang boleh ${json.data.effective_max} karyawan aktif per outlet` +
                (billed > 0
                  ? ` · ditagih +${rupiah(billed)}/bln (${json.data.addon_seats} akun) di setiap tagihan`
                  : ' · tanpa biaya tambahan')) +
            (over.length
              ? ` · catatan: ${over
                  .map((o) => `${o.name} sudah ${o.active_employees} aktif`)
                  .join(', ')} — karyawan lama tidak dinonaktifkan`
              : '') +
            (stale
              ? ` · ⚠ merchant masih punya tagihan lama ${rupiah(stale.amount_due)} — minta mereka pilih paket lagi supaya harganya diperbarui`
              : ''),
        });
        await lookup();
      } else {
        setResult({ ok: false, msg: json.error || 'Gagal menyimpan kuota' });
      }
    } catch {
      setResult({ ok: false, msg: 'Gagal terhubung ke server' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <p className="flex items-center gap-1.5 text-sm font-bold">
        <UsersRound className="size-4 text-teal-600 dark:text-teal-400" /> Kuota Karyawan
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Jumlah akun karyawan aktif khusus per merchant — menimpa batas paket selama langganan
        aktif — sekaligus biayanya. Harga ditulis per akun per bulan; tagihan tahunan otomatis
        dikali 12 dan diskon deal tidak memotongnya. Tekan Ikuti Paket untuk mengembalikan ke
        batas paket sekaligus menghapus biaya tambahan.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          placeholder="email merchant"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setInfo(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && lookup()}
          className="h-9 w-56 text-xs"
        />
        <Button size="sm" variant="outline" onClick={lookup} disabled={loading || !email.trim()}>
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : 'Cek'}
        </Button>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          kuota
          <Input
            type="number"
            min={0}
            max={100}
            placeholder="0"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            className="h-9 w-16 text-xs"
          />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          ditagih
          <Input
            type="number"
            min={0}
            max={100}
            placeholder="0"
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            className="h-9 w-16 text-xs"
          />
          akun ×
        </label>
        <Input
          type="number"
          min={0}
          step={1000}
          placeholder="Rp / akun / bln"
          value={seatPrice}
          onChange={(e) => setSeatPrice(e.target.value)}
          className="h-9 w-32 text-xs"
        />
        <Input
          placeholder="catatan (cth. 2 kasir tambahan)"
          value={addonNote}
          onChange={(e) => setAddonNote(e.target.value)}
          className="h-9 w-44 text-xs"
        />
        <Button size="sm" onClick={() => save(false)} disabled={saving || !email.trim() || cap === ''}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : 'Simpan Kuota'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => save(true)}
          disabled={saving || !email.trim()}
        >
          Ikuti Paket
        </Button>
      </div>
      {Number(seats || 0) > 0 && Number(seatPrice || 0) > 0 && (
        <p className="mt-2 text-[11px] font-medium text-teal-700 dark:text-teal-300">
          Tambahan di setiap tagihan: {rupiah(Number(seats) * Number(seatPrice))}/bulan ·{' '}
          {rupiah(Number(seats) * Number(seatPrice) * 12)}/tahun
        </p>
      )}

      {info && (
        <div className="mt-3 rounded-lg border bg-background px-3 py-2.5 text-[11px]">
          <p className="text-xs font-bold">
            {info.merchant.name}{' '}
            <span className="font-medium text-muted-foreground">{info.merchant.email}</span>
          </p>
          <p className="mt-1 text-muted-foreground">
            {info.subscription
              ? `${info.subscription.plan_name ?? 'Masa percobaan'} · ${info.subscription.status}${
                  info.subscription.current_period_end
                    ? ` · sampai ${tgl(info.subscription.current_period_end)}`
                    : ''
                }`
              : 'Belum punya data langganan'}
          </p>
          <p className="mt-1">
            Batas paket:{' '}
            <span className="font-semibold tabular-nums">
              {info.plan_max_employees ?? 'percobaan'}
            </span>{' '}
            · Kuota khusus:{' '}
            <span className="font-semibold tabular-nums">{info.override ?? '—'}</span> · Berlaku
            sekarang:{' '}
            <span className="font-bold tabular-nums text-teal-700 dark:text-teal-300">
              {info.effective_max}
            </span>{' '}
            karyawan / outlet
          </p>
          <p className="mt-1">
            Biaya tambahan:{' '}
            {info.addon_seats > 0 && info.addon_seat_price > 0 ? (
              <span className="font-semibold">
                {info.addon_seats} akun × {rupiah(info.addon_seat_price)}/bln ={' '}
                <span className="text-teal-700 dark:text-teal-300">
                  {rupiah(info.addon_seats * info.addon_seat_price)}
                </span>{' '}
                per tagihan bulanan
                {info.addon_note ? ` · ${info.addon_note}` : ''}
              </span>
            ) : (
              <span className="text-muted-foreground">tidak ditagih</span>
            )}
          </p>
          <p className="mt-1 text-muted-foreground">
            {info.outlets.length
              ? info.outlets
                  .map((o) => `${o.name}: ${o.active_employees} aktif`)
                  .join(' · ')
              : 'Belum punya outlet'}
          </p>
        </div>
      )}

      {result && (
        <p
          className={`mt-2 text-xs font-medium ${
            result.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
          }`}
        >
          {result.msg}
        </p>
      )}
    </div>
  );
}

export function SubscriptionClient() {
  const [status, setStatus] = useState<string>('pending');
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const fetchRows = useCallback(async (s: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/api/admin/subscription-payments?status=${s}&limit=50`,
        { credentials: 'include' },
      );
      const json = await res.json();
      if (json.success) {
        setRows(json.data);
        setPendingCount(json.pendingCount ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRows(status);
  }, [status, fetchRows]);

  const action = async (id: number, kind: 'confirm' | 'reject') => {
    let note = '';
    if (kind === 'reject') {
      const input = window.prompt('Alasan penolakan (dikirim ke merchant):');
      if (input === null) return; // cancelled
      note = input;
    } else if (!window.confirm('Konfirmasi pembayaran ini? Masa langganan merchant akan diperpanjang.')) {
      return;
    }
    setBusyId(id);
    try {
      const res = await fetch(`${API_URL}/api/admin/subscription-payments/${id}/${kind}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'reject' ? { note } : {}),
      });
      const json = await res.json();
      if (!json.success) alert(json.error || 'Gagal memproses');
      await fetchRows(status);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <RevenueStats />
      <DealForm />
      <EmployeeCapForm />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatus(f.key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                status === f.key
                  ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300'
                  : 'border-transparent bg-muted/50 text-muted-foreground hover:bg-muted'
              }`}
            >
              {f.label}
              {f.key === 'pending' && pendingCount > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={() => fetchRows(status)}>
          <RefreshCw className="size-3.5" /> Muat ulang
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/60 py-16 text-center">
          <CreditCard className="h-9 w-9 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">
            Tidak ada pembayaran {status !== 'all' ? STATUS_LABEL[status as PaymentRow['status']]?.toLowerCase() : ''}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Merchant</th>
                <th className="px-3 py-2 font-medium">Paket</th>
                <th className="px-3 py-2 text-right font-medium">Nominal Transfer</th>
                <th className="px-3 py-2 font-medium">Bukti</th>
                <th className="px-3 py-2 font-medium">Dibuat</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const base = Number(r.amount_due) - r.unique_code;
                return (
                  <tr key={r.id} className="border-b align-top last:border-0">
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{r.user_name}</p>
                      <p className="text-xs text-muted-foreground">{r.user_email}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{r.plan_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.interval === 'monthly' ? 'Bulanan' : 'Tahunan'}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {/* amount_due = base price + 3-digit unique code; the code is
                          what the admin matches against the bank mutation. */}
                      <p className="font-bold tabular-nums">
                        {rupiah(base)
                          .replace(/ /g, ' ')}
                        <span className="text-teal-600 dark:text-teal-400">
                          {' '}+ {r.unique_code}
                        </span>
                      </p>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        = {rupiah(r.amount_due)}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      {r.proof_image ? (
                        <a
                          href={`${API_URL}${r.proof_image}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-teal-600 underline underline-offset-2 hover:text-teal-700"
                        >
                          <ImageIcon className="size-3.5" /> Lihat bukti
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">Belum ada</span>
                      )}
                      {(r.sender_bank || r.sender_name) && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {[r.sender_bank, r.sender_name].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {r.merchant_note && (
                        <p className="mt-0.5 max-w-40 truncate text-[11px] italic text-muted-foreground" title={r.merchant_note}>
                          “{r.merchant_note}”
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      <p>{tgl(r.created_at)}</p>
                      {r.status === 'pending' && r.expires_at && (
                        <p className="text-[11px] text-amber-600">exp {tgl(r.expires_at)}</p>
                      )}
                      {r.status === 'paid' && r.period_end && (
                        <p className="text-[11px] text-green-600">aktif s/d {tgl(r.period_end)}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[r.status]}`}
                      >
                        {STATUS_LABEL[r.status]}
                      </span>
                      {r.review_note && (
                        <p className="mt-0.5 max-w-36 truncate text-[11px] text-muted-foreground" title={r.review_note}>
                          {r.review_note}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {r.status === 'pending' &&
                        (busyId === r.id ? (
                          <Loader2 className="ml-auto size-4 animate-spin text-muted-foreground" />
                        ) : (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="xs"
                              className="bg-green-600 text-white hover:bg-green-700"
                              onClick={() => action(r.id, 'confirm')}
                            >
                              <CheckCircle2 className="size-3.5" /> Konfirmasi
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => action(r.id, 'reject')}
                            >
                              <XCircle className="size-3.5" /> Tolak
                            </Button>
                          </div>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
