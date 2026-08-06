import { redirect } from 'next/navigation';
import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { getRole } from '@/lib/utils/get-role';
import { getSession } from '@/lib/auth';
import { serverFetch } from '@/lib/server-fetch';
import { ActiveOrderAnimation } from '@/components/order/active-order-animation';
import { PendingOrdersLobby } from '@/components/dashboard/pending-orders-lobby';

export default async function ActiveOrderPage() {
  const role = await getRole();

  if (role && role.role === 'owner') {
    // The pickup slip is the same receipt the cashier prints, so it needs the
    // same outlet header (name/address/phone/logo). Fetched here rather than in
    // the client component to match how /dashboard/cashier passes it down.
    const [session, outletRes] = await Promise.all([
      getSession(),
      serverFetch('/api/outlet/me'),
    ]);
    const outlet = outletRes.ok ? (await outletRes.json()).outlet : null;

    // No courier reaches this outlet, so no courier-delivered order can ever
    // arrive. The lobby isn't mounted at all — that stops four endpoints being
    // polled every two seconds forever, and replaces a permanently empty screen
    // with an explanation of why it's empty.
    //
    // The outlet keeps everything it sells over the counter with: cashier,
    // invoices, stock, reports. Only this one flow is unavailable.
    if (outlet && outlet.courier_reachable === false) {
      return (
        <main className="px-4 mx-2 md:mx-6 pb-12 pt-6">
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 dark:bg-amber-950/40">
              <MapPin className="h-8 w-8 text-amber-500" />
            </div>
            <h2 className="text-xl font-black">Belum Terjangkau Kurir</h2>
            <p className="text-sm text-muted-foreground">
              Lokasi {outlet.name} berada di luar area penjemputan kurir Ulun Pesan,
              jadi pesanan antar belum bisa masuk ke outlet ini.
            </p>
            <p className="text-sm text-muted-foreground">
              Kasir, faktur, stok, dan laporan tetap berjalan normal — pian masih
              bisa berjualan langsung di tempat seperti biasa.
            </p>
            <Link
              href="/dashboard/setting"
              className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-rose-500 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-rose-600"
            >
              Periksa Lokasi Outlet
            </Link>
          </div>
        </main>
      );
    }

    return (
      <main className="px-4 mx-2 md:mx-6 pb-12">
        <PendingOrdersLobby
          outletName={outlet?.name ?? ''}
          outletAddress={outlet?.address ?? ''}
          outletPhone={outlet?.phone ?? ''}
          outletLogo={outlet?.avatar ?? ''}
          cashierName={session?.user?.name ?? 'Owner'}
        />
      </main>
    );
  }

  // Customer view — track their own active order.
  const res = await serverFetch('/api/get-active-order');
  const data = res.ok ? await res.json() : null;
  const activeOrder = data?.success ? data.order : null;

  if (!activeOrder) redirect('/dashboard/order');
  // Jasa has its own tracking surface. Materials does NOT — it has goods in
  // transit and real statuses to watch, so it stays on this screen (the courier
  // bits inside are already gated on fulfillment).
  if (activeOrder.fulfillment === 'service') redirect('/dashboard/order');
  if (activeOrder.status === 'delivered')
    redirect(
      // No courier means nobody to rate but the outlet, which is what the
      // service ratings page does.
      activeOrder.fulfillment === 'service' || activeOrder.fulfillment === 'materials'
        ? `/dashboard/ratings/submit/service/${activeOrder.id}`
        : `/dashboard/ratings/submit/customer/${activeOrder.id}`,
    );

  return (
    <main className="px-4 pb-12">
      <ActiveOrderAnimation
        orderId={activeOrder.id}
        status={activeOrder.status as 'pending' | 'confirmed' | 'preparing' | 'ready' | 'on_delivery' | 'delivered' | 'cancelled'}
        orderRef={activeOrder.id.slice(-8).toUpperCase()}
        outletName={activeOrder.outletName}
        statusSince={activeOrder.updatedAt ?? activeOrder.createdAt}
        fulfillment={activeOrder.fulfillment}
        rejectedReason={activeOrder.rejectedReason ?? null}
        deliveryFee={activeOrder.deliveryFee ?? null}
        goodsTotal={activeOrder.goodsTotal ?? null}
        courier={activeOrder.courier ?? null}
      />
    </main>
  );
}
