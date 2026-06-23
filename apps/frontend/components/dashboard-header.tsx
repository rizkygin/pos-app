"use client";

import { Bell, Calendar as CalendarIcon, User } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DashboardHeaderProps {
    title: string;
    description?: string;
}

export function DashboardHeader({ title }: DashboardHeaderProps) {
    const today = new Date().toLocaleDateString('id-ID', {
        weekday: 'long',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });

    return (
        <header className="flex flex-col gap-4 py-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                    {title}
                </h1>

                {/* <div className="flex items-center gap-2">
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
                </div> */}
            </div>
        </header>
    );
}
