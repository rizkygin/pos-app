import { featureBlocked, UpgradeScreen } from "@/lib/utils/feature-gate";
import { SalesClient } from "./sales-client";

export default async function SalesInvoicePage() {
  if (await featureBlocked("salesInvoice")) return <UpgradeScreen label="Faktur Penjualan" />;
  return <SalesClient />;
}
