import { z } from "zod";


export const OutletSchema = z.object({
    id: z.number(),
    name: z.string(),
    image: z.string(),
    tags: z.array(z.string().optional()),
    ratings: z.coerce.number(),
    reviewCount: z.number(),
    estimatedTime: z.string(),
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
});

export type Product = z.infer<typeof ProductSchema>;

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
