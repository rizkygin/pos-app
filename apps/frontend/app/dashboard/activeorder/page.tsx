import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { getSession } from '@/lib/auth';
import { serverFetch } from '@/lib/server-fetch';
import { ActiveOrderAnimation } from '@/components/order/active-order-animation';
import { PendingOrdersLobby } from '@/components/dashboard/pending-orders-lobby';

export default async function ActiveOrderPage() {
  const role = await getRole();

  if (role && role.role === 'owner') {
    // The pickup slip is the same receipt the cashier prints, so it needs the
    // same outlet header (name/address/phone/logo). Fetched here rather than in
    // the client component to match how /dashboard/cashier passes it down.
    const [session, outletRes] = await Promise.all([
      getSession(),
      serverFetch('/api/outlet/me'),
    ]);
    const outlet = outletRes.ok ? (await outletRes.json()).outlet : null;

    return (
      <main className="px-4 mx-2 md:mx-6 pb-12">
        <PendingOrdersLobby
          outletName={outlet?.name ?? ''}
          outletAddress={outlet?.address ?? ''}
          outletPhone={outlet?.phone ?? ''}
          outletLogo={outlet?.avatar ?? ''}
          cashierName={session?.user?.name ?? 'Owner'}
        />
      </main>
    );
  }

  // Customer view — track their own active order.
  const res = await serverFetch('/api/get-active-order');
  const data = res.ok ? await res.json() : null;
  const activeOrder = data?.success ? data.order : null;

  if (!activeOrder) redirect('/dashboard/order');
  // Jasa has its own tracking surface. Materials does NOT — it has goods in
  // transit and real statuses to watch, so it stays on this screen (the courier
  // bits inside are already gated on fulfillment).
  if (activeOrder.fulfillment === 'service') redirect('/dashboard/order');
  if (activeOrder.status === 'delivered')
    redirect(
      // No courier means nobody to rate but the outlet, which is what the
      // service ratings page does.
      activeOrder.fulfillment === 'service' || activeOrder.fulfillment === 'materials'
        ? `/dashboard/ratings/submit/service/${activeOrder.id}`
        : `/dashboard/ratings/submit/customer/${activeOrder.id}`,
    );

  return (
    <main className="px-4 pb-12">
      <ActiveOrderAnimation
        orderId={activeOrder.id}
        status={activeOrder.status as 'pending' | 'confirmed' | 'preparing' | 'ready' | 'on_delivery' | 'delivered' | 'cancelled'}
        orderRef={activeOrder.id.slice(-8).toUpperCase()}
        outletName={activeOrder.outletName}
        statusSince={activeOrder.updatedAt ?? activeOrder.createdAt}
        fulfillment={activeOrder.fulfillment}
        rejectedReason={activeOrder.rejectedReason ?? null}
        deliveryFee={activeOrder.deliveryFee ?? null}
        goodsTotal={activeOrder.goodsTotal ?? null}
      />
    </main>
  );
}
