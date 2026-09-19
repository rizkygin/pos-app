import { getSession } from "@/lib/auth";
import Forbidden from "@/lib/forbidden";
import { TablesClient } from "./tables-client";

// Manajemen Meja. Everything on the floor is live and polled, so the page is a
// thin shell: who may see what is decided by the backend (the `tables` and
// `cashier` permissions, and the plan), and the client renders its answer —
// including the "not allowed" one.
export default async function TablesPage() {
    const session = await getSession();
    if (!session?.user) return <Forbidden />;

    return (
        <main className="flex h-[calc(100vh-2.5rem)] flex-col bg-background">
            <TablesClient cashierName={session.user.name ?? "Kasir"} />
        </main>
    );
}
