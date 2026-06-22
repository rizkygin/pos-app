'use client';

import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  IdCard,
  Building2,
  LayoutGrid,
  SunDim,
  LetterText,
  LayoutDashboard,
  Book,
  LogOut,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ShoppingCart,
  MapPin,
  UserCog,
  Bike,
  ClipboardList,
  Star,
  History,
  Megaphone,
  CreditCard,
  Users,
  Calculator,
  Receipt,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authClient, useSession } from '@/lib/auth-client';
import dynamic from 'next/dynamic';
import { useCurrentUrl } from '@/hooks/use-current-url';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import type { LucideIcon } from 'lucide-react';

type NavItem = {
  name: string;
  url: string;
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
};

const navMain: NavItem[] = [
  {
    name: 'Dashboard',
    url: '/dashboard',
    icon: LayoutDashboard,
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
  },
  {
    name: 'Order',
    url: '/dashboard/order',
    icon: ShoppingCart,
    iconBg: 'bg-orange-100',
    iconColor: 'text-orange-600',
  },
  {
    name: 'Product',
    url: '/dashboard/addproducts',
    icon: LayoutGrid,
    iconBg: 'bg-green-100',
    iconColor: 'text-green-600',
  },
  {
    name: 'Laporan',
    url: '/dashboard/reports',
    icon: LetterText,
    iconBg: 'bg-violet-100',
    iconColor: 'text-violet-600',
  },
  {
    name: 'Kasir',
    url: '/dashboard/cashier',
    icon: Building2,
    iconBg: 'bg-cyan-100',
    iconColor: 'text-cyan-600',
  },
  {
    name: 'Buku Kas',
    url: '/dashboard/cashflow',
    icon: Book,
    iconBg: 'bg-rose-100',
    iconColor: 'text-rose-600',
  },
  
];

const userSubItems = [
  { name: 'User Setting', url: '/dashboard/user', icon: UserCog },
  {
    name: 'Locations Setting',
    url: '/dashboard/users/locations/setting',
    icon: MapPin,
  },
];

const navManagement: NavItem[] = [
  {
    name: 'Pengaturan',
    url: '/dashboard/setting',
    icon: SunDim,
    iconBg: 'bg-slate-100',
    iconColor: 'text-slate-600',
  },
];

const Sidebar = dynamic(
  () => import('@/components/ui/sidebar').then((mod) => mod.Sidebar),
  {
    ssr: false,
  },
);

function NavRow({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const Icon = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        className={cn(
          'h-11 gap-2.5 rounded-md px-2 text-[13px] font-medium transition-colors',
          'text-muted-foreground hover:bg-accent hover:text-foreground',
          isActive && 'bg-accent text-foreground',
        )}
      >
        <Link href={item.url}>
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-md',
              item.iconBg,
            )}
          >
            <Icon className={cn('size-4', item.iconColor)} />
          </span>
          <span>{item.name}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function NavCollapsible({
  label,
  icon: Icon,
  iconBg,
  iconColor,
  items,
  currentUrl,
}: {
  label: string;
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  items: { name: string; url: string; icon: LucideIcon }[];
  currentUrl: string | null;
}) {
  const isActive = items.some((sub) => sub.url === currentUrl);
  return (
    <Collapsible defaultOpen={isActive} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            isActive={isActive}
            className={cn(
              'h-11 gap-2.5 rounded-md px-2 text-[13px] font-medium transition-colors',
              'text-muted-foreground hover:bg-accent hover:text-foreground',
              isActive && 'bg-accent text-foreground',
            )}
          >
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-md',
                iconBg,
              )}
            >
              <Icon className={cn('size-4', iconColor)} />
            </span>
            <span>{label}</span>
            <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/collapsible:rotate-180" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub className="mt-0.5">
            {items.map((sub) => {
              const SubIcon = sub.icon;
              const subActive = sub.url === currentUrl;
              return (
                <SidebarMenuSubItem key={sub.name}>
                  <SidebarMenuSubButton
                    asChild
                    isActive={subActive}
                    className={cn(
                      'h-10 text-[13px] text-muted-foreground',
                      subActive && 'text-foreground font-medium',
                    )}
                  >
                    <Link href={sub.url}>
                      <SubIcon className="size-4" />
                      <span>{sub.name}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

const courierNavItems: NavItem[] = [
  {
    name: 'Ruang Tunggu Order',
    url: '/dashboard/lobby',
    icon: Bike,
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
  },
  {
    name: 'Ratings',
    url: '/dashboard/courier-ratings',
    icon: Star,
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
  },
];

const ownerNavItems: NavItem[] = [
  {
    name: 'Pesanan Aktif',
    url: '/dashboard/activeorder',
    icon: ClipboardList,
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
  },
  {
    name: 'Pasang Iklan',
    url: '/dashboard/promote',
    icon: Megaphone,
    iconBg: 'bg-rose-100',
    iconColor: 'text-rose-600',
  },
  {
    name: 'Kalkulator HPP',
    url: '/dashboard/hpp-calculator',
    icon: Calculator,
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
  },
];

const ratingNavItem: NavItem = {
  name: 'Ratings',
  url: '/dashboard/ratings',
  icon: Star,
  iconBg: 'bg-amber-100',
  iconColor: 'text-amber-600',
};

const customerNavItems: NavItem[] = [
  {
    name: 'History Order',
    url: '/dashboard/history-order',
    icon: History,
    iconBg: 'bg-indigo-100',
    iconColor: 'text-indigo-600',
  },
];

const adminDashboardNavItem: NavItem = {
  name: 'Dashboard',
  url: '/dashboard/admin',
  icon: LayoutDashboard,
  iconBg: 'bg-blue-100',
  iconColor: 'text-blue-600',
};

const adminMenuSubItems = [
  { name: 'Recommend Menu', url: '/dashboard/admin/menu/recommend', icon: Star },
  { name: 'Promote Menu', url: '/dashboard/admin/menu/promote', icon: Megaphone },
];

const adminOutletSubItems = [
  { name: 'Manage Outlet', url: '/dashboard/admin/outlet', icon: Building2 },
  { name: 'Subscription Outlet', url: '/dashboard/admin/outlet/subscription', icon: CreditCard },
];

const adminManageNavItems: NavItem[] = [
  {
    name: 'Order',
    url: '/dashboard/admin/order',
    icon: Receipt,
    iconBg: 'bg-sky-100',
    iconColor: 'text-sky-600',
  },
  {
    name: 'Manage Courier',
    url: '/dashboard/admin/courier',
    icon: Bike,
    iconBg: 'bg-orange-100',
    iconColor: 'text-orange-600',
  },
  {
    name: 'Manage Customer',
    url: '/dashboard/admin/customer',
    icon: Users,
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
  },
  {
    name: 'Manage User',
    url: '/dashboard/admin/user',
    icon: IdCard,
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
  },
  {
    name: 'Manage Rating',
    url: '/dashboard/admin/rating',
    icon: Star,
    iconBg: 'bg-violet-100',
    iconColor: 'text-violet-600',
  },
];

export function AppSidebar({
  isOwner = false,
  isCourier = false,
  isCustomer = false,
  isAdmin = false,
}: {
  isOwner?: boolean;
  isCourier?: boolean;
  isCustomer?: boolean;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const currentUrl = useCurrentUrl();
  const { data: session } = useSession();
  const ownerOnlyNames = new Set(['Product', 'Laporan', 'Kasir', 'Buku Kas']);
  const visibleNavMain = isOwner
    ? navMain.filter((item) => item.url !== '/dashboard/order')
    : isCourier
      ? navMain.filter(
          (item) =>
            !ownerOnlyNames.has(item.name) && item.url !== '/dashboard/order',
        )
      : navMain.filter((item) => !ownerOnlyNames.has(item.name));
  const visibleNavManagement = isOwner ? navManagement : [];

  const user = session?.user;
  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n: string) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'U';

  const signOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => router.push('/'),
      },
    });
  };

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="px-3 py-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="h-9 gap-2 px-2">
              <Link href="/dashboard">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-linear-to-br from-indigo-500 to-violet-600 text-white text-xs font-bold shadow-sm">
                  P
                </div>
                <div className="flex min-w-0 flex-col text-left">
                  <span className="truncate text-[13px] font-semibold leading-none">
                    POS Gratis Pbun
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground leading-none mt-0.5">
                    Workspace
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="px-2 py-1 gap-0">
        <SidebarGroup className="p-0">
          <SidebarGroupLabel className="px-2 py-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
            Overview
          </SidebarGroupLabel>
          <SidebarMenu className="gap-1">
            {isAdmin ? (
              <>
                <NavRow
                  item={adminDashboardNavItem}
                  isActive={adminDashboardNavItem.url === currentUrl}
                />
                <NavCollapsible
                  label="Menu"
                  icon={LayoutGrid}
                  iconBg="bg-green-100"
                  iconColor="text-green-600"
                  items={adminMenuSubItems}
                  currentUrl={currentUrl}
                />
                <NavCollapsible
                  label="Outlet"
                  icon={Building2}
                  iconBg="bg-cyan-100"
                  iconColor="text-cyan-600"
                  items={adminOutletSubItems}
                  currentUrl={currentUrl}
                />
                {adminManageNavItems.map((item) => (
                  <NavRow
                    key={item.name}
                    item={item}
                    isActive={item.url === currentUrl}
                  />
                ))}
              </>
            ) : (
              <>
                {visibleNavMain.map((item) => (
                  <NavRow
                    key={item.name}
                    item={item}
                    isActive={item.url === currentUrl}
                  />
                ))}
                {isOwner &&
                  ownerNavItems.map((item) => (
                    <NavRow
                      key={item.name}
                      item={item}
                      isActive={item.url === currentUrl}
                    />
                  ))}
                {isCourier &&
                  courierNavItems.map((item) => (
                    <NavRow
                      key={item.name}
                      item={item}
                      isActive={item.url === currentUrl}
                    />
                  ))}
                {isCustomer &&
                  customerNavItems.map((item) => (
                    <NavRow
                      key={item.name}
                      item={item}
                      isActive={item.url === currentUrl}
                    />
                  ))}
                {isOwner && (
                  <NavRow
                    item={ratingNavItem}
                    isActive={ratingNavItem.url === currentUrl}
                  />
                )}
              </>
            )}
          </SidebarMenu>
        </SidebarGroup>

        {!isAdmin && (
          <>
            <SidebarSeparator className="mx-2 my-2" />

            <SidebarGroup className="p-0">
              <SidebarGroupLabel className="px-2 py-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
                Management
              </SidebarGroupLabel>
              <SidebarMenu className="gap-1">
                {/* User collapsible item */}
                {!isOwner && (
                  <NavCollapsible
                    label="User"
                    icon={IdCard}
                    iconBg="bg-amber-100"
                    iconColor="text-amber-600"
                    items={userSubItems}
                    currentUrl={currentUrl}
                  />
                )}

                {visibleNavManagement.map((item) => (
                  <NavRow
                    key={item.name}
                    item={item}
                    isActive={item.url === currentUrl}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="px-2 py-3">
        <SidebarSeparator className="mx-0 mb-2" />
        <Popover>
          <PopoverTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-md px-2 py-3 text-left transition-colors hover:bg-accent group-data-[collapsible=icon]:justify-center">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-indigo-500 to-violet-600 text-white text-[11px] font-semibold shadow-sm">
                {initials}
              </div>
              <div className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
                <span className="truncate text-[13px] font-medium leading-none">
                  {user?.name ?? 'User'}
                </span>
                <span className="truncate text-[11px] text-muted-foreground leading-none mt-0.5">
                  {user?.email ?? ''}
                </span>
              </div>
              <ChevronUp className="ml-auto size-3.5 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-52 p-1">
            <div className="flex items-center gap-2 px-2 py-1.5 mb-1">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-indigo-500 to-violet-600 text-white text-[11px] font-semibold">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-medium truncate">
                  {user?.name ?? 'User'}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {user?.email ?? ''}
                </p>
              </div>
            </div>
            <div className="h-px bg-border mb-1" />
            <button
              onClick={signOut}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut className="size-3.5" />
              Sign out
            </button>
          </PopoverContent>
        </Popover>
      </SidebarFooter>
    </Sidebar>
  );
}
