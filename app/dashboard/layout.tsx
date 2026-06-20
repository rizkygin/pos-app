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
import { outletsTable, couriersTable, adminsTable } from "@/src/db/schema";
import { eq } from "drizzle-orm";


const dashboardLayout = async ({ children }: { children: React.ReactNode }) => {

    const session = await getSession();
    if (!session) {
        console.log(session, "session");
        return <Forbidden />
    }

    const [[outlet], [courier], [admin]] = await Promise.all([
        db.select({ id: outletsTable.id }).from(outletsTable).where(eq(outletsTable.user_id, session.user.id)).limit(1),
        db.select({ id: couriersTable.id }).from(couriersTable).where(eq(couriersTable.user_id, session.user.id)).limit(1),
        db.select({ id: adminsTable.id }).from(adminsTable).where(eq(adminsTable.user_id, session.user.id)).limit(1),
    ]);

    const isOwner = !!outlet;
    const isCourier = !!courier;
    const isAdmin = !!admin;
    const isCustomer = !isOwner && !isCourier && !isAdmin;

    return (
        <>
            <AppShell variant="sidebar">
                <AppSidebar isOwner={isOwner} isCourier={isCourier} isCustomer={isCustomer} isAdmin={isAdmin} />

                <AppContent variant="sidebar" className="h-svh overflow-x-hidden overflow-y-auto">
                    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3 md:h-10">
                        <SidebarTrigger className="size-11 md:size-7" />
                        <span className="text-sm font-semibold text-foreground">
                            {isAdmin ? 'Hello Admin' : isOwner ? 'Dashboard' : isCourier ? 'Kurir' : 'Dashboard'}
                        </span>
                    </header>

                    {children}
                    <div className="hidden md:block"><MessageChatComponent /></div>
                </AppContent>
            </AppShell>
        </>

    )
}

export default dashboardLayout