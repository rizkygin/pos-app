"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, Tag, Truck, ShoppingBasket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { fmtIDR, discountedPrice } from "@/lib/utils/format";
import { customerMakingOrder } from "@/app/dashboard/order/[feature]/[outletId]/action";
import type { CartItem } from "@/components/order/basket-sheet-content";
import type { OutletPromo } from "@/components/order/outlet-promo-card";

type InvoiceDraft = {
    outlet_id: number;
    cart: CartItem[];
    appliedPromo: OutletPromo | null;
    deliveryFee: number;
    subtotal: number;
    promoDiscount: number;
    total: number;
};

export default function InvoicePage() {
    const router = useRouter();
    const [draft, setDraft] = useState<InvoiceDraft | null>(null);
    const [isPending, startTransition] = useTransition();

    useEffect(() => {
        const raw = sessionStorage.getItem("pos_invoice_draft");
        if (!raw) {
            router.replace("/dashboard/order");
            return;
        }
        setDraft(JSON.parse(raw));
    }, [router]);

    const handleConfirm = () => {
        if (!draft) return;
        startTransition(async () => {
            await customerMakingOrder({
                outlet_id: draft.outlet_id,
                promo_id: draft.appliedPromo ? Number(draft.appliedPromo.id) : undefined,
                discount_amount: draft.promoDiscount > 0 ? draft.promoDiscount : undefined,
                items: draft.cart.map((item) => ({
                    product_id: item.product.id,
                    quantity: item.quantity,
                    note_product: item.note || undefined,
                    summary_price: String(
                        discountedPrice(item.product.price, item.product.discountPercent) * item.quantity
                    ),
                })),
            });
            sessionStorage.removeItem("pos_invoice_draft");
            router.push("/dashboard/activeorder/");
        });
    };

    if (!draft) return null;

    const { cart, appliedPromo, deliveryFee, subtotal, promoDiscount, total } = draft;

    return (
        <div className="min-h-screen bg-background">
            <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => router.back()}
                        className="h-9 w-9 rounded-xl bg-muted flex items-center justify-center hover:bg-muted/80"
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </button>
                    <h1 className="font-black text-xl">Tagihan</h1>
                </div>

                <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Pesanan</p>
                    <div className="space-y-3">
                        {cart.map((item) => {
                            const finalPrice = discountedPrice(item.product.price, item.product.discountPercent);
                            return (
                                <div key={item.product.id} className="flex items-center gap-3">
                                    <div className="relative h-12 w-12 rounded-xl overflow-hidden flex-shrink-0">
                                        <Image
                                            src={item.product.image}
                                            alt={item.product.product_name}
                                            fill
                                            className="object-cover"
                                        />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-sm line-clamp-1">{item.product.product_name}</p>
                                        {item.note && (
                                            <p className="text-xs text-muted-foreground line-clamp-1">Catatan: {item.note}</p>
                                        )}
                                        <p className="text-xs text-muted-foreground">
                                            {fmtIDR(finalPrice)} × {item.quantity}
                                        </p>
                                    </div>
                                    <p className="font-black text-sm text-rose-600 flex-shrink-0">
                                        {fmtIDR(finalPrice * item.quantity)}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="rounded-2xl border border-border bg-card p-4 space-y-2.5 text-sm">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Rincian Pembayaran</p>

                    <div className="flex justify-between text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                            <ShoppingBasket className="h-3.5 w-3.5" /> Subtotal
                        </span>
                        <span className="font-semibold">{fmtIDR(subtotal)}</span>
                    </div>

                    {appliedPromo && promoDiscount > 0 && (
                        <div className="flex justify-between text-green-600">
                            <span className="flex items-center gap-1.5">
                                <Tag className="h-3.5 w-3.5" /> Promo ({appliedPromo.code})
                            </span>
                            <span className="font-semibold">-{fmtIDR(promoDiscount)}</span>
                        </div>
                    )}

                    <div className="flex justify-between text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                            <Truck className="h-3.5 w-3.5" /> Ongkos kirim
                        </span>
                        <span className="font-semibold">{fmtIDR(deliveryFee)}</span>
                    </div>

                    <Separator />

                    <div className="flex justify-between font-black text-base">
                        <span>Total yang harus dibayar</span>
                        <span className="text-rose-600">{fmtIDR(total)}</span>
                    </div>
                </div>

                <div className="pt-2 space-y-2">
                    <Button
                        onClick={handleConfirm}
                        disabled={isPending}
                        className="w-full rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-black py-6 shadow-lg shadow-rose-200"
                    >
                        {isPending ? "Memproses..." : "Konfirmasi & Pesan"}
                    </Button>
                    <Button
                        variant="ghost"
                        onClick={() => {
                            localStorage.setItem("pos_cart", JSON.stringify(draft.cart));
                            router.back();
                        }}
                        disabled={isPending}
                        className="w-full rounded-2xl font-bold"
                    >
                        Kembali ke Keranjang
                    </Button>
                </div>
            </div>
        </div>
    );
}
