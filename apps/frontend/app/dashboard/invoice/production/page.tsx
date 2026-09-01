import { featureBlocked, UpgradeScreen } from "@/lib/utils/feature-gate";
import { ProductionClient } from "./production-client";

// Same "stock" feature gate as the Stok page: production is a stock operation
// (ingredients out, batch in) and the API enforces the same "stock" permission.
export default async function ProductionPage() {
  if (await featureBlocked("stock")) return <UpgradeScreen label="Produksi" />;
  return <ProductionClient />;
}
