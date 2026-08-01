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
import { IncomingOrderAlarm } from "@/components/dashboard/incoming-order-alarm"
import { PushNotificationNudge } from "@/components/dashboard/push-notification-nudge"
import { EmailVerificationGate } from "@/components/dashboard/email-verification-gate"
import { CustomerBottomNav } from "@/components/customer-bottom-nav"
import { cn } from "@/lib/utils"

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

    // Who gets the bottom nav instead of the sidebar (phone-portrait only).
    // Stricter than `isCustomer`: a signed-up user with no role row yet also
    // satisfies that flag, and they're looking at RegisterRolePage, where every
    // customer tab would be a dead end.
    const isSettledCustomer = !!role && role.role === 'customer';

    // Email is the only identity check a customer goes through — there's no
    // WhatsApp/phone verification — so an unverified address blocks the whole
    // dashboard until confirmed. Checked against role.role === 'customer', NOT
    // the `isCustomer` fallback above: isCustomer is also true for a brand-new
    // user with no role row yet, and that person must still be able to reach
    // RegisterRolePage (rendered by app/dashboard/page.tsx) to pick a role.
    // /api/orders/create enforces the same rule server-side as a backstop.
    const emailUnverified =
        !!role && role.role === "customer" && !session.user.emailVerified;

    return (
        <>
            <AppShell variant="sidebar">
                <AppSidebar isOwner={isOwner} isCourier={isCourier} isCustomer={isCustomer} isAdmin={isAdmin} isEmployee={isEmployee} employeePermissions={employeePermissions} />

                <AppContent
                    variant="sidebar"
                    className={cn(
                        "h-svh overflow-x-hidden overflow-y-auto",
                        // Room for the fixed bottom nav, so the last card of any
                        // page clears it instead of hiding behind it.
                        isSettledCustomer && "max-md:portrait:pb-20",
                    )}
                >
                    <header className="animated-gradient header-shine sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 overflow-hidden border-b border-white/10 px-3 shadow-sm md:h-10">
                        {/* Hiding the trigger is what retires the sidebar: on
                            mobile it renders as a sheet, so with no way to open
                            it, the bottom nav is the only navigation. */}
                        <SidebarTrigger className={cn(
                            "relative z-10 size-11 text-amber-50 hover:bg-white/15 hover:text-white md:size-7",
                            isSettledCustomer && "max-md:portrait:hidden",
                        )} />
                        <span className="relative z-10 flex items-center gap-2 text-sm font-semibold text-amber-50 drop-shadow-sm">
                            <span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.9)]" />
                            {isAdmin ? 'Hello Admin' : isOwner ? 'Dashboard' : isCourier ? 'Kurir' : isEmployee ? 'Karyawan' : 'Dashboard'}
                        </span>
                    </header>

                    {/* Subscription reminder for owners on every dashboard page.
                        Dismiss is session-only — it returns on refresh. */}
                    {isOwner && <SubscriptionWarningBanner />}

                    {/* Rings until every pending order is answered. Lives in the
                        layout, not the Order Lobby, so an owner working the
                        cashier still hears an order land. */}
                    {isOwner && <IncomingOrderAlarm />}

                    {/* One-time prompt to enable background push notifications —
                        the alarm above only rings while a tab is open. */}
                    {isOwner && <PushNotificationNudge />}

                    {emailUnverified ? (
                        <EmailVerificationGate email={session.user.email} />
                    ) : (
                        children
                    )}

                    {isSettledCustomer && <CustomerBottomNav />}

                    {/* <div className="hidden md:block"><MessageChatComponent /></div> */}
                </AppContent>
            </AppShell>
        </>

    )
}

export default dashboardLayout
