import type { TaxConfig } from "@/lib/tax";

export type Outlet = {
    id: number;
    name: string;
    address: string;
    phone: string;
    lat: string;
    lon: string;
    avatar: string;
    tags: string[];
    is_open: boolean;
    ratings: string;
    review_count: number;
};

export type AddonOption = {
    id: number;
    product_id: string;
    name: string;
    price: number;
    available: boolean;
};

export type AddonGroup = {
    id: number;
    name: string;
    /** >= 1 means the customer must pick ("wajib pilih"). */
    min_select: number;
    /** null = unlimited. */
    max_select: number | null;
    options: AddonOption[];
};

export type Product = {
    id: string;
    product_name: string;
    price: string;
    price_mark_down: string;
    category: string;
    image: string;
    description: string | null;
    unit: string;
    ratings: string;
    review_count: number;
    is_recommended: boolean;
    isAvailable: boolean;
    discount_percent: number | null;
    // Owner-defined menu section. Null for products not assigned to one — those
    // fall back to being grouped under their platform `category`.
    menu_group: string | null;
    menu_group_order: number | null;
    // Order-feature slugs (e.g. ["food"]). Decides which /dashboard/order page
    // the courier "Pesan Antar" link opens.
    features: string[];
    // Variants are product rows (0071): a row with variant_of set is one of its
    // base's options, never a menu item of its own.
    variant_of: string | null;
    variant_name: string | null;
    variant_label: string | null;
    variant_sort: number | null;
    /** The base's add-on questions; a variant inherits them. */
    addon_groups: AddonGroup[];
};

export type MenuAd = {
    id: number;
    title: string;
    description: string;
    bannerImage: string;
    productId: string;
};

/** What /api/get-menu says about ordering from this page. */
export type SelfOrderInfo =
    | {
          enabled: true;
          radiusM: number;
          askServiceType: boolean;
          /** Only when the outlet charges tax and its plan includes it. */
          tax: TaxConfig | null;
          /** The table a QR sticker named (?meja=), when it is a real one. */
          table: { id: number; label: string } | null;
      }
    | { enabled: false; reason: string | null }
    | null;

/** What one unit costs — the promo price when there is one. */
export const priceOf = (p: Pick<Product, "price" | "price_mark_down">) =>
    p.price_mark_down && p.price_mark_down !== "0" && parseFloat(p.price_mark_down) > 0
        ? parseFloat(p.price_mark_down)
        : parseFloat(p.price);

export const isDiscounted = (p: Pick<Product, "price_mark_down">) =>
    !!p.price_mark_down && p.price_mark_down !== "0" && parseFloat(p.price_mark_down) > 0;

/** A base product and everything the customer can pick instead of it. */
export type MenuItem = {
    base: Product;
    /** Base first, then its variants in menu order. Empty when it has none. */
    options: Product[];
    /** Anything here still for sale? A habis base with a Large left still is. */
    sellable: boolean;
    /** Cheapest option, for "mulai Rp…". */
    fromPrice: number;
};

export type MenuSection = {
    label: string;
    order: number;
    items: MenuItem[];
};

/**
 * Bases with their variants folded in, grouped into the owner's menu
 * sections (in their order), falling back to the platform category for
 * products in no section. Items with nothing left to sell are dropped, which
 * is what the page did before variants: sold-out rows never showed.
 */
export function buildSections(products: Product[]): MenuSection[] {
    const byId = new Map(products.map((p) => [p.id, p]));
    const variantsOf = new Map<string, Product[]>();
    for (const p of products) {
        // A variant whose base is gone (not for sale, archived) stands alone.
        if (!p.variant_of || !byId.has(p.variant_of)) continue;
        const list = variantsOf.get(p.variant_of);
        if (list) list.push(p);
        else variantsOf.set(p.variant_of, [p]);
    }

    const bucket = new Map<string, MenuSection>();
    for (const p of products) {
        if (p.variant_of && byId.has(p.variant_of)) continue;
        const variants = (variantsOf.get(p.id) ?? []).sort(
            (a, b) =>
                (a.variant_sort ?? 0) - (b.variant_sort ?? 0) ||
                a.product_name.localeCompare(b.product_name, "id"),
        );
        const options = variants.length ? [p, ...variants] : [];
        const all = options.length ? options : [p];
        const sellable = all.some((o) => o.isAvailable);
        if (!sellable) continue;
        const fromPrice = Math.min(...all.filter((o) => o.isAvailable).map(priceOf));

        const label = p.menu_group ?? p.category;
        const order = p.menu_group ? (p.menu_group_order ?? 0) : Number.POSITIVE_INFINITY;
        const item: MenuItem = { base: p, options, sellable, fromPrice };
        const existing = bucket.get(label);
        if (existing) existing.items.push(item);
        else bucket.set(label, { label, order, items: [item] });
    }

    for (const s of bucket.values()) {
        // Recommended first, otherwise as the owner's list has them.
        s.items.sort((a, b) => Number(b.base.is_recommended) - Number(a.base.is_recommended));
    }
    return [...bucket.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

// Section anchor ids. Group names are owner-typed free text ("Minuman Dingin",
// "Nasi & Mie"), so they can't go into an href unescaped.
export const slugify = (s: string) =>
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "grup";
