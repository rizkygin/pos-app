import { featureBlocked, UpgradeScreen } from "@/lib/utils/feature-gate";
import InvoiceReportsClient from "./reports-client";

export default async function InvoiceReportsPage() {
  if (await featureBlocked("reportInvoice")) return <UpgradeScreen label="Laporan Faktur" />;
  return <InvoiceReportsClient />;
}
