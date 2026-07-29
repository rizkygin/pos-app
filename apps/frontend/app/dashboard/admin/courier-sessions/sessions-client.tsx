'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Bike, Clock, RefreshCw, Radio } from 'lucide-react';
import { API_URL } from '@/lib/api-url';

type CourierSession = {
  sessionId: number;
  courierId: number;
  courierName: string;
  courierPhone: string | null;
  avatar: string;
  vehiclePlate: string;
  vehicleType: string;
  startedAt: string;
  endedAt: string | null;
};

// Shifts are open-ended, so a live one is measured against "now" — the caller
// passes it in so every row in a render agrees on the same instant.
function duration(startedAt: string, endedAt: string | null, now: number) {
  const end = endedAt ? new Date(endedAt).getTime() : now;
  const mins = Math.max(0, Math.floor((end - new Date(startedAt).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}j ${m}m` : `${m}m`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Initials rather than the stored avatar: couriers default to
// 'avatar-courier.png', which has no file in public/ and would 404 on every row.
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function CourierIdentity({ session }: { session: CourierSession }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-orange-100 dark:bg-orange-950 text-xs font-black text-orange-700 dark:text-orange-300">
        {initials(session.courierName)}
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-sm truncate">{session.courierName}</p>
        <p className="text-xs text-muted-foreground truncate">
          {session.vehiclePlate} · {session.vehicleType}
          {session.courierPhone ? ` · ${session.courierPhone}` : ''}
        </p>
      </div>
    </div>
  );
}

export function CourierSessionsClient() {
  const [online, setOnline] = useState<CourierSession[]>([]);
  const [history, setHistory] = useState<CourierSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/courier-sessions`, {
        cache: 'no-store',
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setOnline(data.online ?? []);
        setHistory(data.history ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  // Ticks the live "online for" durations without refetching.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="h-6 w-6 rounded-full border-2 border-orange-400 border-t-transparent"
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── Online now ─────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-emerald-500" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
              Sedang Online
            </h2>
            <span className="flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-emerald-500 text-[10px] font-black text-white">
              {online.length}
            </span>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Perbarui
          </button>
        </div>

        {online.length === 0 ? (
          <div className="rounded-2xl border border-dashed py-12 text-center">
            <Bike className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
            <p className="font-semibold text-sm">Tidak ada kurir yang online</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Kurir muncul di sini setelah menekan Go Online.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {online.map((s) => (
              <motion.div
                key={s.sessionId}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-between gap-3 rounded-2xl border bg-background px-4 py-3 shadow-sm"
              >
                <CourierIdentity session={s} />
                <div className="text-right shrink-0">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      {duration(s.startedAt, null, now)}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    sejak {fmtTime(s.startedAt)}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      {/* ── Shift history ──────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Riwayat Shift
          </h2>
        </div>

        {history.length === 0 ? (
          <div className="rounded-2xl border border-dashed py-12 text-center">
            <Clock className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
            <p className="font-semibold text-sm">Belum ada shift selesai</p>
          </div>
        ) : (
          <div className="rounded-2xl border overflow-hidden">
            {/* Wide table scrolls inside its own container so the page never
                scrolls horizontally on mobile. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left font-bold px-4 py-2.5">Kurir</th>
                    <th className="text-left font-bold px-4 py-2.5">Tanggal</th>
                    <th className="text-left font-bold px-4 py-2.5">Mulai</th>
                    <th className="text-left font-bold px-4 py-2.5">Selesai</th>
                    <th className="text-right font-bold px-4 py-2.5">Durasi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {history.map((s) => (
                    <tr key={s.sessionId} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5">
                        <CourierIdentity session={s} />
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {fmtDate(s.startedAt)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{fmtTime(s.startedAt)}</td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {s.endedAt ? fmtTime(s.endedAt) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                        {duration(s.startedAt, s.endedAt, now)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
