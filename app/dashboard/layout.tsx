import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { MessageCircle } from "lucide-react"
import { getSession } from "@/lib/auth"
import Forbidden from "@/lib/forbidden"
import { AppSidebar } from "@/components/app-sidebar"
import MessageChatComponent from "@/components/message/message-components"

import { AppContent } from '@/components/app-content';
import { AppShell } from '@/components/app-shell';
import { AppSidebarHeader } from "@/components/app-sidebar-header"


const dashboardLayout = async ({ children }: { children: React.ReactNode }) => {

    const session = await getSession();
    if (!session) {
        console.log(session, "session");
        return <Forbidden />
    }
    //check cookies is empty and if empty , redirect to login page

    return (
        <>
            <AppShell variant="sidebar">
                <AppSidebar />

                <AppContent variant="sidebar" className="overflow-x-hidden">
                    <AppSidebarHeader breadcrumbs={[]} />
                    {children}
                    <MessageChatComponent />
                </AppContent>
            </AppShell>
        </>

    )
}

export default dashboardLayout