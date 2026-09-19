'use client';

import { useState } from 'react';
import { MessageCircle, Plus, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Stepper, TablePickerDialog, type TableOption } from './floor-dialogs';
import { maskPhone, waLink, type WaitEntry } from './floor-model';

const HEAD = 'text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

/** Amber from 20 minutes, rose from 30 — the design's escalation. */
function waitTone(mins: number) {
  if (mins >= 30) return 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300';
  if (mins >= 20) return 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300';
  return 'bg-muted text-muted-foreground';
}

export function WaitlistView({
  entries,
  now,
  outletName,
  tableOptions,
  canAct,
  busy,
  onAdd,
  onCall,
  onSeat,
  onRemove,
}: {
  entries: WaitEntry[];
  now: number;
  outletName: string;
  /** Free tables, for Dudukkan. */
  tableOptions: TableOption[];
  canAct: boolean;
  busy: boolean;
  onAdd: (v: { guestName: string; phone: string; pax: number; note: string }) => Promise<boolean>;
  onCall: (entry: WaitEntry) => void;
  onSeat: (entry: WaitEntry, tableId: number) => void;
  onRemove: (entry: WaitEntry) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [seating, setSeating] = useState<WaitEntry | null>(null);

  const minsOf = (e: WaitEntry) => Math.max(0, Math.floor((now - new Date(e.createdAt).getTime()) / 60_000));
  const avg = entries.length
    ? Math.round(entries.reduce((n, e) => n + minsOf(e), 0) / entries.length)
    : 0;

  return (
    <section className="min-h-0 flex-1 overflow-auto bg-muted/30 px-4 py-5 md:px-6">
      <div className="flex max-w-4xl flex-col gap-3.5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-base font-semibold">Daftar Tunggu</span>
            <span className="text-[12.5px] text-muted-foreground">
              {entries.length
                ? `${entries.length} rombongan menunggu · rata-rata tunggu ${avg} menit`
                : 'Tidak ada yang menunggu'}
            </span>
          </div>
          {canAct && (
            <Button className="ml-auto" onClick={() => setAdding(true)}>
              <Plus /> Tambah Tamu
            </Button>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="hidden grid-cols-[40px_minmax(0,1.5fr)_46px_minmax(90px,1fr)_76px_190px] gap-2.5 border-b bg-muted/60 px-4 py-2.5 md:grid">
            <span className={HEAD}>No</span>
            <span className={HEAD}>Tamu</span>
            <span className={HEAD}>Pax</span>
            <span className={HEAD}>Kontak</span>
            <span className={HEAD}>Menunggu</span>
            <span />
          </div>
          {entries.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Tamu yang datang saat meja penuh dicatat di sini, lalu didudukkan saat meja kosong.
            </p>
          )}
          {entries.map((e) => {
            const mins = minsOf(e);
            const wa = waLink(
              e.phone,
              `Halo ${e.guestName}, meja Anda di ${outletName} sudah siap. Silakan menuju meja host ya 🙏`,
            );
            return (
              <div
                key={e.id}
                className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2.5 border-b px-4 py-3 last:border-b-0 md:grid-cols-[40px_minmax(0,1.5fr)_46px_minmax(90px,1fr)_76px_190px]"
              >
                <span className="font-mono text-[13px] font-semibold text-muted-foreground">W{e.queueNo}</span>
                <div className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-[13.5px] font-medium">
                    {e.guestName}
                    {e.calledAt && (
                      <span className="ml-2 rounded-full bg-blue-50 px-1.5 py-px text-[10px] font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                        Dipanggil
                      </span>
                    )}
                  </span>
                  <span className="truncate text-[11.5px] text-muted-foreground">
                    <span className="md:hidden">{e.pax} pax · {mins}m · </span>
                    {e.note || '—'}
                  </span>
                </div>
                <span className="hidden text-[13px] md:block">{e.pax}</span>
                <span className="hidden truncate font-mono text-[12.5px] text-muted-foreground md:block">
                  {maskPhone(e.phone)}
                </span>
                <span
                  className={cn(
                    'hidden justify-self-start rounded-full px-2 py-0.5 font-mono text-xs font-semibold md:inline-block',
                    waitTone(mins),
                  )}
                >
                  {mins}m
                </span>
                <div className="col-span-3 flex items-center justify-end gap-1.5 md:col-span-1">
                  {canAct && (
                    <>
                      <Button
                        size="sm"
                        className="bg-blue-600 text-white hover:bg-blue-700"
                        disabled={busy}
                        onClick={() => setSeating(e)}
                      >
                        Dudukkan
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => onCall(e)}>
                        Panggil
                      </Button>
                      {wa && (
                        <a
                          href={wa}
                          target="_blank"
                          rel="noreferrer"
                          title="Kabari lewat WhatsApp"
                          className="grid h-7 w-7 place-items-center rounded-md text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                        >
                          <MessageCircle className="h-4 w-4" />
                        </a>
                      )}
                      <button
                        type="button"
                        title="Hapus dari daftar"
                        onClick={() => onRemove(e)}
                        className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {adding && (
        <AddGuestDialog
          busy={busy}
          onClose={() => setAdding(false)}
          onSave={async (v) => {
            if (await onAdd(v)) setAdding(false);
          }}
        />
      )}
      {seating && (
        <TablePickerDialog
          open
          title={`Dudukkan ${seating.guestName}`}
          description={`${seating.pax} pax. Meja yang muat ditampilkan lebih dulu.`}
          source={{ label: `W${seating.queueNo} · ${seating.guestName} · ${seating.pax} pax` }}
          // Tables that fit first: the host's next question is always "where
          // do four people go".
          options={[...tableOptions].sort(
            (a, b) => Number(b.pax >= seating.pax) - Number(a.pax >= seating.pax),
          )}
          emptyText="Belum ada meja kosong."
          cta={(l) => (l ? `Dudukkan di Meja ${l}` : 'Pilih meja')}
          busy={busy}
          onClose={() => setSeating(null)}
          onPick={(tableId) => {
            onSeat(seating, tableId);
            setSeating(null);
          }}
        />
      )}
    </section>
  );
}

function AddGuestDialog({
  busy,
  onClose,
  onSave,
}: {
  busy: boolean;
  onClose: () => void;
  onSave: (v: { guestName: string; phone: string; pax: number; note: string }) => void;
}) {
  const [guestName, setGuestName] = useState('');
  const [phone, setPhone] = useState('');
  const [pax, setPax] = useState(2);
  const [note, setNote] = useState('');
  const field = 'h-10 rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tambah ke Daftar Tunggu</DialogTitle>
          <DialogDescription>Nomor antrean (W1, W2, …) diberikan otomatis dan berlaku hari ini.</DialogDescription>
        </DialogHeader>
        <form
          id="waitlist-form"
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (guestName.trim()) onSave({ guestName: guestName.trim(), phone, pax, note });
          }}
        >
          <input
            autoFocus
            required
            value={guestName}
            onChange={(e) => setGuestName(e.target.value.slice(0, 100))}
            placeholder="Nama tamu"
            className={field}
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value.slice(0, 20))}
            inputMode="tel"
            placeholder="No. WhatsApp (opsional)"
            className={field}
          />
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Jumlah tamu</span>
            <Stepper value={pax} onChange={setPax} min={1} max={200} suffix="pax" />
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 255))}
            placeholder="Catatan, mis. minta dekat jendela"
            className={field}
          />
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" form="waitlist-form" disabled={busy || !guestName.trim()}>
            Tambahkan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
