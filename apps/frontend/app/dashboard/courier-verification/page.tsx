import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { DashboardHeader } from '@/components/dashboard-header';
import { CourierVerificationClient } from '@/components/courier/courier-verification-client';

export default async function CourierVerificationPage() {
  const role = await getRole();
  if (!role || role.role !== 'courier') redirect('/dashboard');

  return (
    <main className="w-full px-4 pb-16 md:px-6">
      <div className="mx-auto w-full max-w-2xl space-y-5 pt-4">
        <DashboardHeader
          title="Verifikasi Kurir"
          description="Unggah dokumen berikut supaya admin bisa memverifikasi akun pian."
        />
        <CourierVerificationClient />
      </div>
    </main>
  );
}
