"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Eye, EyeOff } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export default function Home() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMSG, setErrorMSG] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMSG("");
    try {
      if (isLogin) {
        const { data, error } = await authClient.signIn.email({
          email,
          password,
          callbackURL: "/dashboard"
        });

        if (error) throw new Error(error.message);
        // Handle successful login
      } else {
        const { data, error } = await authClient.signUp.email({
          email,
          password,
          name,
          callbackURL: "/dashboard",
        }, {
          onError: (error) => {
            setErrorMSG(error.error.message);
            if (error) throw new Error(error.error.message);

          }
        });
        // Handle successful signup
        setIsLogin(!isLogin);
      }
    } catch (err: any) {
      setErrorMSG(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-background overflow-hidden relative">
      {/* Background Decor */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-br from-indigo-500/20 to-blue-500/20 blur-[120px] rounded-full pointer-events-none" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="w-full max-w-md p-8 relative z-10"
      >
        <div className="backdrop-blur-xl bg-foreground dark:bg-black/40 border border-white/10 dark:border-white/10 shadow-2xl rounded-3xl p-8 overflow-hidden">
          <div className="mb-8 text-center">
            <motion.h1
              layout
              className="text-3xl font-semibold tracking-tight text-white mb-2"
            >
              {isLogin ? "Ulun Pesan" : "Buat Akun Hanyar"}
            </motion.h1>
            <motion.p layout className="text-zinc-400 text-sm">
              {isLogin
                ? "Masukkan Email Password Pian"
                : "Masukkan Data Diri Pian biar ulun kenal"}
            </motion.p>
          </div>
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
                    className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-medium"
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
                className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-medium"
                placeholder="Email Sampian"
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
                  className="w-full px-4 py-3 pr-12 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-medium"
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
              }}
              className="text-white hover:text-indigo-300 font-medium transition-colors"
            >
              {isLogin ? "Daftar" : "Login"}
            </button>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
