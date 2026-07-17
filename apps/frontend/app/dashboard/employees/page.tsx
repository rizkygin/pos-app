import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { DashboardHeader } from '@/components/dashboard-header';
import { EmployeesClient } from './employees-client';

const EmployeesPage = async () => {
  const role = await getRole();
  if (!role || role.role !== 'owner') redirect('/dashboard');

  return (
    <main className="px-4 mx-2 md:mx-6 pb-12 space-y-4">
      <DashboardHeader
        title="Karyawan"
        description="Buat akun karyawan dan atur fitur yang boleh mereka akses"
      />
      <EmployeesClient />
    </main>
  );
};

export default EmployeesPage;
