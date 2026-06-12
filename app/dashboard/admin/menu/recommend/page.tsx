import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { DashboardHeader } from '@/components/dashboard-header';
import { RecommendMenuTable } from './recommend-menu-table';

const RecommendMenuPage = async () => {
  const role = await getRole();

  if (!role || role.role !== 'admin') {
    redirect('/dashboard');
  }

  return (
    <main className="px-4 mx-2 md:mx-6 pb-12 space-y-4">
      <DashboardHeader
        title="Recommend Menu"
        description="Kelola produk yang direkomendasikan ke pelanggan"
      />
      <RecommendMenuTable />
    </main>
  );
};

export default RecommendMenuPage;
