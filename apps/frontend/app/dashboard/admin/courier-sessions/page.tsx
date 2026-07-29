import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { DashboardHeader } from '@/components/dashboard-header';
import { CourierSessionsClient } from './sessions-client';

// Admin-only, not an owner page: couriers have no outlet_id, so a shift log is
// platform-wide data. An outlet owner has no basis to see a courier's whole
// working day — only the orders of theirs that courier carried.
const CourierSessionsPage = async () => {
  const role = await getRole();
  if (!role || role.role !== 'admin') redirect('/dashboard');

  return (
    <main className="px-4 mx-2 md:mx-6 pb-12 space-y-4">
      <DashboardHeader
        title="Sesi Kurir"
        description="Kurir yang sedang online dan riwayat shift mereka"
      />
      <CourierSessionsClient />
    </main>
  );
};

export default CourierSessionsPage;
