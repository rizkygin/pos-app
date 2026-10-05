"use client";
import { useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import { Eye, EyeOff } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { AboutUlunPesan } from "@/components/about-ulun-pesan";
import { notifyLogin } from "@/lib/native-bridge";

// better-auth two-factor error codes, in the page's own voice. Anything not
// listed falls back to the server message.
const TWO_FACTOR_ERRORS: Record<string, string> = {
  INVALID_CODE: "Kodenya salah. Cek lagi angka di aplikasi authenticator pian.",
  INVALID_BACKUP_CODE: "Kode cadangan salah, atau sudah pernah dipakai.",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "Terlalu banyak salah. Masuk ulang pakai email dan password.",
  INVALID_TWO_FACTOR_COOKIE: "Waktu verifikasi habis. Masuk ulang pakai email dan password.",
  ACCOUNT_TEMPORARILY_LOCKED: "Terlalu banyak kode salah. Akun dikunci 15 menit, coba lagi nanti.",
};

export default function LoginPage({ notice }: { notice?: string }) {
  const [isLogin, setIsLogin] = useState(true);
  // Second step, shown when the account has two-factor on: sign-in answered
  // { twoFactorRedirect } and no session exists until a code is verified.
  const [twoFactorStep, setTwoFactorStep] = useState(false);
  const [code, setCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMSG, setErrorMSG] = useState("");
  const [noticeMSG, setNoticeMSG] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMSG("");
    setNoticeMSG("");
    try {
      if (isLogin) {
        const { data, error } = await authClient.signIn.email({
          email,
          password,
          callbackURL: "/dashboard"
        });

        if (error) throw new Error(error.message);
        if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
          setTwoFactorStep(true);
          return;
        }
        // Inside the courier app this is the one moment a session cookie is
        // guaranteed fresh — tell the shell to mint its device token now,
        // rather than relying on it to notice on the next page load.
        // No-op in a plain browser; see lib/native-bridge.
        notifyLogin();
      } else {
        const { data, error } = await authClient.signUp.email({
          email,
          password,
          name,
          callbackURL: "/dashboard",
        }, {
          onError: (error :any) => {
            setErrorMSG(error.error.message);
            if (error) throw new Error(error.error.message);

          }
        });
        if (error) throw new Error(error.message);
        // Handle successful signup. Sign-up also fires a verification email —
        // the account works right away, but say so or the mail looks unprompted.
        setNoticeMSG(
          "Akun sudah jadi! Ulun kirimi tautan verifikasi ke email pian, dibuka lah."
        );
        setIsLogin(true);
      }
    } catch (err: any) {
      setErrorMSG(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMSG("");
    try {
      const { error } = useBackupCode
        ? await authClient.twoFactor.verifyBackupCode({ code: code.trim() })
        : await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
      if (error) {
        throw new Error((error.code && TWO_FACTOR_ERRORS[error.code]) || error.message || "Verifikasi gagal");
      }
      notifyLogin();
      // The session cookie only exists from this response on, so a full load
      // (not a client push) is what lets the server render the dashboard.
      window.location.href = "/dashboard";
    } catch (err) {
      setErrorMSG(err instanceof Error ? err.message : "Verifikasi gagal");
      setLoading(false);
    }
  };

  const leaveTwoFactorStep = () => {
    setTwoFactorStep(false);
    setCode("");
    setPassword("");
    setUseBackupCode(false);
    setErrorMSG("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f] overflow-hidden relative">
      {/* Background Decor */}

      {/* About / "Tentang Ulun Pesan" overlay trigger + modal */}
      <AboutUlunPesan />

      <div className="absolute top-1/3 left-1/3 -translate-x-1/2 -translate-y-1/2 w-[420px] h-[420px] bg-rose-600/20 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute top-2/3 left-2/3 -translate-x-1/2 -translate-y-1/2 w-[380px] h-[380px] bg-violet-600/20 blur-[120px] rounded-full pointer-events-none" />

      {/* wordmark home link (GitHub-style) */}
      <a href="/" className="absolute top-5 left-6 z-20 text-lg font-black tracking-tight text-white transition-opacity hover:opacity-80">
        UlunPesan
      </a>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="w-full max-w-md p-8 relative z-10"
      >
        <div className="backdrop-blur-xl bg-white/[0.04] border border-white/10 shadow-2xl rounded-3xl p-8 overflow-hidden">
          <div className="mb-8 text-center">
            <motion.div
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="mx-auto mb-4 flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl bg-white/10 ring-1 ring-white/15 shadow-lg"
            >
              <Image
                src="/icons/icon-192x192.png"
                alt="Ulun Pesan"
                width={80}
                height={80}
                priority
                className="h-full w-full object-contain"
              />
            </motion.div>
            <motion.h1
              layout
              className="text-3xl font-semibold tracking-tight text-white mb-2"
            >
              {twoFactorStep ? "Verifikasi Dua Langkah" : isLogin ? "Ulun Pesan" : "Buat Akun Hanyar"}
            </motion.h1>
            <motion.p layout className="text-zinc-400 text-sm">
              {twoFactorStep
                ? useBackupCode
                  ? "Masukkan salah satu kode cadangan pian"
                  : "Masukkan 6 angka dari aplikasi authenticator pian"
                : isLogin
                  ? "Masukkan Email Password Pian"
                  : "Masukkan Data Diri Pian biar ulun kenal"}
            </motion.p>
          </div>
          {twoFactorStep ? (
            <form onSubmit={handleVerifyCode} className="space-y-4">
              <motion.div layout>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5 ml-1">
                  {useBackupCode ? "Kode Cadangan" : "Kode Verifikasi"}
                </label>
                <input
                  key={useBackupCode ? "backup" : "totp"}
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode={useBackupCode ? "text" : "numeric"}
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={useBackupCode ? 32 : 6}
                  className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/40 transition-all font-medium tracking-widest text-center text-lg"
                  placeholder={useBackupCode ? "xxxxx-xxxxx" : "000000"}
                  required
                />
              </motion.div>
              {errorMSG && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-red-400 text-sm font-medium bg-red-400/10 p-3 rounded-xl border border-red-400/20"
                >
                  {errorMSG}
                </motion.div>
              )}
              <motion.button
                layout
                type="submit"
                disabled={loading}
                className="w-full mt-6 bg-white text-black font-semibold py-3.5 px-4 rounded-2xl hover:bg-zinc-200 focus:outline-none focus:ring-4 focus:ring-white/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                ) : (
                  "Verifikasi"
                )}
              </motion.button>
              <motion.div layout className="flex items-center justify-between pt-2 text-sm">
                <button
                  type="button"
                  onClick={leaveTwoFactorStep}
                  className="text-zinc-400 hover:text-white font-medium transition-colors"
                >
                  Kembali
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUseBackupCode((v) => !v);
                    setCode("");
                    setErrorMSG("");
                  }}
                  className="text-zinc-400 hover:text-rose-300 font-medium transition-colors"
                >
                  {useBackupCode ? "Pakai kode authenticator" : "Pakai kode cadangan"}
                </button>
              </motion.div>
            </form>
          ) : (
          <>
          <form onSubmit={handleSubmit} className="space-y-4">
            <AnimatePresence mode="popLayout">
              {!isLogin && (
                <motion.div
                  key="name"
                  initial={{ opacity: 0, height: 0, scale: 0.95 }}
                  animate={{ opacity: 1, height: "auto", scale: 1 }}
                  exit={{ opacity: 0, height: 0, scale: 0.95 }}
                  transition={{ duration: 0.3 }}
                >
                  <label className="block text-sm font-medium text-zinc-300 mb-1.5 ml-1">
                    Nama Lengkap
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/40 transition-all font-medium"
                    placeholder="Nama Sampian"
                    required={!isLogin}
                  />
                </motion.div>
              )}
            </AnimatePresence>
            <motion.div layout>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5 ml-1">
                Alamat Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/40 transition-all font-medium"
                placeholder="Email Pian"
                required
              />
            </motion.div>
            <motion.div layout>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5 ml-1">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 pr-12 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/40 transition-all font-medium"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white transition-colors p-1"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {isLogin && (
                <div className="mt-2 text-right">
                  <a
                    href="/forgot-password"
                    className="text-xs text-zinc-400 hover:text-rose-300 font-medium transition-colors"
                  >
                    Kada ingat password?
                  </a>
                </div>
              )}
            </motion.div>
            {errorMSG && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-red-400 text-sm font-medium bg-red-400/10 p-3 rounded-xl border border-red-400/20"
              >
                {errorMSG}
              </motion.div>
            )}
            {notice && isLogin && (
              <div className="text-amber-300 text-sm font-medium bg-amber-400/10 p-3 rounded-xl border border-amber-400/20">
                {notice}
              </div>
            )}
            {noticeMSG && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-emerald-400 text-sm font-medium bg-emerald-400/10 p-3 rounded-xl border border-emerald-400/20"
              >
                {noticeMSG}{" "}
                <a href="/verify-email" className="underline hover:text-emerald-300">
                  Kirim ulang
                </a>
              </motion.div>
            )}
            <motion.button
              layout
              type="submit"
              disabled={loading}
              className="w-full mt-6 bg-white text-black font-semibold py-3.5 px-4 rounded-2xl hover:bg-zinc-200 focus:outline-none focus:ring-4 focus:ring-white/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              ) : isLogin ? (
                "Masuk"
              ) : (
                "Mulai Daftar"
              )}
            </motion.button>
          </form>
          <motion.div layout className="mt-8 text-center text-zinc-400 text-sm">
            {isLogin ? "Belum Punya Akun? " : "Sudah Punya Akun? "}
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setErrorMSG("");
                setNoticeMSG("");
              }}
              className="text-white hover:text-rose-300 font-medium transition-colors"
            >
              {isLogin ? "Daftar" : "Login"}
            </button>
          </motion.div>
          </>
          )}

        </div>
      </motion.div>
    </div>
  );
}
