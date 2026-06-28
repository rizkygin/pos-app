import { redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-fetch";
import { RatingSubmitForm } from "@/components/ratings/rating-submit-form";
import { submitCourierRatingAction } from "@/app/dashboard/ratings/actions";

export default async function CourierRatingPage({
    params,
}: {
    params: Promise<{ orderId: string }>;
}) {
    const { orderId } = await params;

    // Backend runs the page guards (this courier's delivered order, has details,
    // not already rated). { ok: false } => redirect.
    const res = await serverFetch(`/api/ratings/courier-page?orderId=${orderId}`);
    const data = res.ok ? await res.json() : { ok: false };
    if (!data.ok) redirect("/dashboard/order");
    const { order } = data;

    // Inline server action — captures orderId from closure
    async function handleSubmit(
        customerRating: { rating: number; comment: string },
        outletRating: { rating: number; comment: string }
    ) {
        "use server";
        return submitCourierRatingAction(orderId, customerRating, outletRating);
    }

    return (
        <main className="px-4 pb-12">
            <RatingSubmitForm
                userType="courier"
                orderId={orderId}
                customer={{
                    name: order.customerName ?? "Pelanggan",
                    phone: order.customerPhone ?? null,
                }}
                outlet={{
                    name: order.outletName,
                    address: order.outletAddress,
                }}
                onSubmit={handleSubmit}
            />
        </main>
    );
}
