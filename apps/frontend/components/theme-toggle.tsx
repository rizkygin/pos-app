'use client';

import { useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';

const ORDER = ['light', 'dark', 'system'] as const;
const LABEL: Record<(typeof ORDER)[number], string> = {
  light: 'Mode terang',
  dark: 'Mode gelap',
  system: 'Ikuti sistem',
};

const noop = () => () => {};

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  // `theme` is undefined until next-themes reads localStorage on the client.
  // Render the placeholder icon until then so SSR and the first client paint
  // agree — otherwise React warns about a hydration mismatch. The store never
  // changes; it just reports server (false) vs client (true).
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

  const current = (mounted && theme ? theme : 'system') as (typeof ORDER)[number];
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];

  const Icon = current === 'light' ? Sun : current === 'dark' ? Moon : Monitor;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className}
      title={LABEL[current]}
      aria-label={`${LABEL[current]}. Ubah ke ${LABEL[next].toLowerCase()}`}
      onClick={() => setTheme(next)}
    >
      <Icon aria-hidden />
    </Button>
  );
}
