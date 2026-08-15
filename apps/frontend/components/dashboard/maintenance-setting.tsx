'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Loader2, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DashboardHeader } from '@/components/dashboard-header';
import { API_URL } from '@/lib/api-url';
import type { Maintenance } from '@/lib/maintenance';

export type MaintenanceWindow = {
  id: number;
  starts_at: string;
  ends_at: string;
  message: string | null;
  notice_minutes: number;
  cancelled_at: string | null;
};

// <input type="datetime-local"> speaks local wall-clock with no zone, so both
// directions go through the browser's own offset rather than string surgery.
function toLocalInput(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function formatRange(startsAt: string, endsAt: string) {
  const fmt = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  return `${fmt.format(new Date(startsAt))} — ${fmt.format(new Date(endsAt))}`;
}

function windowState(w: MaintenanceWindow): { label: string; className: string } {
  const now = Date.now();
  if (w.cancelled_at) return { label: 'Dibatalkan', className: 'bg-muted text-muted-foreground' };
  if (Date.parse(w.ends_at) <= now)
    return { label: 'Selesai', className: 'bg-muted text-muted-foreground' };
  if (Date.parse(w.starts_at) <= now)
    return {
      label: 'Sedang berlangsung',
      className: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    };
  return {
    label: 'Terjadwal',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  };
}

export function MaintenanceSetting({
  current,
  windows,
}: {
  current: Maintenance;
  windows: MaintenanceWindow[];
}) {
  const router = useRouter();

  // Defaults to a one-hour window starting in an hour: long enough ahead that
  // the warning banner has time to be seen before it starts.
  const [startsAt, setStartsAt] = useState(() => toLocalInput(new Date(Date.now() + 3_600_000)));
  const [endsAt, setEndsAt] = useState(() => toLocalInput(new Date(Date.now() + 7_200_000)));
  const [noticeMinutes, setNoticeMinutes] = useState('60');
  const [message, setMessage] = useState('');
  const [alert, setAlert] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [endingId, setEndingId] = useState<number | null>(null);

  const schedule = async () => {
    setPending(true);
    setAlert(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/maintenance`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Bare datetime-local strings are zone-less; converting through Date
          // stamps the admin's own zone, which is what they typed.
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          noticeMinutes: Number(noticeMinutes),
          message,
        }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setAlert({ ok: true, text: 'Jadwal pemeliharaan tersimpan.' });
        setMessage('');
        router.refresh();
      } else {
        setAlert({ ok: false, text: json?.error ?? 'Gagal menyimpan jadwal.' });
      }
    } catch {
      setAlert({ ok: false, text: 'Gagal terhubung ke server.' });
    } finally {
      setPending(false);
    }
  };

  const endWindow = async (id: number) => {
    setEndingId(id);
    setAlert(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/maintenance/${id}/end`, {
        method: 'POST',
        credentials: 'include',
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setAlert({ ok: true, text: 'Jadwal dihentikan. Aplikasi terbuka kembali.' });
        router.refresh();
      } else {
        setAlert({ ok: false, text: json?.error ?? 'Gagal menghentikan jadwal.' });
      }
    } catch {
      setAlert({ ok: false, text: 'Gagal terhubung ke server.' });
    } finally {
      setEndingId(null);
    }
  };

  return (
    <div className="pb-16">
      <DashboardHeader
        title="Pemeliharaan"
        description="Jadwalkan waktu perawatan sistem. Pengguna diberi peringatan lebih dulu, lalu halaman pemeliharaan tampil selama jadwal berjalan."
      />

      {current.status !== 'off' && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <Wrench className="mt-0.5 size-4 shrink-0" />
          <p className="text-sm">
            {current.status === 'active'
              ? 'Aplikasi sedang dalam pemeliharaan. Pengguna melihat halaman pemeliharaan sekarang.'
              : 'Peringatan pemeliharaan sedang tampil untuk semua pengguna.'}
          </p>
        </div>
      )}

      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground">Jadwalkan pemeliharaan</h2>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-foreground">Mulai</span>
            <Input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-foreground">Selesai</span>
            <Input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-foreground">Peringatan sebelum (menit)</span>
            <Input
              type="number"
              min={0}
              max={10080}
              value={noticeMinutes}
              onChange={(e) => setNoticeMinutes(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              Banner hitung mundur mulai tampil sekian menit sebelum waktu mulai.
            </span>
          </label>

          <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">Pesan (opsional)</span>
            <Input
              value={message}
              placeholder="Contoh: Peningkatan sistem pembayaran."
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
        </div>

        {alert && (
          <div
            className={`mt-5 flex items-start gap-2 rounded-lg p-3 text-sm ${
              alert.ok
                ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300'
                : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'
            }`}
          >
            {alert.ok ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            )}
            <span>{alert.text}</span>
          </div>
        )}

        <Button className="mt-6" onClick={schedule} disabled={pending}>
          {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
          Simpan jadwal
        </Button>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-foreground">Riwayat & jadwal</h2>

        {windows.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Belum ada jadwal pemeliharaan.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {windows.map((w) => {
              const state = windowState(w);
              const stoppable = !w.cancelled_at && Date.parse(w.ends_at) > Date.now();
              return (
                <li
                  key={w.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4"
                >
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${state.className}`}
                  >
                    {state.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{formatRange(w.starts_at, w.ends_at)}</p>
                    {w.message && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{w.message}</p>
                    )}
                  </div>
                  {stoppable && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => endWindow(w.id)}
                      disabled={endingId === w.id}
                    >
                      {endingId === w.id && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                      {Date.parse(w.starts_at) <= Date.now() ? 'Hentikan sekarang' : 'Batalkan'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
