import { db } from '@/src/db';
import { productAdsTable, productsTable } from '@/src/db/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import getOutletID from '@/lib/outlet-id';
import { PromoteManager } from './promote-manager';
import { DashboardHeader } from '@/components/dashboard-header';

export const Page = async () => {
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
    })
    .from(productAdsTable)
    .innerJoin(productsTable, eq(productAdsTable.product_id, productsTable.id))
    .where(eq(productAdsTable.outlet_id, outlet.id))
    .orderBy(desc(productAdsTable.createdAt));

  return (
    <main className="px-4 mx-2 md:mx-6 pb-12 space-y-4">
      <DashboardHeader
        title="Promosi Menu"
        description="Buat iklan untuk produk pian. Iklan akan tampil di dashboard pelanggan setelah disetujui admin."
      />
      <PromoteManager
        products={products}
        ads={ads.map((ad) => ({
          ...ad,
          description: ad.description ?? '',
          rejection_reason: ad.rejection_reason ?? null,
        }))}
      />
    </main>
  );
};

export default Page;
