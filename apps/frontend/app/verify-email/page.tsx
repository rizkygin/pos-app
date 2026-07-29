"use client";

import { Suspense, useEffect, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { MailCheck, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { resendVerificationAction } from "./actions";

export default function VerifyEmailPage() {
    return (
        <Suspense>
            <VerifyEmail />
        </Suspense>
    );
}

// better-auth redirects here after handling the token on the backend: success
// carries no extra params, a failure appends &error=<code>.
function errorText(code: string) {
    switch (code) {
        case "USER_NOT_FOUND":
            return "We couldn't find an account for this link.";
        case "INVALID_USER":
            return "This link belongs to a different account. Sign out first, then open it again.";
        case "TOKEN_EXPIRED":
            return "This link has expired. Request a new one below.";
        default:
            return "This link is no longer valid. Request a new one below.";
    }
}

function VerifyEmail() {
    const searchParams = useSearchParams();
    // Set by the backend's callbackURL — marks this as a real verification
    // round-trip rather than someone opening /verify-email directly.
    const cameFromLink = searchParams?.get("verified") === "1";
    const error = searchParams?.get("error");
    const verified = cameFromLink && !error;

    const [email, setEmail] = useState("");
    const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
    const [cooldown, setCooldown] = useState(0);
    const [isPending, startTransition] = useTransition();

    // Ticks the resend button's lockout down to zero. This is courtesy, not
    // security — the enforcement lives in the backend's rate limiter, since
    // anything here is trivially bypassed by reloading the page.
    useEffect(() => {
        if (cooldown <= 0) return;
        const id = setInterval(() => setCooldown((s) => s - 1), 1000);
        return () => clearInterval(id);
    }, [cooldown]);

    function handleResend(e: React.FormEvent) {
        e.preventDefault();
        if (cooldown > 0) return;
        setResult(null);
        startTransition(async () => {
            const res = await resendVerificationAction(email);
            setResult({ ok: res.success, text: res.message });
            setCooldown(res.cooldown);
        });
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background overflow-hidden relative">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-150 h-150 bg-linear-to-br from-rose-500/20 to-pink-500/20 blur-[120px] rounded-full pointer-events-none" />

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="w-full max-w-md p-8 relative z-10"
            >
                <div className="backdrop-blur-xl bg-foreground dark:bg-black/40 border border-white/10 shadow-2xl rounded-3xl p-8">
                    {verified ? (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="flex flex-col items-center gap-3 py-4 text-center"
                        >
                            <CheckCircle2 className="h-12 w-12 text-emerald-400" />
                            <h1 className="text-2xl font-semibold tracking-tight text-white">
                                Email verified
                            </h1>
                            <p className="text-zinc-400 text-sm">
                                Your address is confirmed. You're all set.
                            </p>
                            <a
                                href="/dashboard"
                                className="mt-3 w-full bg-rose-500 hover:bg-rose-600 text-white font-semibold py-3.5 px-4 rounded-2xl transition-all text-center"
                            >
                                Go to Dashboard
                            </a>
                        </motion.div>
                    ) : (
                        <>
                            <div className="mb-8 text-center">
                                <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                                    <MailCheck className="h-6 w-6 text-rose-400" />
                                </div>
                                <h1 className="text-2xl font-semibold tracking-tight text-white mb-1">
                                    Verify your email
                                </h1>
                                <p className="text-zinc-400 text-sm">
                                    {cameFromLink
                                        ? errorText(error ?? "")
                                        : "Enter your email and we'll send you a fresh verification link."}
                                </p>
                            </div>

                            <form onSubmit={handleResend} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-zinc-300 mb-1.5 ml-1">
                                        Email Address
                                    </label>
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="you@example.com"
                                        className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all font-medium"
                                        required
                                    />
                                </div>

                                {result && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className={`flex items-center gap-2 text-sm font-medium p-3 rounded-xl border ${result.ok
                                            ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20"
                                            : "text-rose-400 bg-rose-400/10 border-rose-400/20"
                                            }`}
                                    >
                                        {result.ok
                                            ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                                            : <AlertTriangle className="h-4 w-4 shrink-0" />}
                                        {result.text}
                                    </motion.div>
                                )}

                                <button
                                    type="submit"
                                    disabled={isPending || cooldown > 0}
                                    className="w-full mt-2 bg-rose-500 hover:bg-rose-600 text-white font-semibold py-3.5 px-4 rounded-2xl focus:outline-none focus:ring-4 focus:ring-rose-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {isPending
                                        ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>
                                        : cooldown > 0
                                            ? `Resend in ${cooldown}s`
                                            : "Send verification link"
                                    }
                                </button>

                                <p className="text-center text-sm text-zinc-400 mt-2">
                                    Already verified?{" "}
                                    <a href="/login" className="text-white hover:text-rose-300 font-medium transition-colors">
                                        Sign in
                                    </a>
                                </p>
                            </form>
                        </>
                    )}
                </div>
            </motion.div>
        </div>
    );
}
