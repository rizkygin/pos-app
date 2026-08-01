import { redirect } from 'next/navigation';
import { getRole } from '@/lib/utils/get-role';
import { serverFetch } from '@/lib/server-fetch';
import { ServiceAreaSetting } from '@/components/dashboard/service-area-setting';

export default async function ServiceAreaPage() {
    const role = await getRole();
    if (!role || role.role !== 'admin') redirect('/dashboard');

    const res = await serverFetch('/api/admin/service-area');
    const data = res.ok ? await res.json() : { area: null, outlets: [] };

    return (
        <ServiceAreaSetting
            initialArea={data.area ?? null}
            outlets={data.outlets ?? []}
        />
    );
}
