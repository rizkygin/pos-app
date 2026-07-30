'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { MailCheck, CheckCircle2, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { resendVerificationAction } from '@/app/verify-email/actions';

/**
 * Blocks the customer dashboard until the account's email is verified.
 *
 * There is no WhatsApp/phone verification in this app — email is the only
 * identity check a customer goes through — so an unverified address means an
 * unverified person placing real orders against real outlets. This is the
 * enforcement point: rendered by dashboard/layout.tsx in place of {children}
 * for role === 'customer' whenever session.user.emailVerified is false, which
 * covers every /dashboard/* route in one place. The order-creation endpoint
 * (`/api/orders/create`) enforces the same rule server-side, since a customer
 * could otherwise hit the API directly and skip this screen entirely.
 */
export function EmailVerificationGate({ email }: { email: string }) {
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

    async function handleResend() {
        if (cooldown > 0 || isPending) return;
        setIsPending(true);
        setResult(null);
        const res = await resendVerificationAction(email);
        setResult({ ok: res.success, text: res.message });
        setCooldown(res.cooldown);
        setIsPending(false);
    }

    // The link is clicked in a different tab (email client), so this tab's
    // server-rendered layout still thinks the account is unverified until a
    // fresh request re-checks the session — router.refresh() forces that.
    function handleRefresh() {
        setIsRefreshing(true);
        router.refresh();
        // If verification actually happened, the layout swaps this screen out
        // on the refreshed render; if not, un-stick the button after a beat.
        setTimeout(() => setIsRefreshing(false), 2500);
    }

    return (
        <div className="flex min-h-[70vh] items-center justify-center px-4 py-12">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="w-full max-w-md rounded-3xl border bg-card p-8 shadow-sm"
            >
                <div className="mb-6 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 border border-rose-500/20">
                        <MailCheck className="h-6 w-6 text-rose-500" />
                    </div>
                    <h1 className="text-xl font-black tracking-tight">
                        Verifikasi Email untuk Melanjutkan
                    </h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Kami belum memverifikasi bahwa <span className="font-semibold text-foreground">{email}</span> benar
                        milikmu. Untuk keamanan, pesan hanya bisa dibuat setelah email diverifikasi.
                    </p>
                </div>

                {result && (
                    <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`mb-4 flex items-center gap-2 rounded-xl border p-3 text-sm font-medium ${result.ok
                            ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-600'
                            : 'border-rose-400/20 bg-rose-400/10 text-rose-500'
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

                <div className="space-y-2.5">
                    <button
                        type="button"
                        onClick={handleResend}
                        disabled={isPending || cooldown > 0}
                        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-rose-500 text-sm font-bold text-white transition-colors hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {isPending ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" /> Mengirim…
                            </>
                        ) : cooldown > 0 ? (
                            `Kirim ulang dalam ${cooldown}d`
                        ) : (
                            'Kirim Ulang Link Verifikasi'
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border text-sm font-bold transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                        Saya Sudah Verifikasi, Muat Ulang
                    </button>
                </div>

                <p className="mt-5 text-center text-xs text-muted-foreground">
                    Salah alamat email? Keluar lewat menu di sebelah kiri lalu daftar ulang.
                </p>
            </motion.div>
        </div>
    );
}
