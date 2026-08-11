import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { serverFetch } from '@/lib/server-fetch';
import { ErrandCourierPicker } from '@/components/errand/errand-courier-picker';

/**
 * "Tugaskan Kurir" — hire a courier directly, no outlet involved.
 *
 * The list itself is fetched client-side rather than here: availability changes
 * as couriers go online and pick up jobs, so a server-rendered snapshot would
 * be stale before the customer finished reading it. This page only resolves the
 * guards that decide whether the picker should be shown at all.
 */
export default async function SuruhKurirPage() {
  const role = await getRole();
  if (!role) redirect('/dashboard');

  // A courier already carrying something has no business opening the picker,
  // and an owner has no customer identity to hire with.
  if (role.role !== 'customer' && role.role !== 'courier') {
    redirect('/dashboard');
  }

  // One live errand at a time — the backend enforces this on create, so landing
  // here with one already running would only produce a 409 the customer has to
  // read. Send them to the screen that actually tracks it.
  const res = await serverFetch('/api/errands/active');
  const data = res.ok ? await res.json() : null;
  if (data?.errand) redirect('/dashboard/activeorder');

  return (
    <main className="px-4 mx-2 md:mx-6 pb-12 pt-4">
      <ErrandCourierPicker />
    </main>
  );
}
