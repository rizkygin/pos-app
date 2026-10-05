import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { serverFetch } from '@/lib/server-fetch';
import { AdminSecuritySetting, type AdminSecurityStatus } from '@/components/dashboard/admin-security-setting';

// The only admin page an admin without two-factor can open (proxy.ts sends
// them here). It must stay that way, or setting it up becomes impossible.
export default async function AdminSecurityPage() {
  const role = await getRole();
  if (!role || role.role !== 'admin') redirect('/dashboard');

  // The backend refuses this to an admin who has not enrolled yet, so only ask
  // once they have.
  let security: AdminSecurityStatus | null = null;
  if (role.twoFactorEnabled) {
    const res = await serverFetch('/api/admin/security');
    if (res.ok) security = await res.json();
  }

  return <AdminSecuritySetting enabled={role.twoFactorEnabled} security={security} />;
}
