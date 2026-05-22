import { getUserLocations } from "./actions";
import { CustomerLocationSetting } from "@/components/dashboard/customer-location-setting";

export default async function LocationSettingPage() {
    const locations = await getUserLocations();
    return <CustomerLocationSetting locations={locations} />;
}
