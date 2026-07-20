import { featureBlocked, UpgradeScreen } from "@/lib/utils/feature-gate";
import { PurchaseClient } from "./purchase-client";

export default async function PurchaseInvoicePage() {
  if (await featureBlocked("purchaseInvoice")) return <UpgradeScreen label="Faktur Pembelian" />;
  return <PurchaseClient />;
}
