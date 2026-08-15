"use client";

import Image from "next/image";
import { resolveProductImage, isBackendImage } from "@/lib/image-src";
import { motion, AnimatePresence } from "motion/react";
import { Minus, Plus, Trash2, Tag, X, ArrowRight, ShoppingBasket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { fmtIDR, discountedPrice } from "@/lib/utils/format";
import type { OrderProduct } from "@/components/order/product-card";
import type { OutletPromo } from "@/components/order/outlet-promo-card";
import { useTransition, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getDeliveryFee } from "@/app/dashboard/order/[feature]/[outletId]/action";
import { checkUserHasLocations } from "@/app/dashboard/users/locations/setting/actions";
import { cartNeedsOwnDriver, cartHaulCap } from "@/lib/types";
import { API_URL } from "@/lib/api-url";

type Product = OrderProduct;
type Promo = OutletPromo;

/**
 * Order states that still have someone working on them. Everything else
 * ('delivered', 'cancelled') is finished and blocks nothing.
 */
const ACTIVE_ORDER_STATUSES = [
    'pending',
    'confirmed',
    'preparing',
    'ready',
    'on_delivery',
];

const ACTIVE_CHECK_MS = 10000;

export type CartItem = {
    product: Product;
    quantity: number;
    note: string;
};

export function BasketSheetContent({
    cart,
    onIncrement,
    onDecrement,
    onRemove,
    appliedPromo,
    onRemovePromo,
    outlet_id,
}: {
    cart: CartItem[];
    onIncrement: (id: string) => void;
    onDecrement: (id: string) => void;
    onRemove: (id: string) => void;
    appliedPromo: Promo | null;
    onRemovePromo: () => void;
    outlet_id: number
}) {
    const [isPending, setTransition] = useTransition();
    const [deliveryFee, setDeliveryFee] = useState<number | null>(null);
    const [feeError, setFeeError] = useState<string | null>(null);
    const [hasActiveOrder, setHasActiveOrder] = useState(false);
    const router = useRouter();

    // A customer may only have one order running at a time: the outlet, the
    // courier and the tracking screen all assume a single live job. Checked
    // here, at the last step before the invoice, and re-checked while the sheet
    // stays open so finishing an order re-opens checkout without a reload.
    useEffect(() => {
        let cancelled = false;
        const check = async () => {
            try {
                const res = await fetch(`${API_URL}/api/get-active-order`, {
                    cache: 'no-store',
                    credentials: 'include',
                });
                const data = await res.json();
                if (cancelled) return;
                // The endpoint returns the customer's LATEST order whatever its
                // state, so the statuses are what decide — a delivered or
                // cancelled one is not in the way of anything.
                setHasActiveOrder(
                    !!data?.success && ACTIVE_ORDER_STATUSES.includes(data.order?.status),
                );
            } catch {
                // Never block checkout on a failed check: the customer losing
                // the ability to order because of a network blip is far worse
                // than the double order this is guarding against.
            }
        };
        check();
        const id = setInterval(check, ACTIVE_CHECK_MS);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, []);

    // One bulky item and the outlet hauls the whole order itself. There is no
    // distance fee to fetch in that case — the owner quotes the haul once they
    // have seen the address, capped by the products' price bands.
    const ownDriver = cartNeedsOwnDriver(cart);
    const haulCap = ownDriver ? cartHaulCap(cart) : 0;

    useEffect(() => {
        setDeliveryFee(null);
        setFeeError(null);
        if (ownDriver) return;
        getDeliveryFee(outlet_id).then((result) => {
            if ("error" in result) setFeeError(result.error);
            else setDeliveryFee(result.fee);
        });
    }, [outlet_id, ownDriver]);

    const subtotal = cart.reduce((acc, item) => {
        const price = discountedPrice(item.product.price, item.product.discountPercent);
        return acc + price * item.quantity;
    }, 0);

    const promoDiscount =
        appliedPromo && subtotal >= appliedPromo.minOrder
            ? Math.floor(subtotal * (appliedPromo.discountPercent / 100))
            : 0;

    // On the own-driver lane the haul isn't known yet, so the customer agrees to
    // a ceiling rather than a figure: goods are certain, the rest is bounded.
    const goodsTotal = subtotal - promoDiscount;
    const total = goodsTotal + (ownDriver ? 0 : deliveryFee ?? 0);
    const maxTotal = goodsTotal + haulCap;

    const handleCheckout = () => {
        setTransition(async () => {
            const hasLocation = await checkUserHasLocations();
            if (!hasLocation) {
                router.push("/dashboard/users/locations/setting");
                return;
            }
            sessionStorage.setItem(
                "pos_invoice_draft",
                JSON.stringify({
                    outlet_id, cart, appliedPromo, subtotal, promoDiscount,
                    // On the own-driver lane the fee is still unknown: the invoice
                    // screen shows the ceiling instead, and the backend writes the
                    // real figure when the owner confirms.
                    deliveryFee: ownDriver ? 0 : deliveryFee,
                    total, ownDriver, haulCap, maxTotal,
                })
            );
            router.push("/dashboard/order/invoice");
        });
    }

    if (cart.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
                <ShoppingBasket className="h-16 w-16 opacity-20" />
                <p className="font-bold text-lg">Keranjang kosong</p>
                <p className="text-sm text-center">Tambahkan produk dari menu di bawah</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full m-5">
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                <AnimatePresence>
                    {cart.map((item) => {
                        const finalPrice = discountedPrice(item.product.price, item.product.discountPercent);
                        return (
                            <motion.div
                                key={item.product.id}
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="flex gap-3 p-3 rounded-2xl bg-muted/40 border border-border/50"
                            >
                                <div className="relative h-16 w-16 rounded-xl overflow-hidden flex-shrink-0">
                                    <Image src={resolveProductImage(item.product.image)} unoptimized={isBackendImage(item.product.image)} alt={item.product.product_name} fill className="object-cover" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-bold text-sm leading-tight line-clamp-1">{item.product.product_name}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {fmtIDR(finalPrice)} / {item.product.unit}
                                    </p>
                                    <div className="flex items-center justify-between mt-2">
                                        <div className="flex items-center gap-1.5 bg-background border border-border rounded-xl px-1 h-7">
                                            <button
                                                onClick={() => onDecrement(item.product.id)}
                                                className="h-5 w-5 rounded-lg bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600"
                                            >
                                                <Minus className="h-2.5 w-2.5" />
                                            </button>
                                            <span className="font-black text-xs w-4 text-center">{item.quantity}</span>
                                            <button
                                                onClick={() => onIncrement(item.product.id)}
                                                className="h-5 w-5 rounded-lg bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600"
                                            >
                                                <Plus className="h-2.5 w-2.5" />
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <p className="font-black text-sm text-rose-600">{fmtIDR(finalPrice * item.quantity)}</p>
                                            <button
                                                onClick={() => onRemove(item.product.id)}
                                                className="text-muted-foreground hover:text-destructive transition-colors"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>

            <div className="border-t border-border/60 pt-4 mt-4 space-y-3">
                {appliedPromo && (
                    <div className="flex items-center justify-between rounded-xl bg-green-50 border border-green-200 px-3 py-2">
                        <div className="flex items-center gap-2">
                            <Tag className="h-3.5 w-3.5 text-green-600" />
                            <span className="text-xs font-bold text-green-700">{appliedPromo.code}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-green-700">
                                {promoDiscount > 0 ? `-${fmtIDR(promoDiscount)}` : "Min. belum terpenuhi"}
                            </span>
                            <button onClick={onRemovePromo} className="text-green-600 hover:text-green-800">
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                )}

                <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between text-muted-foreground">
                        <span>Subtotal</span>
                        <span className="font-semibold">{fmtIDR(subtotal)}</span>
                    </div>
                    {promoDiscount > 0 && (
                        <div className="flex justify-between text-green-600">
                            <span>Diskon promo</span>
                            <span className="font-semibold">-{fmtIDR(promoDiscount)}</span>
                        </div>
                    )}
                    {ownDriver ? (
                        <>
                            <div className="flex justify-between text-muted-foreground">
                                <span>Ongkos angkut toko</span>
                                <span className="font-semibold text-amber-600">
                                    maks {fmtIDR(haulCap)}
                                </span>
                            </div>
                            <Separator />
                            <div className="flex justify-between font-black text-base">
                                <span>Total</span>
                                <span className="text-rose-600">
                                    {fmtIDR(goodsTotal)} – {fmtIDR(maxTotal)}
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground pt-1">
                                Barang berat diantar sopir toko, bukan kurir. Ongkos angkut
                                pastinya ditetapkan penjual setelah lihat alamat — tidak akan
                                lebih dari {fmtIDR(haulCap)}, dan pian bisa batalkan sebelum
                                barang berangkat.
                            </p>
                        </>
                    ) : (
                        <>
                            <div className="flex justify-between text-muted-foreground">
                                <span>Ongkos kirim</span>
                                <span className={`font-semibold ${feeError ? "text-destructive" : ""}`}>
                                    {feeError
                                        ? feeError
                                        : deliveryFee === null
                                        ? "Menghitung..."
                                        : fmtIDR(deliveryFee)}
                                </span>
                            </div>
                            <Separator />
                            <div className="flex justify-between font-black text-base">
                                <span>Total</span>
                                <span className="text-rose-600">{fmtIDR(total)}</span>
                            </div>
                        </>
                    )}
                </div>

                {/* One order at a time. Said before the button rather than as a
                    failure after it — the cart itself is untouched, so whatever
                    is in it is still there once the current order is done. */}
                {hasActiveOrder && (
                    <div className="mb-2 rounded-2xl bg-amber-50 px-3 py-2.5 text-xs dark:bg-amber-950/30">
                        <p className="font-bold text-amber-700 dark:text-amber-400">
                            Pesanan pian yang sekarang masih berjalan
                        </p>
                        <p className="mt-0.5 text-muted-foreground">
                            Selesaikan dulu pesanan yang berjalan sebelum memesan lagi.
                            Isi keranjang ini tetap ulun simpan.
                        </p>
                        <button
                            type="button"
                            onClick={() => router.push('/dashboard/activeorder')}
                            className="mt-1.5 font-bold text-rose-600 hover:underline"
                        >
                            Lihat Pesanan Berjalan
                        </button>
                    </div>
                )}

                <Button
                    onClick={handleCheckout}
                    // The own-driver lane never fetches a distance fee, so gating
                    // on deliveryFee there would disable checkout permanently.
                    disabled={
                        isPending ||
                        hasActiveOrder ||
                        (!ownDriver && (!!feeError || deliveryFee === null))
                    }
                    className="w-full rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-black py-6 shadow-lg shadow-rose-200">
                    {hasActiveOrder ? (
                        'Ada Pesanan Berjalan'
                    ) : (
                        <>
                            Checkout <ArrowRight className="ml-2 h-4 w-4" />
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
}
