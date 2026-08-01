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

  if (role.role === 'employee') {
    const permissions = (role.data?.permissions as Record<string, boolean>) ?? {};
    // With the reports permission, employees get the same home stats as the
    // owner (the API allows it); otherwise a simple landing pointing at the
    // sidebar, which already shows only their permitted pages.
    if (permissions.reports) {
      const res = await serverFetch('/api/dashboard/owner');
      const data = res.ok ? await res.json() : { ok: false };
      if (data.ok) {
        return (
          <OwnerDashboard
            activeOrdersCount={data.activeOrdersCount}
            recentOrders={data.recentOrders}
            total6monthsSales={data.total6monthsSales}
            topProduct={data.topProduct}
          />
        );
      }
    }
    return (
      <main className="flex min-h-[70vh] items-center justify-center px-4">
        <div className="max-w-md rounded-3xl border p-8 text-center">
          <p className="text-3xl">👋</p>
          <h1 className="mt-3 text-xl font-bold">
            Halo! Pian masuk sebagai karyawan {String(role.data?.outlet_name ?? '')}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Pilih menu di sebelah kiri untuk mulai bekerja — hanya fitur yang
            diizinkan pemilik yang tampil di sana.
          </p>
        </div>
      </main>
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
        location={data.location ?? null}
      />
    );
  }
};

export default dashboardPage;
