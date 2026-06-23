import { OrderClient } from "@/components/order/order-client";

export default async function OutletMenuPage({
    params,
}: {
    params: Promise<{ feature: string; outletId: string }>;
}) {
    const { feature, outletId } = await params;
    return <OrderClient feature={feature} outletId={outletId} />;
}
