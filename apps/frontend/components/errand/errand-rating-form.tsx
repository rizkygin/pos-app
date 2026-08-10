'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Star } from 'lucide-react';
import { API_URL } from '@/lib/api-url';

/**
 * One form for both directions.
 *
 * It never says who is being rated, because this component genuinely does not
 * know — the backend derives that from the errand and the session. Wording is
 * kept neutral rather than guessing, which would show "Nilai kurir" to the
 * courier himself half the time.
 */
export function ErrandRatingForm({ errandId }: { errandId: string }) {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (rating < 1) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/errands/${errandId}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ rating, comment }),
      });
      const data = await res.json();
      if (data.success) {
        setDone(true);
        return;
      }
      setError(data.error ?? 'Gagal mengirim penilaian.');
    } catch {
      setError('Tidak bisa menghubungi server.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 pt-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-3xl dark:bg-emerald-950/40">
          ⭐
        </div>
        <h1 className="text-xl font-black">Terima Kasih!</h1>
        <p className="text-sm text-muted-foreground">
          Penilaian pian sudah tercatat.
        </p>
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          className="mt-2 rounded-full bg-rose-500 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-rose-600"
        >
          Kembali
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md pt-8">
      <h1 className="text-center text-xl font-black">Beri Penilaian</h1>
      <p className="mt-1 text-center text-sm text-muted-foreground">
        Bagaimana pengalaman pian dengan suruhan ini?
      </p>

      <div className="mt-6 flex justify-center gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} bintang`}
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            className="p-1 transition-transform hover:scale-110"
          >
            <Star
              className={`h-9 w-9 ${
                n <= (hover || rating)
                  ? 'fill-amber-400 text-amber-400'
                  : 'text-muted-foreground/40'
              }`}
            />
          </button>
        ))}
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={4}
        maxLength={500}
        placeholder="Ceritakan pengalaman pian (opsional)"
        className="mt-5 w-full resize-none rounded-xl border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-rose-400"
      />

      {error && (
        <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={busy || rating < 1}
        onClick={submit}
        className="mt-4 w-full rounded-full bg-rose-500 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-rose-600 disabled:opacity-50"
      >
        {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Kirim Penilaian'}
      </button>
    </div>
  );
}
