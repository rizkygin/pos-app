import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { DashboardHeader } from '@/components/dashboard-header';
import { CreditCard } from 'lucide-react';

const SubscriptionOutletPage = async () => {
  const role = await getRole();
  if (!role || role.role !== 'admin') redirect('/dashboard');

  return (
    <main className="px-4 mx-2 md:mx-6 pb-12 space-y-4">
      <DashboardHeader title="Subscription Outlet" description="Kelola langganan outlet" />
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/60 py-20 text-center">
        <CreditCard className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-semibold text-muted-foreground">Segera hadir</p>
        <p className="text-xs text-muted-foreground/70 max-w-sm">
          Fitur langganan outlet masih dalam pengembangan.
        </p>
      </div>
    </main>
  );
};

export default SubscriptionOutletPage;
