import { serverFetch } from '@/lib/server-fetch';
import { PromoteManager } from './promote-manager';
import { DashboardHeader } from '@/components/dashboard-header';

const Page = async () => {
  // Outlet's products + ads (with schedule days/hours) composed by the backend.
  const res = await serverFetch('/api/ads/mine');
  const data = res.ok ? await res.json() : { outlet: null, products: [], ads: [] };

  if (!data.outlet) {
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

  return (
    <main className="px-4 mx-2 md:mx-6 pb-12 space-y-4">
      <PromoteManager products={data.products} ads={data.ads} />
    </main>
  );
};

export default Page;
