import { Receipt, Plus } from "lucide-react";
import { InvoicePageShell } from "../_components/page-shell";

export default function SalesInvoicePage() {
  return (
    <InvoicePageShell
      title="Faktur Penjualan"
      description="Buat faktur penjualan untuk pelanggan/B2B. Faktur yang diposting mengurangi stok dan mencatat pemasukan (kas masuk) saat dibayar."
      icon={Receipt}
      emptyHint="Buat faktur penjualan pertama untuk menagih pelanggan dan mengurangi stok otomatis."
      action={
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-700"
        >
          <Plus className="size-4" />
          Buat Faktur Penjualan
        </button>
      }
    />
  );
}
