import type { Metadata } from 'next';
import { getMaintenance } from '@/lib/maintenance-server';
import { MaintenanceScreen } from '@/components/maintenance/maintenance-screen';

export const metadata: Metadata = {
  title: 'Sedang dalam pemeliharaan',
  robots: { index: false, follow: false },
};

// The proxy rewrites live traffic here, so this must reflect the window as it
// is right now — never a build-time or cached snapshot.
export const dynamic = 'force-dynamic';

export default async function MaintenancePage() {
  return <MaintenanceScreen maintenance={await getMaintenance()} />;
}
