import { getRole } from '@/lib/utils/get-role';
import Forbidden from '@/lib/forbidden';
import { Building2 } from 'lucide-react';
import { OutletsTable } from './outlets-table';

const Page = async () => {
  const role = await getRole();
  if (!role || role.role !== 'admin') return <Forbidden />;

  return (
    <main className="px-4 mx-2 md:mx-6 pb-12 space-y-6">
      <div>
        <h1 className="text-2xl font-black flex items-center gap-2">
          <Building2 className="h-6 w-6 text-cyan-500" />
          Manage Outlet
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Semua outlet yang terdaftar. Filter berdasarkan status, rating, atau fitur.
        </p>
      </div>

      <OutletsTable />
    </main>
  );
};

export default Page;
