"use client";

import {
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
import { Fan } from "lucide-react"
import { IdCard, Building2, LayoutGrid, SunDim, LetterText, LayoutDashboard } from 'lucide-react';
import { useRouter } from "next/navigation";


import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible"

import { ChevronDown } from 'lucide-react';
import AppLogo from './app-logo';
import Link from 'next/link';
import { Button } from "./ui/button";
import { authClient } from "@/lib/auth-client";
import dynamic from "next/dynamic";
import { useCurrentUrl } from "@/hooks/use-current-url";

const projects = [
    { name: "Dashboard", url: "/dashboard", icon: LayoutDashboard, color: "blue" },
    { name: "Order", url: "/dashboard/order", icon: Building2, color: "blue" },
    { name: "Product", url: "/dashboard/product", icon: LayoutGrid, color: "red" },
    { name: "Category", url: "/dashboard/category", icon: LetterText, color: "yellow" },
    { name: "Cashier", url: "/dashboard/cashier", icon: Building2, color: "green" },
    { name: "User", url: "/dashboard/user", icon: IdCard, color: "green" },
    { name: "Setting", url: "/dashboard/setting", icon: SunDim, color: "purple" },
]

const Sidebar = dynamic(() => import("@/components/ui/sidebar").then((mod) => mod.Sidebar), {
    ssr: false,
})

export function AppSidebar() {
    const router = useRouter();

    const currentUrl = useCurrentUrl();

    // console.log(currentUrl);
    const signOut = async () => {
        await authClient.signOut({
            fetchOptions: {
                onSuccess: () => {
                    router.push("/");
                }
            }
        });
    }

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
                                    <SidebarMenuButton asChild isActive={project.url === currentUrl}>
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
                        <Button variant={'outline'} onClick={signOut}> <Fan />Sign Out</Button>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>
        </Sidebar>

    )
}
