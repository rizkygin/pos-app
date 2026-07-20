import { featureBlocked, UpgradeScreen } from "@/lib/utils/feature-gate";
import { StockClient } from "./stock-client";

export default async function StockPage() {
  if (await featureBlocked("stock")) return <UpgradeScreen label="Manajemen Stok" />;
  return <StockClient />;
}
