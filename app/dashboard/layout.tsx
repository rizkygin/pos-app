import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { MessageCircle } from "lucide-react"
import { getSession } from "@/lib/auth"
import Forbidden from "@/lib/forbidden"
import { AppSidebar } from "@/components/app-sidebar"
import MessageChatComponent from "@/components/message/message-components"

import { AppContent } from '@/components/app-content';
import { AppShell } from '@/components/app-shell';
import { AppSidebarHeader } from "@/components/app-sidebar-header"
import { db } from "@/src/db";
import { outletsTable, couriersTable } from "@/src/db/schema";
import { eq } from "drizzle-orm";


const dashboardLayout = async ({ children }: { children: React.ReactNode }) => {

    const session = await getSession();
    if (!session) {
        console.log(session, "session");
        return <Forbidden />
    }

    const [[outlet], [courier]] = await Promise.all([
        db.select({ id: outletsTable.id }).from(outletsTable).where(eq(outletsTable.user_id, session.user.id)).limit(1),
        db.select({ id: couriersTable.id }).from(couriersTable).where(eq(couriersTable.user_id, session.user.id)).limit(1),
    ]);

    const isOwner = !!outlet;
    const isCourier = !!courier;
    const isCustomer = !isOwner && !isCourier;

    return (
        <>
            <AppShell variant="sidebar">
                <AppSidebar isOwner={isOwner} isCourier={isCourier} isCustomer={isCustomer} />

                <AppContent variant="sidebar" className="overflow-x-hidden">
                    <header className="sticky top-0 z-10 flex h-10 shrink-0 items-center border-b bg-background px-3">
                        <SidebarTrigger />
                    </header>

                    {children}
                    <MessageChatComponent />
                </AppContent>
            </AppShell>
        </>

    )
}

export default dashboardLayout