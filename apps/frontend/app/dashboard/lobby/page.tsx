import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { CourierLobby } from '@/components/dashboard/courier-lobby';

export default async function LobbyPage() {
  const role = await getRole();

  if (!role || role.role !== 'courier') redirect('/dashboard');

  return (
    <main className="px-4 mx-2 md:mx-6 pb-12">
      <CourierLobby courierId={role.data.id} />
    </main>
  );
}
