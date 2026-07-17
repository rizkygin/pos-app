import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { DashboardHeader } from '@/components/dashboard-header';
import { SubscriptionClient } from './subscription-client';

const SubscriptionPage = async () => {
  const role = await getRole();
  if (!role || role.role !== 'owner') redirect('/dashboard');

  return (
    <main className="px-4 mx-2 md:mx-6 pb-12 space-y-4">
      <DashboardHeader
        title="Langganan"
        description="Kelola paket langganan Ulun Pesan untuk usaha Pian"
      />
      <SubscriptionClient />
    </main>
  );
};

export default SubscriptionPage;
