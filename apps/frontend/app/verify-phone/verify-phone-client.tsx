'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, MessageCircle, XCircle } from 'lucide-react';
import { API_URL } from '@/lib/api-url';

/**
 * The button that actually spends the verification token.
 *
 * It exists because the token MUST NOT be consumed by a page render. WhatsApp
 * fetches every URL it sends in order to build the preview card in the chat
 * bubble, and Next.js prefetches links on hover — so a token consumed during GET
 * is already spent by the time the customer taps it, and they land on "link ini
 * sudah dipakai" every single time. That was the first version of this page.
 *
 * A POST behind an explicit press cannot be triggered by a crawler or a
 * prefetch, which makes the click the customer makes the only thing that counts.
 */
export function VerifyPhoneClient({ token }: { token: string | null }) {
    const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'fail'>(
        token ? 'idle' : 'fail',
    );
    const [message, setMessage] = useState(token ? '' : 'Link tidak valid.');

    async function verify() {
        setState('busy');
        try {
            const res = await fetch(`${API_URL}/api/phone/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            });
            const data = await res.json().catch(() => null);
            if (data?.success) {
                setState('ok');
                setMessage(`Nomor ${data.phoneDisplay ?? 'WhatsApp'} pian sudah terverifikasi.`);
            } else {
                setState('fail');
                setMessage(data?.error ?? 'Link tidak valid.');
            }
        } catch {
            setState('fail');
            setMessage('Tidak bisa menghubungi server. Coba lagi.');
        }
    }

    const done = state === 'ok' || state === 'fail';

    return (
        <div className="w-full max-w-md rounded-3xl border bg-card p-8 text-center shadow-sm">
            <div
                className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border ${
                    state === 'ok'
                        ? 'border-emerald-500/20 bg-emerald-500/10'
                        : state === 'fail'
                          ? 'border-red-500/20 bg-red-500/10'
                          : 'border-emerald-500/20 bg-emerald-500/10'
                }`}
            >
                {state === 'ok' ? (
                    <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                ) : state === 'fail' ? (
                    <XCircle className="h-6 w-6 text-red-500" />
                ) : (
                    <MessageCircle className="h-6 w-6 text-emerald-500" />
                )}
            </div>

            <h1 className="text-xl font-black tracking-tight">
                {state === 'ok'
                    ? 'WhatsApp Terverifikasi'
                    : state === 'fail'
                      ? 'Verifikasi Gagal'
                      : 'Verifikasi Nomor WhatsApp'}
            </h1>

            <p className="mt-2 text-sm text-muted-foreground">
                {done
                    ? message
                    : 'Ketuk tombol di bawah untuk memastikan nomor ini benar milik pian.'}
            </p>

            {!done && (
                <button
                    type="button"
                    onClick={verify}
                    disabled={state === 'busy'}
                    className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-600 disabled:opacity-60"
                >
                    {state === 'busy' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <CheckCircle2 className="h-4 w-4" />
                    )}
                    {state === 'busy' ? 'Memverifikasi…' : 'Verifikasi Sekarang'}
                </button>
            )}

            <Link
                href="/dashboard"
                // prefetch={false}: this page is reached from WhatsApp, and a
                // prefetch of /dashboard from here is a wasted round-trip on a
                // phone connection that is usually the customer's mobile data.
                prefetch={false}
                className={`mt-2 inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-bold transition-colors ${
                    state === 'ok'
                        ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                        : 'border'
                }`}
            >
                Buka Dashboard
            </Link>

            {state === 'fail' && (
                <p className="mt-3 text-xs text-muted-foreground">
                    Minta link baru dari dashboard kalau yang ini sudah kedaluwarsa atau terpakai.
                </p>
            )}
        </div>
    );
}
