import { serverFetch } from "@/lib/server-fetch";
import { ProductsManager } from "./products-manager";

const Page = async () => {
    // Outlet + its products in one backend call; the Arsip tab's list beside it.
    const [res, archivedRes] = await Promise.all([
        serverFetch("/api/products/mine"),
        serverFetch("/api/products/archived"),
    ]);
    const { outlet, products, gate } = res.ok ? await res.json() : { outlet: null, products: [], gate: null };
    const archived = archivedRes.ok ? ((await archivedRes.json()).products ?? []) : [];

    if (!outlet) {
        return (
            <main className="px-4 mx-2 md:mx-6 pb-12">
                <div className="rounded-2xl border border-rose-100 bg-rose-50 p-8 text-center text-rose-600">
                    <h2 className="text-xl font-bold">No Outlet Found</h2>
                    <p className="mt-2 text-sm">You need to have an active outlet to manage products.</p>
                </div>
            </main>
        );
    }

    return (
        <main className="px-4 mx-2 md:mx-6 pb-12">
            <ProductsManager outletId={outlet.id} initialProducts={products} initialArchived={archived} gate={gate} />
        </main>
    );
};

export default Page;
