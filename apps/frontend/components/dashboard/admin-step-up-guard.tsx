'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { API_URL } from '@/lib/api-url';

// The backend answers a risky admin action with 403 ADMIN_REAUTH_REQUIRED
// until the password has been re-entered on this session (lib/admin-access.ts
// there), and any admin call with 401 ADMIN_SESSION_EXPIRED once the admin's
// 12 hours are up. Rather than teach every admin screen both answers, this
// wraps window.fetch while an admin page is mounted:
//   - ADMIN_REAUTH_REQUIRED → ask for the password, confirm it, then resend
//     the original request and hand ITS response to the caller. Cancelling
//     hands back the 403, whose `error` text the screen already shows.
//   - ADMIN_SESSION_EXPIRED → off to sign in again.
// The backend is the one enforcing; this only spares the admin a dead end.

type Prompt = { resolve: (confirmed: boolean) => void };

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function adminCode(res: Response): Promise<string | null> {
  if (res.status !== 401 && res.status !== 403) return null;
  try {
    const body = await res.clone().json();
    return typeof body?.code === 'string' ? body.code : null;
  } catch {
    return null;
  }
}

export function AdminStepUpGuard() {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const originalFetch = useRef<typeof fetch | null>(null);

  useEffect(() => {
    const original = window.fetch;
    originalFetch.current = original;
    // Several requests can hit the check at once; they share one prompt.
    let waiting: Promise<boolean> | null = null;

    window.fetch = async (input, init) => {
      if (!API_URL || !requestUrl(input).startsWith(API_URL)) return original(input, init);

      // A Request's body can be read once; keep a copy for the resend.
      const retryInput = input instanceof Request ? input.clone() : input;
      const res = await original(input, init);
      const code = await adminCode(res);

      if (code === 'ADMIN_SESSION_EXPIRED') {
        window.location.href = '/login?reauth=admin';
        return res;
      }
      if (code !== 'ADMIN_REAUTH_REQUIRED') return res;

      waiting ??= new Promise<boolean>((resolve) => setPrompt({ resolve })).finally(() => {
        waiting = null;
      });
      return (await waiting) ? original(retryInput, init) : res;
    };

    return () => {
      window.fetch = original;
    };
  }, []);

  const close = (confirmed: boolean) => {
    prompt?.resolve(confirmed);
    setPrompt(null);
    setPassword('');
    setError(null);
  };

  const confirm = async () => {
    const send = originalFetch.current ?? fetch;
    setPending(true);
    setError(null);
    try {
      const res = await send(`${API_URL}/api/admin/reauth`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? 'Konfirmasi gagal.');
        return;
      }
      close(true);
    } catch {
      setError('Tidak bisa menghubungi server.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={prompt !== null} onOpenChange={(open) => !open && close(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-amber-600 dark:text-amber-400" />
            Konfirmasi password
          </DialogTitle>
          <DialogDescription>
            Tindakan ini berisiko, jadi perlu password akun Anda. Setelah itu tindakan berisiko lain
            tidak akan menanyakannya lagi selama 15 menit.
          </DialogDescription>
        </DialogHeader>
        <form
          id="admin-step-up-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) confirm();
          }}
        >
          <Input
            type="password"
            autoComplete="current-password"
            autoFocus
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)} disabled={pending}>
            Batal
          </Button>
          <Button type="submit" form="admin-step-up-form" disabled={pending || !password}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Konfirmasi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
