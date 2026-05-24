"use client";

import { useState, useTransition } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Eye, EyeOff, KeyRound, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { resetPasswordAction } from "./actions";

function PasswordInput({
    value,
    onChange,
    placeholder,
}: {
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
}) {
    const [show, setShow] = useState(false);
    return (
        <div className="relative">
            <input
                type={show ? "text" : "password"}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="w-full px-4 py-3 pr-12 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all font-medium"
                required
            />
            <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white transition-colors"
            >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
        </div>
    );
}

export default function ResetPasswordPage() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const token = searchParams?.get("token") ?? "";

    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
    const [isPending, startTransition] = useTransition();

    const strengthLevel =
        newPassword.length === 0 ? 0
            : newPassword.length < 8 ? 1
                : newPassword.length < 12 ? 2
                    : newPassword.length < 16 ? 3
                        : 4;

    const strengthLabel = ["", "Weak", "Fair", "Good", "Strong"][strengthLevel];
    const strengthColor = ["", "bg-rose-500", "bg-amber-400", "bg-sky-400", "bg-emerald-400"][strengthLevel];

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            setResult({ ok: false, text: "Passwords do not match." });
            return;
        }
        if (newPassword.length < 8) {
            setResult({ ok: false, text: "Password must be at least 8 characters." });
            return;
        }
        if (!token) {
            setResult({ ok: false, text: "Reset token is missing. Use the link from your email." });
            return;
        }
        setResult(null);
        startTransition(async () => {
            const res = await resetPasswordAction(token, newPassword);
            setResult({ ok: res.success, text: res.message });
            if (res.success) {
                setTimeout(() => router.push("/"), 2000);
            }
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
                    {/* Header */}
                    <div className="mb-8 text-center">
                        <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                            <KeyRound className="h-6 w-6 text-rose-400" />
                        </div>
                        <h1 className="text-2xl font-semibold tracking-tight text-white mb-1">
                            Set new password
                        </h1>
                        <p className="text-zinc-400 text-sm">
                            Choose a strong password for your account.
                        </p>
                    </div>

                    {result?.ok ? (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="flex flex-col items-center gap-3 py-4 text-center"
                        >
                            <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                            <p className="text-white font-semibold">{result.text}</p>
                            <p className="text-zinc-400 text-sm">Redirecting to sign in…</p>
                        </motion.div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-zinc-300 mb-1.5 ml-1">
                                    New Password
                                </label>
                                <PasswordInput
                                    value={newPassword}
                                    onChange={setNewPassword}
                                    placeholder="Enter new password"
                                />
                                {strengthLevel > 0 && (
                                    <div className="mt-2 flex items-center gap-2">
                                        <div className="flex gap-1 flex-1">
                                            {[1, 2, 3, 4].map((lvl) => (
                                                <div
                                                    key={lvl}
                                                    className={`h-1 flex-1 rounded-full transition-colors duration-300 ${strengthLevel >= lvl ? strengthColor : "bg-white/10"}`}
                                                />
                                            ))}
                                        </div>
                                        <span className="text-xs text-zinc-400">{strengthLabel}</span>
                                    </div>
                                )}
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-zinc-300 mb-1.5 ml-1">
                                    Confirm Password
                                </label>
                                <PasswordInput
                                    value={confirmPassword}
                                    onChange={setConfirmPassword}
                                    placeholder="Confirm new password"
                                />
                                {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                                    <p className="mt-1.5 ml-1 text-xs text-rose-400 font-medium">
                                        Passwords do not match
                                    </p>
                                )}
                            </div>

                            {result && !result.ok && (
                                <motion.div
                                    initial={{ opacity: 0, y: -6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="flex items-center gap-2 text-rose-400 text-sm font-medium bg-rose-400/10 p-3 rounded-xl border border-rose-400/20"
                                >
                                    <AlertTriangle className="h-4 w-4 shrink-0" />
                                    {result.text}
                                </motion.div>
                            )}

                            <button
                                type="submit"
                                disabled={isPending}
                                className="w-full mt-2 bg-rose-500 hover:bg-rose-600 text-white font-semibold py-3.5 px-4 rounded-2xl focus:outline-none focus:ring-4 focus:ring-rose-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {isPending
                                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Resetting…</>
                                    : "Reset Password"
                                }
                            </button>

                            <p className="text-center text-sm text-zinc-400 mt-2">
                                Remember your password?{" "}
                                <a href="/" className="text-white hover:text-rose-300 font-medium transition-colors">
                                    Sign in
                                </a>
                            </p>
                        </form>
                    )}
                </div>
            </motion.div>
        </div>
    );
}
