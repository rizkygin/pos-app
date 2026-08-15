'use client';

import Link from 'next/link';
import { CalendarClock, History, Home, ShoppingCart, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCurrentUrl } from '@/hooks/use-current-url';
import { cn } from '@/lib/utils';

type Tab = {
  name: string;
  url: string;
  icon: LucideIcon;
  /**
   * Extra subtrees this tab owns. Riwayat covers two sibling routes — outlet
   * orders and errands — that are reachable from each other via the switcher on
   * those pages. Without this, tapping through to the errand history would
   * leave every tab unlit, which reads as "you have navigated out of the app".
   */
  alsoMatch?: string[];
};

// Five is the ceiling — a sixth tab makes each target narrower than a thumb.
// These mirror the customer rows of the sidebar, plus the account page that
// used to sit behind the "User" collapsible.
const TABS: Tab[] = [
  { name: 'Beranda', url: '/dashboard', icon: Home },
  { name: 'Pesan', url: '/dashboard/order', icon: ShoppingCart },
  { name: 'Terjadwal', url: '/dashboard/scheduled-order', icon: CalendarClock },
  {
    name: 'Riwayat',
    url: '/dashboard/history-order',
    icon: History,
    alsoMatch: ['/dashboard/history-errand'],
  },
  { name: 'Akun', url: '/dashboard/user', icon: UserRound },
];

// /dashboard is the home tab, so it matches only itself. Every other tab owns
// its subtree — /dashboard/order/food keeps "Pesan" lit. The trailing slash
// matters: it stops /dashboard/order from claiming /dashboard/order-outlet.
function isTabActive(tab: Tab, pathname: string | null) {
  if (!pathname) return false;
  if (tab.url === '/dashboard') return pathname === '/dashboard';
  const owns = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  return owns(tab.url) || (tab.alsoMatch?.some(owns) ?? false);
}

export function CustomerBottomNav() {
  const pathname = useCurrentUrl();

  return (
    <nav
      aria-label="Navigasi utama"
      // Phones held upright only: `max-md` keeps it off tablets and desktop,
      // `portrait` keeps it from eating the little vertical room a landscape
      // phone has left. Both orientations still reach everything via the
      // sidebar, which is only hidden under this same condition.
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 hidden max-md:portrait:block',
        'border-t border-blue-100 bg-white/90 backdrop-blur-md',
        'shadow-[0_-6px_20px_-12px_rgba(29,78,216,0.35)]',
        'dark:border-blue-950/70 dark:bg-zinc-950/90',
      )}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="flex items-stretch">
        {TABS.map((tab) => {
          const active = isTabActive(tab, pathname);
          const Icon = tab.icon;
          return (
            <li key={tab.url} className="flex-1">
              <Link
                href={tab.url}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex h-16 flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-colors',
                  active
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-muted-foreground active:text-blue-600/70',
                )}
              >
                {active && (
                  <span className="absolute top-0 h-1 w-10 rounded-b-full bg-blue-600 dark:bg-blue-400" />
                )}
                <span
                  className={cn(
                    'flex size-9 items-center justify-center rounded-2xl transition-colors',
                    active && 'bg-blue-50 dark:bg-blue-950/60',
                  )}
                >
                  <Icon className="size-5" strokeWidth={active ? 2.4 : 2} />
                </span>
                <span className="leading-none">{tab.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
