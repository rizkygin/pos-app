import { getRole } from '@/lib/utils/get-role';
import { redirect } from 'next/navigation';
import { AdminDashboard } from '@/components/dashboard/admin-dashboard';

const adminDashboardPage = async () => {
  const role = await getRole();

  if (!role || role.role !== 'admin') {
    redirect('/dashboard');
  }

  return <AdminDashboard />;
};

export default adminDashboardPage;
