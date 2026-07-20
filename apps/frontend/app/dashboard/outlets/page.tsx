import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { DashboardHeader } from '@/components/dashboard-header';
import { OutletsClient } from './outlets-client';

const OutletsPage = async () => {
  const role = await getRole();
  if (!role || role.role !== 'owner') redirect('/dashboard');

  return (
    <main className="px-4 mx-2 md:mx-6 pb-12 space-y-4">
      <DashboardHeader
        title="Outlet Saya"
        description="Kelola semua outlet Pian — pilih outlet aktif atau tambah cabang baru"
      />
      <OutletsClient />
    </main>
  );
};

export default OutletsPage;
