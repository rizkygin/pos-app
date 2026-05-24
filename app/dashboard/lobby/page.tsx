import { redirect } from "next/navigation";
import { db } from "@/src/db";
import { couriersTable } from "@/src/db/schema";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { CourierLobby } from "@/components/dashboard/courier-lobby";

export default async function LobbyPage() {
    const session = await getSession();

    const [courier] = await db
        .select({ id: couriersTable.id })
        .from(couriersTable)
        .where(eq(couriersTable.user_id, session.user.id))
        .limit(1);

    if (!courier) redirect("/dashboard");

    return (
        <main className="px-4 mx-2 md:mx-6 pb-12">
            <CourierLobby courierId={courier.id} />
        </main>
    );
}
