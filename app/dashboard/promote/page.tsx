import { db } from '@/src/db';
import {
  productAdsTable,
  productsTable,
  productAdsSchedule,
  scheduleProductAdsTable,
} from '@/src/db/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import getOutletID from '@/lib/outlet-id';
import { PromoteManager } from './promote-manager';
import { DashboardHeader } from '@/components/dashboard-header';

const Page = async () => {
  const outlet = await getOutletID();

  if (!outlet) {
    return (
      <main className="px-4 mx-2 md:mx-6 pb-12">
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-8 text-center text-rose-600">
          <h2 className="text-xl font-bold">No Outlet Found</h2>
          <p className="mt-2 text-sm">
            You need to have an active outlet to promote products.
          </p>
        </div>
      </main>
    );
  }

  const products = await db
    .select({
      id: productsTable.id,
      product_name: productsTable.product_name,
      image: productsTable.image,
    })
    .from(productsTable)
    .where(
      and(
        eq(productsTable.outlet_id, outlet.id),
        isNull(productsTable.deletedAt),
      ),
    );

  const ads = await db
    .select({
      id: productAdsTable.id,
      product_id: productAdsTable.product_id,
      product_name: productsTable.product_name,
      title: productAdsTable.title,
      description: productAdsTable.description,
      banner_image: productAdsTable.banner_image,
      status: productAdsTable.status,
      is_active: productAdsTable.is_active,
      rejection_reason: productAdsTable.rejection_reason,
      ends_at: productAdsTable.ends_at,
    })
    .from(productAdsTable)
    .innerJoin(productsTable, eq(productAdsTable.product_id, productsTable.id))
    .where(eq(productAdsTable.outlet_id, outlet.id))
    .orderBy(desc(productAdsTable.createdAt));

  const schedules = await db
    .select({
      ad_id: productAdsSchedule.productAdsSchedule_id,
      time: scheduleProductAdsTable.time,
    })
    .from(productAdsSchedule)
    .innerJoin(
      scheduleProductAdsTable,
      eq(productAdsSchedule.scheduleProductAdsTable_id, scheduleProductAdsTable.id),
    );

  const scheduleByAdId = new Map<number, { days: Set<string>; hours: Set<string> }>();
  for (const { ad_id, time } of schedules) {
    if (!time) continue;
    const entry = scheduleByAdId.get(ad_id) ?? { days: new Set(), hours: new Set() };
    entry.days.add(time.day);
    entry.hours.add(time.hour);
    scheduleByAdId.set(ad_id, entry);
  }

  return (
    <main className="px-4 mx-2 md:mx-6 pb-12 space-y-4">
      <DashboardHeader
        title="Promosi Menu"
        description="Buat iklan untuk produk pian. Iklan akan tampil di dashboard pelanggan setelah disetujui admin."
      />
      <PromoteManager
        products={products}
        ads={ads.map((ad) => {
          const schedule = scheduleByAdId.get(ad.id);
          return {
            ...ad,
            description: ad.description ?? '',
            rejection_reason: ad.rejection_reason ?? null,
            ends_at: ad.ends_at ? ad.ends_at.toISOString() : null,
            schedule_days: schedule ? Array.from(schedule.days) : [],
            schedule_hours: schedule ? Array.from(schedule.hours).sort() : [],
          };
        })}
      />
    </main>
  );
};

export default Page;
