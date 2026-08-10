'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import {
    AlertTriangle,
    CheckCircle2,
    Loader2,
    MessageCircle,
    PencilLine,
    RefreshCw,
    Settings,
} from 'lucide-react';
import { API_URL } from '@/lib/api-url';

/**
 * Blocks the customer dashboard until the account's WhatsApp number is verified.
 *
 * WhatsApp is not a nice-to-have contact field in this app: a courier settles an
 * errand price there, an outlet calls about a delivery, and the rating link is
 * pasted into it. An unverified number is a customer nobody can reach halfway
 * through a job that is already under way.
 *
 * Sibling of EmailVerificationGate and rendered from the same place
 * (dashboard/layout.tsx, in place of {children}), so it covers every
 * /dashboard/* route at once. Email is checked first: a customer who has proven
 * neither should answer the cheaper challenge before we spend a billed WhatsApp
 * template on them.
 *
 * Two states, two modals, because they need two different actions from the
 * customer. No number saved is a data-entry problem and belongs in Pengaturan
 * Akun (the one place a number can be edited, with its once-a-month rule); a
 * saved-but-unproven number is a "tap the link we sent you" problem. Showing one
 * screen for both would put a send button in front of someone with nothing to
 * send to.
 */
export function PhoneVerificationGate({ phoneDisplay }: { phoneDisplay: string | null }) {
    const router = useRouter();
    const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
    const [cooldown, setCooldown] = useState(0);
    const [isPending, setIsPending] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    useEffect(() => {
        if (cooldown <= 0) return;
        const id = setInterval(() => setCooldown((s) => s - 1), 1000);
        return () => clearInterval(id);
    }, [cooldown]);

    async function handleSend() {
        if (cooldown > 0 || isPending) return;
        setIsPending(true);
        setResult(null);
        try {
            const res = await fetch(`${API_URL}/api/me/phone/verify/send`, {
                method: 'POST',
                credentials: 'include',
            });
            const data = await res.json();
            if (data.success) {
                if (data.alreadyVerified) {
                    router.refresh();
                    setResult({ ok: true, text: 'Nomor pian sudah terverifikasi.' });
                } else {
                    setResult({
                        ok: true,
                        text: data.delivered
                            ? 'Link verifikasi sudah dikirim ke WhatsApp pian.'
                            : 'Pengiriman WhatsApp belum diaktifkan di server ini.',
                    });
                    setCooldown(data.cooldownSeconds ?? 60);
                }
            } else {
                setResult({ ok: false, text: data.error ?? 'Gagal mengirim link.' });
                if (data.code === 'cooldown') setCooldown(data.secondsLeft ?? 60);
            }
        } catch {
            setResult({ ok: false, text: 'Tidak bisa menghubungi server.' });
        } finally {
            setIsPending(false);
        }
    }

    // The link is tapped inside WhatsApp, quite possibly on a different device,
    // so this tab's server-rendered layout still believes the number is
    // unverified until a fresh request re-checks it.
    function handleRefresh() {
        setIsRefreshing(true);
        router.refresh();
        setTimeout(() => setIsRefreshing(false), 2500);
    }

    const missing = !phoneDisplay;

    return (
        // Not dismissible: this IS the page for as long as the number is
        // unproven, so there is nothing behind it to close onto.
        <div className="flex min-h-[70vh] items-center justify-center px-4 py-12">
            <motion.div
                initial={{ opacity: 0, scale: 0.97, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                className="w-full max-w-md overflow-hidden rounded-3xl border bg-card shadow-xl"
            >
                <div
                    className={`flex items-center gap-2 px-5 py-3 text-white ${
                        missing ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                >
                    {missing ? (
                        <PencilLine className="h-4 w-4 shrink-0" />
                    ) : (
                        <MessageCircle className="h-4 w-4 shrink-0" />
                    )}
                    <span className="text-sm font-black">
                        {missing ? 'Nomor WhatsApp Belum Diisi' : 'Verifikasi WhatsApp Pian'}
                    </span>
                </div>

                <div className="p-6">
                    {missing ? (
                        <>
                            <p className="text-sm text-muted-foreground">
                                Pian belum punya nomor WhatsApp di akun ini. Nomor itu yang dipakai
                                kurir buat menghubungi pian waktu pesanan jalan, jadi harus diisi
                                dulu sebelum bisa pesan.
                            </p>

                            <ol className="mt-4 space-y-2.5 text-sm">
                                <Step n={1}>Buka Pengaturan Akun lewat tombol di bawah.</Step>
                                <Step n={2}>
                                    Isi nomor WhatsApp aktif pian di bagian{' '}
                                    <span className="font-semibold">Nomor WhatsApp</span>, lalu
                                    simpan.
                                </Step>
                                <Step n={3}>
                                    Balik ke sini, nanti muncul tombol kirim link verifikasi.
                                </Step>
                            </ol>

                            <p className="mt-3 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
                                Nomor cuma bisa diubah sekali sebulan, jadi pastikan benar sebelum
                                disimpan.
                            </p>

                            <Link
                                href="/dashboard/user"
                                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-amber-600"
                            >
                                <Settings className="h-4 w-4" />
                                Buka Pengaturan Akun
                            </Link>
                        </>
                    ) : (
                        <>
                            <p className="text-sm text-muted-foreground">
                                Kami perlu memastikan{' '}
                                <span className="font-semibold text-foreground">
                                    {phoneDisplay}
                                </span>{' '}
                                benar-benar nomor pian dan aktif di WhatsApp.
                            </p>

                            <ol className="mt-4 space-y-2.5 text-sm">
                                <Step n={1}>Ketuk tombol kirim link di bawah.</Step>
                                <Step n={2}>
                                    Buka WhatsApp, cari pesan dari kami, lalu ketuk link
                                    verifikasinya.
                                </Step>
                                <Step n={3}>
                                    Balik ke sini dan ketuk{' '}
                                    <span className="font-semibold">Sudah, Muat Ulang</span>.
                                </Step>
                            </ol>

                            {result && (
                                <motion.div
                                    initial={{ opacity: 0, y: -6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className={`mt-4 flex items-center gap-2 rounded-xl border p-3 text-sm font-medium ${
                                        result.ok
                                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                            : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
                                    }`}
                                >
                                    {result.ok ? (
                                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                                    ) : (
                                        <AlertTriangle className="h-4 w-4 shrink-0" />
                                    )}
                                    {result.text}
                                </motion.div>
                            )}

                            <button
                                type="button"
                                onClick={handleSend}
                                disabled={isPending || cooldown > 0}
                                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-600 disabled:opacity-60"
                            >
                                {isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <MessageCircle className="h-4 w-4" />
                                )}
                                {cooldown > 0
                                    ? `Kirim Ulang (${cooldown}s)`
                                    : 'Kirim Link Verifikasi'}
                            </button>

                            <button
                                type="button"
                                onClick={handleRefresh}
                                disabled={isRefreshing}
                                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold disabled:opacity-60"
                            >
                                {isRefreshing ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <RefreshCw className="h-4 w-4" />
                                )}
                                Sudah, Muat Ulang
                            </button>

                            {/* The escape hatch for the case this screen cannot
                                solve on its own: the number itself is wrong, so
                                no amount of resending will ever reach anyone. */}
                            <Link
                                href="/dashboard/user"
                                className="mt-3 flex items-center justify-center gap-1.5 text-xs font-semibold text-muted-foreground underline-offset-4 hover:underline"
                            >
                                <PencilLine className="h-3.5 w-3.5" />
                                Nomornya salah? Ubah di Pengaturan Akun
                            </Link>
                        </>
                    )}

                    <p className="mt-4 text-center text-xs text-muted-foreground">
                        Link berlaku 24 jam. Nomor baru perlu diverifikasi ulang.
                    </p>
                </div>
            </motion.div>
        </div>
    );
}

/** Numbered instruction row — the steps are an order, not a bullet list. */
function Step({ n, children }: { n: number; children: React.ReactNode }) {
    return (
        <li className="flex gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-black">
                {n}
            </span>
            <span className="min-w-0 text-muted-foreground">{children}</span>
        </li>
    );
}
