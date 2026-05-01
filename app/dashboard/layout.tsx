import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { MessageCircle } from "lucide-react"
import { getSession } from "@/lib/auth"
import Forbidden from "@/lib/forbidden"
import { AppSidebar } from "@/components/app-sidebar"
import MessageChatComponent from "@/components/message/message-components"


const dashboardLayout = async ({ children }: { children: React.ReactNode }) => {

    const session = await getSession();
    if (!session) {
        console.log(session, "session");
        return <Forbidden />
    }
    return (
        <>

            <SidebarProvider>
                <AppSidebar />
                <main>
                    <SidebarTrigger />
                    {children}
                    <MessageChatComponent />

                </main>

            </SidebarProvider>
        </>

    )
}

export default dashboardLayout