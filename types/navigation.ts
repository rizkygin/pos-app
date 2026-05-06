import type { LinkProps } from 'next/link';
import type { LucideIcon } from 'lucide-react';

export type BreadcrumbItem = {
    title: string;
    href: NonNullable<LinkProps['href']>;
};

export type NavItem = {
    title: string;
    href: NonNullable<LinkProps['href']>;
    icon?: LucideIcon | null;
    isActive?: boolean;
};
