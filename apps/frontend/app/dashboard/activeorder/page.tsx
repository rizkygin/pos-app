import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { serverFetch } from '@/lib/server-fetch';
import { ActiveOrderAnimation } from '@/components/order/active-order-animation';
import { PendingOrdersLobby } from '@/components/dashboard/pending-orders-lobby';

export default async function ActiveOrderPage() {
  const role = await getRole();

  if (role && role.role === 'owner') {
    return (
      <main className="px-4 mx-2 md:mx-6 pb-12">
        <PendingOrdersLobby />
      </main>
    );
  }

  // Customer view — track their own active order.
  const res = await serverFetch('/api/get-active-order');
  const data = res.ok ? await res.json() : null;
  const activeOrder = data?.success ? data.order : null;

  if (!activeOrder) redirect('/dashboard/order');
  if (activeOrder.status === 'delivered')
    // Service orders have no courier to rate — send them to their history instead.
    redirect(
      activeOrder.fulfillment === 'service'
        ? '/dashboard/history-order'
        : `/dashboard/ratings/submit/customer/${activeOrder.id}`,
    );

  return (
    <main className="px-4 pb-12">
      <ActiveOrderAnimation
        orderId={activeOrder.id}
        status={activeOrder.status as 'pending' | 'confirmed' | 'preparing' | 'ready' | 'on_delivery' | 'delivered'}
        orderRef={activeOrder.id.slice(-8).toUpperCase()}
        outletName={activeOrder.outletName}
        statusSince={activeOrder.updatedAt ?? activeOrder.createdAt}
        fulfillment={activeOrder.fulfillment}
      />
    </main>
  );
}
