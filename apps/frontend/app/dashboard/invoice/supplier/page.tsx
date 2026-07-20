import { featureBlocked, UpgradeScreen } from "@/lib/utils/feature-gate";
import { SupplierClient } from "./supplier-client";

export default async function SupplierPage() {
  if (await featureBlocked("purchaseInvoice")) return <UpgradeScreen label="Data Supplier" />;
  return <SupplierClient />;
}
