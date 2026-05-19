import { getRole } from "@/lib/utils/get-role";
import { getOutletAction } from "./actions";
import { OwnerSetting } from "@/components/dashboard/owner-setting";
import { CourierSetting } from "@/components/dashboard/courier-setting";
import { CustomerSetting } from "@/components/dashboard/customer-setting";

export default async function SettingPage() {
    const role = await getRole();

    if (!role) return null;

    if (role.role === 'owner') {
        const outlet = await getOutletAction();
        return <OwnerSetting outlet={outlet} />;
    }

    if (role.role === 'courier') {
        return <CourierSetting />;
    }

    if (role.role === 'customer') {
        return <CustomerSetting />;
    }
}
