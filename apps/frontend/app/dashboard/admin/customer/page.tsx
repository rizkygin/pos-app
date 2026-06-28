import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { DashboardHeader } from '@/components/dashboard-header';
import { CustomerTable } from './customer-table';

const ManageCustomerPage = async () => {
  const role = await getRole();
  if (!role || role.role !== 'admin') redirect('/dashboard');

  return (
    <main className="px-4 mx-2 md:mx-6 pb-12 space-y-4">
      <DashboardHeader title="Manage Customer" description="Kelola semua pelanggan terdaftar" />
      <CustomerTable />
    </main>
  );
};

export default ManageCustomerPage;
