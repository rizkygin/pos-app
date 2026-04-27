import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { getSession } from "@/lib/auth"
import Forbidden from "@/lib/forbidden"
import { AppSidebar } from "@/components/app-sidebar"


const dashboardLayout = async ({ children }: { children: React.ReactNode }) => {

    const session = await getSession();
    if (!session) {
        console.log(session, "session");
        return <Forbidden />
    }
    return (
        <SidebarProvider>
            <AppSidebar />
            <main>
                <SidebarTrigger />
                {children}
            </main>
        </SidebarProvider>
    )
}

export default dashboardLayout