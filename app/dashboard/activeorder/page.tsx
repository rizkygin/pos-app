import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { db } from '@/src/db';
import { customersTable, ordersTable, outletsTable } from '@/src/db/schema';
import { and, asc,desc, eq, notInArray } from 'drizzle-orm';
import { ActiveOrderAnimation } from '@/components/order/active-order-animation';
import { PendingOrdersLobby } from '@/components/dashboard/pending-orders-lobby';

export default async function ActiveOrderPage() {
  const session = await getSession();

  const [outlet] = await db
    .select({ id: outletsTable.id })
    .from(outletsTable)
    .where(eq(outletsTable.user_id, session.user.id))
    .limit(1);

  if (outlet) {
    return (
      <main className="px-4 mx-2 md:mx-6 pb-12">
        <PendingOrdersLobby />
      </main>
    );
  }

  // Customer view — track their own active order
  const [activeOrder] = await db
    .select({
      id: ordersTable.id,
      status: ordersTable.status,
      outletName: outletsTable.name,
      updatedAt: ordersTable.updatedAt,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
    .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
    .where(
      and(
        eq(customersTable.user_id, session.user.id),
        notInArray(ordersTable.status, ['cancelled'])
      )
    )
    .orderBy(desc(ordersTable.createdAt))
    .limit(1);

    

  if (!activeOrder) redirect('/dashboard/order');
  if (activeOrder.status === 'delivered') redirect(`/dashboard/ratings/submit/customer/${activeOrder.id}`);

  return (
    <main className="px-4 pb-12">
      <ActiveOrderAnimation
        orderId={activeOrder.id}
        status={activeOrder.status as 'pending' | 'confirmed' | 'preparing' | 'ready' | 'on_delivery' | 'delivered'}
        orderRef={activeOrder.id.slice(-8).toUpperCase()}
        outletName={activeOrder.outletName}
        statusSince={(activeOrder.updatedAt ?? activeOrder.createdAt).toISOString()}
      />
    </main>
  );
}
