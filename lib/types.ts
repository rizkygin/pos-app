export type Outlet = {
    id: string;
    name: string;
    image: string;
    tags: string[];
    rating: number;
    reviewCount: number;
    distance: string;
    estimatedTime: string;
    isOpen: boolean;
    feature: string[];
    promoActive: boolean;
};

export type Product = {
    id: string;
    product_name: string;
    image: string;
    price: number;
    price_mark_down?: number;
    buying_price: number;
    ratings: number;
    review_count: number;
    outlet: string;
    outletId: string;
    features: string[];
    is_recommended: boolean;
    discount_percent?: number;
    unit: string;
};

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
