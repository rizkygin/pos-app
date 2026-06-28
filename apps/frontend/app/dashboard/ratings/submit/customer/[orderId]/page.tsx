import { redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-fetch";
import { RatingSubmitForm } from "@/components/ratings/rating-submit-form";
import { submitCustomerRatingAction } from "@/app/dashboard/ratings/actions";

export default async function CustomerRatingPage({
    params,
}: {
    params: Promise<{ orderId: string }>;
}) {
    const { orderId } = await params;

    // Backend runs the page guards (this customer's delivered order, has products,
    // not already rated). { ok: false } => redirect.
    const res = await serverFetch(`/api/ratings/customer-page?orderId=${orderId}`);
    const data = res.ok ? await res.json() : { ok: false };
    if (!data.ok) redirect("/dashboard/order");
    const { order, products } = data;

    // Inline server action — captures orderId from closure
    async function handleSubmit(
        courierRating: { rating: number; comment: string },
        productRatings: { productId: string; orderDetailId: number; rating: number; comment: string }[]
    ) {
        "use server";
        return submitCustomerRatingAction(orderId, courierRating, productRatings);
    }

    return (
        <main className="px-4 pb-12">
            <RatingSubmitForm
                userType="customer"
                orderId={orderId}
                courier={{
                    name: order.courierName ?? "Kurir",
                    vehicleType: order.vehicleType === "motorcycle" ? "Motor" : "Mobil",
                    vehiclePlate: order.vehiclePlate,
                }}
                products={products.map((p: any) => ({
                    id: p.productId,
                    orderDetailId: p.orderDetailId,
                    name: p.name,
                    quantity: p.quantity,
                }))}
                onSubmit={handleSubmit}
            />
        </main>
    );
}
