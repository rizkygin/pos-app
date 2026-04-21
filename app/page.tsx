"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { authClient } from "@/lib/auth-client";

export default function Home() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMSG, setErrorMSG] = useState("");
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
              {isLogin ? "Welcome back" : "Create an account"}
            </motion.h1>
            <motion.p layout className="text-zinc-400 text-sm">
              {isLogin
                ? "Enter your credentials to access your account"
                : "Enter your details to get started on your journey"}
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
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-medium"
                    placeholder="John Doe"
                    required={!isLogin}
                  />
                </motion.div>
              )}
            </AnimatePresence>
            <motion.div layout>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5 ml-1">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-medium"
                placeholder="you@example.com"
                required
              />
            </motion.div>
            <motion.div layout>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5 ml-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-medium"
                placeholder="••••••••"
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
              ) : isLogin ? (
                "Sign In"
              ) : (
                "Get Started"
              )}
            </motion.button>
          </form>
          <motion.div layout className="mt-8 text-center text-zinc-400 text-sm">
            {isLogin ? "Don't have an account? " : "Already have an account? "}
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setErrorMSG("");
              }}
              className="text-white hover:text-indigo-300 font-medium transition-colors"
            >
              {isLogin ? "Sign up" : "Sign in"}
            </button>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
