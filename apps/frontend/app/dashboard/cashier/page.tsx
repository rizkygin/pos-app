import { getSession } from "@/lib/auth";
import { serverFetch } from "@/lib/server-fetch";
import Forbidden from "@/lib/forbidden";
import { CashierClient } from "./cashier-client";
import { taxConfigFrom } from "@/lib/tax";

export default async function CashierPage() {
    const session = await getSession();

    if (!session || !session.user) {
        return <Forbidden />;
    }

    // Outlet + its products in one backend call. /api/products/mine returns ALL
    // products (incl. inventory-only); the cashier only sells customer-facing
    // items, so drop anything flagged not-for-sale. This also keeps
    // inventory-only items from spawning their own category tabs in the POS
    // (the client derives its tabs from this list).
    // Products and plan entitlements together. Both are needed before the
    // counter can render honestly, and fetching the features here rather than
    // from the client avoids the counter briefly offering a control the
    // merchant's plan doesn't include.
    const [res, featuresRes] = await Promise.all([
        serverFetch("/api/products/mine"),
        serverFetch("/api/me/features"),
    ]);
    const { outlet, products } = res.ok ? await res.json() : { outlet: null, products: [] };

    // Closed by default. If the features call failed we do NOT know the plan,
    // and quietly unlocking a paid feature on a network blip is the wrong way
    // to be wrong — opening a shift would be refused by the backend anyway.
    const features: Record<string, unknown> = featuresRes.ok
        ? ((await featuresRes.json())?.features ?? {})
        : {};
    const sellableProducts = products.filter(
        (p: { is_for_sale?: boolean }) => p.is_for_sale !== false,
    );

    if (!outlet) {
        return (
            <main className="flex flex-col min-h-screen bg-muted/50 px-4 mx-2 md:mx-6 pb-12 pt-8">
                <div className="rounded-2xl border border-rose-100 bg-rose-50 p-8 text-center text-rose-600">
                    <h2 className="text-xl font-bold">No Outlet Found</h2>
                    <p className="mt-2 text-sm">You need to have an active outlet to access the Cashier.</p>
                </div>
            </main>
        );
    }

    return (
        <main className="flex flex-col h-[calc(100vh-2.5rem)] bg-muted/30">
            <CashierClient
                outletId={outlet.id}
                outletName={outlet.name}
                outletAddress={outlet.address}
                outletPhone={outlet.phone}
                outletLogo={outlet.avatar ?? ""}
                cashierName={session.user.name ?? "Cashier"}
                canUseShift={features.cashierShift === true}
                canUsePager={features.pager === true}
                // Resolved against the gate here, so the counter can't show a
                // tax line the plan doesn't include. The server applies the
                // same gate when it stores the order.
                taxConfig={taxConfigFrom(outlet, features.tax === true)}
                initialProducts={sellableProducts}
            />
        </main>
    );
}
