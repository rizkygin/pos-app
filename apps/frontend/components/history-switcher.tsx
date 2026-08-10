'use client';

import Link from 'next/link';
import { Receipt, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Switches between the two history screens.
 *
 * Exists because the bottom nav is full: it caps at five tabs by design ("a
 * sixth makes each target narrower than a thumb"), and the sidebar — which does
 * carry a Riwayat Suruh Kurir row — is hidden on portrait phones. Without this
 * control the errand history would be desktop-only, which is backwards for a
 * feature whose customers are on phones.
 *
 * Two links rather than tabs with state: each screen is its own route, so the
 * browser back button behaves and a link can be shared.
 */
export function HistorySwitcher({ active }: { active: 'order' | 'errand' }) {
  const items = [
    { key: 'order' as const, label: 'Pesanan', href: '/dashboard/history-order', icon: Receipt },
    { key: 'errand' as const, label: 'Suruh Kurir', href: '/dashboard/history-errand', icon: Truck },
  ];

  return (
    <div className="mb-4 inline-flex w-full gap-1 rounded-full border bg-muted/50 p-1 sm:w-auto">
      {items.map((item) => {
        const isActive = item.key === active;
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-colors sm:flex-none',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
