import { getSession } from "@/lib/auth";
import Forbidden from "@/lib/forbidden";
import { KitchenClient } from "./kitchen-client";

// Dapur — the Kitchen Display. Live and polled like Manajemen Meja, so the page
// is a thin shell: who may see the tickets (the `kitchen` permission) is the
// backend's call, and the client renders its answer.
export default async function KitchenPage() {
    const session = await getSession();
    if (!session?.user) return <Forbidden />;

    return (
        <main className="flex h-[calc(100vh-2.5rem)] flex-col bg-muted/40">
            <KitchenClient />
        </main>
    );
}
