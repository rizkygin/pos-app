import Link from "next/link";
import { Lock, ArrowRight } from "lucide-react";
import { getRole } from "./get-role";

// True when the caller's PLAN excludes `feature`. Expired subscriptions return
// false here — expiry is handled as read-only by the API (+ warning banner),
// not by hiding pages. Admins/roleless callers are never screened.
export async function featureBlocked(feature: string): Promise<boolean> {
  const role = await getRole();
  if (!role || !role.gate) return false;
  return role.gate.alive && role.gate.features?.[feature] !== true;
}

// Full-page upgrade prompt for a plan-bound feature.
export function UpgradeScreen({ label }: { label: string }) {
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="max-w-md rounded-3xl border p-8 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-rose-100 dark:bg-rose-950">
          <Lock className="size-5 text-rose-600 dark:text-rose-400" />
        </span>
        <h1 className="mt-4 text-xl font-bold">{label} tidak termasuk paket Pian</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Upgrade paket untuk membuka fitur ini — masa aktif yang tersisa
          dikonversi otomatis, tidak ada yang hangus.
        </p>
        <Link
          href="/dashboard/subscription"
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-rose-700"
        >
          Lihat Paket <ArrowRight className="size-4" />
        </Link>
      </div>
    </main>
  );
}
