"use client";

import { useState, useTransition, useEffect } from "react";
import {
    updateUserNameAction,
    changePasswordAction,
    sendVerificationEmailAction,
    requestPasswordResetAction,
    getPhoneStateAction,
    updatePhoneAction,
    type PhoneState,
} from "@/app/dashboard/user/actions";
import { motion, AnimatePresence } from "motion/react";
import {
    User,
    Mail,
    Lock,
    ShieldCheck,
    ShieldAlert,
    Loader2,
    Eye,
    EyeOff,
    CheckCircle2,
    AlertTriangle,
    KeyRound,
    Trash2,
    ChevronRight,
    Phone,
    LogOut,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { notifyLogout } from "@/lib/native-bridge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type UserProps = {
    name: string;
    email: string;
    image: string | null;
    emailVerified: boolean;
};

type AlertState = { ok: boolean; text: string } | null;

function Alert({ state }: { state: AlertState }) {
    if (!state) return null;
    return (
        <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={`flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm font-medium ${state.ok
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400"
                }`}
        >
            {state.ok
                ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                : <AlertTriangle className="h-4 w-4 shrink-0" />
            }
            {state.text}
        </motion.div>
    );
}

/** One settings card. Header row is optional so bare cards stay quiet. */
function Section({
    icon: Icon,
    title,
    description,
    children,
    className = "",
}: {
    icon?: LucideIcon;
    title?: string;
    description?: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section className={`rounded-2xl border bg-card p-5 md:p-6 ${className}`}>
            {title && (
                <div className="mb-5 flex items-start gap-3">
                    {Icon && (
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                            <Icon className="size-4" />
                        </span>
                    )}
                    <div className="space-y-0.5">
                        <h2 className="text-sm font-semibold leading-tight">{title}</h2>
                        {description && (
                            <p className="text-xs text-muted-foreground">{description}</p>
                        )}
                    </div>
                </div>
            )}
            {children}
        </section>
    );
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{label}</label>
            {children}
            {hint}
        </div>
    );
}

function PasswordInput({
    placeholder,
    value,
    onChange,
}: {
    placeholder: string;
    value: string;
    onChange: (v: string) => void;
}) {
    const [show, setShow] = useState(false);
    return (
        <div className="relative">
            <input
                type={show ? "text" : "password"}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 pr-10 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
            >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
        </div>
    );
}

const TABS = [
    { id: "profile", label: "Profile", icon: User },
    { id: "security", label: "Security", icon: Lock },
    { id: "account", label: "Account", icon: KeyRound },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function UserSetting({ user }: { user: UserProps }) {
    const [activeTab, setActiveTab] = useState<TabId>("profile");
    const router = useRouter();

    // Sign out state
    const [signingOut, setSigningOut] = useState(false);

    const signOut = async () => {
        setSigningOut(true);
        // Mirrors the sidebar's sign-out: tells the courier app to stop its
        // location service and revoke its device token before the session goes.
        notifyLogout();
        await authClient.signOut({
            fetchOptions: {
                onSuccess: () => router.push("/login"),
            },
        });
        setSigningOut(false);
    };

    // Profile state
    const [name, setName] = useState(user.name);
    const [profileAlert, setProfileAlert] = useState<AlertState>(null);
    const [profilePending, startProfileTransition] = useTransition();

    // Password state
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [passwordAlert, setPasswordAlert] = useState<AlertState>(null);
    const [passwordPending, startPasswordTransition] = useTransition();

    // Email verification state
    const [verificationSent, setVerificationSent] = useState(false);
    const [verificationPending, startVerificationTransition] = useTransition();

    // WhatsApp state. Fetched rather than passed as a prop: whether the monthly
    // change is available depends on server time, so it can't be baked into the
    // page render and still be right an hour later.
    const [phone, setPhone] = useState("");
    const [phoneState, setPhoneState] = useState<PhoneState | null>(null);
    const [phoneAlert, setPhoneAlert] = useState<{ type: "success" | "error"; message: string } | null>(null);
    const [phonePending, startPhoneTransition] = useTransition();

    useEffect(() => {
        let cancelled = false;
        getPhoneStateAction().then((state) => {
            if (cancelled || !state) return;
            setPhoneState(state);
            setPhone(state.phoneDisplay ?? "");
        });
        return () => {
            cancelled = true;
        };
    }, []);

    function handleSavePhone() {
        setPhoneAlert(null);
        startPhoneTransition(async () => {
            const res = await updatePhoneAction(phone);
            setPhoneAlert({ type: res.success ? "success" : "error", message: res.message });
            if (res.success) {
                // Re-read from the response so the field shows the canonical
                // form the server actually stored, not the punctuation typed in.
                setPhone(res.phoneDisplay ?? phone);
                setPhoneState({
                    phoneDisplay: res.phoneDisplay ?? phone,
                    canChange: false,
                    nextChangeAt: res.nextChangeAt,
                });
            } else if (res.nextChangeAt) {
                // Lost a race, or another tab already used the change. Reflect
                // the lock immediately instead of leaving the button live.
                setPhoneState((prev) =>
                    prev ? { ...prev, canChange: false, nextChangeAt: res.nextChangeAt } : prev,
                );
            }
        });
    }

    function handleSaveProfile() {
        setProfileAlert(null);
        startProfileTransition(async () => {
            const res = await updateUserNameAction(name);
            setProfileAlert({ ok: res.success, text: res.message });
        });
    }

    function handleChangePassword() {
        if (!currentPassword || !newPassword || !confirmPassword) {
            setPasswordAlert({ ok: false, text: "Please fill in all fields." });
            return;
        }
        if (newPassword !== confirmPassword) {
            setPasswordAlert({ ok: false, text: "New passwords do not match." });
            return;
        }
        if (newPassword.length < 8) {
            setPasswordAlert({ ok: false, text: "Password must be at least 8 characters." });
            return;
        }
        setPasswordAlert(null);
        startPasswordTransition(async () => {
            const res = await changePasswordAction(currentPassword, newPassword);
            setPasswordAlert({ ok: res.success, text: res.message });
            if (res.success) {
                setCurrentPassword("");
                setNewPassword("");
                setConfirmPassword("");
            }
        });
    }

    function handleSendVerification() {
        startVerificationTransition(async () => {
            const res = await sendVerificationEmailAction(user.email);
            if (res.success) setVerificationSent(true);
            else setVerificationSent(false);
        });
    }

    function handleRequestPasswordReset() {
        startPasswordTransition(async () => {
            const res = await requestPasswordResetAction(user.email);
            setPasswordAlert({ ok: res.success, text: res.message });
        });
    }

    const [imageFailed, setImageFailed] = useState(false);

    const initials = (user.name ?? "")
        .split(" ")
        .map((part) => part[0])
        .filter(Boolean)
        .join("")
        .toUpperCase()
        .slice(0, 2) || "U";

    const phoneLocked = phoneState !== null && !phoneState.canChange;

    return (
        <div className="mx-auto max-w-3xl space-y-6 px-4 pb-16 pt-6 md:px-6">
            {/* Identity header — who you're editing, before the controls. */}
            <header className="flex flex-col gap-4 rounded-2xl border bg-card p-5 sm:flex-row sm:items-center md:p-6">
                {/* Initials avatar matches the sidebar's (same gradient, same
                    two-letter rule) so the same person reads as the same person
                    in both places. Also covers a set-but-broken image URL, which
                    otherwise renders as the browser's broken-image icon. */}
                {user.image && !imageFailed ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={user.image}
                        alt=""
                        onError={() => setImageFailed(true)}
                        className="size-14 shrink-0 rounded-2xl object-cover"
                    />
                ) : (
                    <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-500 to-violet-600 text-lg font-semibold text-white">
                        {initials}
                    </span>
                )}

                <div className="min-w-0 flex-1 space-y-1">
                    <h1 className="truncate text-lg font-semibold leading-tight">{user.name}</h1>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                        <span className="truncate">{user.email}</span>
                        {user.emailVerified ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                                <ShieldCheck className="size-3" /> Verified
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                                <ShieldAlert className="size-3" /> Unverified
                            </span>
                        )}
                    </div>
                </div>

                <Button
                    variant="outline"
                    onClick={signOut}
                    disabled={signingOut}
                    className="w-full rounded-xl sm:w-auto"
                >
                    {signingOut
                        ? <Loader2 className="mr-1.5 size-4 animate-spin" />
                        : <LogOut className="mr-1.5 size-4" />
                    }
                    Sign out
                </Button>
            </header>

            {/* Tab Navigation */}
            <div className="grid grid-cols-3 gap-1 rounded-2xl bg-muted/60 p-1 sm:inline-grid sm:w-auto sm:grid-flow-col sm:auto-cols-max">
                {TABS.map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => setActiveTab(id)}
                        className={`relative flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors sm:min-w-28 ${activeTab === id
                            ? "text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                            }`}
                    >
                        {activeTab === id && (
                            <motion.div
                                layoutId="tab-indicator"
                                className="absolute inset-0 rounded-xl bg-background shadow-sm"
                                transition={{ type: "spring", bounce: 0.2, duration: 0.35 }}
                            />
                        )}
                        <span className="relative z-10 flex items-center gap-2">
                            <Icon className="size-4" />
                            {label}
                        </span>
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <AnimatePresence mode="wait">
                {activeTab === "profile" && (
                    <motion.div
                        key="profile"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        className="space-y-4"
                    >
                        <Section
                            icon={User}
                            title="Profile information"
                            description="How your name appears across the app."
                        >
                            <div className="space-y-5">
                                <Field label="Full name">
                                    <Input
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="Your name..."
                                        className="rounded-xl"
                                    />
                                </Field>

                                <Field
                                    label="Email address"
                                    hint={<p className="text-xs text-muted-foreground">Email cannot be changed here. Contact support if needed.</p>}
                                >
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            type="email"
                                            value={user.email}
                                            readOnly
                                            className="cursor-not-allowed rounded-xl bg-muted/40 pl-10 text-muted-foreground"
                                        />
                                    </div>
                                </Field>

                                <AnimatePresence>
                                    {profileAlert && <Alert state={profileAlert} />}
                                </AnimatePresence>

                                <Button
                                    onClick={handleSaveProfile}
                                    disabled={profilePending}
                                    className="w-full rounded-xl bg-rose-500 font-semibold text-white hover:bg-rose-600 sm:w-auto"
                                >
                                    {profilePending && <Loader2 className="mr-2 size-4 animate-spin" />}
                                    {profilePending ? "Saving..." : "Save changes"}
                                </Button>
                            </div>
                        </Section>

                        {/* WhatsApp — rate-limited to one change a month. The
                            limit is stated up front rather than sprung as an
                            error after someone has already typed a new number. */}
                        <Section
                            icon={Phone}
                            title="Nomor WhatsApp"
                            description="Dipakai penjual & kurir untuk menghubungi pian soal pesanan."
                        >
                            <div className="space-y-3">
                                <div className="relative">
                                    <Phone className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        type="tel"
                                        inputMode="numeric"
                                        value={phone}
                                        onChange={(e) => setPhone(e.target.value)}
                                        readOnly={phoneLocked}
                                        placeholder="08123456789"
                                        className={`rounded-xl pl-10 ${phoneLocked ? "cursor-not-allowed bg-muted/40 text-muted-foreground" : ""}`}
                                    />
                                </div>

                                {phoneLocked && phoneState?.nextChangeAt ? (
                                    <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                                        <Lock className="mt-0.5 size-3.5 shrink-0" />
                                        Nomor hanya bisa diubah sekali sebulan. Bisa diubah lagi{" "}
                                        {new Date(phoneState.nextChangeAt).toLocaleDateString("id-ID", {
                                            day: "numeric",
                                            month: "long",
                                            year: "numeric",
                                        })}
                                        .
                                    </p>
                                ) : (
                                    <p className="text-xs text-muted-foreground">
                                        Hanya bisa diubah sekali sebulan.
                                    </p>
                                )}

                                {phoneAlert && (
                                    <p
                                        className={`text-xs font-medium ${phoneAlert.type === "success"
                                            ? "text-emerald-600 dark:text-emerald-400"
                                            : "text-rose-600 dark:text-rose-400"
                                            }`}
                                    >
                                        {phoneAlert.message}
                                    </p>
                                )}

                                {phoneState?.canChange && (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={phonePending || !phone.trim()}
                                        onClick={handleSavePhone}
                                        className="rounded-xl"
                                    >
                                        {phonePending ? "Menyimpan..." : "Simpan nomor"}
                                    </Button>
                                )}
                            </div>
                        </Section>
                    </motion.div>
                )}

                {activeTab === "security" && (
                    <motion.div
                        key="security"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        className="space-y-4"
                    >
                        {/* Email Verification */}
                        <div className={`rounded-2xl border p-5 md:p-6 ${user.emailVerified
                            ? "border-emerald-200/60 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                            : "border-amber-200/60 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20"
                            }`}>
                            <div className="flex items-start gap-3">
                                <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${user.emailVerified
                                    ? "bg-emerald-100 dark:bg-emerald-950/60"
                                    : "bg-amber-100 dark:bg-amber-950/60"
                                    }`}>
                                    {user.emailVerified
                                        ? <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
                                        : <ShieldAlert className="size-4 text-amber-500 dark:text-amber-400" />
                                    }
                                </span>
                                <div className="flex-1 space-y-1">
                                    <p className={`text-sm font-semibold ${user.emailVerified
                                        ? "text-emerald-700 dark:text-emerald-400"
                                        : "text-amber-700 dark:text-amber-400"
                                        }`}>
                                        Email {user.emailVerified ? "verified" : "not verified"}
                                    </p>
                                    <p className={`text-xs ${user.emailVerified
                                        ? "text-emerald-600 dark:text-emerald-500"
                                        : "text-amber-600 dark:text-amber-500"
                                        }`}>
                                        {user.emailVerified
                                            ? `Your email ${user.email} is verified and active.`
                                            : "Please verify your email to unlock all features."
                                        }
                                    </p>

                                    {!user.emailVerified && (
                                        <div className="pt-2">
                                            {verificationSent ? (
                                                <motion.p
                                                    initial={{ opacity: 0 }}
                                                    animate={{ opacity: 1 }}
                                                    className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
                                                >
                                                    <CheckCircle2 className="size-4" />
                                                    Verification email sent! Check your inbox.
                                                </motion.p>
                                            ) : (
                                                <Button
                                                    size="sm"
                                                    onClick={handleSendVerification}
                                                    disabled={verificationPending}
                                                    className="rounded-xl bg-amber-500 font-semibold text-white hover:bg-amber-600"
                                                >
                                                    {verificationPending && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                                                    {verificationPending ? "Sending..." : "Send verification email"}
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Change Password */}
                        <Section
                            icon={Lock}
                            title="Change password"
                            description="Ensure your account uses a strong, unique password."
                        >
                            <div className="space-y-5">
                                <Field label="Current password">
                                    <PasswordInput
                                        placeholder="Enter current password..."
                                        value={currentPassword}
                                        onChange={setCurrentPassword}
                                    />
                                </Field>

                                <div className="h-px bg-border/60" />

                                <Field
                                    label="New password"
                                    hint={newPassword.length > 0 ? (
                                        <div className="mt-1.5 flex items-center gap-1">
                                            {[8, 12, 16].map((len, i) => (
                                                <div
                                                    key={len}
                                                    className={`h-1 flex-1 rounded-full transition-colors ${newPassword.length >= len
                                                        ? i === 0 ? "bg-rose-400" : i === 1 ? "bg-amber-400" : "bg-emerald-400"
                                                        : "bg-muted"
                                                        }`}
                                                />
                                            ))}
                                            <span className="ml-1 text-xs text-muted-foreground">
                                                {newPassword.length < 8 ? "Weak" : newPassword.length < 12 ? "Fair" : newPassword.length < 16 ? "Good" : "Strong"}
                                            </span>
                                        </div>
                                    ) : undefined}
                                >
                                    <PasswordInput
                                        placeholder="Enter new password..."
                                        value={newPassword}
                                        onChange={setNewPassword}
                                    />
                                </Field>

                                <Field
                                    label="Confirm new password"
                                    hint={confirmPassword.length > 0 && newPassword !== confirmPassword ? (
                                        <p className="flex items-center gap-1 text-xs font-medium text-rose-500">
                                            <AlertTriangle className="size-3" /> Passwords do not match
                                        </p>
                                    ) : undefined}
                                >
                                    <PasswordInput
                                        placeholder="Confirm new password..."
                                        value={confirmPassword}
                                        onChange={setConfirmPassword}
                                    />
                                </Field>

                                <AnimatePresence>
                                    {passwordAlert && <Alert state={passwordAlert} />}
                                </AnimatePresence>

                                <Button
                                    onClick={handleChangePassword}
                                    disabled={passwordPending}
                                    className="w-full rounded-xl bg-rose-500 font-semibold text-white hover:bg-rose-600 sm:w-auto"
                                >
                                    {passwordPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                                    {passwordPending ? "Updating..." : "Update password"}
                                </Button>
                            </div>
                        </Section>

                        {/* Reset Password */}
                        <Section>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="space-y-0.5">
                                    <p className="flex items-center gap-2 text-sm font-semibold">
                                        <KeyRound className="size-4 text-muted-foreground" /> Forgot your password?
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        Send a reset link to <span className="font-medium text-foreground">{user.email}</span>
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleRequestPasswordReset}
                                    disabled={passwordPending}
                                    className="flex items-center gap-1 text-xs font-semibold text-rose-500 transition-colors hover:text-rose-600 disabled:opacity-50"
                                >
                                    {passwordPending
                                        ? <Loader2 className="size-3.5 animate-spin" />
                                        : <>Send link <ChevronRight className="size-3.5" /></>
                                    }
                                </button>
                            </div>
                        </Section>
                    </motion.div>
                )}

                {activeTab === "account" && (
                    <motion.div
                        key="account"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        className="space-y-4"
                    >
                        {/* Account Info */}
                        <Section icon={KeyRound} title="Account details">
                            <dl className="divide-y divide-border/50">
                                {[
                                    { label: "Full name", value: user.name },
                                    { label: "Email", value: user.email },
                                    { label: "Email status", value: user.emailVerified ? "Verified" : "Not verified" },
                                    { label: "WhatsApp", value: phoneState?.phoneDisplay ?? "—" },
                                ].map(({ label, value }) => (
                                    <div key={label} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                                        <dt className="text-xs text-muted-foreground">{label}</dt>
                                        <dd className={`truncate text-sm font-medium ${label !== "Email status"
                                            ? ""
                                            : user.emailVerified
                                                ? "text-emerald-600 dark:text-emerald-400"
                                                : "text-amber-500 dark:text-amber-400"
                                            }`}>
                                            {value}
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                        </Section>

                        {/* Session */}
                        <Section>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="space-y-0.5">
                                    <p className="text-sm font-semibold">Sign out</p>
                                    <p className="text-xs text-muted-foreground">End this session on this device.</p>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={signOut}
                                    disabled={signingOut}
                                    className="rounded-xl"
                                >
                                    {signingOut
                                        ? <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                                        : <LogOut className="mr-1.5 size-3.5" />
                                    }
                                    Sign out
                                </Button>
                            </div>
                        </Section>

                        {/* Danger Zone */}
                        <section className="rounded-2xl border border-rose-200/60 bg-rose-50/40 p-5 dark:border-rose-900/40 dark:bg-rose-950/20 md:p-6">
                            <div className="mb-4 flex items-start gap-3">
                                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 dark:bg-rose-950/60">
                                    <AlertTriangle className="size-4 text-rose-600 dark:text-rose-400" />
                                </span>
                                <div className="space-y-0.5">
                                    <h2 className="text-sm font-semibold text-rose-700 dark:text-rose-400">Danger zone</h2>
                                    <p className="text-xs text-rose-500 dark:text-rose-500">Irreversible actions. Proceed with caution.</p>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200/60 bg-background p-4 dark:border-rose-900/40">
                                <div className="space-y-0.5">
                                    <p className="text-sm font-semibold">Delete account</p>
                                    <p className="text-xs text-muted-foreground">Permanently delete your account and all associated data.</p>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="rounded-xl border-rose-300 font-semibold text-rose-600 hover:border-rose-400 hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950/40"
                                >
                                    <Trash2 className="mr-1.5 size-3.5" />
                                    Delete
                                </Button>
                            </div>
                        </section>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
