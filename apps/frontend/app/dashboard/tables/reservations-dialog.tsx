'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { floorApi, viewerTimezone } from './floor-api';
import { Stepper } from './floor-dialogs';
import { clock, localDateKey, maskPhone, type FloorTable, type Reservation } from './floor-model';

const STATUS: Record<Reservation['status'], { label: string; tone: string }> = {
  booked: { label: 'Dipesan', tone: 'bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300' },
  seated: { label: 'Datang', tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' },
  cancelled: { label: 'Batal', tone: 'bg-muted text-muted-foreground' },
  no_show: { label: 'Tidak datang', tone: 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300' },
};

const shiftDay = (key: string, days: number) => {
  const [y, m, d] = key.split('-').map(Number);
  return localDateKey(new Date(y, m - 1, d + days));
};

type Draft = {
  id: number | null;
  guestName: string;
  phone: string;
  pax: number;
  date: string;
  time: string;
  tableId: string;
  note: string;
};

/**
 * Ringkasan Reservasi: one day's book, browsable by day, with the actions a
 * host needs at the door — seat the party that just walked in, write off a
 * no-show, take a booking over the phone.
 */
export function ReservationsDialog({
  tables,
  entitled,
  onClose,
  onChanged,
  onSeated,
}: {
  tables: FloorTable[];
  entitled: boolean;
  onClose: () => void;
  /** The floor should re-read: a booking now holds (or releases) a table. */
  onChanged: () => void;
  onSeated: (sessionId: string) => void;
}) {
  const [date, setDate] = useState(localDateKey());
  const [rows, setRows] = useState<Reservation[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [seatPick, setSeatPick] = useState<{ id: number; tableId: string } | null>(null);
  const [reload, setReload] = useState(0);

  const load = useCallback(async (day: string) => {
    const res = await floorApi<{ reservations: Reservation[] }>(
      'GET',
      `/api/reservations?date=${day}&timezone=${encodeURIComponent(viewerTimezone())}`,
    );
    return res;
  }, []);

  useEffect(() => {
    let live = true;
    load(date).then((res) => {
      if (!live) return;
      if (res.ok) {
        setRows(res.data.reservations);
        setError('');
      } else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [date, load, reload]);

  const act = async (fn: () => ReturnType<typeof floorApi>) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return null;
    }
    setError('');
    setReload((n) => n + 1);
    onChanged();
    return res;
  };

  const save = async () => {
    if (!draft) return;
    const reservedAt = new Date(`${draft.date}T${draft.time}`);
    if (Number.isNaN(reservedAt.getTime())) {
      setError('Tanggal atau jam tidak valid');
      return;
    }
    const body = {
      guestName: draft.guestName,
      phone: draft.phone,
      pax: draft.pax,
      // The browser's own zone: the host typed a wall-clock time.
      reservedAt: reservedAt.toISOString(),
      tableId: draft.tableId ? Number(draft.tableId) : null,
      note: draft.note,
    };
    const res = await act(() =>
      draft.id
        ? floorApi('PATCH', `/api/reservations/${draft.id}`, body)
        : floorApi('POST', '/api/reservations', body),
    );
    if (res) {
      setDraft(null);
      if (draft.date !== date) setDate(draft.date);
    }
  };

  const seat = async (r: Reservation, tableId: number | null) => {
    const res = await act(() =>
      floorApi<{ sessionId: string }>('POST', `/api/reservations/${r.id}/seat`, tableId ? { tableId } : {}),
    );
    if (res) {
      setSeatPick(null);
      onSeated((res.data as { sessionId: string }).sessionId);
    }
  };

  const today = localDateKey();
  const sortedTables = [...tables].sort((a, b) => a.label.localeCompare(b.label, 'id', { numeric: true }));
  const booked = rows?.filter((r) => r.status === 'booked').length ?? 0;
  const field = 'h-9 rounded-lg border bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ringkasan Reservasi</DialogTitle>
          <DialogDescription>
            Meja yang dipesan tampil ungu di denah mulai 1 jam sebelum jamnya.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setDate((d) => shiftDay(d, -1))} aria-label="Hari sebelumnya">
            <ChevronLeft />
          </Button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={field} />
          <Button variant="outline" size="icon" onClick={() => setDate((d) => shiftDay(d, 1))} aria-label="Hari berikutnya">
            <ChevronRight />
          </Button>
          {date !== today && (
            <Button variant="ghost" size="sm" onClick={() => setDate(today)}>
              Hari ini
            </Button>
          )}
          <span className="text-xs text-muted-foreground">{booked} menunggu kedatangan</span>
          {entitled && !draft && (
            <Button
              size="sm"
              className="ml-auto"
              onClick={() =>
                setDraft({ id: null, guestName: '', phone: '', pax: 2, date, time: '19:00', tableId: '', note: '' })
              }
            >
              <Plus /> Reservasi
            </Button>
          )}
        </div>

        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </p>
        )}

        {draft && (
          <form
            className="grid gap-2.5 rounded-xl border bg-muted/40 p-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <input
              autoFocus
              required
              value={draft.guestName}
              onChange={(e) => setDraft({ ...draft, guestName: e.target.value.slice(0, 100) })}
              placeholder="Nama tamu"
              className={field}
            />
            <input
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value.slice(0, 20) })}
              inputMode="tel"
              placeholder="No. WhatsApp (opsional)"
              className={field}
            />
            <div className="flex gap-2">
              <input
                type="date"
                required
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                className={cn(field, 'min-w-0 flex-1')}
              />
              <input
                type="time"
                required
                value={draft.time}
                onChange={(e) => setDraft({ ...draft, time: e.target.value })}
                className={cn(field, 'w-28')}
              />
            </div>
            <select
              value={draft.tableId}
              onChange={(e) => setDraft({ ...draft, tableId: e.target.value })}
              className={field}
            >
              <option value="">Tanpa meja (pilih saat datang)</option>
              {sortedTables.map((t) => (
                <option key={t.id} value={t.id}>
                  Meja {t.label} · {t.capacity} kursi
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Tamu</span>
              <Stepper value={draft.pax} onChange={(pax) => setDraft({ ...draft, pax })} min={1} max={200} suffix="pax" />
            </div>
            <input
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value.slice(0, 255) })}
              placeholder="Catatan"
              className={field}
            />
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                Batal
              </Button>
              <Button type="submit" disabled={busy}>
                {draft.id ? 'Simpan Perubahan' : 'Simpan Reservasi'}
              </Button>
            </div>
          </form>
        )}

        <div className="flex max-h-[50vh] flex-col divide-y overflow-y-auto rounded-xl border">
          {rows === null && <p className="px-4 py-8 text-center text-sm text-muted-foreground">Memuat…</p>}
          {rows?.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Belum ada reservasi di tanggal ini.</p>
          )}
          {rows?.map((r) => {
            const st = STATUS[r.status];
            return (
              <div key={r.id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className="w-12 shrink-0 font-mono text-sm font-semibold">{clock(r.reservedAt)}</span>
                  <div className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-sm font-medium">
                      {r.guestName} · {r.pax} pax
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {r.tableLabel ? `Meja ${r.tableLabel}` : 'Belum pilih meja'} · {maskPhone(r.phone)}
                      {r.note ? ` · ${r.note}` : ''}
                    </span>
                  </div>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', st.tone)}>
                    {st.label}
                  </span>
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                  {r.status === 'booked' && (
                    <>
                      {date === today && entitled && (
                        <Button
                          size="sm"
                          className="bg-blue-600 text-white hover:bg-blue-700"
                          disabled={busy}
                          onClick={() =>
                            r.tableId ? seat(r, null) : setSeatPick({ id: r.id, tableId: '' })
                          }
                        >
                          Dudukkan
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          const at = new Date(r.reservedAt);
                          setDraft({
                            id: r.id,
                            guestName: r.guestName,
                            phone: r.phone ?? '',
                            pax: r.pax,
                            date: localDateKey(at),
                            time: clock(at),
                            tableId: r.tableId ? String(r.tableId) : '',
                            note: r.note ?? '',
                          });
                        }}
                      >
                        <Pencil /> Ubah
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => act(() => floorApi('POST', `/api/reservations/${r.id}/status`, { status: 'no_show' }))}
                      >
                        Tidak datang
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() => act(() => floorApi('POST', `/api/reservations/${r.id}/status`, { status: 'cancelled' }))}
                      >
                        Batal
                      </Button>
                    </>
                  )}
                  {(r.status === 'cancelled' || r.status === 'no_show') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => act(() => floorApi('POST', `/api/reservations/${r.id}/status`, { status: 'booked' }))}
                    >
                      Pulihkan
                    </Button>
                  )}
                </div>
                {seatPick?.id === r.id && (
                  <div className="flex items-center justify-end gap-2">
                    <select
                      value={seatPick.tableId}
                      onChange={(e) => setSeatPick({ id: r.id, tableId: e.target.value })}
                      className={field}
                    >
                      <option value="">Pilih meja kosong</option>
                      {sortedTables
                        .filter((t) => !t.sessionId && !t.blockedAt)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            Meja {t.label} · {t.capacity} kursi
                          </option>
                        ))}
                    </select>
                    <Button
                      size="sm"
                      disabled={!seatPick.tableId || busy}
                      onClick={() => seat(r, Number(seatPick.tableId))}
                    >
                      Dudukkan
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
