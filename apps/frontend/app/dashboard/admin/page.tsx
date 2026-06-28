import { getRole } from '@/lib/utils/get-role';
import { redirect } from 'next/navigation';
import { serverFetch } from '@/lib/server-fetch';
import { AdminDashboard } from '@/components/dashboard/admin-dashboard';

const adminDashboardPage = async () => {
  const role = await getRole();

  if (!role || role.role !== 'admin') {
    redirect('/dashboard');
  }

  const res = await serverFetch('/api/admin/dashboard');
  const data = res.ok
    ? await res.json()
    : {
        revenue30Days: 0,
        revenuePercentageChange: 0,
        pendingOrdersCount: 0,
        activeOrdersCount: 0,
        onlineCouriersCount: 0,
        totalOutlets: 0,
        totalCouriers: 0,
        totalCustomers: 0,
        recentOrders: [],
      };

  return (
    <AdminDashboard
      revenue30Days={data.revenue30Days}
      revenuePercentageChange={data.revenuePercentageChange}
      pendingOrdersCount={data.pendingOrdersCount}
      activeOrdersCount={data.activeOrdersCount}
      onlineCouriersCount={data.onlineCouriersCount}
      totalOutlets={data.totalOutlets}
      totalCouriers={data.totalCouriers}
      totalCustomers={data.totalCustomers}
      recentOrders={data.recentOrders}
    />
  );
};

export default adminDashboardPage;
