import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { DashboardHeader } from '@/components/dashboard-header';
import { AdminErrandsClient } from './errands-client';

// Admin-only. Errands have no outlet, so there is no owner whose data this
// could be — the whole feature is platform-level.
const AdminErrandPage = async () => {
  const role = await getRole();
  if (!role || role.role !== 'admin') redirect('/dashboard');

  return (
    <main className="px-4 mx-2 md:mx-6 pb-12 space-y-4">
      <DashboardHeader
        title="Suruh Kurir"
        description="Semua pesanan kurir langsung dari pelanggan"
      />
      <AdminErrandsClient />
    </main>
  );
};

export default AdminErrandPage;
