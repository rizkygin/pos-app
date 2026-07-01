import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { serverFetch } from '@/lib/server-fetch';

export default async function OrderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getRole();

  // Owners and couriers don't place orders — send them to their dashboard.
  if (role && (role.role === 'owner' || role.role === 'courier')) {
    redirect('/dashboard');
  }

  // Customers with an in-progress order (not delivered/cancelled) resume it.
  const res = await serverFetch('/api/get-active-order');
  const data = res.ok ? await res.json() : null;

  //if customer have an active order, they must not able to order another thing. 
  if (data?.success && data.order && data.order.status !== 'delivered' && data.order.fulfillment !=='service') {
    redirect('/dashboard/activeorder/');
  }
  

  return <>{children}</>;
}
