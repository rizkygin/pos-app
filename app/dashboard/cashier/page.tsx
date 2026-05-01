import { getSession } from "@/lib/auth";
import { db } from "@/src/db";
import { outletsTable, productsTable } from "@/src/db/schema";
import { eq } from "drizzle-orm";
import Forbidden from "@/lib/forbidden";
import { CashierClient } from "./cashier-client";

export default async function CashierPage() {
    const session = await getSession();

    if (!session || !session.user) {
        return <Forbidden />;
    }

    // Find the outlet belonging to this user
    const outletRes = await db.select().from(outletsTable).where(eq(outletsTable.user_id, session.user.id)).limit(1);
    const outlet = outletRes[0];

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

    // Fetch products for this outlet
    const products = await db.select().from(productsTable).where(eq(productsTable.outlet_id, outlet.id));

    return (
        <main className="flex flex-col min-h-[calc(100vh-4rem)] bg-muted/30">
            <CashierClient outletId={outlet.id} initialProducts={products} />
        </main>
    );
}