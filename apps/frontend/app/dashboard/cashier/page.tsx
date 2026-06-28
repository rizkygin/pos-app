import { getSession } from "@/lib/auth";
import { serverFetch } from "@/lib/server-fetch";
import Forbidden from "@/lib/forbidden";
import { CashierClient } from "./cashier-client";

export default async function CashierPage() {
    const session = await getSession();

    if (!session || !session.user) {
        return <Forbidden />;
    }

    // Outlet + its products in one backend call.
    const res = await serverFetch("/api/products/mine");
    const { outlet, products } = res.ok ? await res.json() : { outlet: null, products: [] };

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
                cashierName={session.user.name ?? "Cashier"}
                initialProducts={products}
            />
        </main>
    );
}
