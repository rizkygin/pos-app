'use client';

import { useMemo, useState } from 'react';
import { X, Check, Plus, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils/format';
import type { AddonGroup, CartAddon, Product } from './cashier-client';

/**
 * Everything a product asks when the cashier taps it, on one screen.
 *
 * TWO QUESTIONS OF DIFFERENT KINDS, and keeping them apart is the whole point
 * of this file:
 *
 *   WHICH ONE?   the variant. Ukuran: Reguler / Large / Jumbo. Answering it
 *                changes the product being sold — the cart line becomes a
 *                different products row, at its own price, with its own stock
 *                and its own cost. Exactly one answer, always.
 *   WHAT ELSE?   the add-ons. Topping, level pedas. Each answer adds a CHILD
 *                line beside the dish. Zero or many, per the group's rules.
 *
 * They share a screen because the cashier experiences them as one interruption
 * between tapping a product and getting back to the customer, and they share
 * nothing else. A "Large" that was modelled as a +6.000 add-on would report a
 * Reguler sold plus an abstract upsize, and take the extra milk out of nobody's
 * stock — see migration 0071.
 *
 * THIS IS THE ONLY PLACE min_select / max_select ARE ENFORCED, and that is
 * deliberate. The rules govern what a cashier may COMPOSE; they never govern
 * what checkout will settle. A tab parked before the owner made a group
 * mandatory must still be payable — see lib/addons.ts on the backend for the
 * other half of that rule.
 *
 * Add-on quantities here are PER UNIT of the parent line. One "Telur" on a line
 * of two nasi goreng means an egg on each; the server multiplies out (and is
 * the only thing that does, so no client can get the multiplication wrong).
 */

/** What a variant costs per unit — the same rule the cart applies. */
export const priceOf = (p: Product) =>
  p.price_mark_down && p.price_mark_down !== '0'
    ? parseFloat(p.price_mark_down)
    : parseFloat(p.price);

export function OptionPickerModal({
  product,
  variantLabel,
  variants,
  groups,
  onCancel,
  onConfirm,
}: {
  /** The base the cashier tapped. Its own row is the default variant. */
  product: Product;
  /** The question, e.g. "Ukuran". */
  variantLabel: string;
  /**
   * Base first, then its variants in menu order. Empty when the product has
   * none — the section then renders nothing at all rather than a one-option
   * question the cashier has to dismiss.
   */
  variants: Product[];
  groups: AddonGroup[];
  onCancel: () => void;
  onConfirm: (choice: { product: Product; addons: CartAddon[] }) => void;
}) {
  // Default to the base, or to the first variant that is actually in stock —
  // opening on a sold-out default would make the cashier's first tap a
  // correction. Sold out everywhere leaves the base selected and the button
  // disabled, which is the honest state.
  const [variantId, setVariantId] = useState<string>(() => {
    if (variants.length === 0) return product.id;
    return (variants.find((v) => v.isAvailable) ?? variants[0]).id;
  });
  const chosenVariant =
    variants.find((v) => v.id === variantId) ?? variants[0] ?? product;
  // Keyed by option id — the catalogue row, not the product, since the same
  // product can appear in two groups at two prices.
  const [picked, setPicked] = useState<Record<number, number>>({});

  const chosenIn = (group: AddonGroup) =>
    group.options.reduce((n, o) => n + (picked[o.id] ?? 0), 0);

  const toggle = (group: AddonGroup, optionId: number) => {
    setPicked((prev) => {
      const next = { ...prev };
      if (next[optionId]) {
        delete next[optionId];
        return next;
      }
      // A group that takes exactly one answer behaves like a radio: picking a
      // second replaces the first instead of refusing the tap. Refusing would
      // make the cashier hunt for what to deselect while a customer waits.
      if (group.max_select === 1) {
        for (const o of group.options) delete next[o.id];
      } else if (
        group.max_select !== null &&
        chosenIn(group) >= group.max_select
      ) {
        return prev;
      }
      next[optionId] = 1;
      return next;
    });
  };

  const bump = (group: AddonGroup, optionId: number, delta: number) => {
    setPicked((prev) => {
      const current = prev[optionId] ?? 0;
      const target = current + delta;
      if (target <= 0) {
        const next = { ...prev };
        delete next[optionId];
        return next;
      }
      if (group.max_select !== null && delta > 0) {
        const total = group.options.reduce(
          (n, o) => n + (o.id === optionId ? target : (prev[o.id] ?? 0)),
          0,
        );
        if (total > group.max_select) return prev;
      }
      return { ...prev, [optionId]: target };
    });
  };

  // Which required groups still have no answer. Named rather than counted so
  // the button can say what is missing instead of just being greyed out.
  const unmet = useMemo(
    () => groups.filter((g) => g.min_select > 0 && chosenIn(g) < g.min_select),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, picked],
  );

  const extra = useMemo(
    () =>
      groups.reduce(
        (sum, g) =>
          sum +
          g.options.reduce((s, o) => s + o.price * (picked[o.id] ?? 0), 0),
        0,
      ),
    [groups, picked],
  );

  const confirm = () => {
    if (unmet.length > 0 || !chosenVariant.isAvailable) return;
    const addons: CartAddon[] = [];
    for (const g of groups) {
      for (const o of g.options) {
        const qty = picked[o.id] ?? 0;
        if (qty > 0) {
          addons.push({
            product_id: o.product_id,
            option_id: o.id,
            name: o.name,
            quantity: qty,
            price: o.price,
          });
        }
      }
    }
    onConfirm({ product: chosenVariant, addons });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-background rounded-t-3xl sm:rounded-3xl border shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {variants.length > 0 ? 'Pilih untuk' : 'Tambahan untuk'}
            </p>
            <h3 className="font-bold truncate">{product.product_name}</h3>
          </div>
          <button
            onClick={onCancel}
            aria-label="Tutup"
            className="p-1 text-muted-foreground hover:text-foreground shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
          {/* WHICH ONE. A radio, never a checkbox: the answer decides what is
              being sold, so "none" and "two of them" are not states that exist.
              Prices are absolute, not deltas — a variant is not a surcharge on
              the base, it is its own product at its own price. */}
          {variants.length > 0 && (
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <p className="font-semibold text-sm">
                  {variantLabel}
                  <span className="text-rose-500 ml-1">*</span>
                </p>
                <p className="text-[11px] text-muted-foreground">pilih 1</p>
              </div>

              <div className="space-y-1.5">
                {variants.map((variant) => {
                  const selected = variant.id === variantId;
                  return (
                    <button
                      key={variant.id}
                      type="button"
                      disabled={!variant.isAvailable}
                      onClick={() => setVariantId(variant.id)}
                      className={`flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors disabled:cursor-not-allowed ${
                        selected
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                          : !variant.isAvailable
                            ? 'opacity-50'
                            : 'hover:bg-muted/50'
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                          selected
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'border-muted-foreground/30'
                        }`}
                      >
                        {selected && <Check className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm truncate">
                          {/* The short label among its siblings. The full
                              "Kopi Susu (Large)" is what the receipt prints;
                              here the base name is already in the header. */}
                          {variant.variant_name?.trim() || variant.product_name}
                        </span>
                        {!variant.isAvailable && (
                          <span className="block text-[11px] text-rose-500">
                            Habis
                          </span>
                        )}
                      </span>
                      <span className="text-sm font-semibold shrink-0">
                        {formatCurrency(priceOf(variant))}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {groups.map((group) => {
            const chosen = chosenIn(group);
            const required = group.min_select > 0;
            const full =
              group.max_select !== null && chosen >= group.max_select;
            return (
              <div key={group.id}>
                <div className="flex items-baseline justify-between mb-2">
                  <p className="font-semibold text-sm">
                    {group.name}
                    {required && <span className="text-rose-500 ml-1">*</span>}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {required && `min ${group.min_select}`}
                    {required && group.max_select !== null && ' · '}
                    {group.max_select !== null && `maks ${group.max_select}`}
                  </p>
                </div>

                <div className="space-y-1.5">
                  {group.options.map((option) => {
                    const qty = picked[option.id] ?? 0;
                    const selected = qty > 0;
                    // Sold out stays visible but unpickable: the cashier can
                    // see it exists and say so, rather than wondering where it
                    // went.
                    const disabled =
                      !option.available || (!selected && full);
                    return (
                      <div
                        key={option.id}
                        className={`flex items-center gap-2 rounded-xl border p-2.5 transition-colors ${
                          selected
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                            : disabled
                              ? 'opacity-50'
                              : 'hover:bg-muted/50'
                        }`}
                      >
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => toggle(group, option.id)}
                          className="flex flex-1 items-center gap-2.5 text-left min-w-0 disabled:cursor-not-allowed"
                        >
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                              selected
                                ? 'bg-blue-600 border-blue-600 text-white'
                                : 'border-muted-foreground/30'
                            }`}
                          >
                            {selected && <Check className="h-3.5 w-3.5" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm truncate">
                              {option.name}
                            </span>
                            {!option.available && (
                              <span className="block text-[11px] text-rose-500">
                                Habis
                              </span>
                            )}
                          </span>
                          <span className="text-sm font-semibold shrink-0">
                            {/* A free add-on says so. "Rp 0" reads like a bug. */}
                            {option.price > 0
                              ? `+${formatCurrency(option.price)}`
                              : 'Gratis'}
                          </span>
                        </button>

                        {/* Only where more than one of the same thing makes
                            sense — a radio-style group never shows steppers. */}
                        {selected && group.max_select !== 1 && (
                          <div className="flex items-center gap-1.5 shrink-0 border rounded-lg px-1 py-0.5 bg-background">
                            <button
                              type="button"
                              aria-label={`Kurangi ${option.name}`}
                              onClick={() => bump(group, option.id, -1)}
                              className="p-1 text-muted-foreground hover:text-foreground"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="text-xs font-bold w-4 text-center">
                              {qty}
                            </span>
                            <button
                              type="button"
                              aria-label={`Tambah ${option.name}`}
                              onClick={() => bump(group, option.id, 1)}
                              className="p-1 text-blue-600 hover:text-blue-700"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {group.options.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">
                      Belum ada pilihan di grup ini.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t px-5 py-4 shrink-0 space-y-2">
          {unmet.length > 0 && (
            <p className="text-xs text-rose-500">
              Wajib pilih: {unmet.map((g) => g.name).join(', ')}
            </p>
          )}
          {!chosenVariant.isAvailable && (
            <p className="text-xs text-rose-500">
              {chosenVariant.variant_name?.trim() || chosenVariant.product_name}{' '}
              sedang habis.
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel} className="flex-1">
              Batal
            </Button>
            <Button
              onClick={confirm}
              disabled={unmet.length > 0 || !chosenVariant.isAvailable}
              className="flex-1"
            >
              {/* The whole per-unit price, not the add-on delta: once a variant
                  is in play "+6.000" answers a question nobody asked — what the
                  cashier reads back to the customer is what one costs. */}
              Tambah · {formatCurrency(priceOf(chosenVariant) + extra)}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
