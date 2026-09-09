'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * The date window, as a plain two-input form.
 *
 * A router.push rather than a native GET form so the page re-renders as a
 * client navigation — the audit query is the slow part and Next keeps the
 * current screen up while it runs, instead of blanking to a white document.
 */
export function RangeForm({
  outletId,
  from,
  to,
}: {
  outletId: string;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const [fromValue, setFromValue] = useState(from);
  const [toValue, setToValue] = useState(to);

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-md border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const q = new URLSearchParams({ from: fromValue, to: toValue });
        router.push(`/auditowners/${outletId}?${q}`);
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Dari tanggal
        <Input
          type="date"
          value={fromValue}
          onChange={(e) => setFromValue(e.target.value)}
          className="w-44"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Sampai tanggal
        <Input
          type="date"
          value={toValue}
          onChange={(e) => setToValue(e.target.value)}
          className="w-44"
          required
        />
      </label>
      <Button type="submit">Tampilkan</Button>
      <p className="basis-full text-xs text-muted-foreground">
        Maksimal 3 bulan sekali tampil. Kosongkan alamat halaman untuk kembali ke 30 hari terakhir.
      </p>
    </form>
  );
}
