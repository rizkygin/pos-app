"use client";

import { useState, useTransition } from "react";
import {
    updateUserNameAction,
    changePasswordAction,
    sendVerificationEmailAction,
    requestPasswordResetAction,
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
} from "lucide-react";
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
            className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl text-sm font-semibold ${state.ok
                ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                : "bg-rose-50 border border-rose-200 text-rose-700"
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
                className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 placeholder:text-muted-foreground"
            />
            <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
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

    return (
        <div className="px-4 md:px-6 pb-16 pt-6 max-w-3xl space-y-6">
            {/* Page Header */}
            <div>
                <h1 className="text-2xl font-black">Account Settings</h1>
                <p className="text-sm text-muted-foreground mt-1">Manage your profile, security, and account preferences.</p>
            </div>

            {/* Tab Navigation */}
            <div className="flex gap-1 p-1 bg-muted/60 rounded-2xl w-fit">
                {TABS.map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => setActiveTab(id)}
                        className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all duration-200 ${activeTab === id
                            ? "text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                            }`}
                    >
                        {activeTab === id && (
                            <motion.div
                                layoutId="tab-indicator"
                                className="absolute inset-0 bg-background rounded-xl shadow-sm"
                                transition={{ type: "spring", bounce: 0.2, duration: 0.35 }}
                            />
                        )}
                        <span className="relative z-10 flex items-center gap-2">
                            <Icon className="h-4 w-4" />
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
                        {/* Profile Info */}
                        <div className="p-5 rounded-2xl border border-border/60 bg-card shadow-sm space-y-5">
                            <p className="font-black text-sm flex items-center gap-2">
                                <User className="h-4 w-4 text-rose-500" /> Profile Information
                            </p>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Full Name</label>
                                <Input
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Your name..."
                                    className="rounded-xl"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Email Address</label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        type="email"
                                        value={user.email}
                                        readOnly
                                        className="rounded-xl pl-10 bg-muted/40 text-muted-foreground cursor-not-allowed"
                                    />
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                        {user.emailVerified
                                            ? <span className="flex items-center gap-1 text-xs font-bold text-emerald-600"><ShieldCheck className="h-3.5 w-3.5" /> Verified</span>
                                            : <span className="flex items-center gap-1 text-xs font-bold text-amber-500"><ShieldAlert className="h-3.5 w-3.5" /> Unverified</span>
                                        }
                                    </div>
                                </div>
                                <p className="text-xs text-muted-foreground">Email cannot be changed here. Contact support if needed.</p>
                            </div>

                            <AnimatePresence>
                                {profileAlert && <Alert state={profileAlert} />}
                            </AnimatePresence>

                            <Button
                                onClick={handleSaveProfile}
                                disabled={profilePending}
                                className="w-full rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-black"
                            >
                                {profilePending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                {profilePending ? "Saving..." : "Save Changes"}
                            </Button>
                        </div>
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
                        <div className={`p-5 rounded-2xl border shadow-sm ${user.emailVerified
                            ? "bg-emerald-50/60 border-emerald-200/60"
                            : "bg-amber-50/60 border-amber-200/60"
                            }`}>
                            <div className="flex items-start gap-4">
                                <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${user.emailVerified ? "bg-emerald-100" : "bg-amber-100"}`}>
                                    {user.emailVerified
                                        ? <ShieldCheck className="h-5 w-5 text-emerald-600" />
                                        : <ShieldAlert className="h-5 w-5 text-amber-500" />
                                    }
                                </div>
                                <div className="flex-1 space-y-1">
                                    <p className={`font-black text-sm ${user.emailVerified ? "text-emerald-700" : "text-amber-700"}`}>
                                        Email {user.emailVerified ? "Verified" : "Not Verified"}
                                    </p>
                                    <p className={`text-xs ${user.emailVerified ? "text-emerald-600" : "text-amber-600"}`}>
                                        {user.emailVerified
                                            ? `Your email ${user.email} is verified and active.`
                                            : `Please verify your email to unlock all features.`
                                        }
                                    </p>

                                    {!user.emailVerified && (
                                        <div className="pt-2">
                                            {verificationSent ? (
                                                <motion.p
                                                    initial={{ opacity: 0 }}
                                                    animate={{ opacity: 1 }}
                                                    className="flex items-center gap-1.5 text-xs font-bold text-emerald-600"
                                                >
                                                    <CheckCircle2 className="h-4 w-4" />
                                                    Verification email sent! Check your inbox.
                                                </motion.p>
                                            ) : (
                                                <Button
                                                    size="sm"
                                                    onClick={handleSendVerification}
                                                    disabled={verificationPending}
                                                    className="rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold"
                                                >
                                                    {verificationPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                                                    {verificationPending ? "Sending..." : "Send Verification Email"}
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Change Password */}
                        <div className="p-5 rounded-2xl border border-border/60 bg-card shadow-sm space-y-5">
                            <div>
                                <p className="font-black text-sm flex items-center gap-2">
                                    <Lock className="h-4 w-4 text-rose-500" /> Change Password
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">Ensure your account uses a strong, unique password.</p>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Current Password</label>
                                <PasswordInput
                                    placeholder="Enter current password..."
                                    value={currentPassword}
                                    onChange={setCurrentPassword}
                                />
                            </div>

                            <div className="h-px bg-border/60" />

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">New Password</label>
                                <PasswordInput
                                    placeholder="Enter new password..."
                                    value={newPassword}
                                    onChange={setNewPassword}
                                />
                                {newPassword.length > 0 && (
                                    <div className="flex gap-1 mt-1.5">
                                        {[8, 12, 16].map((len, i) => (
                                            <div
                                                key={len}
                                                className={`h-1 flex-1 rounded-full transition-colors ${newPassword.length >= [8, 12, 16][i]
                                                    ? i === 0 ? "bg-rose-400" : i === 1 ? "bg-amber-400" : "bg-emerald-400"
                                                    : "bg-muted"
                                                    }`}
                                            />
                                        ))}
                                        <span className="text-xs text-muted-foreground ml-1">
                                            {newPassword.length < 8 ? "Weak" : newPassword.length < 12 ? "Fair" : newPassword.length < 16 ? "Good" : "Strong"}
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Confirm New Password</label>
                                <PasswordInput
                                    placeholder="Confirm new password..."
                                    value={confirmPassword}
                                    onChange={setConfirmPassword}
                                />
                                {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                                    <p className="text-xs text-rose-500 font-semibold flex items-center gap-1">
                                        <AlertTriangle className="h-3 w-3" /> Passwords do not match
                                    </p>
                                )}
                            </div>

                            <AnimatePresence>
                                {passwordAlert && <Alert state={passwordAlert} />}
                            </AnimatePresence>

                            <Button
                                onClick={handleChangePassword}
                                disabled={passwordPending}
                                className="w-full rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-black"
                            >
                                {passwordPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                {passwordPending ? "Updating..." : "Update Password"}
                            </Button>
                        </div>

                        {/* Reset Password */}
                        <div className="p-5 rounded-2xl border border-border/60 bg-card shadow-sm">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <p className="font-black text-sm flex items-center gap-2">
                                        <KeyRound className="h-4 w-4 text-rose-500" /> Forgot Password?
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        Send a password reset link to <span className="font-semibold text-foreground">{user.email}</span>
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleRequestPasswordReset}
                                    disabled={passwordPending}
                                    className="flex items-center gap-1.5 text-xs font-bold text-rose-500 hover:text-rose-600 transition-colors disabled:opacity-50"
                                >
                                    {passwordPending
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        : <>Send Link <ChevronRight className="h-3.5 w-3.5" /></>
                                    }
                                </button>
                            </div>
                        </div>
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
                        <div className="p-5 rounded-2xl border border-border/60 bg-card shadow-sm space-y-4">
                            <p className="font-black text-sm flex items-center gap-2">
                                <KeyRound className="h-4 w-4 text-rose-500" /> Account Details
                            </p>
                            <div className="space-y-3">
                                {[
                                    { label: "Full Name", value: user.name },
                                    { label: "Email", value: user.email },
                                    { label: "Email Status", value: user.emailVerified ? "Verified" : "Not Verified" },
                                ].map(({ label, value }) => (
                                    <div key={label} className="flex items-center justify-between py-2.5 border-b border-border/40 last:border-0">
                                        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{label}</span>
                                        <span className={`text-sm font-semibold ${label === "Email Status" && !user.emailVerified ? "text-amber-500" : label === "Email Status" ? "text-emerald-600" : ""}`}>
                                            {value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Danger Zone */}
                        <div className="p-5 rounded-2xl border border-rose-200/60 bg-rose-50/40 shadow-sm space-y-4">
                            <div>
                                <p className="font-black text-sm text-rose-700 flex items-center gap-2">
                                    <AlertTriangle className="h-4 w-4" /> Danger Zone
                                </p>
                                <p className="text-xs text-rose-500 mt-1">Irreversible actions. Proceed with caution.</p>
                            </div>

                            <div className="flex items-center justify-between p-4 rounded-xl bg-background border border-rose-200/60">
                                <div className="space-y-0.5">
                                    <p className="text-sm font-bold">Delete Account</p>
                                    <p className="text-xs text-muted-foreground">Permanently delete your account and all associated data.</p>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="rounded-xl border-rose-300 text-rose-600 hover:bg-rose-50 hover:border-rose-400 font-bold"
                                >
                                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                                    Delete
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
