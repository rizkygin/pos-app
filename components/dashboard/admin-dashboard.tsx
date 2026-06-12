"use client";

import { DashboardHeader } from "@/components/dashboard-header";

export const AdminDashboard = () => {
    return (
        <main className="px-4 mx-2 md:mx-6 pb-12 space-y-8">
            <DashboardHeader
                title="Hello Admin"
                description="Admin dashboard"
            />
            
        </main>
    );
};
