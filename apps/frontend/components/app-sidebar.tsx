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
  Receipt,
  ClipboardList,
  Star,
  History,
  CalendarClock,
  Megaphone,
  CreditCard,
  Users,
  Calculator,
  FileText,
  FileBarChart,
  ShoppingBag,
  Boxes,
  Truck,
  Home
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
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
    iconBg: 'bg-blue-100 dark:bg-blue-950',
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
  {
    name: 'Order',
    url: '/dashboard/order',
    icon: ShoppingCart,
    iconBg: 'bg-orange-100 dark:bg-orange-950',
    iconColor: 'text-orange-600 dark:text-orange-400',
  },
  {
    name: 'Product',
    url: '/dashboard/addproducts',
    icon: LayoutGrid,
    iconBg: 'bg-green-100 dark:bg-green-950',
    iconColor: 'text-green-600 dark:text-green-400',
  },
  {
    name: 'Laporan',
    url: '/dashboard/reports',
    icon: LetterText,
    iconBg: 'bg-violet-100 dark:bg-violet-950',
    iconColor: 'text-violet-600 dark:text-violet-400',
  },
  {
    name: 'Kasir',
    url: '/dashboard/cashier',
    icon: Building2,
    iconBg: 'bg-cyan-100 dark:bg-cyan-950',
    iconColor: 'text-cyan-600 dark:text-cyan-400',
  },
  {
    name: 'Buku Kas',
    url: '/dashboard/cashflow',
    icon: Book,
    iconBg: 'bg-rose-100 dark:bg-rose-950',
    iconColor: 'text-rose-600 dark:text-rose-400',
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
    iconBg: 'bg-slate-100 dark:bg-slate-800',
    iconColor: 'text-slate-600 dark:text-slate-400',
  },
];

const Sidebar = dynamic(
  () => import('@/components/ui/sidebar').then((mod) => mod.Sidebar),
  {
    ssr: false,
  },
);



const courierNavItems: NavItem[] = [
  {
    name: 'Ruang Tunggu Order',
    url: '/dashboard/lobby',
    icon: Bike,
    iconBg: 'bg-blue-100 dark:bg-blue-950',
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
  {
    name: 'Ratings',
    url: '/dashboard/courier-ratings',
    icon: Star,
    iconBg: 'bg-amber-100 dark:bg-amber-950',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
];

const ownerNavItems: NavItem[] = [
  {
    name: 'Pesanan Aktif',
    url: '/dashboard/activeorder',
    icon: ClipboardList,
    iconBg: 'bg-emerald-100 dark:bg-emerald-950',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    name: 'Pasang Iklan',
    url: '/dashboard/promote',
    icon: Megaphone,
    iconBg: 'bg-rose-100 dark:bg-rose-950',
    iconColor: 'text-rose-600 dark:text-rose-400',
  },
  {
    name: 'Kalkulator HPP',
    url: '/dashboard/hpp-calculator',
    icon: Calculator,
    iconBg: 'bg-amber-100 dark:bg-amber-950',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  {
    name: 'Langganan',
    url: '/dashboard/subscription',
    icon: CreditCard,
    iconBg: 'bg-rose-100 dark:bg-rose-950',
    iconColor: 'text-rose-600 dark:text-rose-400',
  },
  {
    name: 'Karyawan',
    url: '/dashboard/employees',
    icon: Users,
    iconBg: 'bg-teal-100 dark:bg-teal-950',
    iconColor: 'text-teal-600 dark:text-teal-400',
  },
];

const ratingNavItem: NavItem = {
  name: 'Ratings',
  url: '/dashboard/ratings',
  icon: Star,
  iconBg: 'bg-amber-100 dark:bg-amber-950',
  iconColor: 'text-amber-600 dark:text-amber-400',
};

// Owner-only "Faktur & Stok" group. Pages live under /dashboard/invoice/* and
// are gated to the owner role by that route's layout (getSession + role check).
const invoiceNavSubItems = [
  { name: 'Faktur Penjualan', url: '/dashboard/invoice/sales', icon: Receipt },
  { name: 'Faktur Pembelian', url: '/dashboard/invoice/purchase', icon: ShoppingBag },
  { name: 'Laporan Faktur', url: '/dashboard/invoice/reports', icon: FileBarChart },
  { name: 'Stok', url: '/dashboard/invoice/stock', icon: Boxes },
  { name: 'Supplier', url: '/dashboard/invoice/supplier', icon: Truck },
];

const customerNavItems: NavItem[] = [
  {
    name: 'Terjadwal',
    url: '/dashboard/scheduled-order',
    icon: CalendarClock,
    iconBg: 'bg-blue-100 dark:bg-blue-950',
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
  {
    name: 'History Order',
    url: '/dashboard/history-order',
    icon: History,
    iconBg: 'bg-indigo-100 dark:bg-indigo-950',
    iconColor: 'text-indigo-600 dark:text-indigo-400',
  },
];

const adminDashboardNavItem: NavItem = {
  name: 'Dashboard',
  url: '/dashboard/admin',
  icon: LayoutDashboard,
  iconBg: 'bg-blue-100 dark:bg-blue-950',
  iconColor: 'text-blue-600 dark:text-blue-400',
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
    iconBg: 'bg-sky-100 dark:bg-sky-950',
    iconColor: 'text-sky-600 dark:text-sky-400',
  },
  {
    name: 'Manage Courier',
    url: '/dashboard/admin/courier',
    icon: Bike,
    iconBg: 'bg-orange-100 dark:bg-orange-950',
    iconColor: 'text-orange-600 dark:text-orange-400',
  },
  {
    name: 'Manage Customer',
    url: '/dashboard/admin/customer',
    icon: Users,
    iconBg: 'bg-emerald-100 dark:bg-emerald-950',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    name: 'Manage User',
    url: '/dashboard/admin/user',
    icon: IdCard,
    iconBg: 'bg-amber-100 dark:bg-amber-950',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  {
    name: 'Manage Rating',
    url: '/dashboard/admin/rating',
    icon: Star,
    iconBg: 'bg-violet-100 dark:bg-violet-950',
    iconColor: 'text-violet-600 dark:text-violet-400',
  },
];
function NavRow({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const Icon = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        className={cn(
          'clay-item h-12 gap-3 rounded-[18px] px-3 text-[13.5px] font-medium',
          'text-muted-foreground hover:text-foreground',
          'group-data-[collapsible=icon]:size-12! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-2xl! group-data-[collapsible=icon]:px-0!',
          isActive && 'clay-active text-foreground font-semibold',
        )}
      >
        <Link href={item.url}>
          <span className="clay-icon flex size-9 shrink-0 items-center justify-center rounded-xl">
            <Icon className={cn('size-4.5', item.iconColor)} />
          </span>
          <span className="group-data-[collapsible=icon]:hidden">{item.name}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function NavCollapsible({
  label,
  icon: Icon,
  iconColor,
  items,
  currentUrl,
}: {
  label: string;
  icon: LucideIcon;
  iconBg?: string;
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
              'clay-item h-12 gap-3 rounded-[18px] px-3 text-[13.5px] font-medium',
              'text-muted-foreground hover:text-foreground',
              'group-data-[collapsible=icon]:size-12! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-2xl! group-data-[collapsible=icon]:px-0!',
              isActive && 'clay-active text-foreground font-semibold',
            )}
          >
            <span className="clay-icon flex size-9 shrink-0 items-center justify-center rounded-xl">
              <Icon className={cn('size-4.5', iconColor)} />
            </span>
            <span className="group-data-[collapsible=icon]:hidden">{label}</span>
            <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/collapsible:rotate-180 group-data-[collapsible=icon]:hidden" />
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
export function AppSidebar({
  isOwner = false,
  isCourier = false,
  isCustomer = false,
  isAdmin = false,
  isEmployee = false,
  employeePermissions = {},
}: {
  isOwner?: boolean;
  isCourier?: boolean;
  isCustomer?: boolean;
  isAdmin?: boolean;
  isEmployee?: boolean;
  employeePermissions?: Record<string, boolean>;
}) {
  const router = useRouter();
  const currentUrl = useCurrentUrl();
  const { data: session } = useSession();
  const ownerOnlyNames = new Set(['Product', 'Laporan', 'Kasir', 'Buku Kas']);
  // Employees see exactly the pages their permission map allows (set by the
  // owner in /dashboard/employees). Keys mirror backend EMPLOYEE_PERMISSIONS.
  const can = (perm: string) => employeePermissions?.[perm] === true;
  const employeeNavPerm: Record<string, string> = {
    Dashboard: 'reports',
    Product: 'products',
    Laporan: 'reports',
    Kasir: 'cashier',
    'Buku Kas': 'cashflow',
  };
  const employeeInvoiceSubPerm: Record<string, string> = {
    'Faktur Penjualan': 'salesInvoice',
    'Faktur Pembelian': 'purchaseInvoice',
    'Laporan Faktur': 'reports',
    Stok: 'stock',
    Supplier: 'purchaseInvoice',
  };
  const employeeInvoiceItems = invoiceNavSubItems.filter((i) =>
    can(employeeInvoiceSubPerm[i.name] ?? ''),
  );
  const visibleNavMain = isEmployee
    ? navMain.filter(
        (item) => employeeNavPerm[item.name] && can(employeeNavPerm[item.name]),
      )
    : isOwner
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
        onSuccess: () => router.push('/login'),
      },
    });
  };

  return (
    <Sidebar
      collapsible="icon"
      variant="inset"
      style={
        {
          '--sidebar-border': 'transparent',
        } as React.CSSProperties
      }
    >
      <SidebarHeader className="px-3 py-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild
              className="h-auto gap-3 rounded-[18px] px-2 py-2 hover:bg-transparent! group-data-[collapsible=icon]:size-12! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-2xl!"
            >
              <Link href="/dashboard">
                <span className="clay-icon flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl">
                  <Image
                    src="/icons/icon-192x192.png"
                    alt="Ulun Pesan"
                    width={44}
                    height={44}
                    className="size-9 rounded-lg object-cover"
                  />
                </span>
                <div className="flex min-w-0 flex-col text-left group-data-[collapsible=icon]:hidden">
                  <span className="truncate text-[14px] font-semibold leading-none">
                    Ulun Pesan
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground leading-none mt-1.5">
                    Pangkalan Bun Punya
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="px-2 py-1 gap-0">
        <SidebarGroup className="p-0">
          <SidebarGroupLabel className="px-2 py-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
            FITUR
          </SidebarGroupLabel>
          <SidebarMenu className="gap-3">
            {isAdmin ? (
              <>
                <NavRow
                  item={adminDashboardNavItem}
                  isActive={adminDashboardNavItem.url === currentUrl}
                />
                <NavCollapsible
                  label="Menu"
                  icon={LayoutGrid}
                  iconBg="bg-green-100 dark:bg-green-950"
                  iconColor="text-green-600 dark:text-green-400"
                  items={adminMenuSubItems}
                  currentUrl={currentUrl}
                />
                <NavCollapsible
                  label="Outlet"
                  icon={Building2}
                  iconBg="bg-cyan-100 dark:bg-cyan-950"
                  iconColor="text-cyan-600 dark:text-cyan-400"
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
                {isEmployee && can('activeOrders') && (
                  <NavRow
                    item={ownerNavItems[0]}
                    isActive={ownerNavItems[0].url === currentUrl}
                  />
                )}
                {(isOwner || (isEmployee && employeeInvoiceItems.length > 0)) && (
                  <NavCollapsible
                    label="Faktur & Stok"
                    icon={FileText}
                    iconBg="bg-teal-100 dark:bg-teal-950"
                    iconColor="text-teal-600 dark:text-teal-400"
                    items={isEmployee ? employeeInvoiceItems : invoiceNavSubItems}
                    currentUrl={currentUrl}
                  />
                )}
              </>
            )}
          </SidebarMenu>
        </SidebarGroup>

        {!isAdmin && (
          <>
            <div className="clay-divider mx-2 my-3" />

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
                    iconBg="bg-amber-100 dark:bg-amber-950"
                    iconColor="text-amber-600 dark:text-amber-400"
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
        <div className="clay-divider mx-1 mb-3" />
        <Popover>
          <PopoverTrigger asChild>
            <button className="clay-item flex w-full items-center gap-3 rounded-[18px] px-2 py-2.5 text-left group-data-[collapsible=icon]:size-12! group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-2xl! group-data-[collapsible=icon]:px-0!">
              <div className="clay-raised flex size-9 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-indigo-500 to-violet-600 text-white text-[11px] font-semibold">
                {initials}
              </div>
              <div className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
                <span className="truncate text-[13px] font-semibold leading-none">
                  {user?.name ?? 'User'}
                </span>
                <span className="truncate text-[11px] text-muted-foreground leading-none mt-1">
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
            <Link
              href="/dashboard/user"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] text-foreground hover:bg-accent transition-colors"
            >
              <UserCog className="size-3.5" />
              User Setting
            </Link>
            <button
              onClick={signOut}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
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
