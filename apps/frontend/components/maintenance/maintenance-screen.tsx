'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Wrench } from 'lucide-react';
import { useRemaining } from '@/components/maintenance/countdown';
import { DEFAULT_MAINTENANCE_MESSAGE, type Maintenance } from '@/lib/maintenance';

function formatClock(iso: string | null) {
  if (!iso) return null;
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(iso));
}

export function MaintenanceScreen({ maintenance }: { maintenance: Maintenance }) {
  const router = useRouter();
  const remaining = useRemaining(maintenance.endsAt);

  // The proxy rewrites every route here while the window is open, so the way
  // back is simply to reload once it closes. Poll instead of making the visitor
  // guess when to refresh.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(id);
  }, [router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
        <Wrench className="size-8" />
      </div>

      <h1 className="mt-8 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        Sedang dalam pemeliharaan
      </h1>

      <p className="mt-4 max-w-md text-balance text-sm leading-relaxed text-muted-foreground sm:text-base">
        {maintenance.message?.trim() || DEFAULT_MAINTENANCE_MESSAGE}
      </p>

      {remaining && (
        <p className="mt-8 text-sm text-muted-foreground">
          Perkiraan selesai dalam{' '}
          <span className="font-semibold text-foreground">{remaining}</span>
        </p>
      )}

      {maintenance.endsAt && (
        <p className="mt-1 text-xs text-muted-foreground/80">
          Sekitar {formatClock(maintenance.endsAt)} WIB
        </p>
      )}

      <p className="mt-10 text-xs text-muted-foreground/70">
        Halaman ini akan terbuka kembali dengan sendirinya. Terima kasih atas kesabarannya.
      </p>
    </main>
  );
}
