import { OrderClient } from "@/components/order/order-client";

export default async function OutletMenuPage({
    params,
}: {
    params: Promise<{ feature: string; outletId: string }>;
}) {
    const { feature, outletId } = await params;
    // OrderClient handles service mode internally (feature === 'service'): same
    // browsing UI, but per-item "Ajukan Layanan" requests instead of a basket.
    return <OrderClient feature={feature} outletId={outletId} />;
}
