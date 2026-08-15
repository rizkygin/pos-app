import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { CourierLobby } from '@/components/dashboard/courier-lobby';
import { ErrandRequestPanel } from '@/components/errand/errand-request-panel';

export default async function LobbyPage() {
  const role = await getRole();

  if (!role || role.role !== 'courier') redirect('/dashboard');

  return (
    <main className="px-4 mx-2 md:mx-6 pb-12">
      {/* Not "above the lobby" but INSTEAD of it: a direct hire is aimed at this
          courier personally and holds them exclusively, so while one is live
          every offer in the open queue is one they cannot take. The panel passes
          the lobby straight through whenever there is no errand. */}
      <ErrandRequestPanel>
        <CourierLobby courierId={role.data.id} />
      </ErrandRequestPanel>
    </main>
  );
}
