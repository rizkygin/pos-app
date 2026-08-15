import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { serverFetch } from '@/lib/server-fetch';
import { MaintenanceSetting } from '@/components/dashboard/maintenance-setting';
import { MAINTENANCE_OFF } from '@/lib/maintenance';

export default async function MaintenancePage() {
  const role = await getRole();
  if (!role || role.role !== 'admin') redirect('/dashboard');

  const res = await serverFetch('/api/admin/maintenance');
  const data = res.ok ? await res.json() : { current: MAINTENANCE_OFF, windows: [] };

  return (
    <MaintenanceSetting
      current={data.current ?? MAINTENANCE_OFF}
      windows={data.windows ?? []}
    />
  );
}
