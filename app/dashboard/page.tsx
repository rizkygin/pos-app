import { getSession } from "@/lib/auth";
import { getRole } from "@/lib/utils/get-role";
import RegisterRolePage from "@/pages/register-role";
import { CourierDashboard } from "@/components/dashboard/courier-dashboard";
import { CustomerDashboard } from "@/components/dashboard/customer-dashboard";
import { OwnerDashboard } from "@/components/dashboard/owner-dashboard";
import { db } from "@/src/db";
import { outletsTable, productsTable, orderDetailsTable } from "@/src/db/schema";
import { eq, and, gte, sql, desc } from "drizzle-orm";

const dashboardPage = async () => {

    const role = await getRole();

    if (!role) {
        return <RegisterRolePage />
    }

    if (role.role === 'owner') {
        const session = await getSession();

        const outletRes = await db
            .select({ id: outletsTable.id })
            .from(outletsTable)
            .where(eq(outletsTable.user_id, session.user.id))
            .limit(1);
        const outlet = outletRes[0];

        let activeOrdersCount = 0;
        let recentOrders: {
            orderId: string;
            itemCount: number;
            totalAmount: number;
            status: "addToChart" | "checkout" | null;
        }[] = [];

        if (outlet) {
            const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

            // Active orders in last 24h
            const activeRows = await db
                .selectDistinct({ orderId: orderDetailsTable.order_id })
                .from(orderDetailsTable)
                .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
                .where(
                    and(
                        eq(productsTable.outlet_id, outlet.id),
                        gte(orderDetailsTable.created_at, since)
                    )
                );
            activeOrdersCount = activeRows.length;

            // Recent orders — grouped by order_id, most recent first
            const orderRows = await db
                .select({
                    orderId: orderDetailsTable.order_id,
                    itemCount: sql<number>`cast(count(*) as int)`,
                    totalAmount: sql<number>`coalesce(sum(cast(${orderDetailsTable.summary_price} as numeric)), 0)`,
                    status: sql<"addToChart" | "checkout" | null>`min(${orderDetailsTable.status}::text)`,
                })
                .from(orderDetailsTable)
                .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
                .where(eq(productsTable.outlet_id, outlet.id))
                .groupBy(orderDetailsTable.order_id)
                .orderBy(desc(sql`max(${orderDetailsTable.created_at})`))
                .limit(5);

            recentOrders = orderRows;
        }

        return <OwnerDashboard activeOrdersCount={activeOrdersCount} recentOrders={recentOrders} />;
    }

    if (role.role === 'courier') {
        return <CourierDashboard />
    }

    if (role.role === 'customer') {
        return <CustomerDashboard />
    }
}

export default dashboardPage;