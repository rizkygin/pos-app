'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CATEGORY_PICKER_IN,
  CATEGORY_PICKER_OUT,
  type CashflowCategoryPicker,
} from '@/lib/cashflow-categories';

/**
 * Category choice for a Buku Kas entry, replacing an 18-line <select>.
 *
 * The chips are native radios under one name, so `required` is the browser's
 * own check, same as Metode. The "Lainnya" panel is hidden rather than
 * unmounted for the same reason: a category picked in there and then folded
 * away must still count as picked when the form submits.
 */
export function CategoryPicker({
  type,
  value,
  onChange,
}: {
  type: 'IN' | 'OUT';
  value: string;
  onChange: (category: string) => void;
}) {
  const picker: CashflowCategoryPicker =
    type === 'IN' ? CATEGORY_PICKER_IN : CATEGORY_PICKER_OUT;
  const [showMore, setShowMore] = useState(false);
  const pickedInMore = picker.groups
    .flatMap((g) => g.items)
    .find((o) => o.value === value);

  const chip = (o: { value: string; label: string }) => (
    <label
      key={o.value}
      // The stored name, for when the short label leaves it unclear.
      title={o.label !== o.value ? o.value : undefined}
      className="relative cursor-pointer select-none rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-2"
    >
      <input
        type="radio"
        name="cashflow-category"
        value={o.value}
        checked={value === o.value}
        onChange={() => onChange(o.value)}
        required
        className="sr-only"
      />
      {o.label}
    </label>
  );

  return (
    <div className="space-y-2">
      <span
        id="cashflow-category-label"
        className="block text-sm font-medium leading-none"
      >
        Kategori <span className="text-red-600 dark:text-red-400">*</span>
      </span>
      <div
        role="radiogroup"
        aria-labelledby="cashflow-category-label"
        aria-required="true"
        className="space-y-2.5 pt-1"
      >
        <div className="flex flex-wrap gap-2">{picker.common.map(chip)}</div>

        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 transition-transform',
              showMore && 'rotate-180',
            )}
          />
          Lainnya
          {!showMore && pickedInMore && (
            <span className="text-foreground">· {pickedInMore.label}</span>
          )}
        </button>

        <div hidden={!showMore} className="space-y-3 rounded-lg border p-3">
          {picker.groups.map((g) => (
            <div key={g.label} className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {g.label}
              </p>
              <div className="flex flex-wrap gap-2">{g.items.map(chip)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
