import { getSession } from '@/lib/auth';
import { db } from '@/src/db';
import {
  adminsTable,
  couriersTable,
  customersTable,
  orderDetailsTable,
  ordersTable,
  outletsTable,
  productsTable,
  usersTable,
} from '@/src/db/schema';
import { alias } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import Forbidden from '@/lib/forbidden';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Bike,
  ChevronLeft,
  Globe,
  Mail,
  MapPin,
  Package,
  Phone,
  Receipt,
  Store,
  Tag,
  User,
  Wallet,
} from 'lucide-react';

const OFFLINE_CUSTOMER_EMAIL = 'rizkygin1@gmail.com';

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  pending: { label: 'Menunggu', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  confirmed: { label: 'Dikonfirmasi', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  preparing: { label: 'Diproses', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  ready: { label: 'Siap', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  on_delivery: { label: 'Diantar', className: 'bg-violet-50 text-violet-700 border-violet-200' },
  delivered: { label: 'Selesai', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  cancelled: { label: 'Dibatalkan', className: 'bg-rose-50 text-rose-700 border-rose-200' },
};

function fmtIDR(n: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}

type OfflineNote = {
  customerName?: string | null;
  discountAmount?: number;
  paymentMethod?: 'cash' | 'non_cash';
  amountPaid?: number;
  changeDue?: number;
};

const Page = async ({ params }: { params: Promise<{ order_id: string }> }) => {
  const { order_id } = await params;
  const session = await getSession();
  if (!session) return <Forbidden />;

  const [admin] = await db
    .select({ id: adminsTable.id })
    .from(adminsTable)
    .where(eq(adminsTable.user_id, session.user.id))
    .limit(1);

  if (!admin) return <Forbidden />;

  const courierUser = alias(usersTable, 'courier_user');

  const [order] = await db
    .select({
      id: ordersTable.id,
      status: ordersTable.status,
      delivery_fee: ordersTable.delivery_fee,
      discount_amount: ordersTable.discount_amount,
      note: ordersTable.note,
      rejected_by: ordersTable.rejected_by,
      rejected_reason: ordersTable.rejected_reason,
      scheduled_at: ordersTable.scheduled_at,
      created_at: ordersTable.createdAt,
      updated_at: ordersTable.updatedAt,
      outlet_name: outletsTable.name,
      outlet_address: outletsTable.address,
      outlet_phone: outletsTable.phone,
      customer_name: usersTable.name,
      customer_email: usersTable.email,
      customer_phone: usersTable.phone,
      customer_address: usersTable.address,
      courier_name: courierUser.name,
      courier_phone: courierUser.phone,
      courier_plate: couriersTable.vehicle_plate,
      courier_vehicle: couriersTable.vehicle_type,
    })
    .from(ordersTable)
    .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
    .innerJoin(usersTable, eq(customersTable.user_id, usersTable.id))
    .innerJoin(outletsTable, eq(ordersTable.outlet_id, outletsTable.id))
    .leftJoin(couriersTable, eq(ordersTable.courier_id, couriersTable.id))
    .leftJoin(courierUser, eq(couriersTable.user_id, courierUser.id))
    .where(eq(ordersTable.id, order_id))
    .limit(1);

  if (!order) return notFound();

  const items = await db
    .select({
      detail_id: orderDetailsTable.id,
      quantity: orderDetailsTable.quantity,
      note: orderDetailsTable.note_product,
      summary_price: orderDetailsTable.summary_price,
      product_name: productsTable.product_name,
      price: productsTable.price,
      category: productsTable.category,
      unit: productsTable.unit,
    })
    .from(orderDetailsTable)
    .innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id))
    .where(eq(orderDetailsTable.order_id, order_id));

  const isOfflineOrder = order.customer_email === OFFLINE_CUSTOMER_EMAIL;
  const offlineNote = isOfflineOrder ? (order.note as OfflineNote | null) : null;

  const subtotal = items.reduce((sum, item) => sum + Number(item.summary_price), 0);
  const deliveryFee = Number(order.delivery_fee ?? 0);
  const discount = Number(order.discount_amount ?? 0) + (offlineNote?.discountAmount ?? 0);
  const totalPaid = subtotal + deliveryFee - discount;

  const s = STATUS_MAP[order.status] ?? STATUS_MAP.pending;

  return (
    <main className="px-4 mx-2 md:mx-6 pb-12 space-y-6">
      <Link
        href="/dashboard/admin/order"
        className="flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" /> Semua Pesanan
      </Link>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1.5">
          <span
            className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider ${
              isOfflineOrder ? 'text-amber-600' : 'text-blue-600'
            }`}
          >
            {isOfflineOrder ? <Store className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}
            {isOfflineOrder ? 'Pesanan Offline' : 'Pesanan Online'}
          </span>
          <h1 className="text-2xl font-black">
            Order #{order.id.slice(-8).toUpperCase()}
          </h1>
          <p className="text-sm text-muted-foreground">
            {order.outlet_name} ·{' '}
            {order.created_at &&
              new Date(order.created_at).toLocaleDateString('id-ID', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black border ${s.className}`}>
          {s.label}
        </span>
      </div>

      {order.status === 'cancelled' && order.rejected_reason && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span className="font-bold">Dibatalkan oleh {order.rejected_by ?? '-'}:</span> {order.rejected_reason}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {/* Outlet, customer, courier info */}
        <div className="md:col-span-1 space-y-6">
          <div className="rounded-2xl border border-border/60 bg-card shadow-sm p-6 space-y-3">
            <div className="flex items-center gap-2 text-sm font-black text-muted-foreground uppercase tracking-widest">
              <Store className="h-4 w-4" /> Outlet
            </div>
            <p className="font-black text-sm">{order.outlet_name}</p>
            {order.outlet_address && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="font-semibold">{order.outlet_address}</span>
              </div>
            )}
            {order.outlet_phone && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Phone className="h-3.5 w-3.5 shrink-0" />
                <span className="font-semibold">{order.outlet_phone}</span>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border/60 bg-card shadow-sm p-6 space-y-3">
            <div className="flex items-center gap-2 text-sm font-black text-muted-foreground uppercase tracking-widest">
              <User className="h-4 w-4" /> Pelanggan
            </div>
            {isOfflineOrder ? (
              <>
                <p className="font-black text-sm">{offlineNote?.customerName || 'Walk-in Customer'}</p>
                <p className="text-xs text-muted-foreground font-semibold">Pesanan Kasir (Offline)</p>
              </>
            ) : (
              <>
                <p className="font-black text-sm">{order.customer_name}</p>
                {order.customer_email && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Mail className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-semibold truncate">{order.customer_email}</span>
                  </div>
                )}
                {order.customer_phone && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-semibold">{order.customer_phone}</span>
                  </div>
                )}
                {order.customer_address && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-semibold">{order.customer_address}</span>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="rounded-2xl border border-border/60 bg-card shadow-sm p-6 space-y-3">
            <div className="flex items-center gap-2 text-sm font-black text-muted-foreground uppercase tracking-widest">
              <Bike className="h-4 w-4" /> Kurir
            </div>
            {order.courier_name ? (
              <>
                <p className="font-black text-sm">{order.courier_name}</p>
                {order.courier_phone && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-semibold">{order.courier_phone}</span>
                  </div>
                )}
                {order.courier_plate && (
                  <p className="text-xs text-muted-foreground font-semibold capitalize">
                    {order.courier_plate} · {order.courier_vehicle}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground font-semibold">Belum ada kurir ditugaskan</p>
            )}
          </div>
        </div>

        {/* Items + payment summary */}
        <div className="md:col-span-2 space-y-4">
          <div className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-border/60 bg-muted/20">
              <Package className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-black text-muted-foreground uppercase tracking-widest">
                {items.length} Item Pesanan
              </span>
            </div>
            <div className="divide-y divide-border/40">
              {items.map((item) => (
                <div key={item.detail_id} className="flex items-start gap-4 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-sm">{item.product_name}</p>
                    <p className="text-xs text-muted-foreground font-semibold capitalize">{item.category}</p>
                    {item.note && <p className="text-xs text-muted-foreground mt-0.5 italic">&quot;{item.note}&quot;</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-black text-sm">{fmtIDR(Number(item.summary_price))}</p>
                    <p className="text-xs text-muted-foreground font-semibold">
                      {item.quantity} {item.unit} × {fmtIDR(Number(item.price))}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card shadow-sm p-5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-black text-muted-foreground uppercase tracking-widest">
              <Receipt className="h-4 w-4" /> Ringkasan Pembayaran
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground font-semibold">Subtotal ({items.length} item)</span>
                <span className="font-bold">{fmtIDR(subtotal)}</span>
              </div>
              {!isOfflineOrder && deliveryFee > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground font-semibold">Ongkos Kirim</span>
                  <span className="font-bold">{fmtIDR(deliveryFee)}</span>
                </div>
              )}
              {discount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground font-semibold flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5" /> Diskon
                  </span>
                  <span className="font-bold text-rose-500">-{fmtIDR(discount)}</span>
                </div>
              )}
              <div className="border-t border-border/60 pt-2 flex justify-between">
                <span className="font-black text-sm">Total Dibayar Pelanggan</span>
                <span className="font-black text-sm text-rose-600">{fmtIDR(totalPaid)}</span>
              </div>
            </div>

            <div className="border-t border-border/60 pt-3 flex justify-between text-sm">
              <span className="text-muted-foreground font-semibold flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5" /> Pendapatan Kurir (Ongkir)
              </span>
              <span className="font-black text-orange-600">
                {deliveryFee > 0 ? fmtIDR(deliveryFee) : 'Tidak ada pengantaran'}
              </span>
            </div>

            {isOfflineOrder && offlineNote && (
              <div className="border-t border-border/60 pt-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground font-semibold flex items-center gap-1.5">
                    <Wallet className="h-3.5 w-3.5" /> Metode Pembayaran
                  </span>
                  <span className="font-bold">{offlineNote.paymentMethod === 'non_cash' ? 'Non-Cash' : 'Cash'}</span>
                </div>
                {offlineNote.paymentMethod !== 'non_cash' && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground font-semibold">Uang Diterima</span>
                      <span className="font-bold">{fmtIDR(offlineNote.amountPaid ?? 0)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground font-semibold">Kembalian</span>
                      <span className="font-bold text-emerald-600">{fmtIDR(offlineNote.changeDue ?? 0)}</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
};

export default Page;
