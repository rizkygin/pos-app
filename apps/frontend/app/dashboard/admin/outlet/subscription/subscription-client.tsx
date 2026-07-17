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

type RevenueSummary = {
  all_time: number;
  all_time_count: number;
  this_month: number;
  this_month_count: number;
  last_month: number;
  active_subscribers: number;
  trialing: number;
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
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border bg-muted/20 px-3.5 py-3">
          <p className="text-[11px] font-medium text-muted-foreground">{t.label}</p>
          <p className="mt-0.5 truncate text-lg font-bold tabular-nums">{t.value}</p>
          <p className="text-[11px] text-muted-foreground">{t.sub}</p>
        </div>
      ))}
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
