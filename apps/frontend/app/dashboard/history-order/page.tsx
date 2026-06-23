import { getSession } from '@/lib/auth';
import { db } from '@/src/db';
import {
  customersTable,
  ordersTable,
  orderDetailsTable,
  outletsTable,
} from '@/src/db/schema';
import { and, desc, eq, sql, sum } from 'drizzle-orm';
import { format } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import { ShoppingBag, CheckCircle2, XCircle, Clock, Bike, Package } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

function fmtIDR(n: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n);
}

const STATUS_CONFIG = {
  pending: {
    label: 'Menunggu',
    icon: Clock,
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  },
  confirmed: {
    label: 'Dikonfirmasi',
    icon: Package,
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  },
  preparing: {
    label: 'Diproses',
    icon: Package,
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  },
  ready: {
    label: 'Siap Diambil',
    icon: Package,
    className: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  },
  on_delivery: {
    label: 'Dalam Pengiriman',
    icon: Bike,
    className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400',
  },
  delivered: {
    label: 'Selesai',
    icon: CheckCircle2,
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  },
  cancelled: {
    label: 'Dibatalkan',
    icon: XCircle,
    className: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  },
} as const;

export default async function HistoryOrderPage() {
  const session = await getSession();

  const [customer] = await db
    .select({ id: customersTable.id })
    .from(customersTable)
    .where(eq(customersTable.user_id, session.user.id))
    .limit(1);

  if (!customer) {
    return (
      <main className="px-4 md:px-6 pb-12 flex flex-col items-center justify-center min-h-[40vh] gap-3">
        <ShoppingBag className="size-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Kamu belum terdaftar sebagai pelanggan.</p>
      </main>
    );
  }

  const orders = await db
    .select({
      id: ordersTable.id,
      status: ordersTable.status,
      createdAt: ordersTable.createdAt,
      outletName: outletsTable.name,
      itemCount: sql<number>`COUNT(${orderDetailsTable.id})`.mapWith(Number),
      totalAmount: sum(
        sql<number>`CAST(${orderDetailsTable.summary_price} AS NUMERIC)`,
      ).mapWith(Number),
    })
    .from(ordersTable)
    .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
    .leftJoin(orderDetailsTable, eq(orderDetailsTable.order_id, ordersTable.id))
    .where(eq(ordersTable.customer_id, customer.id))
    .groupBy(ordersTable.id, outletsTable.name)
    .orderBy(desc(ordersTable.createdAt));

  return (
    <main className="px-4 md:px-6 pb-12 space-y-6">
      <div className="pt-4">
        <h1 className="text-lg font-bold">History Order</h1>
        <p className="text-sm text-muted-foreground">Semua pesanan yang pernah kamu buat</p>
      </div>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[30vh] gap-3 rounded-2xl border border-dashed border-border/60">
          <ShoppingBag className="size-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Belum ada pesanan</p>
          <Link
            href="/dashboard/order"
            className="text-xs font-semibold text-indigo-600 hover:underline"
          >
            Mulai pesan sekarang
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.pending;
            const StatusIcon = cfg.icon;
            const date = order.createdAt
              ? format(new Date(order.createdAt), 'd MMM yyyy, HH:mm', { locale: idLocale })
              : '-';

            return (
              <div
                key={order.id}
                className="rounded-2xl border border-border/60 bg-card shadow-sm p-4 flex items-center gap-4"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-950">
                  <ShoppingBag className="size-5 text-indigo-600 dark:text-indigo-400" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold truncate">
                      #{order.id.slice(-8).toUpperCase()}
                    </span>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold',
                        cfg.className,
                      )}
                    >
                      <StatusIcon className="size-3" />
                      {cfg.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {order.outletName} · {order.itemCount} item · {date}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <p className="text-sm font-bold">{fmtIDR(order.totalAmount ?? 0)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
