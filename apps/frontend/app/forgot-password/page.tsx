"use client";

import { useEffect, useState, useTransition } from "react";
import { motion } from "motion/react";
import { KeyRound, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { requestResetLinkAction } from "./actions";

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("");
    const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
    const [cooldown, setCooldown] = useState(0);
    const [isPending, startTransition] = useTransition();

    // Courtesy lockout only — the enforcement is the backend rate limiter, since
    // a reload clears anything held here.
    useEffect(() => {
        if (cooldown <= 0) return;
        const id = setInterval(() => setCooldown((s) => s - 1), 1000);
        return () => clearInterval(id);
    }, [cooldown]);

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (cooldown > 0) return;
        setResult(null);
        startTransition(async () => {
            const res = await requestResetLinkAction(email);
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
                    <div className="mb-8 text-center">
                        <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                            <KeyRound className="h-6 w-6 text-rose-400" />
                        </div>
                        <h1 className="text-2xl font-semibold tracking-tight text-white mb-1">
                            Forgot your password?
                        </h1>
                        <p className="text-zinc-400 text-sm">
                            Enter your email and we'll send you a link to set a new one.
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
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
                                    : "Send reset link"
                            }
                        </button>

                        <p className="text-center text-sm text-zinc-400 mt-2">
                            Remember your password?{" "}
                            <a href="/login" className="text-white hover:text-rose-300 font-medium transition-colors">
                                Sign in
                            </a>
                        </p>
                    </form>
                </div>
            </motion.div>
        </div>
    );
}
