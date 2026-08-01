'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import {
  BadgeCheck,
  Check,
  ImageUp,
  Loader2,
  ShieldX,
  UserRoundCog,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { API_URL } from '@/lib/api-url';
import { resolveUploadImage } from '@/lib/image-src';
import { cn } from '@/lib/utils';

type Slot = { kind: string; label: string };
type Group = { id: string; title: string; note: string; kinds: Slot[] };
type Doc = { image: string; uploadedAt: string };

type Review = {
  courier: {
    id: number;
    name: string;
    email: string;
    phone: string | null;
    avatar: string;
    vehicle_plate: string;
    vehicle_type: 'car' | 'motorcycle';
    verification_status: 'pending' | 'approved' | 'rejected';
    verification_note: string | null;
  };
  documents: Record<string, Doc>;
  missing: string[];
  complete: boolean;
  groups: Group[];
};

export function VerificationReview({
  courierId,
  onClose,
  onSaved,
}: {
  courierId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/couriers/${courierId}/verification`, {
        cache: 'no-store',
        credentials: 'include',
      });
      const json = await res.json();
      if (json.success) {
        setData(json as Review);
        setNote(json.courier?.verification_note ?? '');
      } else {
        setError(json.error ?? 'Gagal memuat data verifikasi');
      }
    } catch {
      setError('Gagal memuat data verifikasi');
    } finally {
      setLoading(false);
    }
  }, [courierId]);

  useEffect(() => {
    load();
  }, [load]);

  const verify = async (approve: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/couriers/${courierId}/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approve, note }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? 'Gagal menyimpan keputusan');
        return;
      }
      onSaved();
      await load();
    } catch {
      setError('Gagal menyimpan keputusan');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Admin replaces a slot with a retouched file — the background-cleaned face
   * shot being the reason this exists. `setAvatar` rides along for the front
   * face, so the cleaned portrait becomes the courier's picture in one step.
   */
  const replaceDocument = async (kind: string, file: File, setAvatar: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('kind', kind);
      body.append('setAvatar', String(setAvatar));
      body.append('file', file);

      const res = await fetch(`${API_URL}/api/admin/couriers/${courierId}/documents`, {
        method: 'POST',
        credentials: 'include',
        body,
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? 'Gagal mengganti foto');
        return;
      }
      onSaved();
      await load();
    } catch {
      setError('Gagal mengganti foto');
    } finally {
      setBusy(false);
    }
  };

  const useAsAvatar = async (kind: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/couriers/${courierId}/avatar`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromDocument: kind }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? 'Gagal mengganti foto profil');
        return;
      }
      onSaved();
      await load();
    } catch {
      setError('Gagal mengganti foto profil');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-4 top-1/2 z-50 mx-auto max-h-[86vh] max-w-3xl -translate-y-1/2 space-y-4 overflow-y-auto rounded-2xl border bg-background p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-base font-black">Verifikasi Kurir</h3>
            {data && (
              <p className="truncate text-sm text-muted-foreground">
                {data.courier.name} · {data.courier.vehicle_plate}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !data ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {error ?? 'Gagal memuat data verifikasi'}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
              <div className="relative size-12 overflow-hidden rounded-full bg-muted">
                <Image
                  src={resolveUploadImage(data.courier.avatar)}
                  alt={data.courier.name}
                  fill
                  unoptimized
                  sizes="48px"
                  className="object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Foto profil kurir saat ini</p>
                <p className="truncate text-sm font-semibold">{data.courier.email}</p>
              </div>
              <StatusPill status={data.courier.verification_status} />
            </div>

            {error && (
              <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                {error}
              </p>
            )}

            {data.groups.map((group) => (
              <section key={group.id} className="space-y-2">
                <div>
                  <h4 className="text-sm font-black">{group.title}</h4>
                  <p className="text-xs text-muted-foreground">{group.note}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {group.kinds.map((slot) => {
                    const doc = data.documents[slot.kind];
                    return (
                      <div key={slot.kind} className="space-y-1">
                        <div
                          className={cn(
                            'relative aspect-[3/4] overflow-hidden rounded-xl border',
                            !doc && 'flex items-center justify-center border-dashed bg-muted/40',
                          )}
                        >
                          {doc ? (
                            <button
                              type="button"
                              onClick={() => setZoom(resolveUploadImage(doc.image))}
                              className="absolute inset-0"
                            >
                              <Image
                                src={resolveUploadImage(doc.image)}
                                alt={slot.label}
                                fill
                                unoptimized
                                sizes="(max-width: 640px) 45vw, 170px"
                                className="object-cover"
                              />
                            </button>
                          ) : (
                            <span className="text-[11px] font-semibold text-muted-foreground">
                              Belum ada
                            </span>
                          )}
                        </div>
                        <p className="text-center text-[11px] font-semibold">{slot.label}</p>

                        {/* Retouch: upload an edited version over the courier's
                            own. Offered on every slot (a dark STNK scan needs it
                            as much as a face), but only the front face carries
                            the "sekaligus jadi foto profil" shortcut. */}
                        <label
                          className={cn(
                            'flex w-full cursor-pointer items-center justify-center gap-1 rounded-lg bg-muted px-2 py-1 text-[10px] font-bold text-muted-foreground transition-colors hover:bg-amber-100 hover:text-amber-700 dark:hover:bg-amber-950/50',
                            busy && 'pointer-events-none opacity-50',
                          )}
                        >
                          <ImageUp className="size-3" />
                          {slot.kind === 'face_front' ? 'Ganti + Foto Profil' : 'Ganti Foto'}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (file) replaceDocument(slot.kind, file, slot.kind === 'face_front');
                            }}
                          />
                        </label>

                        {/* Face shots only: the avatar is what a customer sees
                            at the door, so offering a licence or a number plate
                            as their portrait would be a mistake waiting to be
                            clicked. */}
                        {doc && group.id === 'face' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => useAsAvatar(slot.kind)}
                            className="flex w-full items-center justify-center gap-1 rounded-lg bg-muted px-2 py-1 text-[10px] font-bold text-muted-foreground transition-colors hover:bg-blue-100 hover:text-blue-700 disabled:opacity-50 dark:hover:bg-blue-950/50"
                          >
                            <UserRoundCog className="size-3" /> Jadikan Foto Profil
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}

            <div className="space-y-2 border-t pt-4">
              <label className="text-xs font-bold text-muted-foreground">
                Catatan (wajib kalau menolak)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Contoh: Foto wajah kiri masih memakai topi, mohon diulang."
                className="w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus:border-blue-400"
              />

              {!data.complete && (
                <p className="text-xs font-semibold text-amber-600">
                  Dokumen belum lengkap ({data.missing.length} kurang) — belum bisa disetujui.
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => verify(false)}
                  className="text-rose-600"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldX className="h-4 w-4" />}
                  Tolak
                </Button>
                <Button disabled={busy || !data.complete} onClick={() => verify(true)}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Setujui
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {zoom && (
        <button
          type="button"
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-6"
        >
          <span className="relative h-full w-full">
            <Image src={zoom} alt="Dokumen" fill unoptimized className="object-contain" />
          </span>
        </button>
      )}
    </>
  );
}

export function StatusPill({ status }: { status: 'pending' | 'approved' | 'rejected' }) {
  const meta = {
    pending: { label: 'Menunggu', className: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' },
    approved: { label: 'Terverifikasi', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' },
    rejected: { label: 'Ditolak', className: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300' },
  }[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold',
        meta.className,
      )}
    >
      {status === 'approved' && <BadgeCheck className="size-3" />}
      {meta.label}
    </span>
  );
}
