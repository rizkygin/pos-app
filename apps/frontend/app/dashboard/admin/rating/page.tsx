import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { DashboardHeader } from '@/components/dashboard-header';
import { RatingTable } from './rating-table';

const ManageRatingPage = async () => {
  const role = await getRole();

  if (!role || role.role !== 'admin') {
    redirect('/dashboard');
  }

  return (
    <main className="px-4 mx-2 md:mx-6 pb-12 space-y-4">
      <DashboardHeader
        title="Manage Rating"
        description="Lihat ulasan dan rating produk dari pelanggan"
      />
      <RatingTable />
    </main>
  );
};

export default ManageRatingPage;
