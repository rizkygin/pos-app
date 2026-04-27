import { getSession } from "@/lib/auth";
import { getRole } from "@/lib/utils/get-role";
import RegisterRolePage from "@/pages/register-role";
import { CourierDashboard } from "@/components/dashboard/courier-dashboard";
import { CustomerDashboard } from "@/components/dashboard/customer-dashboard";
import { OwnerDashboard } from "@/components/dashboard/owner-dashboard";

const dashboardPage = async () => {

    const session = await getSession();

    const role = await getRole();


    if (!role) {
        return <RegisterRolePage />
    }

    if (role.role === 'owner') {
        return (
            <OwnerDashboard />
        )
    }

    if (role.role === 'courier') {
        return <CourierDashboard />
    }

    if (role.role === 'customer') {
        return <CustomerDashboard />
    }
}

export default dashboardPage;