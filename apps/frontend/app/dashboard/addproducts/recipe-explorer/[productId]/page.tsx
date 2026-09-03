import { RecipeExplorer } from './recipe-explorer';

// The explorer fetches its own data client-side (GET
// /api/products/:id/recipe-explorer) because everything on it — variant
// switching, add-on toggles, expanding a branch — re-reads the same graph, and
// zoom/pan must survive all of it. `name` is only a placeholder for the header
// while that first request is in flight; the response carries the real name.
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
            <RecipeExplorer productId={productId} productName={name ?? null} />
        </main>
    );
};

export default Page;
