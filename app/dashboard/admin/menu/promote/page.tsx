import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { DashboardHeader } from '@/components/dashboard-header';
import { PromoteAdsTable } from './promote-ads-table';

const PromoteMenuPage = async () => {
  const role = await getRole();

  if (!role || role.role !== 'admin') {
    redirect('/dashboard');
  }

  return (
    <main className="px-4 mx-2 md:mx-6 pb-12 space-y-4">
      <DashboardHeader
        title="Promote Menu"
        description="Tinjau dan setujui iklan menu yang diajukan outlet"
      />
      <PromoteAdsTable />
    </main>
  );
};

export default PromoteMenuPage;
