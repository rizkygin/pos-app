import { getSession } from "@/lib/auth";
import { db } from "@/src/db";
import { outletsTable, productsTable } from "@/src/db/schema";
import { eq } from "drizzle-orm";
import Forbidden from "@/lib/forbidden";
import { ProductsManager } from "./products-manager";
import getOutletID from "@/lib/outlet-id"

const Page = async () => {
    const outlet = await getOutletID();

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

    // Fetch products for this outlet
    const products = await db.select().from(productsTable).where(eq(productsTable.outlet_id, outlet.id));

    return (
        <main className="px-4 mx-2 md:mx-6 pb-12">
            <ProductsManager outletId={outlet.id} initialProducts={products} />
        </main>
    );
};

export default Page;