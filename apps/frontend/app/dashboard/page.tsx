import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { serverFetch } from '@/lib/server-fetch';
import RegisterRolePage from '@/pages/register-role';
import { CourierDashboard } from '@/components/dashboard/courier-dashboard';
import { CustomerDashboard } from '@/components/dashboard/customer-dashboard';
import { OwnerDashboard } from '@/components/dashboard/owner-dashboard';

const dashboardPage = async () => {
  const role = await getRole();

  if (!role) {
    return <RegisterRolePage />;
  }
  if (role.role === 'admin') {
    redirect('/dashboard/admin');
  }

  if (role.role === 'owner') {
    const res = await serverFetch('/api/dashboard/owner');
    const data = res.ok ? await res.json() : { ok: false };
    if (!data.ok) return null;

    return (
      <OwnerDashboard
        activeOrdersCount={data.activeOrdersCount}
        recentOrders={data.recentOrders}
        total6monthsSales={data.total6monthsSales}
        topProduct={data.topProduct}
      />
    );
  }

  if (role.role === 'courier') {
    const res = await serverFetch('/api/dashboard/courier');
    const data = res.ok ? await res.json() : { ok: false };
    if (!data.ok) return null;

    return (
      <CourierDashboard
        currentPickUp={data.currentPickUp}
        dashboardValue={data.dashboardValue}
        weeklyPerformance={data.weeklyPerformance}
        initialIsOnline={data.initialIsOnline}
        todayOnlineSeconds={data.todayOnlineSeconds}
        ratingStatus={data.ratingStatus}
        delaySeconds={data.delaySeconds}
      />
    );
  }

  if (role.role === 'customer') {
    const res = await serverFetch('/api/dashboard/customer');
    const data = res.ok ? await res.json() : { ok: false, lastOrders: [], recommend: [], ads: [], hasLocation: false };

    return (
      <CustomerDashboard
        lastOrders={data.lastOrders}
        recommend={data.recommend}
        ads={data.ads}
        hasLocation={data.hasLocation}
      />
    );
  }
};

export default dashboardPage;
