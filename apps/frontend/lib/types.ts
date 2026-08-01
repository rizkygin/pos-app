import { z } from "zod";


export const OutletSchema = z.object({
    id: z.number(),
    name: z.string(),
    image: z.string(),
    tags: z.array(z.string().optional()),
    ratings: z.coerce.number(),
    reviewCount: z.number(),
    // Null when there's nothing to measure from — a signed-out visitor, or a
    // customer with no saved address. Better an absent chip than a made-up one.
    estimatedTime: z.string().nullable(),
    // Road distance from the customer's default address, km. Null likewise.
    distanceKm: z.number().nullable().optional(),
    // Beyond the 50 km delivery cap by road. Only ever true on a real routed
    // measurement — absent distance means "unknown", never "too far".
    outOfRange: z.boolean().optional(),
    isOpen: z.boolean(),
    features: z.array(z.string().optional()),
    coverImage: z.string(),
    address: z.string(),
    phone: z.string(),
})

export type Outlet = z.infer<typeof OutletSchema>;


export const ProductSchema = z.object({
    id: z.string(),
    product_name: z.string(),
    price: z.number(),
    price_mark_down: z.number(),
    category: z.string(),
    image: z.string(),
    ratings: z.number(),
    isAvailable: z.boolean(),
    description: z.string(),
    unit: z.string(),
    outlet: z.string(),
    outleid: z.number(),
    reviewCount: z.string(),
    isRecommended: z.boolean().optional(),
    discountPercent: z.number().optional(),
    features: z.array(z.string()).optional(),
    // Range-priced products: jasa, and bulky goods the outlet hauls itself.
    // Null for ordinary fixed-price products.
    lowest_price: z.number().nullable().optional(),
    highest_price: z.number().nullable().optional(),
    // false = too bulky for a courier. Decides the order's lane at checkout and,
    // together with the range above, which kind of ranged product this is.
    courierDeliverable: z.boolean().optional(),
    // The owner's own menu section ("Besi & Baja"), preferred over `category`
    // for the browse tabs. Null/absent when the product isn't in a section.
    menuGroup: z.string().nullable().optional(),
    menuGroupOrder: z.number().nullable().optional(),
});

export type Product = z.infer<typeof ProductSchema>;

/**
 * Is this a jasa product, as opposed to bulky building materials?
 *
 * A price range alone no longer answers that. Both kinds carry
 * [lowest_price, highest_price], but they mean different things: for jasa the
 * band IS the price, negotiated per job; for materials the floor is the goods
 * and the band above it is the outlet's haul cost. `courierDeliverable` is the
 * separator, and it holds because the backend forces it true for every category
 * that doesn't ask the courier question — so only bulky goods can be both
 * ranged and undeliverable.
 *
 * Without this, besi would vanish from the mart/materials catalog and surface
 * under Layanan Jasa instead.
 */
export const isServiceProduct = (p: Product): boolean =>
    p.lowest_price != null && p.courierDeliverable !== false;

/**
 * Does this cart have to be delivered by the outlet's own driver?
 *
 * One bulky item is enough — a courier is never asked to carry half an order.
 * Mirrors resolveLane() on the backend, which is the authority; this copy exists
 * so checkout can show the right totals before the order is created.
 */
export const cartNeedsOwnDriver = (
    items: { product: Pick<Product, 'courierDeliverable'> }[],
): boolean => items.some((i) => i.product.courierDeliverable === false);

/**
 * Ceiling on what the outlet may charge to haul this cart, in rupiah.
 *
 * Each bulky product carries a [lowest_price, highest_price] band: the floor is
 * the goods, the gap above it is the outlet's operational room. A fixed-price
 * product riding along contributes nothing. Mirrors materialsFeeCap() on the
 * backend, which recomputes and enforces it — this is for display only.
 */
export const cartHaulCap = (
    items: { product: Pick<Product, 'lowest_price' | 'highest_price'>; quantity: number }[],
): number =>
    items.reduce((cap, { product, quantity }) => {
        const gap = Math.max(0, (product.highest_price ?? 0) - (product.lowest_price ?? 0));
        return cap + gap * quantity;
    }, 0);

export type Promo = {
    id: string;
    code: string;
    title: string;
    description: string;
    discountPercent: number;
    minOrder: number;
    maxDiscount?: number;
    validUntil: string;
    gradient: string;
    feature: string[];
};
