import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuItem,
    SidebarMenuButton,
    SidebarMenuBadge,
    SidebarMenuAction,
} from "@/components/ui/sidebar"

import { IdCard, Building2, LayoutGrid, SunDim, Moon, LetterText, MailCheck, AlarmCheckIcon } from 'lucide-react';


import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible"

import { ChevronDown } from 'lucide-react';
import AppLogo from './app-logo';
import Link from 'next/link';


const projects = [
    { name: "Order", url: "/dashboard/order", icon: Building2 },
    { name: "Product", url: "/dashboard/product", icon: LayoutGrid },
    { name: "Category", url: "/dashboard/category", icon: LetterText },
    { name: "User", url: "/dashboard/user", icon: IdCard },
    { name: "Setting", url: "/dashboard/setting", icon: SunDim },
]

export function AppSidebar() {
    return (

        <Sidebar collapsible="icon" variant="inset">
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                            <Link href="/dashboard">
                                <AppLogo />
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>
            <SidebarContent className="flex flex-col gap-2 mx-2">
                <SidebarGroup>
                    <SidebarGroupLabel>Application</SidebarGroupLabel>
                    <SidebarMenu>
                        {projects.map((project) => {
                            const Icon = project.icon;
                            return (
                                <SidebarMenuItem key={project.name}>
                                    <SidebarMenuButton asChild>
                                        <Link href={project.url}>
                                            <Icon />
                                            <span>{project.name}</span>
                                        </Link>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            );
                        })}
                    </SidebarMenu>
                </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton>
                            Username
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>
        </Sidebar>

    )
}
