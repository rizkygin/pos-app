import { redirect } from "next/navigation";
import { db } from "@/src/db";
import { couriersTable } from "@/src/db/schema";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { CourierDashboard } from "@/components/dashboard/courier-dashboard";

export default async function LobbyPage() {
    const session = await getSession();

    const [courier] = await db
        .select({ id: couriersTable.id })
        .from(couriersTable)
        .where(eq(couriersTable.user_id, session.user.id))
        .limit(1);

    if (!courier) redirect("/dashboard");

    return <CourierDashboard />;
}
