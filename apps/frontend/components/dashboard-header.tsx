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
            </div>
        </header>
    );
}
