'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  Ban,
  Bike,
  ClipboardList,
  Loader2,
  MapPin,
  Phone,
  Star,
  UserRound,
  AlertTriangle,
} from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { resolveUploadImage } from '@/lib/image-src';
import {
  ErrandDestinationStep,
  type ErrandDestination,
} from '@/components/errand/errand-destination-step';

type Courier = {
  id: number;
  name: string;
  avatar: string;
  vehicleType: string;
  vehiclePlate: string;
  rating: number;
  reviewCount: number;
  /** Null when the courier has never reported a position — see below. */
  distanceKm: number | null;
  /**
   * Seconds left on this courier's rejection cooldown, or null when he can be
   * hired. He stays in the list either way — greyed out and untappable is an
   * answer ("he turned you down"); vanishing is not.
   */
  rejectedCooldownSeconds: number | null;
};

/**
 * Blocking problems the customer has to fix themselves, as opposed to "no
 * couriers right now" which is nobody's fault and fixes itself. The backend
 * distinguishes these with a code precisely so this screen can too: an empty
 * list and a missing address look identical otherwise.
 */
type Blocker = 'no_address' | 'no_phone' | null;

const POLL_MS = 5000;

/**
 * What people actually send couriers for, offered as one-tap starting points.
 *
 * The empty note box is the hardest part of this screen: "Mau ditugaskan apa?"
 * is an open question, and a customer who has never used the feature has no
 * idea how specific to be. Real errands answer that better than any
 * instruction — and they are a starting point, not a menu; every one lands in
 * the textarea for editing rather than being sent as-is.
 */
const NOTE_EXAMPLES = [
  'Bawakan kucingku ke dokter hewan',
  'Belikan obat anak-anak sirup di apotek',
  'Ambilkan laundry ku di tempat laundry',
  'Titip beli galon air, antar ke rumah',
  'Antarkan dokumen ke kantor',
];

/** Rotating hint in the empty box, so the field reads as alive rather than fixed. */
function useRotatingPlaceholder(active: boolean) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % NOTE_EXAMPLES.length), 3500);
    return () => clearInterval(id);
  }, [active]);
  return `Contoh: ${NOTE_EXAMPLES[index]}`;
}

/** The tappable examples themselves. Shown only while the note is still empty. */
function NoteExamples({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="mt-2">
      <p className="text-xs text-muted-foreground">Contoh tugas, tinggal ketuk:</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {NOTE_EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onPick(example)}
            className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-950/60"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "10 menit lagi" / "40 detik lagi" — a wait, not a timestamp. */
function formatCooldown(seconds: number) {
  return seconds >= 60 ? `${Math.ceil(seconds / 60)} menit lagi` : `${seconds} detik lagi`;
}

function formatDistance(km: number | null) {
  if (km === null) return 'Jarak tidak diketahui';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

export function ErrandCourierPicker() {
  const router = useRouter();
  // Nothing is fetched until the customer has said where the errand ends: the
  // list is sorted by distance to that point, so a list built before it is
  // answered would be sorted by the wrong thing.
  const [destination, setDestination] = useState<ErrandDestination | null>(null);
  // Open on arrival, and re-openable from the chip in the header. Answering it
  // is the only way past it — unless a draft answers it first (see below).
  const [editingDestination, setEditingDestination] = useState(true);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [loading, setLoading] = useState(true);
  const [blocker, setBlocker] = useState<Blocker>(null);
  const [selected, setSelected] = useState<Courier | null>(null);
  const [note, setNote] = useState('');
  // Only for the header card below — the note in the confirmation sheet is
  // always an open textarea. Same `note` state behind both.
  const [editingNote, setEditingNote] = useState(false);
  const notePlaceholder = useRotatingPlaceholder(!note);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!destination) return;
    try {
      const qs = new URLSearchParams({
        lat: String(destination.lat),
        lon: String(destination.lon),
        address: destination.address,
      });
      const res = await fetch(`${API_URL}/api/errands/couriers?${qs}`, {
        cache: 'no-store',
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        setCouriers(data.couriers);
        setBlocker(null);
      } else if (data.code === 'no_address') {
        setBlocker('no_address');
      }
    } catch {
      // Transient network blips are not worth a visible error on a list that
      // refreshes every few seconds anyway.
    } finally {
      setLoading(false);
    }
  }, [destination]);

  // A request the customer already wrote and had turned down comes back filled
  // in: same job, same destination, different courier. Runs once on arrival and
  // only while the form is still untouched — a draft must never overwrite what
  // the customer is in the middle of typing.
  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/errands/draft`, {
          cache: 'no-store',
          credentials: 'include',
        });
        const data = await res.json();
        if (cancelled || !data.success || !data.draft) return;
        setNote((current) => current || data.draft.note);
        if (data.draft.destination) {
          setDestination((current) => current ?? data.draft.destination);
          // The destination question is already answered, so the sheet that asks
          // it steps aside — the chip in the header still says where, and "Ubah"
          // reopens it for anyone whose plans changed.
          setEditingDestination(false);
          setDraftRestored(true);
        }
      } catch {
        // No draft is the normal case; a failed fetch just means a blank form.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!destination) return;
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load, destination]);

  // Polling must not yank the list out from under an open confirmation sheet.
  // Without this the courier being confirmed could vanish mid-tap.
  useEffect(() => {
    if (!selected) return;
    // "Still there" now includes "still hireable": a courier who declines while
    // his own confirmation sheet is open must not be left with a live button.
    const stillThere = couriers.some(
      (c) => c.id === selected.id && c.rejectedCooldownSeconds === null,
    );
    if (!stillThere && !submitting) setSelected(null);
  }, [couriers, selected, submitting]);

  async function hire() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/errands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ courierId: selected.id, note, destination }),
      });
      const data = await res.json();
      if (data.success) {
        // Tracking lives on the shared active-order screen, which knows how to
        // render an errand.
        router.push('/dashboard/activeorder');
        return;
      }
      if (data.code === 'no_phone') {
        setBlocker('no_phone');
        setSelected(null);
        return;
      }
      // courier_taken / already_active / cooldown / courier_cooldown all arrive
      // here with a readable Indonesian message from the backend — no second
      // copy of the wording on this side to drift out of sync.
      setError(data.error ?? 'Gagal memesan kurir.');
      // Both mean "this courier specifically is not hireable right now", so the
      // sheet closes and the list reloads without him.
      if (data.code === 'courier_taken' || data.code === 'courier_cooldown') {
        setSelected(null);
        load();
      }
    } catch {
      setError('Tidak bisa menghubungi server. Coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }

  if (blocker === 'no_address') {
    return (
      <BlockerCard
        title="Alamat Belum Diatur"
        body="Kurir perlu tahu ke mana harus datang. Atur alamat utama pian dulu, lalu balik ke sini."
        href="/dashboard/setting"
        cta="Atur Alamat"
      />
    );
  }

  if (blocker === 'no_phone') {
    return (
      <BlockerCard
        title="Nomor HP Belum Diatur"
        body="Kurir menghubungi pian lewat WhatsApp buat menyepakati harga, jadi nomor HP wajib diisi dulu."
        href="/dashboard/setting"
        cta="Atur Nomor HP"
        icon={<Phone className="h-8 w-8 text-amber-500" />}
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-5">
        <h1 className="text-2xl font-black">Tugaskan Kurir</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pilih kurir yang lagi kosong, lalu sepakati harga langsung lewat WhatsApp.
          Ulun Pesan tidak memotong ongkos pian sepeser pun.
        </p>
        {/* The destination stays on screen with a way back to it: the distance
            beside every courier below is measured to this point, so it has to
            be visible and correctable without restarting the flow. */}
        <div className="mt-2 flex items-center gap-2 rounded-2xl bg-muted px-3 py-2">
          <MapPin className="h-4 w-4 shrink-0 text-rose-500" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            {destination?.address ?? 'Tujuan belum dipilih'}
          </span>
          <button
            type="button"
            onClick={() => setEditingDestination(true)}
            className="shrink-0 text-xs font-bold text-rose-600 hover:underline"
          >
            Ubah
          </button>
        </div>
        {/* The restored note, brought up here beside the destination rather than
            left buried in the confirmation sheet. A prefill the customer cannot
            see until two taps later is one they cannot correct either — and
            "bisa diubah" has to point at something. */}
        {note && (
          <div className="mt-2 rounded-2xl bg-muted px-3 py-2">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 shrink-0 text-rose-500" />
              {editingNote ? (
                <span className="flex-1 text-xs font-semibold">Tugas pian</span>
              ) : (
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{note}</span>
              )}
              <button
                type="button"
                onClick={() => setEditingNote((v) => !v)}
                className="shrink-0 text-xs font-bold text-rose-600 hover:underline"
              >
                {editingNote ? 'Selesai' : 'Ubah'}
              </button>
            </div>
            {editingNote && (
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={500}
                autoFocus
                placeholder={notePlaceholder}
                className="mt-1.5 w-full resize-none rounded-xl border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-rose-400"
              />
            )}
            {editingNote && !note && <NoteExamples onPick={setNote} />}
          </div>
        )}
        {/* Says out loud that the form is not blank by accident — a prefilled
            destination the customer did not just type would otherwise read as
            the app having ignored them. */}
        {draftRestored && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Ulun simpankan tugas pian yang tadi ditolak, tinggal pilih kurir
            lain. Tujuan dan catatan di atas bisa diubah.
          </p>
        )}
      </header>

      {!destination || loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : couriers.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <Bike className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 font-bold">Belum Ada Kurir Kosong</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Semua kurir lagi ada pesanan atau belum online. Layar ini otomatis
            memperbarui, jadi pian tinggal menunggu sebentar.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {couriers.map((c) => {
            const cooldown = c.rejectedCooldownSeconds;
            return (
            <li key={c.id}>
              <button
                type="button"
                // Rejected this customer: still listed, so they can see he is
                // there and why he is unavailable, but not selectable.
                disabled={cooldown !== null}
                onClick={() => setSelected(c)}
                className={`flex w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left transition-colors ${
                  cooldown !== null
                    ? 'cursor-not-allowed opacity-60'
                    : 'hover:bg-accent'
                }`}
              >
                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-muted">
                  {c.avatar ? (
                    <Image
                      src={resolveUploadImage(c.avatar)}
                      alt={c.name}
                      fill
                      // Matches the rest of the app: next/image's optimizer
                      // 400s on the backend's /uploads origin.
                      unoptimized
                      sizes="48px"
                      className="object-cover"
                    />
                  ) : (
                    <UserRound className="m-3 h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{c.name}</p>
                  {cooldown !== null ? (
                    <p className="flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400">
                      <Ban className="h-3 w-3 shrink-0" />
                      Menolak tugas pian · bisa lagi {formatCooldown(cooldown)}
                    </p>
                  ) : (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                        {c.rating.toFixed(1)}
                        <span className="opacity-70">({c.reviewCount})</span>
                      </span>
                      <span aria-hidden>·</span>
                      <span className="truncate">{c.vehiclePlate}</span>
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-xs font-semibold text-muted-foreground">
                  {formatDistance(c.distanceKm)}
                </span>
              </button>
            </li>
            );
          })}
        </ul>
      )}

      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => !submitting && setSelected(null)}
          >
            <motion.div
              initial={{ y: 40 }}
              animate={{ y: 0 }}
              exit={{ y: 40 }}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-background p-5"
            >
              <h2 className="text-lg font-black">Tugaskan Kurir {selected.name}?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Setelah dikirim, Kurir {selected.name} akan menghubungi pian lewat
                WhatsApp. Harga ditentukan kurir, bukan aplikasi.
              </p>

              <p className="mt-3 flex items-start gap-2 rounded-xl bg-muted px-3 py-2.5 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                <span>
                  <span className="font-semibold">Tujuan akhir: </span>
                  {destination?.address}
                </span>
              </p>

              <label className="mt-4 block text-sm font-semibold" htmlFor="errand-note">
                Mau ditugaskan apa? <span className="text-rose-500">*</span>
              </label>
              <textarea
                id="errand-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder={notePlaceholder}
                className="mt-1.5 w-full resize-none rounded-xl border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-rose-400"
              />
              {!note && <NoteExamples onPick={setNote} />}
              {!note.trim() && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Tulis dulu tugasnya biar kurir tahu yang mau dikerjakan.
                </p>
              )}

              {error && (
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {error}
                </p>
              )}

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setSelected(null)}
                  className="flex-1 rounded-full border px-4 py-3 text-sm font-bold disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  // The courier has nothing to act on without this — an errand
                  // that says nothing is a phone call he has to make to find out
                  // what he agreed to. The backend refuses it too.
                  disabled={submitting || !note.trim()}
                  onClick={hire}
                  className="flex-1 rounded-full bg-rose-500 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-rose-600 disabled:opacity-50"
                >
                  {submitting ? (
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  ) : (
                    'Tugaskan Sekarang'
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingDestination && (
          <ErrandDestinationStep
            cancelLabel={destination ? 'Batal' : 'Kembali'}
            onCancel={() => {
              // Without a destination there is no screen to fall back to, so
              // cancelling leaves the feature entirely.
              if (destination) setEditingDestination(false);
              else router.push('/dashboard');
            }}
            onConfirm={(d) => {
              setLoading(true);
              setSelected(null);
              setCouriers([]);
              setDestination(d);
              setEditingDestination(false);
              // Their own answer now, not the restored one.
              setDraftRestored(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function BlockerCard({
  title,
  body,
  href,
  cta,
  icon,
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 pt-10 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 dark:bg-amber-950/40">
        {icon ?? <MapPin className="h-8 w-8 text-amber-500" />}
      </div>
      <h2 className="text-xl font-black">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
      <Link
        href={href}
        className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-rose-500 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-rose-600"
      >
        {cta}
      </Link>
    </div>
  );
}
