import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { DashboardHeader } from '@/components/dashboard-header';
import { CourierOffersClient } from './offers-client';

export default async function CourierOffersPage() {
  const role = await getRole();
  if (!role || role.role !== 'admin') redirect('/dashboard');

  return (
    <main className="px-4 mx-2 md:mx-6 pb-12 space-y-4">
      <DashboardHeader
        title="Tawaran Order"
        description="Siapa yang menerima, menolak, dan mendiamkan tawaran order."
      />
      <CourierOffersClient />
    </main>
  );
}
