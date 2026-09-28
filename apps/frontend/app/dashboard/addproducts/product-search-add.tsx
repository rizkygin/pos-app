'use client';

import { forwardRef, useId, useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';

export type PickerOption = {
  id: string;
  name: string;
  /** Second line — stock, unit, kind: whatever tells two similar names apart. */
  meta?: string;
  /** Section it is listed under. Sections show in the `groups` order. */
  group: string;
};

type Props = {
  options: PickerOption[];
  /** Section order. The first is what an empty search suggests. */
  groups: string[];
  /** Already on the list: still shown, so the owner sees it is there, but not pickable twice. */
  taken?: Set<string>;
  onPick: (id: string) => void;
  placeholder: string;
};

// With nothing typed, a handful from the likeliest section rather than the
// whole catalogue — a native <select> of eighty products was the thing being
// replaced here.
const SUGGEST = 8;
const MAX_RESULTS = 50;

const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Search box that adds a product to a list: type, then click or Enter.
 *
 * The results list renders inline under the box instead of floating, so it
 * works the same inside the scrolling add-on dialog and on a phone, with no
 * popover to clip or position. Enter never reaches the surrounding product
 * form — it picks, or does nothing.
 */
export const ProductSearchAdd = forwardRef<HTMLInputElement, Props>(
  function ProductSearchAdd({ options, groups, taken, onPick, placeholder }, ref) {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState<string | null>(null);
    const listId = useId();

    const q = fold(query.trim());
    const words = q ? q.split(/\s+/) : [];

    const results = useMemo(() => {
      const rank = (g: string) => {
        const i = groups.indexOf(g);
        return i < 0 ? groups.length : i;
      };
      const byName = (a: PickerOption, b: PickerOption) => a.name.localeCompare(b.name, 'id');
      if (!q) {
        const first = options.filter((o) => rank(o.group) === 0);
        return [...(first.length ? first : options)].sort(byName).slice(0, SUGGEST);
      }
      const terms = q.split(/\s+/);
      return options
        .map((o) => ({ o, n: fold(o.name) }))
        .filter(({ n }) => terms.every((w) => n.includes(w)))
        .sort(
          (a, b) =>
            rank(a.o.group) - rank(b.o.group) ||
            Number(b.n.startsWith(terms[0])) - Number(a.n.startsWith(terms[0])) ||
            byName(a.o, b.o),
        )
        .slice(0, MAX_RESULTS)
        .map(({ o }) => o);
    }, [q, options, groups]);

    const pickable = results.filter((o) => !taken?.has(o.id));
    const optionId = (id: string) => `${listId}-${id}`;

    const pick = (id: string) => {
      onPick(id);
      setQuery('');
      setActive(null);
    };

    const move = (dir: 1 | -1) => {
      if (pickable.length === 0) return;
      const at = pickable.findIndex((o) => o.id === active);
      const next =
        at < 0
          ? dir === 1
            ? 0
            : pickable.length - 1
          : (at + dir + pickable.length) % pickable.length;
      const id = pickable[next].id;
      setActive(id);
      document.getElementById(optionId(id))?.scrollIntoView({ block: 'nearest' });
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setOpen(true);
        move(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Enter') {
        // Inside the product form: an Enter that fell through would save it.
        e.preventDefault();
        const target = pickable.find((o) => o.id === active) ?? (pickable.length === 1 ? pickable[0] : null);
        if (target) pick(target.id);
      } else if (e.key === 'Escape') {
        if (query) e.preventDefault();
        if (query) setQuery('');
        else setOpen(false);
        setActive(null);
      }
    };

    // Bold the first typed word where it appears, so the eye lands on why
    // each row matched. Skipped for names whose accents change their length.
    const highlight = (name: string) => {
      if (!words.length) return name;
      const folded = fold(name);
      const at = folded.indexOf(words[0]);
      if (at < 0 || folded.length !== name.length) return name;
      return (
        <>
          {name.slice(0, at)}
          <mark className="rounded-sm bg-amber-200/70 text-inherit dark:bg-amber-500/30">
            {name.slice(at, at + words[0].length)}
          </mark>
          {name.slice(at + words[0].length)}
        </>
      );
    };

    let lastGroup = '';

    return (
      <div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={ref}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActive(null);
            }}
            // A highlight never outlives the list it was made in: reopened, the
            // first ArrowDown starts from the top again.
            onFocus={() => {
              setOpen(true);
              setActive(null);
            }}
            // Clicking back into a box closed with Escape reopens it.
            onMouseDown={() => setOpen(true)}
            onBlur={() => {
              setOpen(false);
              setActive(null);
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active ? optionId(active) : undefined}
            autoComplete="off"
            placeholder={placeholder}
            className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
        </div>

        {open && (
          <div
            id={listId}
            role="listbox"
            className="mt-1.5 max-h-64 overflow-y-auto rounded-xl border bg-background p-1 shadow-sm"
          >
            {results.length === 0 ? (
              <p className="px-3 py-2.5 text-xs text-muted-foreground">
                {q ? <>Tidak ada yang cocok dengan &ldquo;{query.trim()}&rdquo;.</> : 'Belum ada produk.'}
              </p>
            ) : (
              results.map((o) => {
                const isTaken = !!taken?.has(o.id);
                const header = o.group !== lastGroup;
                lastGroup = o.group;
                return (
                  <div key={o.id}>
                    {header && (
                      <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {o.group}
                        {!q && ' · saran'}
                      </p>
                    )}
                    <button
                      id={optionId(o.id)}
                      type="button"
                      role="option"
                      aria-selected={active === o.id}
                      aria-disabled={isTaken}
                      // Keep focus in the box: a blur first would close the
                      // list before the click lands.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => !isTaken && pick(o.id)}
                      // Move, not enter: a list that opens under a resting
                      // pointer must not pick up a highlight nobody asked for.
                      onMouseMove={() => !isTaken && active !== o.id && setActive(o.id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        isTaken
                          ? 'cursor-default opacity-50'
                          : active === o.id
                            ? 'bg-blue-50 dark:bg-blue-950/40'
                            : 'hover:bg-muted'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{highlight(o.name)}</span>
                        {o.meta && (
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {o.meta}
                          </span>
                        )}
                      </span>
                      {isTaken ? (
                        <span className="shrink-0 text-[11px] text-muted-foreground">sudah ada</span>
                      ) : (
                        <Plus className="h-4 w-4 shrink-0 text-blue-600" />
                      )}
                    </button>
                  </div>
                );
              })
            )}
            {!q && options.length > results.length && (
              <p className="px-3 pb-1.5 pt-2 text-[11px] text-muted-foreground">
                Ketik untuk mencari di semua {options.length} produk.
              </p>
            )}
          </div>
        )}
      </div>
    );
  },
);
