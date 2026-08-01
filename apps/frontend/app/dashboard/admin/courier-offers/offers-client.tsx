'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bike, CheckCircle2, Clock, Loader2, ThumbsDown, TimerOff } from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { cn } from '@/lib/utils';

type CourierRow = {
  courierId: number;
  name: string;
  email: string;
  phone: string | null;
  verificationStatus: 'pending' | 'approved' | 'rejected';
  ratings: string | null;
  offered: number;
  accepted: number;
  declined: number;
  expired: number;
  superseded: number;
  avgResponseSeconds: number | null;
  lastOfferedAt: string | null;
};

type LogRow = {
  id: number;
  orderId: string;
  courierId: number;
  courierName: string;
  state: 'offered' | 'accepted' | 'declined' | 'expired' | 'superseded';
  round: number;
  offeredAt: string;
  respondedAt: string | null;
  outletName: string;
  deliveryFee: string | null;
};

type Payload = {
  windowDays: number;
  totals: { offered: number; accepted: number; declined: number; expired: number };
  couriers: CourierRow[];
  log: LogRow[];
};

const WINDOWS = [
  { days: 1, label: '24 jam' },
  { days: 7, label: '7 hari' },
  { days: 30, label: '30 hari' },
];

const STATE_META: Record<LogRow['state'], { label: string; className: string }> = {
  offered: { label: 'Berjalan', className: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300' },
  accepted: { label: 'Diterima', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' },
  declined: { label: 'Ditolak', className: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' },
  expired: { label: 'Didiamkan', className: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300' },
  superseded: { label: 'Dibatalkan', className: 'bg-muted text-muted-foreground' },
};

function pct(part: number, whole: number) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function CourierOffersClient() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/courier-offers?days=${days}`, {
        cache: 'no-store',
        credentials: 'include',
      });
      const json = await res.json();
      if (json.success) setData(json as Payload);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex gap-1 rounded-xl bg-muted/50 p-1 w-fit">
        {WINDOWS.map((w) => (
          <button
            key={w.days}
            onClick={() => setDays(w.days)}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
              days === w.days
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {w.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : !data ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Gagal memuat data.</p>
      ) : data.totals.offered === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed py-16 text-center">
          <Bike className="size-8 text-muted-foreground/40" />
          <p className="font-bold">Belum ada tawaran</p>
          <p className="text-sm text-muted-foreground">
            Tawaran tercatat di sini begitu order dikonfirmasi dan dikirim ke kurir.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Ditawarkan" value={data.totals.offered} icon={Bike} tone="text-blue-600" />
            <Stat
              label="Diterima"
              value={data.totals.accepted}
              sub={`${pct(data.totals.accepted, data.totals.offered)}%`}
              icon={CheckCircle2}
              tone="text-emerald-600"
            />
            <Stat
              label="Ditolak"
              value={data.totals.declined}
              sub={`${pct(data.totals.declined, data.totals.offered)}%`}
              icon={ThumbsDown}
              tone="text-amber-600"
            />
            <Stat
              label="Didiamkan"
              value={data.totals.expired}
              sub={`${pct(data.totals.expired, data.totals.offered)}%`}
              icon={TimerOff}
              tone="text-rose-600"
            />
          </div>

          <section className="space-y-2">
            <h2 className="text-sm font-black">Per Kurir</h2>
            <div className="overflow-x-auto rounded-2xl border">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-bold">Kurir</th>
                    <th className="px-4 py-3 font-bold">Ditawarkan</th>
                    <th className="px-4 py-3 font-bold">Diterima</th>
                    <th className="px-4 py-3 font-bold">Ditolak</th>
                    <th className="px-4 py-3 font-bold">Didiamkan</th>
                    <th className="px-4 py-3 font-bold">Rata-rata jawab</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.couriers.map((c) => {
                    const ignoreRate = pct(c.expired, c.offered);
                    return (
                      <tr key={c.courierId} className={cn(ignoreRate >= 50 && 'bg-rose-50/50 dark:bg-rose-950/20')}>
                        <td className="px-4 py-3">
                          <p className="font-bold">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.email}</p>
                        </td>
                        <td className="px-4 py-3 tabular-nums">{c.offered}</td>
                        <td className="px-4 py-3 tabular-nums text-emerald-600">{c.accepted}</td>
                        <td className="px-4 py-3 tabular-nums text-amber-600">{c.declined}</td>
                        <td className="px-4 py-3 tabular-nums">
                          <span className={cn('font-bold', ignoreRate >= 50 ? 'text-rose-600' : 'text-muted-foreground')}>
                            {c.expired}
                          </span>
                          {c.offered > 0 && (
                            <span className="ml-1 text-xs text-muted-foreground">({ignoreRate}%)</span>
                          )}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">
                          {/* Only answered offers count toward this. A timeout is
                              not a slow answer, it is no answer, and averaging it
                              in would quietly reward ignoring orders. */}
                          {c.avgResponseSeconds !== null ? `${c.avgResponseSeconds} detik` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-black">Riwayat Tawaran</h2>
            <div className="divide-y rounded-2xl border">
              {data.log.map((row) => {
                const meta = STATE_META[row.state];
                const answeredIn =
                  row.respondedAt
                    ? Math.round(
                        (new Date(row.respondedAt).getTime() - new Date(row.offeredAt).getTime()) / 1000,
                      )
                    : null;
                return (
                  <div key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', meta.className)}>
                      {meta.label}
                    </span>
                    <span className="font-bold">{row.courierName}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      #{row.orderId.slice(-8).toUpperCase()}
                    </span>
                    <span className="text-xs text-muted-foreground">{row.outletName}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                      ronde {row.round}
                    </span>
                    <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="size-3" />
                      {fmtTime(row.offeredAt)}
                      {answeredIn !== null && ` · dijawab ${answeredIn} detik`}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  sub?: string;
  icon: typeof Bike;
  tone: string;
}) {
  return (
    <div className="rounded-2xl border p-4">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        <Icon className={cn('size-3.5', tone)} />
        {label}
      </div>
      <p className="mt-1 text-2xl font-black tabular-nums">
        {value}
        {sub && <span className="ml-1.5 text-sm font-bold text-muted-foreground">{sub}</span>}
      </p>
    </div>
  );
}
