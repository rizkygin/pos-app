import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { DashboardHeader } from '@/components/dashboard-header';
import { MembershipClient } from './membership-client';

const MembershipPage = async () => {
  const role = await getRole();
  if (!role || role.role !== 'owner') redirect('/dashboard');

  return (
    <main className="px-4 mx-2 md:mx-6 pb-12 space-y-4">
      <DashboardHeader
        title="Membership"
        description="Database pelanggan outlet Pian: poin, tier, dan kode promo sendiri"
      />
      <MembershipClient />
    </main>
  );
};

export default MembershipPage;
