"use client";

import { useState } from "react";
import { Search, Bell, Calendar as CalendarIcon, User, ChevronDown, ShoppingCart, MessageSquare, Landmark, History, MessageCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface DashboardHeaderProps {
    title: string;
    description?: string;
}

export function DashboardHeader({ title, description }: DashboardHeaderProps) {
    const [isOpen, setIsOpen] = useState(false);

    const today = new Date().toLocaleDateString('id-ID', {
        weekday: 'long',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });

    const quickItems = [
        { label: "Orders", value: "24", icon: ShoppingCart, color: "text-blue-600", bg: "bg-blue-50" },
        { label: "Messages", value: "12", icon: MessageSquare, color: "text-purple-600", bg: "bg-purple-50" },
        { label: "Today's Income", value: "$2,450", icon: Landmark, color: "text-emerald-600", bg: "bg-emerald-50" },
        { label: "Sales History", value: "View All", icon: History, color: "text-amber-600", bg: "bg-amber-50" },
    ];

    return (
        <header className="flex flex-col gap-4 py-8">

            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-col gap-1">
                    <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                        {title}
                    </h1>
                </div>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div className="relative w-full sm:w-64 md:w-80">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder="Search dashboard..."
                            className="pl-9 bg-background/50 border-muted focus-visible:ring-blue-600/20"
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="hidden items-center gap-2 rounded-lg border bg-background/50 px-3 py-1.5 text-sm font-medium text-muted-foreground lg:flex">
                            <CalendarIcon className="h-4 w-4" />
                            <span className="text-[10px] uppercase tracking-wider">{today}</span>
                        </div>

                        <Button variant="outline" size="icon" className="relative group">
                            <Bell className="h-4 w-4 transition-transform group-hover:rotate-12" />
                            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-blue-600 ring-2 ring-background" />
                            <span className="sr-only">Notifications</span>
                        </Button>

                        <Button variant="ghost" size="icon" className="rounded-full border border-muted bg-background/50">
                            <User className="h-4 w-4" />
                            <span className="sr-only">Profile</span>
                        </Button>
                    </div>
                </div>
            </div>

            <Collapsible
                open={isOpen}
                onOpenChange={setIsOpen}
                className="w-full space-y-2"
            >
                <div className="flex items-center justify-between space-x-4">
                    <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="flex items-center gap-2 p-0 hover:bg-transparent text-muted-foreground hover:text-blue-600 transition-colors">
                            <div className={`p-1 rounded-md transition-colors ${isOpen ? 'bg-blue-100 text-blue-600' : 'bg-muted text-muted-foreground'}`}>
                                <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
                            </div>
                            <span className="text-xs font-bold uppercase tracking-widest">Quick Overview</span>
                        </Button>
                    </CollapsibleTrigger>
                </div>
                <CollapsibleContent className="pt-4 overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-300">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {quickItems.map((item, index) => (
                            <div key={index} className="flex items-center gap-4 p-4 rounded-xl border bg-background/50 hover:bg-background transition-colors hover:shadow-sm">
                                <div className={`p-3 rounded-xl ${item.bg} ${item.color}`}>
                                    <item.icon className="h-5 w-5" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-tight">{item.label}</span>
                                    <span className="text-lg font-bold">{item.value}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </CollapsibleContent>
            </Collapsible>
        </header>
    );
}
