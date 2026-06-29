import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { MessageCircle } from "lucide-react"
import { getSession } from "@/lib/auth"
import { getRole } from "@/lib/utils/get-role"
import Forbidden from "@/lib/forbidden"
import { AppSidebar } from "@/components/app-sidebar"
import MessageChatComponent from "@/components/message/message-components"

import { AppContent } from '@/components/app-content';
import { AppShell } from '@/components/app-shell';
import { AppSidebarHeader } from "@/components/app-sidebar-header"


const dashboardLayout = async ({ children }: { children: React.ReactNode }) => {

    const session = await getSession();
    if (!session) {
        return <Forbidden />
    }

    const role = await getRole();
    const isOwner = role && role.role === 'owner';
    const isCourier = role && role.role === 'courier';
    const isAdmin = role && role.role === 'admin';
    const isCustomer = !isOwner && !isCourier && !isAdmin;

    return (
        <>
            <AppShell variant="sidebar">
                <AppSidebar isOwner={isOwner} isCourier={isCourier} isCustomer={isCustomer} isAdmin={isAdmin} />

                <AppContent variant="sidebar" className="h-svh overflow-x-hidden overflow-y-auto">
                    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3 md:h-10 bg-linear-to-r from-purple-800 to-green-600">
                        <SidebarTrigger className="size-11 md:size-7" />
                        <span className="text-sm font-semibold text-amber-50">
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
