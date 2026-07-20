'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Store, ChevronDown, Check, Plus } from 'lucide-react';
import { API_URL } from '@/lib/api-url';

type OutletRow = { id: number; name: string; address: string; is_open: boolean };

// Owner-only outlet switcher. The active outlet lives in an httpOnly cookie
// set by the backend; switching reloads so every page refetches under the new
// outlet. Hidden entirely for single-outlet owners with no room to grow.
export function OutletSwitcher() {
  const [outlets, setOutlets] = useState<OutletRow[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [maxOutlets, setMaxOutlets] = useState(1);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/my-outlets`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.success) {
          setOutlets(j.data);
          setActiveId(j.active_id);
          setMaxOutlets(j.max_outlets ?? 1);
        }
      })
      .catch(() => {});
  }, []);

  // Nothing to switch and nothing to add → stay invisible.
  if (outlets.length <= 1 && maxOutlets <= 1) return null;
  const active = outlets.find((o) => o.id === activeId);

  const switchTo = async (id: number) => {
    if (id === activeId || switching) return;
    setSwitching(true);
    try {
      const res = await fetch(`${API_URL}/api/outlets/active`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outlet_id: id }),
      });
      if (res.ok) window.location.reload();
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="relative px-3 pb-1 group-data-[collapsible=icon]:hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-xl border bg-background px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-muted"
      >
        <Store className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />
        <span className="min-w-0 flex-1 truncate">{active?.name ?? 'Outlet'}</span>
        <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-3 top-full z-40 mt-1 overflow-hidden rounded-xl border bg-background shadow-xl">
            {outlets.map((o) => (
              <button
                key={o.id}
                onClick={() => switchTo(o.id)}
                disabled={switching}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                  o.id === activeId ? 'font-bold' : ''
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                {o.id === activeId && <Check className="size-3.5 shrink-0 text-emerald-600" />}
              </button>
            ))}
            <Link
              href="/dashboard/outlets"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 border-t px-3 py-2 text-sm font-semibold text-sky-600 transition-colors hover:bg-muted dark:text-sky-400"
            >
              <Plus className="size-3.5" /> Kelola Outlet
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
