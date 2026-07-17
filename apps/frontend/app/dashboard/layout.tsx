import type { Metadata } from "next"
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
import { SubscriptionWarningBanner } from "@/components/subscription-warning-banner"

// Private, authenticated area — never index. robots.ts also disallows
// crawling it, but noindex here is the real guarantee (a disallowed page can
// still get indexed by URL alone if linked from elsewhere; noindex actively
// removes it).
export const metadata: Metadata = {
    robots: { index: false, follow: false },
}

const dashboardLayout = async ({ children }: { children: React.ReactNode }) => {

    const session = await getSession();
    if (!session) {
        return <Forbidden />
    }

    const role = await getRole();
    const isOwner = role && role.role === 'owner';
    const isCourier = role && role.role === 'courier';
    const isAdmin = role && role.role === 'admin';
    const isEmployee = role && role.role === 'employee';
    const employeePermissions: Record<string, boolean> =
        isEmployee ? ((role.data?.permissions as Record<string, boolean>) ?? {}) : {};
    const isCustomer = !isOwner && !isCourier && !isAdmin && !isEmployee;

    return (
        <>
            <AppShell variant="sidebar">
                <AppSidebar isOwner={isOwner} isCourier={isCourier} isCustomer={isCustomer} isAdmin={isAdmin} isEmployee={isEmployee} employeePermissions={employeePermissions} />

                <AppContent variant="sidebar" className="h-svh overflow-x-hidden overflow-y-auto">
                    <header className="animated-gradient header-shine sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 overflow-hidden border-b border-white/10 px-3 shadow-sm md:h-10">
                        <SidebarTrigger className="relative z-10 size-11 text-amber-50 hover:bg-white/15 hover:text-white md:size-7" />
                        <span className="relative z-10 flex items-center gap-2 text-sm font-semibold text-amber-50 drop-shadow-sm">
                            <span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.9)]" />
                            {isAdmin ? 'Hello Admin' : isOwner ? 'Dashboard' : isCourier ? 'Kurir' : isEmployee ? 'Karyawan' : 'Dashboard'}
                        </span>
                    </header>

                    {/* Subscription reminder for owners on every dashboard page.
                        Dismiss is session-only — it returns on refresh. */}
                    {isOwner && <SubscriptionWarningBanner />}

                    {children}
                    
                    {/* <div className="hidden md:block"><MessageChatComponent /></div> */}
                </AppContent>
            </AppShell>
        </>

    )
}

export default dashboardLayout
