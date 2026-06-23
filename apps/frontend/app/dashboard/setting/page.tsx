import { getRole } from "@/lib/utils/get-role";
import { OwnerSetting } from "@/components/dashboard/owner-setting";
import { CourierSetting } from "@/components/dashboard/courier-setting";
import { CustomerSetting } from "@/components/dashboard/customer-setting";

export default async function SettingPage() {
    const role = await getRole();

    if (!role) return null;

    if (role.role === 'owner') {
        return <OwnerSetting />;
    }

    if (role.role === 'courier') {
        return <CourierSetting />;
    }

    if (role.role === 'customer') {
        return <CustomerSetting />;
    }
}
