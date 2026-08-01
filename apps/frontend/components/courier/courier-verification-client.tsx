'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import {
  AlertTriangle,
  BadgeCheck,
  Camera,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { resolveUploadImage } from '@/lib/image-src';
import { cn } from '@/lib/utils';

type Slot = { kind: string; label: string };
type Group = { id: string; title: string; note: string; kinds: Slot[] };
type Doc = { image: string; uploadedAt: string };

type Verification = {
  status: 'pending' | 'approved' | 'rejected';
  note: string | null;
  documents: Record<string, Doc>;
  missing: string[];
  complete: boolean;
  groups: Group[];
};

const STATUS_META = {
  pending: {
    icon: Clock,
    title: 'Menunggu Verifikasi',
    tone: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
    body: 'Dokumen pian sedang diperiksa admin. Pian belum bisa online dan menerima order sampai disetujui.',
  },
  approved: {
    icon: BadgeCheck,
    title: 'Terverifikasi',
    tone: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
    body: 'Akun pian sudah disetujui admin. Silakan online dan mulai menerima order.',
  },
  rejected: {
    icon: AlertTriangle,
    title: 'Ditolak',
    tone: 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
    body: 'Perbaiki foto sesuai catatan admin di bawah, lalu unggah ulang. Pengajuan otomatis masuk antrean lagi.',
  },
} as const;

function SlotCard({
  slot,
  doc,
  locked,
  onUploaded,
  onError,
}: {
  slot: Slot;
  doc?: Doc;
  locked: boolean;
  onUploaded: (data: Verification) => void;
  onError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const body = new FormData();
      // Field order matters for streaming multipart: `kind` has to be readable
      // before the file is consumed, so it goes in first.
      body.append('kind', slot.kind);
      body.append('file', file);

      const res = await fetch(`${API_URL}/api/courier/documents`, {
        method: 'POST',
        credentials: 'include',
        body,
      });
      const data = await res.json();
      if (!data.success) {
        onError(data.error ?? 'Gagal mengunggah foto');
        return;
      }
      onUploaded(data);
    } catch {
      onError('Gagal mengunggah foto. Periksa koneksi pian.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        disabled={locked || busy}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed transition-colors',
          doc
            ? 'border-transparent'
            : 'border-border bg-muted/40 hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-950/30',
          (locked || busy) && 'cursor-not-allowed opacity-70',
        )}
      >
        {doc ? (
          <>
            <Image
              src={resolveUploadImage(doc.image)}
              alt={slot.label}
              fill
              unoptimized
              sizes="(max-width: 640px) 45vw, 200px"
              className="object-cover"
            />
            {!locked && (
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/55 py-1 text-[11px] font-bold text-white">
                <RefreshCw className="size-3" /> Ganti
              </span>
            )}
            <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white">
              <CheckCircle2 className="size-3.5" />
            </span>
          </>
        ) : (
          <span className="flex flex-col items-center gap-1 text-muted-foreground">
            <Camera className="size-6" />
            <span className="text-[11px] font-semibold">Ambil foto</span>
          </span>
        )}

        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-background/70">
            <Loader2 className="size-5 animate-spin text-blue-600" />
          </span>
        )}
      </button>

      <p className="text-center text-[11px] font-semibold text-foreground/80">{slot.label}</p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        // Opens the camera directly on a phone, which is where these are taken.
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset first: picking the same file twice in a row fires no change
          // event otherwise, so a failed upload could never be retried.
          e.target.value = '';
          if (file) upload(file);
        }}
      />
    </div>
  );
}

export function CourierVerificationClient() {
  const [data, setData] = useState<Verification | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/courier/verification`, {
        cache: 'no-store',
        credentials: 'include',
      });
      const json = await res.json();
      if (json.success) setData(json as Verification);
      else setError(json.error ?? 'Gagal memuat status verifikasi');
    } catch {
      setError('Gagal memuat status verifikasi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-center">
        <AlertTriangle className="size-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">{error ?? 'Gagal memuat status verifikasi'}</p>
      </div>
    );
  }

  const meta = STATUS_META[data.status];
  const StatusIcon = meta.icon;
  const uploaded = Object.keys(data.documents).length;
  const total = data.groups.reduce((n, g) => n + g.kinds.length, 0);
  const locked = data.status === 'approved';

  return (
    <div className="space-y-6">
      <div className={cn('rounded-2xl border-2 p-4', meta.tone)}>
        <div className="flex items-start gap-3">
          <StatusIcon className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-black">{meta.title}</p>
            <p className="mt-0.5 text-sm opacity-90">{meta.body}</p>
            {/* Shown while pending too, not just on rejection: a rejection
                usually lists several problems, and the applicant needs the list
                to survive the first photo they replace — which is exactly the
                moment the application flips back to pending. */}
            {data.status !== 'approved' && data.note && (
              <p className="mt-2 rounded-xl bg-white/60 p-2.5 text-sm font-semibold dark:bg-black/30">
                {data.status === 'rejected' ? 'Catatan admin:' : 'Catatan admin sebelumnya:'}{' '}
                {data.note}
              </p>
            )}
          </div>
        </div>

        {!locked && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs font-bold">
              <span>
                {uploaded} dari {total} foto
              </span>
              {data.complete ? <span>Lengkap ✓</span> : <span>{data.missing.length} lagi</span>}
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/15">
              <div
                className="h-full rounded-full bg-current transition-all"
                style={{ width: `${Math.round((uploaded / total) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      )}

      {data.groups.map((group) => (
        <section key={group.id} className="space-y-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-black">
              <ShieldCheck className="size-4 text-blue-600 dark:text-blue-400" />
              {group.title}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{group.note}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {group.kinds.map((slot) => (
              <SlotCard
                key={slot.kind}
                slot={slot}
                doc={data.documents[slot.kind]}
                locked={locked}
                onUploaded={(next) => {
                  setError(null);
                  // The upload response carries the whole document set back, so
                  // the grid updates without a second round trip.
                  setData((prev) => (prev ? { ...prev, ...next } : prev));
                }}
                onError={setError}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
