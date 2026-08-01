import { redirect } from "next/navigation";
import { OrderClient } from "@/components/order/order-client";
import { serverFetch } from "@/lib/server-fetch";

export default async function OutletMenuPage({
    params,
}: {
    params: Promise<{ feature: string; outletId: string }>;
}) {
    const { feature, outletId } = await params;

    // Server-side range gate. OrderClient renders an out-of-range state too, but
    // that happens only after a full menu has been shipped to the browser — this
    // stops the route resolving at all, so an unreachable outlet's catalogue is
    // never sent.
    //
    // Jasa is exempt: nothing is transported, so distance doesn't disqualify it.
    //
    // Defence in depth, not the enforcement. The real guarantee lives in
    // orders/create, which refuses out-of-range orders however the request was
    // made — hiding a page only stops people who came through the UI.
    if (feature !== "service") {
        const res = await serverFetch(`/api/get-outlet-id?outletId=${outletId}`);
        if (res.ok) {
            const { data } = await res.json();
            if (data?.outOfRange) redirect(`/dashboard/order/${feature}`);
        }
    }

    // OrderClient handles service mode internally (feature === 'service'): same
    // browsing UI, but per-item "Ajukan Layanan" requests instead of a basket.
    return <OrderClient feature={feature} outletId={outletId} />;
}
