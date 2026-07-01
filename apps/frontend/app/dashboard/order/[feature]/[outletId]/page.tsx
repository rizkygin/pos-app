import { OrderClient } from "@/components/order/order-client";
import { ServiceOrderClient } from "@/components/order/service-order-client";

export default async function OutletMenuPage({
    params,
}: {
    params: Promise<{ feature: string; outletId: string }>;
}) {
    const { feature, outletId } = await params;
    // Service orders skip the cart/delivery flow entirely — a customer just
    // submits a request and the owner sets price + schedule afterwards.
    if (feature === "service") {
        return <ServiceOrderClient feature={feature} outletId={outletId} />;
    }
    return <OrderClient feature={feature} outletId={outletId} />;
}
