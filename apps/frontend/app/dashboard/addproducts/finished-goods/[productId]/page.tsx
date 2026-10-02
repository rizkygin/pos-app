import { FinishedGoodsExplorer } from './finished-goods-explorer';

// Jelajah Barang Jadi — Jelajah Resep's reverse. Fetches client-side (GET
// /api/products/:id/finished-goods) for the same reason the recipe explorer
// does: zoom, pan and hand-placed nodes must survive a refetch after Paksa Hitung HPP.
// `name` only fills the header while that first request is in flight.
const Page = async ({
    params,
    searchParams,
}: {
    params: Promise<{ productId: string }>;
    searchParams: Promise<{ name?: string }>;
}) => {
    const { productId } = await params;
    const { name } = await searchParams;

    return (
        <main className="mx-2 flex h-[calc(100svh-3rem)] flex-col overflow-hidden py-2 md:mx-6 md:h-[calc(100svh-2.5rem)]">
            <FinishedGoodsExplorer productId={productId} productName={name ?? null} />
        </main>
    );
};

export default Page;
