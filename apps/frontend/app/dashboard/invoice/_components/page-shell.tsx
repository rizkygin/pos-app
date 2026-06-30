import type { LucideIcon } from "lucide-react";

// Shared scaffold for the invoice/stock pages: a header (title + description +
// optional action slot) and a centered empty state. Backend wiring comes later;
// for now each page renders its empty state.
export function InvoicePageShell({
  title,
  description,
  icon: Icon,
  action,
  emptyHint,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  action?: React.ReactNode;
  emptyHint: string;
}) {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Icon className="size-5 text-teal-600 dark:text-teal-400" />
            {title}
          </h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>

      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 px-6 py-16 text-center">
        <Icon className="size-8 text-muted-foreground/50" />
        <p className="mt-3 text-sm font-medium">Belum ada data</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{emptyHint}</p>
      </div>
    </div>
  );
}
