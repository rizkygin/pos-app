'use client';

import { useState } from 'react';
import { motion } from 'motion/react';
import { Bell, BellOff, BellRing, Loader2, Send, ShieldAlert } from 'lucide-react';
import { usePushSubscription } from '@/lib/use-push-subscription';

/**
 * Permanent control for background order notifications — lives in Settings so
 * an owner can always find it, independent of the one-time nudge banner (see
 * push-notification-nudge.tsx) which only appears until answered once.
 */
export function PushNotificationCard() {
  const { state, busy, subscribe, unsubscribe, sendTest } = usePushSubscription();
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    const ok = await sendTest();
    setTestResult(
      ok
        ? { ok: true, text: 'Notifikasi tes dikirim — cek layar perangkatmu.' }
        : { ok: false, text: 'Gagal mengirim notifikasi tes.' },
    );
    setTesting(false);
  }

  if (state === 'unsupported') {
    return (
      <div className="p-5 rounded-2xl border border-border/60 bg-card shadow-sm space-y-1">
        <p className="font-black flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" /> Notifikasi Pesanan Baru
        </p>
        <p className="text-xs text-muted-foreground">
          Browser ini tidak mendukung notifikasi latar belakang. Coba Chrome, Edge, atau Safari versi terbaru.
        </p>
      </div>
    );
  }

  return (
    <div className="p-5 rounded-2xl border border-border/60 bg-card shadow-sm space-y-4">
      <div>
        <p className="font-black flex items-center gap-2">
          <BellRing className="h-4 w-4 text-rose-500" /> Notifikasi Pesanan Baru
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Dapatkan notifikasi dan bunyi peringatan di perangkat ini setiap ada pesanan masuk — walaupun aplikasi ditutup.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2.5">
          {state === 'subscribed' ? (
            <Bell className="h-4 w-4 text-emerald-500" />
          ) : (
            <BellOff className="h-4 w-4 text-muted-foreground" />
          )}
          <div>
            <p className="text-sm font-bold">
              {state === 'subscribed' && 'Notifikasi aktif di perangkat ini'}
              {state === 'unsubscribed' && 'Notifikasi belum diaktifkan'}
              {state === 'default' && 'Belum diminta izin'}
              {state === 'denied' && 'Izin notifikasi ditolak'}
              {state === 'unconfigured' && 'Notifikasi belum dikonfigurasi server'}
            </p>
            {state === 'denied' && (
              <p className="text-xs text-muted-foreground">
                Izinkan notifikasi untuk situs ini lewat pengaturan browser, lalu muat ulang halaman.
              </p>
            )}
          </div>
        </div>

        {(state === 'default' || state === 'unsubscribed') && (
          <button
            type="button"
            onClick={subscribe}
            disabled={busy}
            className="shrink-0 flex items-center gap-1.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold px-4 py-2 transition-colors disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
            Aktifkan
          </button>
        )}
        {state === 'subscribed' && (
          <button
            type="button"
            onClick={unsubscribe}
            disabled={busy}
            className="shrink-0 rounded-xl border border-border/60 text-xs font-bold px-4 py-2 hover:bg-muted transition-colors disabled:opacity-60"
          >
            Matikan
          </button>
        )}
      </div>

      {state === 'subscribed' && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
          >
            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Kirim notifikasi tes
          </button>
          {testResult && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className={`text-xs font-medium ${testResult.ok ? 'text-emerald-600' : 'text-rose-500'}`}
            >
              {testResult.text}
            </motion.p>
          )}
        </div>
      )}
    </div>
  );
}
