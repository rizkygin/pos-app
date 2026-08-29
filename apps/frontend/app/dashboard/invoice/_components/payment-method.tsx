'use client';

import { Banknote, CreditCard, Landmark, QrCode, Smartphone, Wallet } from 'lucide-react';

// Mirrors the backend's invoice_payment_method enum (see schema.ts). The
// cashflow ledger only stores cash vs transfer; these finer labels live on
// invoice_payments.method and exist so the owner can tell a QRIS settlement
// from a bank transfer when reading a faktur.
export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Tunai', icon: Banknote },
  { value: 'transfer', label: 'Transfer', icon: Landmark },
  { value: 'qris', label: 'QRIS', icon: QrCode },
  { value: 'debit', label: 'Debit', icon: CreditCard },
  { value: 'credit', label: 'Kartu Kredit', icon: CreditCard },
  { value: 'ewallet', label: 'E-Wallet', icon: Smartphone },
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]['value'];

export const methodMeta = (m: string) =>
  PAYMENT_METHODS.find((p) => p.value === m) ?? PAYMENT_METHODS[0];

/** Chip grid — two columns on phones, three from sm. Cash is always first so
 *  the common case stays where the thumb already is. */
export function PaymentMethodPicker({
  value,
  onChange,
  label = 'Metode Pembayaran',
}: {
  value: PaymentMethod;
  onChange: (v: PaymentMethod) => void;
  label?: string;
}) {
  return (
    <div className="space-y-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Wallet className="size-3.5" /> {label}
      </span>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {PAYMENT_METHODS.map((m) => {
          const Icon = m.icon;
          const active = value === m.value;
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => onChange(m.value)}
              aria-pressed={active}
              className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-medium transition-colors ${
                active
                  ? 'border-teal-600 bg-teal-600 text-white'
                  : 'border-border bg-background hover:bg-muted'
              }`}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{m.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Read-only label for a recorded payment. Non-cash is tinted so a glance down
 *  the history tells you what actually hit the drawer. */
export function PaymentMethodBadge({ method }: { method: string }) {
  const meta = methodMeta(method);
  const Icon = meta.icon;
  const cash = meta.value === 'cash';
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
        cash
          ? 'bg-muted text-muted-foreground'
          : 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300'
      }`}
    >
      <Icon className="size-3" />
      {meta.label}
    </span>
  );
}
