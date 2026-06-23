import { CategoryClient } from "@/components/order/category-client";

export default async function FeaturePage({
    params,
}: {
    params: Promise<{ feature: string }>;
}) {
    const { feature } = await params;
    return <CategoryClient feature={feature} />;
}
