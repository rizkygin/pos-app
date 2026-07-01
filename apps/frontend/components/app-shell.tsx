import type { ReactNode } from 'react';
import { SidebarProvider } from '@/components/ui/sidebar';

type Props = {
    children: ReactNode;
    variant?: 'header' | 'sidebar';
};

export function AppShell({ children, variant = 'header' }: Props) {
    const isOpen = true;

    if (variant === 'header') {
        return (
            <div className="flex min-h-screen w-full flex-col bg-linear-to-br from-purple-500 via-green-500 to-orange-500">{children}</div>
        );
    }

    return (
        <SidebarProvider
            defaultOpen={isOpen}
            style={{ '--sidebar-width-icon': '4.75rem' } as React.CSSProperties}
        >
            {children}
        </SidebarProvider>
    );
}
