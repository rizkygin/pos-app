'use client';

import { useState } from 'react';
import QRCode from 'react-qr-code';
import { AlertTriangle, CheckCircle2, Copy, Download, KeyRound, Laptop, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DashboardHeader } from '@/components/dashboard-header';
import { LocalDateTime } from '@/components/local-datetime';
import { API_URL } from '@/lib/api-url';
import { authClient } from '@/lib/auth-client';

// better-auth error codes from /two-factor/*, reworded for this page.
const ERRORS: Record<string, string> = {
  INVALID_PASSWORD: 'Password salah.',
  INVALID_CODE: 'Kode salah. Pastikan jam di HP tepat, lalu coba kode yang baru muncul.',
  TOTP_NOT_ENABLED: 'Pengaturan belum dimulai. Ulangi dari langkah pertama.',
};

function errorText(error: { code?: string; message?: string; status?: number }) {
  if (error.status === 429) return 'Terlalu cepat. Tunggu beberapa detik lalu coba lagi.';
  return (error.code && ERRORS[error.code]) || error.message || 'Terjadi kesalahan.';
}

// The secret inside otpauth://totp/...?secret=XXXX, grouped by four so it can
// be typed into an authenticator that cannot scan.
function manualSecret(totpURI: string) {
  try {
    const secret = new URL(totpURI).searchParams.get('secret') ?? '';
    return secret.replace(/(.{4})/g, '$1 ').trim();
  } catch {
    return '';
  }
}

type Step =
  | { name: 'start' }
  | { name: 'scan'; totpURI: string; backupCodes: string[] }
  | { name: 'codes'; backupCodes: string[]; fresh: boolean };

export type AdminSecurityStatus = {
  adminSessionExpiresAt: string;
  stepUpValidUntil: string | null;
  devices: {
    id: number;
    device: string;
    ip: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
    current: boolean;
  }[];
};

export function AdminSecuritySetting({
  enabled,
  security,
}: {
  enabled: boolean;
  /** Only once enrolled: the backend refuses this to an admin without 2FA. */
  security: AdminSecurityStatus | null;
}) {
  const [step, setStep] = useState<Step>({ name: 'start' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [signOutState, setSignOutState] = useState<{ pending: boolean; text: string | null }>({
    pending: false,
    text: null,
  });

  const signOutOthers = async () => {
    setSignOutState({ pending: true, text: null });
    try {
      const res = await fetch(`${API_URL}/api/admin/security/sign-out-others`, {
        method: 'POST',
        credentials: 'include',
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? 'Gagal');
      setSignOutState({
        pending: false,
        text: body.ended ? `${body.ended} sesi lain sudah dikeluarkan.` : 'Tidak ada sesi lain yang aktif.',
      });
    } catch (e) {
      setSignOutState({ pending: false, text: e instanceof Error ? e.message : 'Gagal' });
    }
  };

  const run = async (fn: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan.');
    } finally {
      setPending(false);
    }
  };

  const start = () =>
    run(async () => {
      const { data, error } = await authClient.twoFactor.enable({ password });
      if (error) throw new Error(errorText(error));
      setPassword('');
      setStep({ name: 'scan', totpURI: data.totpURI, backupCodes: data.backupCodes });
    });

  const confirm = (backupCodes: string[]) =>
    run(async () => {
      const { error } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, '') });
      if (error) throw new Error(errorText(error));
      setCode('');
      setStep({ name: 'codes', backupCodes, fresh: true });
    });

  const regenerate = () =>
    run(async () => {
      const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
      if (error) throw new Error(errorText(error));
      setPassword('');
      setSaved(false);
      setStep({ name: 'codes', backupCodes: data.backupCodes, fresh: false });
    });

  const copyCodes = async (codes: string[]) => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Gagal menyalin. Salin manual atau unduh berkasnya.');
    }
  };

  const downloadCodes = (codes: string[]) => {
    const text = `Kode cadangan Ulun Pesan (admin)\nSetiap kode hanya bisa dipakai sekali.\n\n${codes.join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ulunpesan-kode-cadangan.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const errorBox = error && (
    <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <p>{error}</p>
    </div>
  );

  const passwordField = (onSubmit: () => void, label: string) => (
    <form
      className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label className="flex flex-1 flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">Password akun</span>
        <Input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      <Button type="submit" disabled={pending || !password}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        {label}
      </Button>
    </form>
  );

  return (
    <div className="pb-16">
      <DashboardHeader
        title="Keamanan Admin"
        description="Verifikasi dua langkah wajib untuk akun admin. Setelah password, login juga meminta kode dari aplikasi authenticator di HP."
      />

      {!enabled && step.name !== 'codes' && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p className="text-sm">
            Menu admin terkunci sampai verifikasi dua langkah aktif. Siapkan aplikasi authenticator
            di HP, misalnya Google Authenticator, Microsoft Authenticator, atau 1Password.
          </p>
        </div>
      )}

      {enabled && step.name === 'start' && (
        <section className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="size-5" />
            <h2 className="text-lg font-semibold">Verifikasi dua langkah aktif</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Setiap login ke akun ini meminta kode dari aplikasi authenticator. Kalau HP hilang, pakai
            salah satu kode cadangan di halaman login.
          </p>

          {security && (
            <p className="mt-4 text-sm text-muted-foreground">
              Hak admin di sesi ini berlaku sampai{' '}
              <span className="font-medium text-foreground">
                <LocalDateTime value={security.adminSessionExpiresAt} />
              </span>{' '}
              (12 jam sejak login). Setelah itu Anda diminta login ulang. Tindakan berisiko, seperti
              menghapus data atau mengonfirmasi pembayaran, selalu meminta password lagi.
            </p>
          )}

          <h3 className="mt-6 font-medium text-foreground">Buat ulang kode cadangan</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Kode cadangan yang lama langsung tidak berlaku lagi.
          </p>
          {passwordField(regenerate, 'Buat kode baru')}
          {errorBox}
        </section>
      )}

      {enabled && step.name === 'start' && security && (
        <section className="mt-6 rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-2">
            <Laptop className="size-5 text-foreground" />
            <h2 className="text-lg font-semibold text-foreground">Perangkat yang pernah dipakai</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Login dari perangkat yang belum ada di daftar ini mengirim email peringatan ke alamat akun ini.
          </p>
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
            {security.devices.length === 0 && (
              <li className="p-3 text-sm text-muted-foreground">Belum ada perangkat tercatat.</li>
            )}
            {security.devices.map((d) => (
              <li key={d.id} className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <span className="font-medium text-foreground">{d.device}</span>
                  {d.current && (
                    <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                      Perangkat ini
                    </span>
                  )}
                  <div className="text-xs text-muted-foreground">
                    Pertama <LocalDateTime value={d.firstSeenAt} />
                    {d.ip ? ` · IP ${d.ip}` : ''}
                  </div>
                </div>
                <div className="shrink-0 text-xs text-muted-foreground">
                  Terakhir login <LocalDateTime value={d.lastSeenAt} />
                </div>
              </li>
            ))}
          </ul>

          <h3 className="mt-6 font-medium text-foreground">Keluarkan semua perangkat lain</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Mengakhiri semua sesi akun ini kecuali yang sedang Anda pakai. Pakai ini kalau ada login yang
            bukan Anda, lalu ganti password.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            disabled={signOutState.pending}
            onClick={signOutOthers}
          >
            {signOutState.pending ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
            Keluarkan perangkat lain
          </Button>
          {signOutState.text && <p className="mt-2 text-sm text-foreground">{signOutState.text}</p>}
        </section>
      )}

      {!enabled && step.name === 'start' && (
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground">1. Konfirmasi password</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Untuk memastikan yang memasang verifikasi dua langkah adalah pemilik akun ini.
          </p>
          {passwordField(start, 'Lanjut')}
          {errorBox}
        </section>
      )}

      {step.name === 'scan' && (
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground">2. Pindai kode QR</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Buka aplikasi authenticator, pilih tambah akun, lalu pindai kode ini.
          </p>
          <div className="mt-5 flex flex-col gap-6 sm:flex-row sm:items-start">
            {/* Stays white in dark mode: scanners need dark-on-light. */}
            <div className="w-fit rounded-lg bg-white p-3">
              <QRCode value={step.totpURI} size={176} />
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-muted-foreground">Tidak bisa memindai? Masukkan kunci ini secara manual:</p>
              <p className="mt-2 break-all rounded-md bg-muted px-3 py-2 font-mono text-foreground">
                {manualSecret(step.totpURI)}
              </p>
            </div>
          </div>

          <h2 className="mt-8 text-lg font-semibold text-foreground">3. Masukkan kode dari aplikasi</h2>
          <form
            className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              confirm(step.backupCodes);
            }}
          >
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-foreground">Kode 6 angka</span>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="w-40 text-center font-mono tracking-widest"
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </label>
            <Button type="submit" disabled={pending || code.replace(/\s/g, '').length !== 6}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Aktifkan
            </Button>
          </form>
          {errorBox}
        </section>
      )}

      {step.name === 'codes' && (
        <section className="rounded-xl border border-border bg-card p-6">
          {step.fresh && (
            <div className="mb-5 flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-5" />
              <p className="font-semibold">Verifikasi dua langkah aktif.</p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <KeyRound className="size-5 text-foreground" />
            <h2 className="text-lg font-semibold text-foreground">Simpan kode cadangan</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Kalau HP hilang, setiap kode ini bisa dipakai sekali sebagai pengganti kode authenticator.
            Kode ini hanya ditampilkan sekarang. Simpan di tempat aman, terpisah dari HP.
          </p>
          <ul className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-muted p-4 font-mono text-sm text-foreground sm:grid-cols-5">
            {step.backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => copyCodes(step.backupCodes)}>
              <Copy className="size-4" />
              {copied ? 'Tersalin' : 'Salin'}
            </Button>
            <Button type="button" variant="outline" onClick={() => downloadCodes(step.backupCodes)}>
              <Download className="size-4" />
              Unduh .txt
            </Button>
          </div>
          <label className="mt-6 flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            Saya sudah menyimpan kode cadangan ini
          </label>
          <Button
            type="button"
            className="mt-4"
            disabled={!saved}
            // Full load: enrolling rotated the session cookie, and the server
            // components need to see the new two-factor state.
            onClick={() => (window.location.href = step.fresh ? '/dashboard/admin' : '/dashboard/admin/security')}
          >
            Selesai
          </Button>
          {errorBox}
        </section>
      )}
    </div>
  );
}
