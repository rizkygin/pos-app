import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { serverFetch } from '@/lib/server-fetch';
import { AdminActivityLog } from '@/components/dashboard/admin-activity-log';

export default async function AdminActivityPage() {
  const role = await getRole();
  if (!role || role.role !== 'admin') redirect('/dashboard');

  const res = await serverFetch('/api/admin/activity?page=1&limit=50');
  const data = res.ok ? await res.json() : { data: [], count: 0 };

  return <AdminActivityLog initialRows={data.data ?? []} initialCount={data.count ?? 0} />;
}
